const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { g3Error, sha256 } = require('./g3ReviewContract');

const PROMOTION_DIRECTORY = 'g3-production-v1';
const LOCK_FILE = 'promotion.lock';
const BACKUP_FILE = 'previous_selected_takes.json';
const PENDING_FILE = 'promotion_pending.json';
const RECEIPT_FILE = 'promotion_receipt.json';
const PRIVATE_TEMP_PREFIX = '.g3-promotion-private-';
const PRODUCTION_TEMP_PREFIX = '.g3-selected-takes-';
const MAX_TARGET_BYTES = 2 * 1024 * 1024;

function identity(stats) {
    return {
        dev: stats.dev,
        ino: stats.ino,
        mode: stats.mode,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
    };
}

function sameIdentity(left, right) {
    return Boolean(left && right)
        && ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every((key) => left[key] === right[key]);
}

function assertDirectory(directoryPath, code, exactMode = null) {
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw g3Error(code, 'Directory is missing'); }
    if (stats.isSymbolicLink() || !stats.isDirectory() || (exactMode !== null && (stats.mode & 0o777) !== exactMode)
        || fs.realpathSync.native(directoryPath) !== directoryPath) {
        throw g3Error(code, 'Directory is unsafe');
    }
    return stats;
}

function exactPromotionPaths(userDataPath, rootFingerprint) {
    if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath) || path.normalize(userDataPath) !== userDataPath
        || userDataPath.includes('\0') || !/^[a-f0-9]{64}$/.test(rootFingerprint)) {
        throw g3Error('G3_PROMOTION_USER_DATA_INVALID', 'Electron userData path is invalid');
    }
    const namespace = rootFingerprint.slice(0, 24);
    const promotionRoot = path.join(userDataPath, 'film-pipeline', 'promotions', PROMOTION_DIRECTORY, namespace);
    return {
        promotionRoot,
        lockPath: path.join(promotionRoot, LOCK_FILE),
        backupPath: path.join(promotionRoot, BACKUP_FILE),
        pendingPath: path.join(promotionRoot, PENDING_FILE),
        receiptPath: path.join(promotionRoot, RECEIPT_FILE),
    };
}

function ensurePromotionRoot(userDataPath, paths) {
    assertDirectory(userDataPath, 'G3_PROMOTION_USER_DATA_INVALID');
    const components = ['film-pipeline', 'promotions', PROMOTION_DIRECTORY, path.basename(paths.promotionRoot)];
    let current = userDataPath;
    for (const [index, component] of components.entries()) {
        current = path.join(current, component);
        try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        assertDirectory(current, 'G3_PROMOTION_DIRECTORY_UNSAFE', index === 0 ? null : 0o700);
    }
    if (current !== paths.promotionRoot) throw g3Error('G3_PROMOTION_DIRECTORY_UNSAFE', 'Promotion namespace mismatch');
}

function randomTemp(parent, prefix, context = {}) {
    const randomBytes = context.promotionRandomBytes || crypto.randomBytes;
    return path.join(parent, `${prefix}${process.pid}-${randomBytes(12).toString('hex')}`);
}

function writeExclusiveFile(filePath, buffer, mode = 0o600) {
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw g3Error('G3_NOFOLLOW_UNAVAILABLE', 'No-follow writes are unavailable');
    }
    let descriptor;
    let created = false;
    try {
        descriptor = fs.openSync(
            filePath,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
            mode,
        );
        created = true;
        fs.fchmodSync(descriptor, mode);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        const stats = fs.fstatSync(descriptor);
        if (!stats.isFile() || (stats.mode & 0o777) !== mode || stats.size !== buffer.byteLength) {
            throw g3Error('G3_PROMOTION_TEMP_UNSAFE', 'Exclusive file verification failed');
        }
        return identity(stats);
    } catch (error) {
        if (created) {
            if (descriptor !== undefined) {
                try { fs.closeSync(descriptor); } catch { /* cleanup continues */ }
                descriptor = undefined;
            }
            try { fs.unlinkSync(filePath); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError.code; }
        }
        throw error;
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function privateAtomicWrite(filePath, buffer, context = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.byteLength <= 0 || buffer.byteLength > MAX_TARGET_BYTES) {
        throw g3Error('G3_PROMOTION_PRIVATE_WRITE_INVALID', 'Private promotion record is invalid');
    }
    const parent = path.dirname(filePath);
    const before = assertDirectory(parent, 'G3_PROMOTION_DIRECTORY_UNSAFE', 0o700);
    try {
        const target = fs.lstatSync(filePath);
        if (target.isSymbolicLink() || !target.isFile() || (target.mode & 0o777) !== 0o600) {
            throw g3Error('G3_PROMOTION_PRIVATE_TARGET_UNSAFE', 'Private promotion target is unsafe');
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const tempPath = randomTemp(parent, PRIVATE_TEMP_PREFIX, context);
    let renamed = false;
    try {
        writeExclusiveFile(tempPath, buffer);
        const after = assertDirectory(parent, 'G3_PROMOTION_DIRECTORY_UNSAFE', 0o700);
        if (before.dev !== after.dev || before.ino !== after.ino) {
            throw g3Error('G3_PROMOTION_PARENT_CHANGED', 'Private promotion parent changed');
        }
        const renameFile = context.promotionPrivateRenameFile || fs.renameSync;
        renameFile(tempPath, filePath);
        renamed = true;
        const written = fs.lstatSync(filePath);
        if (written.isSymbolicLink() || !written.isFile() || (written.mode & 0o777) !== 0o600
            || written.size !== buffer.byteLength) {
            throw g3Error('G3_PROMOTION_PRIVATE_TARGET_UNSAFE', 'Private promotion record is unsafe');
        }
    } finally {
        if (!renamed) {
            try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
}

function acquirePromotionLock(paths, tokenHash, context = {}) {
    const lockBuffer = Buffer.from(`${JSON.stringify({ schema_version: 'film_pipeline.g3_promotion_lock.v1', token_sha256: tokenHash })}\n`);
    let lockIdentity;
    try {
        lockIdentity = writeExclusiveFile(paths.lockPath, lockBuffer);
    } catch (error) {
        if (error.code === 'EEXIST') throw g3Error('G3_PROMOTION_LOCKED', 'Another promotion owns the private lock');
        throw error;
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        let current;
        try { current = fs.lstatSync(paths.lockPath); } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        if (current.isSymbolicLink() || !current.isFile() || !sameIdentity(lockIdentity, identity(current))) {
            throw g3Error('G3_PROMOTION_LOCK_CHANGED', 'Promotion lock identity changed');
        }
        fs.unlinkSync(paths.lockPath);
    };
}

function readTarget(targetPath) {
    let before;
    try { before = fs.lstatSync(targetPath); } catch (error) {
        if (error.code === 'ENOENT') return { exists: false, sha256: '', size: 0, mode: 0, identity: null, buffer: null };
        throw error;
    }
    if (before.isSymbolicLink() || !before.isFile() || before.size <= 0 || before.size > MAX_TARGET_BYTES) {
        const code = before.size > MAX_TARGET_BYTES ? 'G3_PROMOTION_TARGET_TOO_LARGE' : 'G3_PROMOTION_TARGET_UNSAFE';
        throw g3Error(code, 'Production selected takes target is unsafe');
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw g3Error('G3_NOFOLLOW_UNAVAILABLE', 'No-follow reads are unavailable');
    let descriptor;
    try {
        descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor);
        if (!sameIdentity(identity(before), identity(opened))) throw g3Error('G3_PROMOTION_TARGET_CHANGED', 'Target changed before read');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(targetPath);
        if (buffer.byteLength !== opened.size || !sameIdentity(identity(opened), identity(after))
            || !sameIdentity(identity(opened), identity(pathAfter))) {
            throw g3Error('G3_PROMOTION_TARGET_CHANGED', 'Target changed during read');
        }
        return {
            exists: true,
            sha256: sha256(buffer),
            size: buffer.byteLength,
            mode: opened.mode & 0o777,
            identity: identity(opened),
            buffer,
        };
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function sameTargetSnapshot(left, right) {
    if (left.exists !== right.exists) return false;
    if (!left.exists) return true;
    return left.sha256 === right.sha256 && left.size === right.size && left.mode === right.mode
        && sameIdentity(left.identity, right.identity);
}

function assertRootIdentity(rootInfo) {
    const current = assertDirectory(rootInfo.root, 'G3_PRODUCTION_ROOT_UNSAFE');
    if (fs.realpathSync.native(rootInfo.root) !== rootInfo.realRoot
        || current.dev !== rootInfo.stats.dev || current.ino !== rootInfo.stats.ino) {
        throw g3Error('G3_PROMOTION_ROOT_CHANGED', 'Configured production root changed');
    }
    return current;
}

function fsyncDirectory(directoryPath) {
    let descriptor;
    try {
        descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
        fs.fsyncSync(descriptor);
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function replaceSelectedTakes(rootInfo, selectedBuffer, expectedTarget, context = {}) {
    if (!Buffer.isBuffer(selectedBuffer) || selectedBuffer.byteLength <= 0 || selectedBuffer.byteLength > MAX_TARGET_BYTES) {
        throw g3Error('G3_PROMOTION_SELECTED_TAKES_INVALID', 'Selected takes payload is invalid');
    }
    assertRootIdentity(rootInfo);
    const targetPath = path.join(rootInfo.root, 'selected_takes.json');
    const current = readTarget(targetPath);
    if (!sameTargetSnapshot(current, expectedTarget)) throw g3Error('G3_PROMOTION_TARGET_STALE', 'Target changed after plan');
    const tempPath = randomTemp(rootInfo.root, PRODUCTION_TEMP_PREFIX, context);
    let renamed = false;
    try {
        writeExclusiveFile(tempPath, selectedBuffer);
        assertRootIdentity(rootInfo);
        const beforeCommit = readTarget(targetPath);
        if (!sameTargetSnapshot(beforeCommit, expectedTarget)) throw g3Error('G3_PROMOTION_TARGET_STALE', 'Target changed before commit');
        const renameFile = context.promotionRenameFile || fs.renameSync;
        renameFile(tempPath, targetPath);
        renamed = true;
        fsyncDirectory(rootInfo.root);
        const written = readTarget(targetPath);
        if (!written.exists || written.sha256 !== sha256(selectedBuffer) || written.size !== selectedBuffer.byteLength
            || written.mode !== 0o600) {
            throw g3Error('G3_PROMOTION_POST_WRITE_MISMATCH', 'Committed selected takes failed stable verification');
        }
        return written;
    } finally {
        if (!renamed) {
            try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
}

module.exports = {
    MAX_TARGET_BYTES,
    PRODUCTION_TEMP_PREFIX,
    exactPromotionPaths,
    ensurePromotionRoot,
    privateAtomicWrite,
    acquirePromotionLock,
    readTarget,
    sameTargetSnapshot,
    replaceSelectedTakes,
};
