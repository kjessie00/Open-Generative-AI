const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    APPROVED_CANDIDATE_PREFIXES,
    MEDIA_MIME_TYPES,
    MAX_SOURCE_JSON_BYTES,
    exactKeys,
    boundedText,
    g3Error,
    sha256,
} = require('./g3ReviewContract');

const MAX_CANDIDATES = 120;
const MAX_CANDIDATE_BYTES = 256 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 1024 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const SESSION_TOKEN_SECRET = crypto.randomBytes(32);

function stableIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function assertMainOwnedRoot(config = {}) {
    const root = config.productionRoot;
    if (typeof root !== 'string' || !root || root.includes('\0') || !path.isAbsolute(root) || path.normalize(root) !== root) {
        throw g3Error('G3_PRODUCTION_ROOT_NOT_CONFIGURED', 'Configured production root is invalid');
    }
    let stats;
    try { stats = fs.lstatSync(root); } catch { throw g3Error('G3_PRODUCTION_ROOT_MISSING', 'Production root is missing'); }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw g3Error('G3_PRODUCTION_ROOT_UNSAFE', 'Production root must be a real directory');
    }
    const realRoot = fs.realpathSync.native(root);
    if (realRoot !== root) throw g3Error('G3_PRODUCTION_ROOT_UNSAFE', 'Production root contains symlinks');
    return { root, realRoot, stats };
}

function assertRelativeCandidate(relativePath) {
    if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')
        || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
        throw g3Error('G3_CANDIDATE_PATH_UNSAFE', 'Candidate path is invalid');
    }
    const normalized = path.posix.normalize(relativePath);
    if (normalized !== relativePath || normalized.startsWith('../')
        || !APPROVED_CANDIDATE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
        throw g3Error('G3_CANDIDATE_PATH_UNSAFE', 'Candidate path is not allowlisted');
    }
    const extension = path.extname(normalized).toLowerCase();
    if (!Object.hasOwn(MEDIA_MIME_TYPES, extension)) {
        throw g3Error('G3_CANDIDATE_TYPE_UNSUPPORTED', 'Candidate media type is unsupported');
    }
    return { normalized, extension };
}

function assertCandidateAncestors(root, relativePath) {
    const components = relativePath.split('/');
    let cursor = root;
    for (let index = 0; index < components.length; index += 1) {
        cursor = path.join(cursor, components[index]);
        let stats;
        try { stats = fs.lstatSync(cursor); } catch { throw g3Error('G3_CANDIDATE_MISSING', 'Candidate path is missing'); }
        if (stats.isSymbolicLink()) throw g3Error('G3_CANDIDATE_SYMLINK', 'Candidate path contains a symlink');
        if (index < components.length - 1 && !stats.isDirectory()) {
            throw g3Error('G3_CANDIDATE_PARENT_UNSAFE', 'Candidate parent is not a directory');
        }
        if (index === components.length - 1 && !stats.isFile()) {
            throw g3Error('G3_CANDIDATE_NOT_REGULAR', 'Candidate is not a regular file');
        }
    }
    return cursor;
}

function hashStableFile(filePath, maxBytes) {
    const before = fs.lstatSync(filePath);
    if (before.isSymbolicLink() || !before.isFile() || before.size <= 0 || before.size > maxBytes) {
        throw g3Error(before.size > maxBytes ? 'G3_CANDIDATE_TOO_LARGE' : 'G3_CANDIDATE_NOT_REGULAR', 'Candidate file is unsafe');
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw g3Error('G3_NOFOLLOW_UNAVAILABLE', 'No-follow reads are unavailable');
    }
    let descriptor;
    try {
        descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor);
        if (!stableIdentity(before, opened)) throw g3Error('G3_CANDIDATE_CHANGED', 'Candidate changed before hashing');
        const digest = crypto.createHash('sha256');
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (position < opened.size) {
            const read = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, opened.size - position), position);
            if (read <= 0) throw g3Error('G3_CANDIDATE_CHANGED', 'Candidate ended during hashing');
            digest.update(chunk.subarray(0, read));
            position += read;
        }
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(filePath);
        if (!stableIdentity(opened, after) || !stableIdentity(opened, pathAfter)) {
            throw g3Error('G3_CANDIDATE_CHANGED', 'Candidate changed during hashing');
        }
        return { sha256: digest.digest('hex'), stats: opened };
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function readStableFile(filePath, maxBytes, { privateFile = false } = {}) {
    const before = fs.lstatSync(filePath);
    if (before.isSymbolicLink() || !before.isFile() || before.size <= 0 || before.size > maxBytes
        || (privateFile && (before.mode & 0o777) !== 0o600)) {
        throw g3Error(privateFile ? 'G3_DRAFT_FILE_UNSAFE' : 'G3_SOURCE_FILE_UNSAFE', 'File is unsafe');
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw g3Error('G3_NOFOLLOW_UNAVAILABLE', 'No-follow reads are unavailable');
    let descriptor;
    try {
        descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor);
        if (!stableIdentity(before, opened)) throw g3Error('G3_SOURCE_CHANGED', 'File changed before read');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(filePath);
        if (buffer.byteLength !== opened.size || !stableIdentity(opened, after) || !stableIdentity(opened, pathAfter)) {
            throw g3Error('G3_SOURCE_CHANGED', 'File changed during read');
        }
        return { buffer, stats: opened, sha256: sha256(buffer) };
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function sourceHash(root, relativePath) {
    return readStableFile(path.join(root, relativePath), MAX_SOURCE_JSON_BYTES).sha256;
}

function safeJson(filePath) {
    const read = readStableFile(filePath, MAX_SOURCE_JSON_BYTES);
    let value;
    try { value = JSON.parse(read.buffer.toString('utf8')); } catch { throw g3Error('G3_SOURCE_JSON_INVALID', 'Source JSON is malformed'); }
    return { ...read, value };
}

function candidateToken(secret, rootFingerprint, candidate) {
    return crypto.createHmac('sha256', secret)
        .update(`${rootFingerprint}\0${candidate.relativePath}\0${candidate.sha256}\0${candidate.sizeBytes}`)
        .digest('base64url');
}

function inventoryFromReader(rootInfo, readerState, context = {}) {
    const blockers = [];
    if (readerState?.security?.walk_truncated) blockers.push('G3_PRODUCTION_SCAN_TRUNCATED');
    const candidateSymlinks = readerState?.security?.skipped_paths?.symlink || [];
    if (candidateSymlinks.some((relativePath) => APPROVED_CANDIDATE_PREFIXES.some((prefix) => (
        String(relativePath).split(path.sep).join('/').startsWith(prefix)
    )))) blockers.push('G3_PRODUCTION_SCAN_SKIPPED_SYMLINKS');
    const paths = Array.from(new Set((readerState?.files || [])
        .map((file) => String(file.relative_path || '').split(path.sep).join('/'))
        .filter((relativePath) => APPROVED_CANDIDATE_PREFIXES.some((prefix) => relativePath.startsWith(prefix)))
        .filter((relativePath) => Object.hasOwn(MEDIA_MIME_TYPES, path.extname(relativePath).toLowerCase()))))
        .sort();
    if (paths.length > MAX_CANDIDATES) throw g3Error('G3_CANDIDATE_LIMIT_EXCEEDED', 'Candidate count exceeds the limit');
    const rootFingerprint = sha256(`${rootInfo.realRoot}\0${rootInfo.stats.dev}\0${rootInfo.stats.ino}`);
    const records = [];
    let totalBytes = 0;
    for (const rawRelativePath of paths) {
        try {
            const { normalized, extension } = assertRelativeCandidate(rawRelativePath);
            const filePath = assertCandidateAncestors(rootInfo.root, normalized);
            const realPath = fs.realpathSync.native(filePath);
            if (!realPath.startsWith(`${rootInfo.realRoot}${path.sep}`)) throw g3Error('G3_CANDIDATE_PATH_UNSAFE', 'Candidate escaped production root');
            const hashed = hashStableFile(filePath, MAX_CANDIDATE_BYTES);
            totalBytes += hashed.stats.size;
            if (totalBytes > MAX_INVENTORY_BYTES) throw g3Error('G3_CANDIDATE_INVENTORY_TOO_LARGE', 'Candidate inventory is too large');
            const duration = context.durationByRelativePath?.[normalized];
            const durationAuthoritative = typeof duration === 'number' && Number.isFinite(duration) && duration > 0;
            const candidate = {
                relativePath: normalized,
                fileName: path.basename(normalized),
                extension,
                mimeType: MEDIA_MIME_TYPES[extension],
                sizeBytes: hashed.stats.size,
                sha256: hashed.sha256,
                durationSec: durationAuthoritative ? duration : null,
                durationAuthoritative,
                previewAllowed: hashed.stats.size <= MAX_PREVIEW_BYTES,
            };
            candidate.token = candidateToken(context.tokenSecret || SESSION_TOKEN_SECRET, rootFingerprint, candidate);
            records.push(candidate);
        } catch (error) {
            if (error.code === 'G3_CANDIDATE_INVENTORY_TOO_LARGE') throw error;
            blockers.push(error.code || 'G3_CANDIDATE_REJECTED');
        }
    }
    if (!records.length) blockers.push('G3_CANDIDATE_INVENTORY_EMPTY');
    const inventoryHash = sha256(JSON.stringify(records.map((record) => ({
        relative_path: record.relativePath,
        size_bytes: record.sizeBytes,
        sha256: record.sha256,
        duration_sec: record.durationSec,
        duration_authoritative: record.durationAuthoritative,
    }))));
    return { records, blockers: Array.from(new Set(blockers)), inventoryHash, rootFingerprint };
}

function revalidateCandidate(rootInfo, candidate) {
    const filePath = assertCandidateAncestors(rootInfo.root, candidate.relativePath);
    const hashed = hashStableFile(filePath, MAX_CANDIDATE_BYTES);
    if (hashed.sha256 !== candidate.sha256 || hashed.stats.size !== candidate.sizeBytes) {
        throw g3Error('G3_CANDIDATE_CHANGED', 'Candidate changed after inventory');
    }
    return filePath;
}

function loadCandidatePreview(payload, rootInfo, inventory) {
    exactKeys(payload, ['candidateToken'], 'G3_PREVIEW_REQUEST_INVALID');
    const token = boundedText(payload.candidateToken, 'G3_CANDIDATE_TOKEN_INVALID', 256);
    const candidate = inventory.records.find((record) => record.token === token);
    if (!candidate) throw g3Error('G3_CANDIDATE_TOKEN_INVALID', 'Candidate token is invalid');
    if (!candidate.previewAllowed) {
        return { ok: false, loaded: false, executed: false, error: 'G3_CANDIDATE_PREVIEW_TOO_LARGE' };
    }
    const filePath = revalidateCandidate(rootInfo, candidate);
    const read = readStableFile(filePath, MAX_PREVIEW_BYTES);
    if (read.sha256 !== candidate.sha256) throw g3Error('G3_CANDIDATE_CHANGED', 'Candidate changed before preview');
    return {
        ok: true,
        loaded: true,
        executed: false,
        candidate_token: candidate.token,
        mime_type: candidate.mimeType,
        byte_length: read.buffer.byteLength,
        sha256: candidate.sha256,
        base64: read.buffer.toString('base64'),
    };
}

module.exports = {
    assertMainOwnedRoot,
    assertRelativeCandidate,
    assertCandidateAncestors,
    hashStableFile,
    readStableFile,
    sourceHash,
    safeJson,
    inventoryFromReader,
    revalidateCandidate,
    loadCandidatePreview,
};
