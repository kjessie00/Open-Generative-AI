const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DRAFT_SCHEMA = 'film_pipeline.new_project_draft.v1';
const DRAFT_DIRECTORY = 'canonical-project-bootstrap-v1';
const DRAFT_METADATA_FILE = 'draft.json';
const DRAFT_BRIEF_FILE = 'brief.md';
const DRAFT_SCRIPT_FILE = 'script.txt';
const DRAFT_TEMP_PREFIX = '.new-project-draft-';
const PLANNING_AGENT_REQUEST_SCHEMA = 'film_pipeline.planning_agent_request.v1';
const PLANNING_AGENT_COLLABORATION_DIRECTORY = 'collaboration';
const PLANNING_AGENT_QUEUE_DIRECTORY = 'queue';
const PLANNING_AGENT_REQUEST_PREFIX = 'request_';
const MAX_PLANNING_AGENT_INSTRUCTION_BYTES = 16 * 1024;
const MAX_PLANNING_AGENT_REQUEST_BYTES = 32 * 1024;
const MAX_PLANNING_AGENT_REQUEST_FILES = 200;
const MAX_RECENT_PLANNING_AGENT_REQUESTS = 20;
const MAX_DRAFT_JSON_BYTES = 8 * 1024;
const MAX_BRIEF_BYTES = 64 * 1024;
const MAX_SCRIPT_BYTES = 256 * 1024;
const MAX_PRODUCTION_ID_LENGTH = 64;
const BUILDER_RELATIVE_PATH = 'scripts/build_short_drama_pipeline_pack.py';
const ROUTE_TO_BUILDER = Object.freeze({ seedance: 'seedance', flow_omni: 'flow', both: 'both' });

function bootstrapError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
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

function safeString(value, code, maxBytes, { trim = true } = {}) {
    if (typeof value !== 'string' || value.includes('\0') || !isWellFormedUnicode(value)) {
        throw bootstrapError(code, 'Draft text is invalid');
    }
    const normalized = trim ? value.trim() : value;
    const byteLength = Buffer.byteLength(normalized, 'utf8');
    if (!normalized || byteLength > maxBytes) {
        throw bootstrapError(code, 'Draft text is empty or too large');
    }
    return normalized;
}

function assertExactKeys(value, expected, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
        throw bootstrapError(code, 'Draft shape is invalid');
    }
}

function validateNewProjectDraft(payload) {
    const keys = [
        'production_id', 'brief', 'script', 'route', 'aspect_ratio', 'scene_duration', 'max_scenes',
    ];
    assertExactKeys(payload, keys, 'NEW_PROJECT_DRAFT_SHAPE_INVALID');

    const productionId = safeString(
        payload.production_id,
        'NEW_PROJECT_ID_INVALID',
        MAX_PRODUCTION_ID_LENGTH,
    );
    if (!/^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])$/.test(productionId)
        || productionId.includes('..')) {
        throw bootstrapError('NEW_PROJECT_ID_INVALID', 'Production id is not a safe canonical slug');
    }
    const brief = safeString(payload.brief, 'NEW_PROJECT_BRIEF_INVALID', MAX_BRIEF_BYTES);
    const script = safeString(payload.script, 'NEW_PROJECT_SCRIPT_INVALID', MAX_SCRIPT_BYTES);
    if (!Object.hasOwn(ROUTE_TO_BUILDER, payload.route)) {
        throw bootstrapError('NEW_PROJECT_ROUTE_INVALID', 'Generator route is invalid');
    }
    if (!['9:16', '16:9'].includes(payload.aspect_ratio)) {
        throw bootstrapError('NEW_PROJECT_ASPECT_INVALID', 'Aspect ratio is invalid');
    }
    if (!Number.isSafeInteger(payload.scene_duration) || payload.scene_duration < 4 || payload.scene_duration > 15) {
        throw bootstrapError('NEW_PROJECT_SCENE_DURATION_INVALID', 'Scene duration is out of bounds');
    }
    if (!Number.isSafeInteger(payload.max_scenes) || payload.max_scenes < 1 || payload.max_scenes > 10) {
        throw bootstrapError('NEW_PROJECT_MAX_SCENES_INVALID', 'Maximum scene count is out of bounds');
    }

    return {
        production_id: productionId,
        brief,
        script,
        route: payload.route,
        aspect_ratio: payload.aspect_ratio,
        scene_duration: payload.scene_duration,
        max_scenes: payload.max_scenes,
    };
}

function defaultDraft() {
    return {
        production_id: '',
        brief: '',
        script: '',
        route: 'both',
        aspect_ratio: '9:16',
        scene_duration: 5,
        max_scenes: 10,
    };
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function exactDraftPaths(userDataPath) {
    if (typeof userDataPath !== 'string' || userDataPath.includes('\0')
        || !path.isAbsolute(userDataPath) || path.normalize(userDataPath) !== userDataPath) {
        throw bootstrapError('NEW_PROJECT_USER_DATA_INVALID', 'Electron userData path is invalid');
    }
    const draftRoot = path.join(userDataPath, 'film-pipeline', 'drafts', DRAFT_DIRECTORY);
    const collaborationRoot = path.join(draftRoot, PLANNING_AGENT_COLLABORATION_DIRECTORY);
    const planningAgentQueueRoot = path.join(collaborationRoot, PLANNING_AGENT_QUEUE_DIRECTORY);
    return {
        userDataPath,
        draftRoot,
        metadataPath: path.join(draftRoot, DRAFT_METADATA_FILE),
        briefPath: path.join(draftRoot, DRAFT_BRIEF_FILE),
        scriptPath: path.join(draftRoot, DRAFT_SCRIPT_FILE),
        collaborationRoot,
        planningAgentQueueRoot,
    };
}

function assertDirectory(pathValue, code, { privateMode = false } = {}) {
    let stats;
    try {
        stats = fs.lstatSync(pathValue);
    } catch {
        throw bootstrapError(code, 'Required directory does not exist');
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw bootstrapError(code, 'Required directory is unsafe');
    }
    if (privateMode && (stats.mode & 0o077) !== 0) {
        throw bootstrapError(code, 'Draft directory permissions are too broad');
    }
    return stats;
}

function ensurePrivateDraftDirectory(paths) {
    const userDataStats = assertDirectory(paths.userDataPath, 'NEW_PROJECT_USER_DATA_INVALID');
    const realUserData = fs.realpathSync.native(paths.userDataPath);
    if (realUserData !== paths.userDataPath) {
        throw bootstrapError('NEW_PROJECT_USER_DATA_INVALID', 'Electron userData path contains symlinks');
    }
    let current = paths.userDataPath;
    const components = ['film-pipeline', 'drafts', DRAFT_DIRECTORY];
    for (const [index, component] of components.entries()) {
        current = path.join(current, component);
        try {
            fs.mkdirSync(current, { mode: 0o700 });
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
        const stats = assertDirectory(
            current,
            'NEW_PROJECT_DRAFT_DIRECTORY_UNSAFE',
            { privateMode: index > 0 },
        );
        const realCurrent = fs.realpathSync.native(current);
        if (!realCurrent.startsWith(realUserData + path.sep)
            || (index === components.length - 1 && realCurrent !== paths.draftRoot)) {
            throw bootstrapError('NEW_PROJECT_DRAFT_DIRECTORY_UNSAFE', 'Draft directory escapes Electron userData');
        }
        if (index === 0 && stats.dev !== userDataStats.dev) {
            throw bootstrapError('NEW_PROJECT_DRAFT_DIRECTORY_UNSAFE', 'Draft directory changed filesystem');
        }
    }
}

function ensurePrivatePlanningAgentQueue(paths) {
    ensurePrivateDraftDirectory(paths);
    const draftStats = assertDirectory(
        paths.draftRoot,
        'PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE',
        { privateMode: true },
    );
    let current = paths.draftRoot;
    for (const [index, component] of [
        PLANNING_AGENT_COLLABORATION_DIRECTORY,
        PLANNING_AGENT_QUEUE_DIRECTORY,
    ].entries()) {
        current = path.join(current, component);
        try {
            fs.mkdirSync(current, { mode: 0o700 });
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
        const stats = assertDirectory(
            current,
            'PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE',
            { privateMode: true },
        );
        const expected = index === 0 ? paths.collaborationRoot : paths.planningAgentQueueRoot;
        if (fs.realpathSync.native(current) !== expected || stats.dev !== draftStats.dev) {
            throw bootstrapError('PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE', 'Planning agent queue escapes the draft root');
        }
    }
}

function assertRegularOrMissing(filePath) {
    try {
        const stats = fs.lstatSync(filePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw bootstrapError('NEW_PROJECT_DRAFT_TARGET_UNSAFE', 'Draft target is unsafe');
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

function atomicWritePrivateFile(filePath, content, options = {}) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const parentPath = path.dirname(filePath);
    const parentBefore = assertDirectory(parentPath, 'NEW_PROJECT_DRAFT_DIRECTORY_UNSAFE', { privateMode: true });
    assertRegularOrMissing(filePath);
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw bootstrapError('NEW_PROJECT_DRAFT_NOFOLLOW_UNAVAILABLE', 'No-follow draft write is unavailable');
    }
    const randomBytes = options.randomBytes || crypto.randomBytes;
    const tempPath = path.join(parentPath, `${DRAFT_TEMP_PREFIX}${process.pid}-${randomBytes(12).toString('hex')}`);
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
        const parentAfter = assertDirectory(parentPath, 'NEW_PROJECT_DRAFT_DIRECTORY_UNSAFE', { privateMode: true });
        if (parentBefore.dev !== parentAfter.dev || parentBefore.ino !== parentAfter.ino) {
            throw bootstrapError('NEW_PROJECT_DRAFT_PARENT_CHANGED', 'Draft parent changed during write');
        }
        assertRegularOrMissing(filePath);
        const tempStats = fs.lstatSync(tempPath);
        if (tempStats.isSymbolicLink() || !tempStats.isFile() || (tempStats.mode & 0o077) !== 0) {
            throw bootstrapError('NEW_PROJECT_DRAFT_TEMP_UNSAFE', 'Draft temporary file is unsafe');
        }
        const renameFile = options.renameFile || fs.renameSync;
        renameFile(tempPath, filePath);
        renamed = true;
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
        if (!renamed) {
            try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
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

function readPrivateFile(filePath, maxBytes) {
    let stats;
    try {
        stats = fs.lstatSync(filePath);
    } catch {
        throw bootstrapError('NEW_PROJECT_DRAFT_INCOMPLETE', 'Draft file is missing');
    }
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.size > maxBytes
        || (stats.mode & 0o777) !== 0o600) {
        throw bootstrapError('NEW_PROJECT_DRAFT_FILE_UNSAFE', 'Draft file is unsafe');
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw bootstrapError('NEW_PROJECT_DRAFT_NOFOLLOW_UNAVAILABLE', 'No-follow draft read is unavailable');
    }
    let descriptor;
    try {
        descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || !stableIdentity(stats, opened)) {
            throw bootstrapError('NEW_PROJECT_DRAFT_FILE_CHANGED', 'Draft file changed before read');
        }
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(filePath);
        if (buffer.byteLength !== stats.size || !stableIdentity(opened, after) || !stableIdentity(opened, pathAfter)) {
            throw bootstrapError('NEW_PROJECT_DRAFT_FILE_CHANGED', 'Draft file changed during read');
        }
        return buffer;
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function metadataForDraft(draft, briefBuffer, scriptBuffer) {
    return {
        schema_version: DRAFT_SCHEMA,
        production_id: draft.production_id,
        route: draft.route,
        aspect_ratio: draft.aspect_ratio,
        scene_duration: draft.scene_duration,
        max_scenes: draft.max_scenes,
        brief_sha256: sha256(briefBuffer),
        script_sha256: sha256(scriptBuffer),
        saved_at: new Date().toISOString(),
    };
}

function draftRevisionEvidence(draft) {
    const briefSha256 = sha256(Buffer.from(`${draft.brief}\n`, 'utf8'));
    const scriptSha256 = sha256(Buffer.from(`${draft.script}\n`, 'utf8'));
    const canonical = JSON.stringify({
        production_id: draft.production_id,
        route: draft.route,
        aspect_ratio: draft.aspect_ratio,
        scene_duration: draft.scene_duration,
        max_scenes: draft.max_scenes,
        brief_sha256: briefSha256,
        script_sha256: scriptSha256,
    });
    return {
        revisionSha256: sha256(canonical),
        briefSha256,
        scriptSha256,
    };
}

function planningAgentRequestId({
    stage, instruction, productionId, revisionSha256, briefSha256, scriptSha256,
}) {
    return `${PLANNING_AGENT_REQUEST_PREFIX}${sha256(JSON.stringify({
        schema_version: PLANNING_AGENT_REQUEST_SCHEMA,
        production_id: productionId,
        draft_revision_sha256: revisionSha256,
        brief_sha256: briefSha256,
        script_sha256: scriptSha256,
        stage,
        instruction,
    }))}`;
}

function validatePlanningAgentRequestPayload(payload) {
    assertExactKeys(
        payload,
        ['stage', 'instruction', 'expected_revision_sha256'],
        'PLANNING_AGENT_REQUEST_SHAPE_INVALID',
    );
    if (!['brief', 'script'].includes(payload.stage)) {
        throw bootstrapError('PLANNING_AGENT_REQUEST_STAGE_INVALID', 'Planning agent request stage is invalid');
    }
    const instruction = safeString(
        payload.instruction,
        'PLANNING_AGENT_REQUEST_INSTRUCTION_INVALID',
        MAX_PLANNING_AGENT_INSTRUCTION_BYTES,
    );
    if (typeof payload.expected_revision_sha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(payload.expected_revision_sha256)) {
        throw bootstrapError('PLANNING_AGENT_REQUEST_REVISION_INVALID', 'Planning agent request revision is invalid');
    }
    return {
        stage: payload.stage,
        instruction,
        expectedRevisionSha256: payload.expected_revision_sha256,
    };
}

function validatePlanningAgentRequestRecord(record, currentDraft = null) {
    assertExactKeys(record, [
        'schema_version', 'request_id', 'stage', 'instruction', 'production_id',
        'draft_revision_sha256', 'brief_sha256', 'script_sha256', 'status',
        'requested_at', 'executed', 'model_called',
    ], 'PLANNING_AGENT_QUEUE_RECORD_INVALID');
    if (record.schema_version !== PLANNING_AGENT_REQUEST_SCHEMA
        || !['brief', 'script'].includes(record.stage)
        || typeof record.instruction !== 'string'
        || !record.instruction
        || record.instruction.includes('\0')
        || !isWellFormedUnicode(record.instruction)
        || Buffer.byteLength(record.instruction, 'utf8') > MAX_PLANNING_AGENT_INSTRUCTION_BYTES
        || !/^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])$/.test(record.production_id)
        || record.production_id.includes('..')
        || !/^[a-f0-9]{64}$/.test(record.draft_revision_sha256)
        || !/^[a-f0-9]{64}$/.test(record.brief_sha256)
        || !/^[a-f0-9]{64}$/.test(record.script_sha256)
        || record.status !== 'queued_local_handoff'
        || !Number.isFinite(Date.parse(record.requested_at))
        || record.executed !== false
        || record.model_called !== false) {
        throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_INVALID', 'Planning agent queue record is invalid');
    }
    const expectedId = planningAgentRequestId({
        stage: record.stage,
        instruction: record.instruction,
        productionId: record.production_id,
        revisionSha256: record.draft_revision_sha256,
        briefSha256: record.brief_sha256,
        scriptSha256: record.script_sha256,
    });
    if (record.request_id !== expectedId) {
        throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_INVALID', 'Planning agent queue record identity is invalid');
    }
    if (currentDraft && record.production_id === currentDraft.production_id) {
        const evidence = draftRevisionEvidence(currentDraft);
        if (record.draft_revision_sha256 === evidence.revisionSha256
            && (record.brief_sha256 !== evidence.briefSha256
                || record.script_sha256 !== evidence.scriptSha256)) {
            throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_INVALID', 'Planning agent queue revision evidence is invalid');
        }
    }
    return record;
}

function emptyPlanningCollaboration() {
    return {
        status: 'empty',
        total_request_count: 0,
        recent_requests: [],
        truncated: false,
        blockers: [],
    };
}

function readPlanningCollaboration(paths, draft) {
    let collaborationStats;
    try {
        collaborationStats = fs.lstatSync(paths.collaborationRoot);
    } catch (error) {
        if (error.code === 'ENOENT') return emptyPlanningCollaboration();
        return { ...emptyPlanningCollaboration(), status: 'blocked', blockers: ['PLANNING_AGENT_QUEUE_READ_FAILED'] };
    }
    try {
        if (collaborationStats.isSymbolicLink() || !collaborationStats.isDirectory()
            || (collaborationStats.mode & 0o077) !== 0
            || fs.realpathSync.native(paths.collaborationRoot) !== paths.collaborationRoot) {
            throw bootstrapError('PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE', 'Planning collaboration directory is unsafe');
        }
        let queueStats;
        try {
            queueStats = fs.lstatSync(paths.planningAgentQueueRoot);
        } catch (error) {
            if (error.code === 'ENOENT') return emptyPlanningCollaboration();
            throw error;
        }
        if (queueStats.isSymbolicLink() || !queueStats.isDirectory()
            || (queueStats.mode & 0o077) !== 0
            || queueStats.dev !== collaborationStats.dev
            || fs.realpathSync.native(paths.planningAgentQueueRoot) !== paths.planningAgentQueueRoot) {
            throw bootstrapError('PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE', 'Planning agent queue directory is unsafe');
        }
        const entries = fs.readdirSync(paths.planningAgentQueueRoot, { withFileTypes: true });
        if (entries.length > MAX_PLANNING_AGENT_REQUEST_FILES) {
            throw bootstrapError('PLANNING_AGENT_QUEUE_LIMIT_REACHED', 'Planning agent queue file limit was reached');
        }
        const records = entries.map((entry) => {
            if (!entry.isFile() || entry.isSymbolicLink()
                || !/^request_[a-f0-9]{64}\.json$/.test(entry.name)) {
                throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_UNSAFE', 'Planning agent queue entry is unsafe');
            }
            const filePath = path.join(paths.planningAgentQueueRoot, entry.name);
            const buffer = readPrivateFile(filePath, MAX_PLANNING_AGENT_REQUEST_BYTES);
            let record;
            try {
                record = JSON.parse(buffer.toString('utf8'));
            } catch {
                throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_INVALID', 'Planning agent queue record is malformed');
            }
            validatePlanningAgentRequestRecord(record, draft);
            if (`${record.request_id}.json` !== entry.name) {
                throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_INVALID', 'Planning agent queue filename is invalid');
            }
            return record;
        }).sort((left, right) => Date.parse(right.requested_at) - Date.parse(left.requested_at));
        return {
            status: records.length ? 'queued' : 'empty',
            total_request_count: records.length,
            recent_requests: records.slice(0, MAX_RECENT_PLANNING_AGENT_REQUESTS),
            truncated: records.length > MAX_RECENT_PLANNING_AGENT_REQUESTS,
            blockers: [],
        };
    } catch (error) {
        return {
            ...emptyPlanningCollaboration(),
            status: 'blocked',
            blockers: [error.code || 'PLANNING_AGENT_QUEUE_READ_FAILED'],
        };
    }
}

function readSavedDraft(paths) {
    const metadataBuffer = readPrivateFile(paths.metadataPath, MAX_DRAFT_JSON_BYTES);
    const briefBuffer = readPrivateFile(paths.briefPath, MAX_BRIEF_BYTES + 1);
    const scriptBuffer = readPrivateFile(paths.scriptPath, MAX_SCRIPT_BYTES + 1);
    let metadata;
    try {
        metadata = JSON.parse(metadataBuffer.toString('utf8'));
    } catch {
        throw bootstrapError('NEW_PROJECT_DRAFT_METADATA_INVALID', 'Draft metadata is malformed');
    }
    assertExactKeys(metadata, [
        'schema_version', 'production_id', 'route', 'aspect_ratio', 'scene_duration', 'max_scenes',
        'brief_sha256', 'script_sha256', 'saved_at',
    ], 'NEW_PROJECT_DRAFT_METADATA_INVALID');
    if (metadata.schema_version !== DRAFT_SCHEMA
        || !/^[a-f0-9]{64}$/.test(metadata.brief_sha256)
        || !/^[a-f0-9]{64}$/.test(metadata.script_sha256)
        || metadata.brief_sha256 !== sha256(briefBuffer)
        || metadata.script_sha256 !== sha256(scriptBuffer)
        || !Number.isFinite(Date.parse(metadata.saved_at))) {
        throw bootstrapError('NEW_PROJECT_DRAFT_METADATA_INVALID', 'Draft metadata evidence is invalid');
    }
    const draft = validateNewProjectDraft({
        production_id: metadata.production_id,
        brief: briefBuffer.toString('utf8'),
        script: scriptBuffer.toString('utf8'),
        route: metadata.route,
        aspect_ratio: metadata.aspect_ratio,
        scene_duration: metadata.scene_duration,
        max_scenes: metadata.max_scenes,
    });
    return { draft, savedAt: metadata.saved_at };
}

function loadDraft(context) {
    let paths;
    try {
        paths = exactDraftPaths(context.userDataPath);
        assertDirectory(paths.userDataPath, 'NEW_PROJECT_USER_DATA_INVALID');
        const realUserData = fs.realpathSync.native(paths.userDataPath);
        if (realUserData !== paths.userDataPath) throw bootstrapError('NEW_PROJECT_USER_DATA_INVALID', 'userData contains symlinks');
    } catch (error) {
        return { status: 'error', draft: defaultDraft(), savedAt: '', paths: null, errorCode: error.code || 'NEW_PROJECT_USER_DATA_INVALID' };
    }
    try {
        const components = ['film-pipeline', 'drafts', DRAFT_DIRECTORY];
        for (let index = 0; index < components.length; index += 1) {
            const directoryPath = path.join(paths.userDataPath, ...components.slice(0, index + 1));
            const stats = fs.lstatSync(directoryPath);
            if (stats.isSymbolicLink() || !stats.isDirectory() || (index > 0 && (stats.mode & 0o077) !== 0)) {
                throw bootstrapError('NEW_PROJECT_DRAFT_DIRECTORY_UNSAFE', 'Draft directory is unsafe');
            }
            if (fs.realpathSync.native(directoryPath) !== directoryPath) {
                throw bootstrapError('NEW_PROJECT_DRAFT_DIRECTORY_UNSAFE', 'Draft directory contains symlinks');
            }
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { status: 'empty', draft: defaultDraft(), savedAt: '', paths, errorCode: '' };
        }
        return { status: 'error', draft: defaultDraft(), savedAt: '', paths: null, errorCode: error.code || 'NEW_PROJECT_DRAFT_DIRECTORY_UNSAFE' };
    }
    try {
        const saved = readSavedDraft(paths);
        return { status: 'restored', ...saved, paths, errorCode: '' };
    } catch (error) {
        return { status: 'error', draft: defaultDraft(), savedAt: '', paths: null, errorCode: error.code || 'NEW_PROJECT_DRAFT_READ_FAILED' };
    }
}

function inspectParentAndTarget(config, draft) {
    const parentRoot = config?.productionParentRoot;
    if (typeof parentRoot !== 'string' || !parentRoot || parentRoot.includes('\0')) {
        return { ready: false, reason: 'NEW_PROJECT_PARENT_NOT_CONFIGURED', parentRoot: '', targetPath: '' };
    }
    if (!path.isAbsolute(parentRoot) || path.normalize(parentRoot) !== parentRoot) {
        return { ready: false, reason: 'NEW_PROJECT_PARENT_UNSAFE', parentRoot: '', targetPath: '' };
    }
    let parentStats;
    let realParent;
    try {
        parentStats = fs.lstatSync(parentRoot);
        realParent = fs.realpathSync.native(parentRoot);
    } catch {
        return { ready: false, reason: 'NEW_PROJECT_PARENT_MISSING', parentRoot, targetPath: '' };
    }
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory() || realParent !== parentRoot) {
        return { ready: false, reason: 'NEW_PROJECT_PARENT_UNSAFE', parentRoot, targetPath: '' };
    }
    const targetPath = path.join(parentRoot, draft.production_id);
    try {
        const targetStats = fs.lstatSync(targetPath);
        const reason = targetStats.isSymbolicLink()
            ? 'NEW_PROJECT_TARGET_SYMLINK'
            : targetStats.isDirectory()
                ? fs.readdirSync(targetPath).length === 0
                    ? 'NEW_PROJECT_TARGET_EMPTY_DIRECTORY_EXISTS'
                    : 'NEW_PROJECT_TARGET_NONEMPTY_DIRECTORY_EXISTS'
                : 'NEW_PROJECT_TARGET_FILE_EXISTS';
        return { ready: false, reason, parentRoot, targetPath };
    } catch (error) {
        if (error.code !== 'ENOENT') {
            return { ready: false, reason: 'NEW_PROJECT_TARGET_UNSAFE', parentRoot, targetPath };
        }
    }
    return { ready: true, reason: '', parentRoot, targetPath };
}

function inspectHarness(harnessStatus) {
    if (harnessStatus?.ready !== true || harnessStatus?.readiness !== 'available'
        || typeof harnessStatus.rootPath !== 'string' || !path.isAbsolute(harnessStatus.rootPath)) {
        return { ready: false, reason: 'NEW_PROJECT_HARNESS_NOT_READY', rootPath: '', builderPath: '' };
    }
    const expectedBuilder = path.join(harnessStatus.rootPath, BUILDER_RELATIVE_PATH);
    const builder = harnessStatus.entries?.find((entry) => entry.id === 'pack_builder');
    if (builder?.ready !== true || builder.path !== expectedBuilder || !/^[a-f0-9]{64}$/.test(builder.sha256 || '')) {
        return { ready: false, reason: 'NEW_PROJECT_BUILDER_NOT_READY', rootPath: harnessStatus.rootPath, builderPath: '' };
    }
    return { ready: true, reason: '', rootPath: harnessStatus.rootPath, builderPath: expectedBuilder };
}

function shellQuote(value) {
    const text = String(value ?? '');
    if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(text)) return text;
    return `'${text.replace(/'/g, `'\\''`)}'`;
}

function buildPreview(draft, paths, target, harness) {
    const args = [
        harness.builderPath,
        '--brief', paths.briefPath,
        '--script', paths.scriptPath,
        '--production-id', draft.production_id,
        '--output-root', target.parentRoot,
        '--target-generator', ROUTE_TO_BUILDER[draft.route],
        '--aspect-ratio', draft.aspect_ratio,
        '--scene-duration', String(draft.scene_duration),
        '--max-scenes', String(draft.max_scenes),
    ];
    const rendered = ['python3', ...args].map(shellQuote).join(' ');
    const shellSafeCommand = `cd ${shellQuote(harness.rootPath)} && ${rendered}`;
    return {
        ready: true,
        copyAllowed: true,
        previewOnly: true,
        executed: false,
        command: 'python3',
        args,
        cwd: harness.rootPath,
        targetPath: target.targetPath,
        shellSafeCommand,
        byteLength: Buffer.byteLength(shellSafeCommand, 'utf8'),
        sha256: sha256(shellSafeCommand),
        sideEffectType: 'local_planning_write',
    };
}

function unavailablePreview(reason, targetPath = '') {
    return {
        ready: false,
        copyAllowed: false,
        previewOnly: true,
        executed: false,
        command: '',
        args: [],
        cwd: '',
        targetPath,
        shellSafeCommand: '',
        byteLength: 0,
        sha256: '',
        sideEffectType: 'local_planning_write',
        reason,
    };
}

function getNewProjectDraftState(context = {}) {
    const loaded = loadDraft(context);
    const blockers = [];
    if (loaded.status === 'empty') blockers.push('NEW_PROJECT_DRAFT_EMPTY');
    if (loaded.status === 'error') blockers.push(loaded.errorCode || 'NEW_PROJECT_DRAFT_READ_FAILED');
    const harness = inspectHarness(context.harnessStatus);
    const target = loaded.status === 'restored'
        ? inspectParentAndTarget(context.config, loaded.draft)
        : { ready: false, reason: '', parentRoot: '', targetPath: '' };
    if (loaded.status === 'restored' && !target.ready) blockers.push(target.reason);
    if (!harness.ready) blockers.push(harness.reason);
    const uniqueBlockers = Array.from(new Set(blockers.filter(Boolean)));
    const preview = uniqueBlockers.length === 0
        ? buildPreview(loaded.draft, loaded.paths, target, harness)
        : unavailablePreview(uniqueBlockers[0], target.targetPath);
    const revision = loaded.status === 'restored'
        ? draftRevisionEvidence(loaded.draft)
        : { revisionSha256: '', briefSha256: '', scriptSha256: '' };
    const collaboration = loaded.status === 'restored'
        ? readPlanningCollaboration(loaded.paths, loaded.draft)
        : emptyPlanningCollaboration();
    return {
        ok: loaded.status !== 'error',
        status: loaded.status,
        draft: loaded.draft,
        savedAt: loaded.savedAt,
        revision_sha256: revision.revisionSha256,
        collaboration,
        readiness: uniqueBlockers.length === 0 ? 'ready_to_copy' : 'blocked',
        blockers: uniqueBlockers,
        parentRoot: target.parentRoot,
        targetPath: target.targetPath,
        harnessReady: harness.ready,
        preview,
        executed: false,
    };
}

function saveNewProjectDraft(payload, context = {}) {
    const draft = validateNewProjectDraft(payload);
    const paths = exactDraftPaths(context.userDataPath);
    ensurePrivateDraftDirectory(paths);
    const briefBuffer = Buffer.from(`${draft.brief}\n`, 'utf8');
    const scriptBuffer = Buffer.from(`${draft.script}\n`, 'utf8');
    const metadata = metadataForDraft(draft, briefBuffer, scriptBuffer);
    const metadataBuffer = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    if (metadataBuffer.byteLength > MAX_DRAFT_JSON_BYTES) {
        throw bootstrapError('NEW_PROJECT_DRAFT_METADATA_TOO_LARGE', 'Draft metadata is too large');
    }
    atomicWritePrivateFile(paths.briefPath, briefBuffer, context);
    atomicWritePrivateFile(paths.scriptPath, scriptBuffer, context);
    atomicWritePrivateFile(paths.metadataPath, metadataBuffer, context);
    return { ...getNewProjectDraftState(context), status: 'saved' };
}

function enqueuePlanningAgentRequest(payload, context = {}) {
    const request = validatePlanningAgentRequestPayload(payload);
    const loaded = loadDraft(context);
    if (loaded.status !== 'restored' || !loaded.paths) {
        throw bootstrapError('PLANNING_AGENT_DRAFT_NOT_SAVED', 'A saved draft is required before creating an agent handoff');
    }
    const revision = draftRevisionEvidence(loaded.draft);
    if (request.expectedRevisionSha256 !== revision.revisionSha256) {
        throw bootstrapError('PLANNING_AGENT_REQUEST_STALE', 'The saved draft changed before the agent handoff');
    }
    ensurePrivatePlanningAgentQueue(loaded.paths);

    const requestId = planningAgentRequestId({
        stage: request.stage,
        instruction: request.instruction,
        productionId: loaded.draft.production_id,
        revisionSha256: revision.revisionSha256,
        briefSha256: revision.briefSha256,
        scriptSha256: revision.scriptSha256,
    });
    const requestPath = path.join(loaded.paths.planningAgentQueueRoot, `${requestId}.json`);
    let alreadyQueued = false;
    try {
        const existing = JSON.parse(readPrivateFile(requestPath, MAX_PLANNING_AGENT_REQUEST_BYTES).toString('utf8'));
        validatePlanningAgentRequestRecord(existing, loaded.draft);
        if (existing.request_id !== requestId
            || existing.stage !== request.stage
            || existing.instruction !== request.instruction
            || existing.draft_revision_sha256 !== revision.revisionSha256
            || existing.brief_sha256 !== revision.briefSha256
            || existing.script_sha256 !== revision.scriptSha256
            || existing.production_id !== loaded.draft.production_id) {
            throw bootstrapError('PLANNING_AGENT_REQUEST_IDEMPOTENCY_CONFLICT', 'Existing planning agent request does not match');
        }
        alreadyQueued = true;
    } catch (error) {
        if (error.code !== 'NEW_PROJECT_DRAFT_INCOMPLETE') throw error;
    }

    if (!alreadyQueued) {
        const queueState = readPlanningCollaboration(loaded.paths, loaded.draft);
        if (queueState.status === 'blocked') {
            throw bootstrapError(queueState.blockers[0], 'Planning agent queue is blocked');
        }
        if (queueState.total_request_count >= MAX_PLANNING_AGENT_REQUEST_FILES) {
            throw bootstrapError('PLANNING_AGENT_QUEUE_LIMIT_REACHED', 'Planning agent queue file limit was reached');
        }
        const record = {
            schema_version: PLANNING_AGENT_REQUEST_SCHEMA,
            request_id: requestId,
            stage: request.stage,
            instruction: request.instruction,
            production_id: loaded.draft.production_id,
            draft_revision_sha256: revision.revisionSha256,
            brief_sha256: revision.briefSha256,
            script_sha256: revision.scriptSha256,
            status: 'queued_local_handoff',
            requested_at: new Date().toISOString(),
            executed: false,
            model_called: false,
        };
        validatePlanningAgentRequestRecord(record, loaded.draft);
        const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
        if (buffer.byteLength > MAX_PLANNING_AGENT_REQUEST_BYTES) {
            throw bootstrapError('PLANNING_AGENT_REQUEST_TOO_LARGE', 'Planning agent request is too large');
        }
        atomicWritePrivateFile(requestPath, buffer, context);
    }

    return {
        ok: true,
        queued: true,
        already_queued: alreadyQueued,
        request_id: requestId,
        status: 'queued_local_handoff',
        executed: false,
        model_called: false,
        state: getNewProjectDraftState(context),
    };
}

function copyNewProjectBuildCommand(context = {}) {
    const state = getNewProjectDraftState(context);
    if (!state.preview.copyAllowed || !state.preview.shellSafeCommand) {
        return {
            ok: false, copied: false, verified: false, executed: false,
            error: state.blockers[0] || 'NEW_PROJECT_PREVIEW_NOT_READY',
            length: 0, byteLength: 0, sha256: '', state,
        };
    }
    const clipboardApi = context.clipboardApi;
    if (!clipboardApi || typeof clipboardApi.writeText !== 'function' || typeof clipboardApi.readText !== 'function') {
        return {
            ok: false, copied: false, verified: false, executed: false,
            error: 'NEW_PROJECT_CLIPBOARD_UNAVAILABLE',
            length: state.preview.shellSafeCommand.length,
            byteLength: state.preview.byteLength,
            sha256: state.preview.sha256,
            state,
        };
    }
    clipboardApi.writeText(state.preview.shellSafeCommand);
    const verified = clipboardApi.readText() === state.preview.shellSafeCommand;
    return {
        ok: verified,
        copied: verified,
        verified,
        executed: false,
        error: verified ? '' : 'NEW_PROJECT_CLIPBOARD_VERIFY_FAILED',
        length: state.preview.shellSafeCommand.length,
        byteLength: state.preview.byteLength,
        sha256: state.preview.sha256,
        state,
    };
}

module.exports = {
    DRAFT_SCHEMA,
    BUILDER_RELATIVE_PATH,
    MAX_BRIEF_BYTES,
    MAX_SCRIPT_BYTES,
    MAX_PLANNING_AGENT_INSTRUCTION_BYTES,
    PLANNING_AGENT_REQUEST_SCHEMA,
    defaultDraft,
    validateNewProjectDraft,
    exactDraftPaths,
    getNewProjectDraftState,
    saveNewProjectDraft,
    enqueuePlanningAgentRequest,
    copyNewProjectBuildCommand,
};
