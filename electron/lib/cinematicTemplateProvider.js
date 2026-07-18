const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const newProjectDraftProvider = require('./newProjectDraftProvider');

const CINEMATIC_TEMPLATE_SCHEMA = 'film_pipeline.cinematic_template.v1';
const TEMPLATE_FILE = 'cinematic-template.json';
const TEMP_PREFIX = '.cinematic-template-';
const MAX_TEMPLATE_TEXT_BYTES = 4 * 1024;
const MAX_TEMPLATE_FILE_BYTES = 32 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

function failure(code, message = code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function exactKeys(value, expected, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
        throw failure(code, 'Cinematic template object shape is invalid');
    }
}

function isWellFormedUnicode(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF) {
            if (index + 1 >= value.length) return false;
            const next = value.charCodeAt(index + 1);
            if (next < 0xDC00 || next > 0xDFFF) return false;
            index += 1;
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            return false;
        }
    }
    return true;
}

function templateText(value, code) {
    if (typeof value !== 'string' || value.includes('\0') || !isWellFormedUnicode(value)) {
        throw failure(code, 'Cinematic template text is invalid');
    }
    const normalized = value.trim();
    if (Buffer.byteLength(normalized, 'utf8') > MAX_TEMPLATE_TEXT_BYTES) {
        throw failure(code, 'Cinematic template text is too large');
    }
    return normalized;
}

function defaultTemplate() {
    return {
        mode: 'basic',
        director_intent: '',
        visual_thesis: '',
        must_preserve: '',
        must_avoid: '',
    };
}

function normalizeTemplate(value, code = 'CINEMATIC_TEMPLATE_SHAPE_INVALID') {
    exactKeys(value, [
        'mode', 'director_intent', 'visual_thesis', 'must_preserve', 'must_avoid',
    ], code);
    if (!['basic', 'cinematic'].includes(value.mode)) {
        throw failure('CINEMATIC_TEMPLATE_MODE_INVALID', 'Cinematic template mode is invalid');
    }
    const normalized = {
        mode: value.mode,
        director_intent: templateText(value.director_intent, 'CINEMATIC_TEMPLATE_DIRECTOR_INTENT_INVALID'),
        visual_thesis: templateText(value.visual_thesis, 'CINEMATIC_TEMPLATE_VISUAL_THESIS_INVALID'),
        must_preserve: templateText(value.must_preserve, 'CINEMATIC_TEMPLATE_MUST_PRESERVE_INVALID'),
        must_avoid: templateText(value.must_avoid, 'CINEMATIC_TEMPLATE_MUST_AVOID_INVALID'),
    };
    return normalized.mode === 'basic' ? defaultTemplate() : normalized;
}

function validateSavePayload(payload) {
    exactKeys(payload, [
        'mode', 'director_intent', 'visual_thesis', 'must_preserve', 'must_avoid',
        'expected_revision_sha256',
    ], 'CINEMATIC_TEMPLATE_SAVE_SHAPE_INVALID');
    if (typeof payload.expected_revision_sha256 !== 'string'
        || (payload.expected_revision_sha256 !== '' && !SHA256.test(payload.expected_revision_sha256))) {
        throw failure('CINEMATIC_TEMPLATE_REVISION_INVALID', 'Expected cinematic template revision is invalid');
    }
    return {
        template: normalizeTemplate({
            mode: payload.mode,
            director_intent: payload.director_intent,
            visual_thesis: payload.visual_thesis,
            must_preserve: payload.must_preserve,
            must_avoid: payload.must_avoid,
        }),
        expectedRevisionSha256: payload.expected_revision_sha256,
    };
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function templateRevision(template) {
    return sha256(JSON.stringify(template));
}

function exactPaths(userDataPath) {
    const draftPaths = newProjectDraftProvider.exactDraftPaths(userDataPath);
    return {
        userDataPath: draftPaths.userDataPath,
        draftRoot: draftPaths.draftRoot,
        templatePath: path.join(draftPaths.draftRoot, TEMPLATE_FILE),
    };
}

function assertDirectory(directoryPath, code, { privateMode = false } = {}) {
    let stats;
    try {
        stats = fs.lstatSync(directoryPath);
    } catch {
        throw failure(code, 'Required cinematic template directory does not exist');
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()
        || (privateMode && (stats.mode & 0o077) !== 0)) {
        throw failure(code, 'Cinematic template directory is unsafe');
    }
    return stats;
}

function assertSafeUserData(paths) {
    const stats = assertDirectory(paths.userDataPath, 'CINEMATIC_TEMPLATE_USER_DATA_INVALID');
    if (fs.realpathSync.native(paths.userDataPath) !== paths.userDataPath) {
        throw failure('CINEMATIC_TEMPLATE_USER_DATA_INVALID', 'Electron userData path contains symlinks');
    }
    return stats;
}

function inspectExistingDirectories(paths) {
    assertSafeUserData(paths);
    const components = ['film-pipeline', 'drafts', path.basename(paths.draftRoot)];
    for (const [index] of components.entries()) {
        const current = path.join(paths.userDataPath, ...components.slice(0, index + 1));
        let stats;
        try {
            stats = fs.lstatSync(current);
        } catch (error) {
            if (error.code === 'ENOENT') return false;
            throw error;
        }
        if (stats.isSymbolicLink() || !stats.isDirectory()
            || (index > 0 && (stats.mode & 0o077) !== 0)
            || fs.realpathSync.native(current) !== current) {
            throw failure('CINEMATIC_TEMPLATE_DIRECTORY_UNSAFE', 'Cinematic template directory is unsafe');
        }
    }
    return true;
}

function ensurePrivateDirectory(paths) {
    const userDataStats = assertSafeUserData(paths);
    const components = ['film-pipeline', 'drafts', path.basename(paths.draftRoot)];
    for (const [index, component] of components.entries()) {
        const current = path.join(paths.userDataPath, ...components.slice(0, index + 1));
        try {
            fs.mkdirSync(current, { mode: 0o700 });
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
        const stats = assertDirectory(current, 'CINEMATIC_TEMPLATE_DIRECTORY_UNSAFE', { privateMode: index > 0 });
        const realCurrent = fs.realpathSync.native(current);
        if (!realCurrent.startsWith(paths.userDataPath + path.sep)
            || (index === components.length - 1 && realCurrent !== paths.draftRoot)
            || (index === 0 && stats.dev !== userDataStats.dev)) {
            throw failure('CINEMATIC_TEMPLATE_DIRECTORY_UNSAFE', 'Cinematic template directory escapes userData');
        }
    }
}

function stableIdentity(left, right) {
    return left.dev === right.dev
        && left.ino === right.ino
        && left.mode === right.mode
        && left.size === right.size
        && left.mtimeMs === right.mtimeMs
        && left.ctimeMs === right.ctimeMs;
}

function readPrivateFile(filePath) {
    let stats;
    try {
        stats = fs.lstatSync(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0
        || stats.size > MAX_TEMPLATE_FILE_BYTES || (stats.mode & 0o777) !== 0o600) {
        throw failure('CINEMATIC_TEMPLATE_FILE_UNSAFE', 'Cinematic template file is unsafe');
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure('CINEMATIC_TEMPLATE_NOFOLLOW_UNAVAILABLE', 'No-follow template read is unavailable');
    }
    let descriptor;
    try {
        descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || !stableIdentity(stats, opened)) {
            throw failure('CINEMATIC_TEMPLATE_FILE_CHANGED', 'Cinematic template changed before read');
        }
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(filePath);
        if (buffer.byteLength !== stats.size || !stableIdentity(opened, after)
            || !stableIdentity(opened, pathAfter)) {
            throw failure('CINEMATIC_TEMPLATE_FILE_CHANGED', 'Cinematic template changed during read');
        }
        return { buffer, identity: stats };
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function fsyncDirectory(directoryPath) {
    let descriptor;
    try {
        descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
        fs.fsyncSync(descriptor);
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
}

function atomicWrite(filePath, buffer, options = {}) {
    const parentPath = path.dirname(filePath);
    const parentBefore = assertDirectory(parentPath, 'CINEMATIC_TEMPLATE_DIRECTORY_UNSAFE', { privateMode: true });
    let targetBefore = null;
    try {
        targetBefore = fs.lstatSync(filePath);
        if (targetBefore.isSymbolicLink() || !targetBefore.isFile()
            || (targetBefore.mode & 0o777) !== 0o600) {
            throw failure('CINEMATIC_TEMPLATE_TARGET_UNSAFE', 'Cinematic template target is unsafe');
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const expectedTarget = options.expectedTargetIdentity;
    if ((expectedTarget === null && targetBefore !== null)
        || (expectedTarget && (!targetBefore || !stableIdentity(expectedTarget, targetBefore)))) {
        throw failure('CINEMATIC_TEMPLATE_REVISION_STALE', 'Cinematic template changed before write');
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure('CINEMATIC_TEMPLATE_NOFOLLOW_UNAVAILABLE', 'No-follow template write is unavailable');
    }
    const randomBytes = options.randomBytes || crypto.randomBytes;
    const tempPath = path.join(parentPath, `${TEMP_PREFIX}${process.pid}-${randomBytes(12).toString('hex')}`);
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
    let descriptor;
    let renamed = false;
    try {
        descriptor = fs.openSync(tempPath, flags, 0o600);
        fs.fchmodSync(descriptor, 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;

        const parentAfter = assertDirectory(parentPath, 'CINEMATIC_TEMPLATE_DIRECTORY_UNSAFE', { privateMode: true });
        if (parentBefore.dev !== parentAfter.dev || parentBefore.ino !== parentAfter.ino
            || fs.realpathSync.native(parentPath) !== parentPath) {
            throw failure('CINEMATIC_TEMPLATE_PARENT_CHANGED', 'Cinematic template parent changed');
        }
        const tempStats = fs.lstatSync(tempPath);
        if (tempStats.isSymbolicLink() || !tempStats.isFile() || (tempStats.mode & 0o777) !== 0o600) {
            throw failure('CINEMATIC_TEMPLATE_TEMP_UNSAFE', 'Temporary cinematic template is unsafe');
        }
        const currentTarget = (() => {
            try { return fs.lstatSync(filePath); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        })();
        if ((targetBefore === null) !== (currentTarget === null)
            || (targetBefore && (!currentTarget || !stableIdentity(targetBefore, currentTarget)))) {
            throw failure('CINEMATIC_TEMPLATE_REVISION_STALE', 'Cinematic template changed before write');
        }
        const renameFile = options.renameFile || fs.renameSync;
        renameFile(tempPath, filePath);
        renamed = true;
        const finalStats = fs.lstatSync(filePath);
        if (finalStats.isSymbolicLink() || !finalStats.isFile()
            || (finalStats.mode & 0o777) !== 0o600 || finalStats.size !== buffer.byteLength) {
            throw failure('CINEMATIC_TEMPLATE_TARGET_UNSAFE', 'Written cinematic template is unsafe');
        }
        fsyncDirectory(parentPath);
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
        if (!renamed) {
            try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
}

function parseSavedTemplate(buffer) {
    let record;
    try {
        record = JSON.parse(buffer.toString('utf8'));
    } catch {
        throw failure('CINEMATIC_TEMPLATE_FILE_INVALID', 'Cinematic template JSON is malformed');
    }
    exactKeys(record, [
        'schema_version', 'mode', 'director_intent', 'visual_thesis', 'must_preserve',
        'must_avoid', 'saved_at',
    ], 'CINEMATIC_TEMPLATE_FILE_INVALID');
    if (record.schema_version !== CINEMATIC_TEMPLATE_SCHEMA
        || typeof record.saved_at !== 'string' || !Number.isFinite(Date.parse(record.saved_at))) {
        throw failure('CINEMATIC_TEMPLATE_FILE_INVALID', 'Cinematic template evidence is invalid');
    }
    const template = normalizeTemplate({
        mode: record.mode,
        director_intent: record.director_intent,
        visual_thesis: record.visual_thesis,
        must_preserve: record.must_preserve,
        must_avoid: record.must_avoid,
    }, 'CINEMATIC_TEMPLATE_FILE_INVALID');
    return { template, savedAt: record.saved_at, revisionSha256: templateRevision(template) };
}

function loadTemplate(context = {}) {
    let paths;
    try {
        paths = exactPaths(context.userDataPath);
        if (!inspectExistingDirectories(paths)) {
            return { status: 'empty', ...defaultTemplateState(), paths };
        }
        const loadedFile = readPrivateFile(paths.templatePath);
        if (!loadedFile) return { status: 'empty', ...defaultTemplateState(), paths, targetIdentity: null };
        return {
            status: 'restored',
            ...parseSavedTemplate(loadedFile.buffer),
            paths,
            targetIdentity: loadedFile.identity,
        };
    } catch (error) {
        return {
            status: 'error', ...defaultTemplateState(), paths: null,
            errorCode: error.code || 'CINEMATIC_TEMPLATE_READ_FAILED',
        };
    }
}

function defaultTemplateState() {
    return {
        template: defaultTemplate(), savedAt: '', revisionSha256: '', errorCode: '', targetIdentity: null,
    };
}

function publicState(loaded, status = loaded.status) {
    const blockers = loaded.status === 'error'
        ? [loaded.errorCode || 'CINEMATIC_TEMPLATE_READ_FAILED']
        : [];
    return {
        ok: loaded.status !== 'error',
        status,
        template: loaded.template,
        savedAt: loaded.savedAt,
        revision_sha256: loaded.revisionSha256,
        blockers,
        executed: false,
    };
}

function getNewProjectCinematicTemplateState(context = {}) {
    return publicState(loadTemplate(context));
}

function saveNewProjectCinematicTemplate(payload, context = {}) {
    const validated = validateSavePayload(payload);
    const current = loadTemplate(context);
    if (current.status === 'error') {
        throw failure(current.errorCode || 'CINEMATIC_TEMPLATE_READ_FAILED');
    }
    if (validated.expectedRevisionSha256 !== current.revisionSha256) {
        throw failure('CINEMATIC_TEMPLATE_REVISION_STALE', 'Cinematic template changed before save');
    }
    const paths = exactPaths(context.userDataPath);
    ensurePrivateDirectory(paths);
    const record = {
        schema_version: CINEMATIC_TEMPLATE_SCHEMA,
        ...validated.template,
        saved_at: new Date().toISOString(),
    };
    const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
    if (buffer.byteLength > MAX_TEMPLATE_FILE_BYTES) {
        throw failure('CINEMATIC_TEMPLATE_FILE_TOO_LARGE', 'Cinematic template file is too large');
    }
    atomicWrite(paths.templatePath, buffer, { ...context, expectedTargetIdentity: current.targetIdentity });
    return publicState({
        status: 'restored',
        template: validated.template,
        savedAt: record.saved_at,
        revisionSha256: templateRevision(validated.template),
        errorCode: '',
    }, 'saved');
}

module.exports = {
    CINEMATIC_TEMPLATE_SCHEMA,
    MAX_TEMPLATE_TEXT_BYTES,
    defaultTemplate,
    exactPaths,
    validateSavePayload,
    getNewProjectCinematicTemplateState,
    saveNewProjectCinematicTemplate,
};
