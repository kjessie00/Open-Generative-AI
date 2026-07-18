const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DRAFT_SCHEMA = 'film_pipeline.new_project_draft.v1';
const DRAFT_DIRECTORY = 'canonical-project-bootstrap-v1';
const DRAFT_METADATA_FILE = 'draft.json';
const DRAFT_BRIEF_FILE = 'brief.md';
const DRAFT_SCRIPT_FILE = 'script.txt';
const DRAFT_TEMP_PREFIX = '.new-project-draft-';
const LEGACY_PLANNING_AGENT_REQUEST_SCHEMA = 'film_pipeline.planning_agent_request.v1';
const PLANNING_AGENT_REQUEST_SCHEMA = 'film_pipeline.planning_agent_request.v2';
const PLANNING_DRAFT_SNAPSHOT_SCHEMA = 'film_pipeline.planning_draft_snapshot.v1';
const PLANNING_AGENT_SUGGESTION_SCHEMA = 'film_pipeline.planning_agent_suggestion.v1';
const PLANNING_AGENT_DECISION_RECEIPT_SCHEMA = 'film_pipeline.planning_agent_decision_receipt.v1';
const PLANNING_AGENT_COLLABORATION_DIRECTORY = 'collaboration';
const PLANNING_AGENT_QUEUE_DIRECTORY = 'queue';
const PLANNING_AGENT_SNAPSHOT_DIRECTORY = 'snapshots';
const PLANNING_AGENT_SUGGESTION_DIRECTORY = 'suggestions';
const PLANNING_AGENT_RECEIPT_DIRECTORY = 'receipts';
const PLANNING_AGENT_REQUEST_PREFIX = 'request_';
const PLANNING_AGENT_SNAPSHOT_PREFIX = 'revision_';
const PLANNING_AGENT_SUGGESTION_PREFIX = 'suggestion_';
const PLANNING_AGENT_DECISION_PREFIX = 'decision_';
const MAX_PLANNING_AGENT_INSTRUCTION_BYTES = 16 * 1024;
const MAX_PLANNING_AGENT_REQUEST_BYTES = 32 * 1024;
const MAX_PLANNING_AGENT_SUMMARY_BYTES = 2 * 1024;
const MAX_PLANNING_AGENT_SUGGESTION_BYTES = 320 * 1024;
const MAX_PLANNING_AGENT_RECEIPT_BYTES = 16 * 1024;
const MAX_PLANNING_AGENT_SNAPSHOT_MANIFEST_BYTES = 16 * 1024;
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
    const planningAgentSnapshotsRoot = path.join(collaborationRoot, PLANNING_AGENT_SNAPSHOT_DIRECTORY);
    const planningAgentSuggestionsRoot = path.join(collaborationRoot, PLANNING_AGENT_SUGGESTION_DIRECTORY);
    const planningAgentReceiptsRoot = path.join(collaborationRoot, PLANNING_AGENT_RECEIPT_DIRECTORY);
    return {
        userDataPath,
        draftRoot,
        metadataPath: path.join(draftRoot, DRAFT_METADATA_FILE),
        briefPath: path.join(draftRoot, DRAFT_BRIEF_FILE),
        scriptPath: path.join(draftRoot, DRAFT_SCRIPT_FILE),
        collaborationRoot,
        planningAgentQueueRoot,
        planningAgentSnapshotsRoot,
        planningAgentSuggestionsRoot,
        planningAgentReceiptsRoot,
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

function ensurePrivatePlanningAgentDirectories(paths, childNames = [PLANNING_AGENT_QUEUE_DIRECTORY]) {
    ensurePrivateDraftDirectory(paths);
    const draftStats = assertDirectory(
        paths.draftRoot,
        'PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE',
        { privateMode: true },
    );
    for (const [index, component] of [PLANNING_AGENT_COLLABORATION_DIRECTORY, ...childNames].entries()) {
        const current = index === 0
            ? paths.collaborationRoot
            : path.join(paths.collaborationRoot, component);
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
        const expectedByName = {
            [PLANNING_AGENT_QUEUE_DIRECTORY]: paths.planningAgentQueueRoot,
            [PLANNING_AGENT_SNAPSHOT_DIRECTORY]: paths.planningAgentSnapshotsRoot,
            [PLANNING_AGENT_SUGGESTION_DIRECTORY]: paths.planningAgentSuggestionsRoot,
            [PLANNING_AGENT_RECEIPT_DIRECTORY]: paths.planningAgentReceiptsRoot,
        };
        const expected = index === 0 ? paths.collaborationRoot : expectedByName[component];
        if (!expected) throw bootstrapError('PLANNING_AGENT_DIRECTORY_UNSAFE', 'Planning agent directory is unknown');
        if (fs.realpathSync.native(current) !== expected || stats.dev !== draftStats.dev) {
            throw bootstrapError('PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE', 'Planning agent queue escapes the draft root');
        }
    }
}

function ensurePrivatePlanningAgentQueue(paths) {
    ensurePrivatePlanningAgentDirectories(paths, [
        PLANNING_AGENT_QUEUE_DIRECTORY,
        PLANNING_AGENT_SNAPSHOT_DIRECTORY,
    ]);
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

function fsyncDirectory(directoryPath) {
    let descriptor;
    try {
        descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
        fs.fsyncSync(descriptor);
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
}

function atomicPublishPrivateFile(filePath, content, options = {}) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const parentPath = path.dirname(filePath);
    const parentBefore = assertDirectory(parentPath, 'PLANNING_AGENT_DIRECTORY_UNSAFE', { privateMode: true });
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw bootstrapError('NEW_PROJECT_DRAFT_NOFOLLOW_UNAVAILABLE', 'No-follow private publish is unavailable');
    }
    const randomBytes = options.randomBytes || crypto.randomBytes;
    const tempPath = path.join(parentPath, `${DRAFT_TEMP_PREFIX}${process.pid}-${randomBytes(12).toString('hex')}`);
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
    let descriptor;
    let published = false;
    try {
        descriptor = fs.openSync(tempPath, flags, 0o600);
        fs.fchmodSync(descriptor, 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        const parentAfter = assertDirectory(parentPath, 'PLANNING_AGENT_DIRECTORY_UNSAFE', { privateMode: true });
        if (parentBefore.dev !== parentAfter.dev || parentBefore.ino !== parentAfter.ino) {
            throw bootstrapError('NEW_PROJECT_DRAFT_PARENT_CHANGED', 'Private publish parent changed');
        }
        const tempStats = fs.lstatSync(tempPath);
        if (tempStats.isSymbolicLink() || !tempStats.isFile() || (tempStats.mode & 0o777) !== 0o600) {
            throw bootstrapError('NEW_PROJECT_DRAFT_TEMP_UNSAFE', 'Private publish temporary file is unsafe');
        }
        const linkFile = options.linkFile || fs.linkSync;
        linkFile(tempPath, filePath);
        published = true;
        const finalStats = fs.lstatSync(filePath);
        if (!finalStats.isFile() || finalStats.isSymbolicLink()
            || finalStats.dev !== tempStats.dev || finalStats.ino !== tempStats.ino
            || (finalStats.mode & 0o777) !== 0o600) {
            throw bootstrapError('PLANNING_AGENT_PUBLISH_UNSAFE', 'Published private file identity is unsafe');
        }
        fsyncDirectory(parentPath);
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
        try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!published) {
            // The final path is never removed here: another publisher may have won an EEXIST race.
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
    schemaVersion = PLANNING_AGENT_REQUEST_SCHEMA,
    stage, instruction, productionId, revisionSha256, briefSha256, scriptSha256,
    snapshotRevisionSha256 = '',
}) {
    return `${PLANNING_AGENT_REQUEST_PREFIX}${sha256(JSON.stringify({
        schema_version: schemaVersion,
        production_id: productionId,
        draft_revision_sha256: revisionSha256,
        brief_sha256: briefSha256,
        script_sha256: scriptSha256,
        ...(schemaVersion === PLANNING_AGENT_REQUEST_SCHEMA
            ? { snapshot_revision_sha256: snapshotRevisionSha256 }
            : {}),
        stage,
        instruction,
    }))}`;
}

function snapshotPaths(paths, revisionSha256) {
    const snapshotRoot = path.join(
        paths.planningAgentSnapshotsRoot,
        `${PLANNING_AGENT_SNAPSHOT_PREFIX}${revisionSha256}`,
    );
    return {
        snapshotRoot,
        manifestPath: path.join(snapshotRoot, 'manifest.json'),
        briefPath: path.join(snapshotRoot, DRAFT_BRIEF_FILE),
        scriptPath: path.join(snapshotRoot, DRAFT_SCRIPT_FILE),
    };
}

function validateSnapshotManifest(manifest, revision) {
    assertExactKeys(manifest, [
        'schema_version', 'draft_revision_sha256', 'production_id', 'route', 'aspect_ratio',
        'scene_duration', 'max_scenes', 'brief_sha256', 'script_sha256', 'created_at',
    ], 'PLANNING_AGENT_SNAPSHOT_INVALID');
    if (manifest.schema_version !== PLANNING_DRAFT_SNAPSHOT_SCHEMA
        || manifest.draft_revision_sha256 !== revision
        || !/^[a-f0-9]{64}$/.test(manifest.brief_sha256)
        || !/^[a-f0-9]{64}$/.test(manifest.script_sha256)
        || !Number.isFinite(Date.parse(manifest.created_at))) {
        throw bootstrapError('PLANNING_AGENT_SNAPSHOT_INVALID', 'Planning draft snapshot manifest is invalid');
    }
    return manifest;
}

function readPlanningDraftSnapshot(paths, revisionSha256) {
    if (!/^[a-f0-9]{64}$/.test(revisionSha256)) {
        throw bootstrapError('PLANNING_AGENT_SNAPSHOT_INVALID', 'Planning draft snapshot revision is invalid');
    }
    const snapshot = snapshotPaths(paths, revisionSha256);
    const rootStats = assertDirectory(
        snapshot.snapshotRoot,
        'PLANNING_AGENT_SNAPSHOT_UNSAFE',
        { privateMode: true },
    );
    const snapshotsStats = assertDirectory(
        paths.planningAgentSnapshotsRoot,
        'PLANNING_AGENT_SNAPSHOT_UNSAFE',
        { privateMode: true },
    );
    if (rootStats.dev !== snapshotsStats.dev
        || fs.realpathSync.native(snapshot.snapshotRoot) !== snapshot.snapshotRoot) {
        throw bootstrapError('PLANNING_AGENT_SNAPSHOT_UNSAFE', 'Planning draft snapshot escapes its root');
    }
    const names = fs.readdirSync(snapshot.snapshotRoot).sort();
    if (names.join(',') !== [DRAFT_BRIEF_FILE, DRAFT_SCRIPT_FILE, 'manifest.json'].sort().join(',')) {
        throw bootstrapError('PLANNING_AGENT_SNAPSHOT_UNSAFE', 'Planning draft snapshot content is not exact');
    }
    const manifestBuffer = readPrivateFile(snapshot.manifestPath, MAX_PLANNING_AGENT_SNAPSHOT_MANIFEST_BYTES);
    const briefBuffer = readPrivateFile(snapshot.briefPath, MAX_BRIEF_BYTES + 1);
    const scriptBuffer = readPrivateFile(snapshot.scriptPath, MAX_SCRIPT_BYTES + 1);
    let manifest;
    try { manifest = JSON.parse(manifestBuffer.toString('utf8')); } catch {
        throw bootstrapError('PLANNING_AGENT_SNAPSHOT_INVALID', 'Planning draft snapshot manifest is malformed');
    }
    validateSnapshotManifest(manifest, revisionSha256);
    if (sha256(briefBuffer) !== manifest.brief_sha256 || sha256(scriptBuffer) !== manifest.script_sha256) {
        throw bootstrapError('PLANNING_AGENT_SNAPSHOT_INVALID', 'Planning draft snapshot hashes do not match');
    }
    const draft = validateNewProjectDraft({
        production_id: manifest.production_id,
        brief: briefBuffer.toString('utf8'),
        script: scriptBuffer.toString('utf8'),
        route: manifest.route,
        aspect_ratio: manifest.aspect_ratio,
        scene_duration: manifest.scene_duration,
        max_scenes: manifest.max_scenes,
    });
    const evidence = draftRevisionEvidence(draft);
    if (evidence.revisionSha256 !== revisionSha256
        || evidence.briefSha256 !== manifest.brief_sha256
        || evidence.scriptSha256 !== manifest.script_sha256) {
        throw bootstrapError('PLANNING_AGENT_SNAPSHOT_INVALID', 'Planning draft snapshot revision does not match');
    }
    return { manifest, draft };
}

function publishPlanningDraftSnapshot(paths, draft, context = {}) {
    const evidence = draftRevisionEvidence(draft);
    ensurePrivatePlanningAgentDirectories(paths, [PLANNING_AGENT_SNAPSHOT_DIRECTORY]);
    try {
        return readPlanningDraftSnapshot(paths, evidence.revisionSha256);
    } catch (error) {
        if (error.code !== 'PLANNING_AGENT_SNAPSHOT_UNSAFE') throw error;
        try {
            fs.lstatSync(snapshotPaths(paths, evidence.revisionSha256).snapshotRoot);
            throw error;
        } catch (missingError) {
            if (missingError.code !== 'ENOENT') throw error;
        }
    }

    const snapshotsParent = paths.planningAgentSnapshotsRoot;
    const parentBefore = assertDirectory(snapshotsParent, 'PLANNING_AGENT_SNAPSHOT_UNSAFE', { privateMode: true });
    const randomBytes = context.randomBytes || crypto.randomBytes;
    const stagingRoot = path.join(
        snapshotsParent,
        `.snapshot-${process.pid}-${randomBytes(12).toString('hex')}`,
    );
    let published = false;
    try {
        fs.mkdirSync(stagingRoot, { mode: 0o700 });
        fs.chmodSync(stagingRoot, 0o700);
        const briefBuffer = Buffer.from(`${draft.brief}\n`, 'utf8');
        const scriptBuffer = Buffer.from(`${draft.script}\n`, 'utf8');
        const manifest = {
            schema_version: PLANNING_DRAFT_SNAPSHOT_SCHEMA,
            draft_revision_sha256: evidence.revisionSha256,
            production_id: draft.production_id,
            route: draft.route,
            aspect_ratio: draft.aspect_ratio,
            scene_duration: draft.scene_duration,
            max_scenes: draft.max_scenes,
            brief_sha256: evidence.briefSha256,
            script_sha256: evidence.scriptSha256,
            created_at: new Date().toISOString(),
        };
        for (const [name, buffer] of [
            [DRAFT_BRIEF_FILE, briefBuffer],
            [DRAFT_SCRIPT_FILE, scriptBuffer],
            ['manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')],
        ]) {
            const descriptor = fs.openSync(
                path.join(stagingRoot, name),
                fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
                0o600,
            );
            try {
                fs.fchmodSync(descriptor, 0o600);
                fs.writeFileSync(descriptor, buffer);
                fs.fsyncSync(descriptor);
            } finally { fs.closeSync(descriptor); }
        }
        fsyncDirectory(stagingRoot);
        const parentAfter = assertDirectory(snapshotsParent, 'PLANNING_AGENT_SNAPSHOT_UNSAFE', { privateMode: true });
        if (parentBefore.dev !== parentAfter.dev || parentBefore.ino !== parentAfter.ino) {
            throw bootstrapError('NEW_PROJECT_DRAFT_PARENT_CHANGED', 'Snapshot parent changed during publish');
        }
        const target = snapshotPaths(paths, evidence.revisionSha256).snapshotRoot;
        const renameDirectory = context.renameDirectory || fs.renameSync;
        renameDirectory(stagingRoot, target);
        published = true;
        fsyncDirectory(snapshotsParent);
    } catch (error) {
        if (!published && ['EEXIST', 'ENOTEMPTY'].includes(error.code)) {
            // A concurrent publisher won. Its immutable snapshot is validated below.
        } else {
            throw error;
        }
    } finally {
        if (!published) {
            try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* best effort own staging cleanup */ }
        }
    }
    return readPlanningDraftSnapshot(paths, evidence.revisionSha256);
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
    const isLegacy = record?.schema_version === LEGACY_PLANNING_AGENT_REQUEST_SCHEMA;
    assertExactKeys(record, [
        'schema_version', 'request_id', 'stage', 'instruction', 'production_id',
        'draft_revision_sha256', 'brief_sha256', 'script_sha256', 'status',
        'requested_at', 'executed', 'model_called',
        ...(!isLegacy ? ['snapshot_revision_sha256'] : []),
    ], 'PLANNING_AGENT_QUEUE_RECORD_INVALID');
    if (![LEGACY_PLANNING_AGENT_REQUEST_SCHEMA, PLANNING_AGENT_REQUEST_SCHEMA].includes(record.schema_version)
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
        || (!isLegacy && record.snapshot_revision_sha256 !== record.draft_revision_sha256)
        || record.status !== 'queued_local_handoff'
        || !Number.isFinite(Date.parse(record.requested_at))
        || record.executed !== false
        || record.model_called !== false) {
        throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_INVALID', 'Planning agent queue record is invalid');
    }
    const expectedId = planningAgentRequestId({
        schemaVersion: record.schema_version,
        stage: record.stage,
        instruction: record.instruction,
        productionId: record.production_id,
        revisionSha256: record.draft_revision_sha256,
        briefSha256: record.brief_sha256,
        scriptSha256: record.script_sha256,
        snapshotRevisionSha256: isLegacy ? '' : record.snapshot_revision_sha256,
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

function requestFilePath(paths, requestId) {
    if (typeof requestId !== 'string' || !/^request_[a-f0-9]{64}$/.test(requestId)) {
        throw bootstrapError('PLANNING_AGENT_REQUEST_ID_INVALID', 'Planning agent request id is invalid');
    }
    return path.join(paths.planningAgentQueueRoot, `${requestId}.json`);
}

function readPlanningAgentRequest(paths, requestId, currentDraft = null) {
    const filePath = requestFilePath(paths, requestId);
    let record;
    try { record = JSON.parse(readPrivateFile(filePath, MAX_PLANNING_AGENT_REQUEST_BYTES).toString('utf8')); } catch (error) {
        if (error.code) throw error;
        throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_INVALID', 'Planning agent request is malformed');
    }
    validatePlanningAgentRequestRecord(record, currentDraft);
    if (record.request_id !== requestId) {
        throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_INVALID', 'Planning agent request filename does not match');
    }
    return record;
}

function snapshotForRequest(paths, request, currentDraft = null) {
    if (request.schema_version === PLANNING_AGENT_REQUEST_SCHEMA) {
        const snapshot = readPlanningDraftSnapshot(paths, request.snapshot_revision_sha256);
        if (snapshot.manifest.draft_revision_sha256 !== request.draft_revision_sha256
            || snapshot.manifest.production_id !== request.production_id
            || snapshot.manifest.brief_sha256 !== request.brief_sha256
            || snapshot.manifest.script_sha256 !== request.script_sha256) {
            throw bootstrapError('PLANNING_AGENT_SNAPSHOT_INVALID', 'Planning request and snapshot do not match');
        }
        return { ...snapshot, legacyFallback: false };
    }
    if (!currentDraft) {
        throw bootstrapError('PLANNING_AGENT_LEGACY_SOURCE_UNAVAILABLE', 'Legacy planning request source is unavailable');
    }
    const evidence = draftRevisionEvidence(currentDraft);
    if (evidence.revisionSha256 !== request.draft_revision_sha256
        || evidence.briefSha256 !== request.brief_sha256
        || evidence.scriptSha256 !== request.script_sha256
        || currentDraft.production_id !== request.production_id) {
        throw bootstrapError('PLANNING_AGENT_LEGACY_SOURCE_UNAVAILABLE', 'Legacy planning request no longer matches the draft');
    }
    return {
        manifest: {
            schema_version: PLANNING_DRAFT_SNAPSHOT_SCHEMA,
            draft_revision_sha256: evidence.revisionSha256,
            production_id: currentDraft.production_id,
            route: currentDraft.route,
            aspect_ratio: currentDraft.aspect_ratio,
            scene_duration: currentDraft.scene_duration,
            max_scenes: currentDraft.max_scenes,
            brief_sha256: evidence.briefSha256,
            script_sha256: evidence.scriptSha256,
            created_at: request.requested_at,
        },
        draft: currentDraft,
        legacyFallback: true,
    };
}

function planningAgentSuggestionToken({ request, proposedTextSha256, summary, appModelCalled = false }) {
    return `${PLANNING_AGENT_SUGGESTION_PREFIX}${sha256(JSON.stringify({
        schema_version: PLANNING_AGENT_SUGGESTION_SCHEMA,
        request_id: request.request_id,
        stage: request.stage,
        base_revision_sha256: request.draft_revision_sha256,
        target_source_sha256: request.stage === 'brief' ? request.brief_sha256 : request.script_sha256,
        proposed_text_sha256: proposedTextSha256,
        summary,
        produced_by_agent: true,
        app_model_called: appModelCalled,
    }))}`;
}

function validatePlanningAgentSuggestion(record, request) {
    assertExactKeys(record, [
        'schema_version', 'suggestion_token', 'request_id', 'stage', 'base_revision_sha256',
        'target_source_sha256', 'proposed_text_sha256', 'proposed_text', 'summary',
        'published_at', 'produced_by_agent', 'app_model_called', 'status',
    ], 'PLANNING_AGENT_SUGGESTION_INVALID');
    const maxTextBytes = request.stage === 'brief' ? MAX_BRIEF_BYTES : MAX_SCRIPT_BYTES;
    const proposedText = safeString(
        record.proposed_text,
        'PLANNING_AGENT_SUGGESTION_INVALID',
        maxTextBytes,
    );
    const proposedHash = sha256(Buffer.from(`${proposedText}\n`, 'utf8'));
    const summary = safeString(
        record.summary,
        'PLANNING_AGENT_SUGGESTION_INVALID',
        MAX_PLANNING_AGENT_SUMMARY_BYTES,
    );
    const sourceHash = request.stage === 'brief' ? request.brief_sha256 : request.script_sha256;
    const expectedToken = planningAgentSuggestionToken({
        request,
        proposedTextSha256: proposedHash,
        summary,
        appModelCalled: record.app_model_called,
    });
    if (record.schema_version !== PLANNING_AGENT_SUGGESTION_SCHEMA
        || record.suggestion_token !== expectedToken
        || record.request_id !== request.request_id
        || record.stage !== request.stage
        || record.base_revision_sha256 !== request.draft_revision_sha256
        || record.target_source_sha256 !== sourceHash
        || record.proposed_text_sha256 !== proposedHash
        || record.proposed_text !== proposedText
        || record.summary !== summary
        || !Number.isFinite(Date.parse(record.published_at))
        || record.produced_by_agent !== true
        || typeof record.app_model_called !== 'boolean'
        || record.status !== 'ready_for_review') {
        throw bootstrapError('PLANNING_AGENT_SUGGESTION_INVALID', 'Planning agent suggestion is invalid');
    }
    if (proposedHash === sourceHash) {
        throw bootstrapError('PLANNING_AGENT_SUGGESTION_NOOP', 'Planning agent suggestion does not change the target text');
    }
    return record;
}

function suggestionPath(paths, requestId) {
    return path.join(paths.planningAgentSuggestionsRoot, `${requestId}.json`);
}

function readPlanningAgentSuggestion(paths, request) {
    let buffer;
    try { buffer = readPrivateFile(suggestionPath(paths, request.request_id), MAX_PLANNING_AGENT_SUGGESTION_BYTES); } catch (error) {
        if (error.code === 'NEW_PROJECT_DRAFT_INCOMPLETE') return null;
        throw error;
    }
    let record;
    try { record = JSON.parse(buffer.toString('utf8')); } catch {
        throw bootstrapError('PLANNING_AGENT_SUGGESTION_INVALID', 'Planning agent suggestion is malformed');
    }
    return validatePlanningAgentSuggestion(record, request);
}

function decisionReceiptId(action, suggestionToken) {
    return `${PLANNING_AGENT_DECISION_PREFIX}${sha256(JSON.stringify({
        schema_version: PLANNING_AGENT_DECISION_RECEIPT_SCHEMA,
        action,
        suggestion_token: suggestionToken,
    }))}`;
}

function decisionReceiptPath(paths, action, suggestionToken) {
    return path.join(paths.planningAgentReceiptsRoot, `${action}_${suggestionToken}.json`);
}

function validateDecisionReceipt(record, action, suggestion, request) {
    assertExactKeys(record, [
        'schema_version', 'receipt_id', 'suggestion_token', 'request_id', 'stage', 'action',
        'source_revision_sha256', 'source_target_sha256', 'proposed_text_sha256',
        'result_revision_sha256', 'decided_at', 'draft_written', 'one_shot',
    ], 'PLANNING_AGENT_DECISION_RECEIPT_INVALID');
    if (record.schema_version !== PLANNING_AGENT_DECISION_RECEIPT_SCHEMA
        || record.receipt_id !== decisionReceiptId(action, suggestion.suggestion_token)
        || record.suggestion_token !== suggestion.suggestion_token
        || record.request_id !== request.request_id
        || record.stage !== request.stage
        || record.action !== action
        || record.source_revision_sha256 !== request.draft_revision_sha256
        || record.source_target_sha256 !== suggestion.target_source_sha256
        || record.proposed_text_sha256 !== suggestion.proposed_text_sha256
        || !/^[a-f0-9]{64}$/.test(record.result_revision_sha256)
        || !Number.isFinite(Date.parse(record.decided_at))
        || record.draft_written !== (action === 'apply')
        || record.one_shot !== true) {
        throw bootstrapError('PLANNING_AGENT_DECISION_RECEIPT_INVALID', 'Planning agent decision receipt is invalid');
    }
    return record;
}

function readDecisionReceipt(paths, action, suggestion, request) {
    let buffer;
    try {
        buffer = readPrivateFile(
            decisionReceiptPath(paths, action, suggestion.suggestion_token),
            MAX_PLANNING_AGENT_RECEIPT_BYTES,
        );
    } catch (error) {
        if (error.code === 'NEW_PROJECT_DRAFT_INCOMPLETE') return null;
        throw error;
    }
    let record;
    try { record = JSON.parse(buffer.toString('utf8')); } catch {
        throw bootstrapError('PLANNING_AGENT_DECISION_RECEIPT_INVALID', 'Planning agent decision receipt is malformed');
    }
    return validateDecisionReceipt(record, action, suggestion, request);
}

function emptyPlanningCollaboration() {
    return {
        status: 'empty',
        total_request_count: 0,
        ready_suggestion_count: 0,
        stale_suggestion_count: 0,
        applied_suggestion_count: 0,
        recent_requests: [],
        truncated: false,
        blockers: [],
    };
}

function validateOptionalArtifactDirectory(rootPath, pattern, limit, code) {
    let stats;
    try { stats = fs.lstatSync(rootPath); } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory() || (stats.mode & 0o077) !== 0
        || fs.realpathSync.native(rootPath) !== rootPath) {
        throw bootstrapError(code, 'Planning collaboration artifact directory is unsafe');
    }
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    if (entries.length > limit) throw bootstrapError(code, 'Planning collaboration artifact limit was reached');
    for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink() || !pattern.test(entry.name)) {
            throw bootstrapError(code, 'Planning collaboration artifact entry is unsafe');
        }
    }
    return entries;
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
            snapshotForRequest(paths, record, draft);
            return record;
        }).sort((left, right) => Date.parse(right.requested_at) - Date.parse(left.requested_at));

        validateOptionalArtifactDirectory(
            paths.planningAgentSuggestionsRoot,
            /^request_[a-f0-9]{64}\.json$/,
            MAX_PLANNING_AGENT_REQUEST_FILES,
            'PLANNING_AGENT_SUGGESTION_DIRECTORY_UNSAFE',
        );
        validateOptionalArtifactDirectory(
            paths.planningAgentReceiptsRoot,
            /^(?:hold|apply)_suggestion_[a-f0-9]{64}\.json$/,
            MAX_PLANNING_AGENT_REQUEST_FILES * 2,
            'PLANNING_AGENT_RECEIPT_DIRECTORY_UNSAFE',
        );
        const currentEvidence = draftRevisionEvidence(draft);
        let readySuggestionCount = 0;
        let staleSuggestionCount = 0;
        let appliedSuggestionCount = 0;
        const projectedRecords = records.map((record) => {
            const suggestion = readPlanningAgentSuggestion(paths, record);
            if (!suggestion) return record;
            const applyReceipt = readDecisionReceipt(paths, 'apply', suggestion, record);
            const holdReceipt = readDecisionReceipt(paths, 'hold', suggestion, record);
            const currentTargetHash = record.stage === 'brief'
                ? currentEvidence.briefSha256
                : currentEvidence.scriptSha256;
            let reviewStatus;
            let applyAllowed = false;
            if (applyReceipt) {
                appliedSuggestionCount += 1;
                reviewStatus = currentTargetHash === suggestion.proposed_text_sha256
                    ? 'applied'
                    : 'applied_then_edited';
            } else if (currentTargetHash === suggestion.target_source_sha256
                || currentTargetHash === suggestion.proposed_text_sha256) {
                readySuggestionCount += 1;
                applyAllowed = true;
                reviewStatus = holdReceipt ? 'held' : 'ready';
            } else {
                staleSuggestionCount += 1;
                reviewStatus = 'stale';
            }
            return {
                ...record,
                suggestion: {
                    suggestion_token: suggestion.suggestion_token,
                    review_status: reviewStatus,
                    summary: suggestion.summary,
                    proposed_text: suggestion.proposed_text,
                    published_at: suggestion.published_at,
                    apply_allowed: applyAllowed,
                    reapply_allowed: false,
                    applied_at: applyReceipt?.decided_at || '',
                    held_at: holdReceipt?.decided_at || '',
                },
            };
        });
        const status = appliedSuggestionCount > 0 && readySuggestionCount === 0 && staleSuggestionCount === 0
            ? 'applied'
            : readySuggestionCount > 0
                ? 'suggestion_ready'
                : staleSuggestionCount > 0
                    ? 'stale'
                    : records.length
                        ? 'queued'
                        : 'empty';
        return {
            status,
            total_request_count: records.length,
            ready_suggestion_count: readySuggestionCount,
            stale_suggestion_count: staleSuggestionCount,
            applied_suggestion_count: appliedSuggestionCount,
            recent_requests: projectedRecords.slice(0, MAX_RECENT_PLANNING_AGENT_REQUESTS),
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

function hasCanonicalDraftFile(paths) {
    for (const filePath of [paths.metadataPath, paths.briefPath, paths.scriptPath]) {
        try {
            fs.lstatSync(filePath);
            return true;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return false;
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
        if (!hasCanonicalDraftFile(paths)) {
            return { status: 'empty', draft: defaultDraft(), savedAt: '', paths, errorCode: '' };
        }
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
    publishPlanningDraftSnapshot(loaded.paths, loaded.draft, context);

    const requestId = planningAgentRequestId({
        schemaVersion: PLANNING_AGENT_REQUEST_SCHEMA,
        stage: request.stage,
        instruction: request.instruction,
        productionId: loaded.draft.production_id,
        revisionSha256: revision.revisionSha256,
        briefSha256: revision.briefSha256,
        scriptSha256: revision.scriptSha256,
        snapshotRevisionSha256: revision.revisionSha256,
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
            snapshot_revision_sha256: revision.revisionSha256,
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
        try {
            atomicPublishPrivateFile(requestPath, buffer, context);
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const existing = JSON.parse(readPrivateFile(requestPath, MAX_PLANNING_AGENT_REQUEST_BYTES).toString('utf8'));
            validatePlanningAgentRequestRecord(existing, loaded.draft);
            if (existing.request_id !== requestId) {
                throw bootstrapError('PLANNING_AGENT_REQUEST_IDEMPOTENCY_CONFLICT', 'Concurrent planning request differs');
            }
            alreadyQueued = true;
        }
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

function preparePlanningAgentHandoff(payload, context = {}) {
    assertExactKeys(payload, ['request_id'], 'PLANNING_AGENT_PREPARE_SHAPE_INVALID');
    const loaded = loadDraft(context);
    if (loaded.status !== 'restored' || !loaded.paths) {
        throw bootstrapError('PLANNING_AGENT_DRAFT_NOT_SAVED', 'A saved draft is required for agent handoff');
    }
    const request = readPlanningAgentRequest(loaded.paths, payload.request_id, loaded.draft);
    const snapshot = snapshotForRequest(loaded.paths, request, loaded.draft);
    return {
        ok: true,
        request,
        snapshot: {
            manifest: snapshot.manifest,
            brief: snapshot.draft.brief,
            script: snapshot.draft.script,
        },
        legacy_fallback: snapshot.legacyFallback,
    };
}

function validateSuggestionPublishPayload(payload) {
    assertExactKeys(
        payload,
        ['request_id', 'proposed_text', 'summary'],
        'PLANNING_AGENT_SUGGESTION_SHAPE_INVALID',
    );
    if (typeof payload.request_id !== 'string' || !/^request_[a-f0-9]{64}$/.test(payload.request_id)) {
        throw bootstrapError('PLANNING_AGENT_REQUEST_ID_INVALID', 'Planning agent request id is invalid');
    }
    return payload;
}

function publishPlanningAgentSuggestion(payload, context = {}) {
    const input = validateSuggestionPublishPayload(payload);
    const handoff = preparePlanningAgentHandoff({ request_id: input.request_id }, context);
    const request = handoff.request;
    const maxTextBytes = request.stage === 'brief' ? MAX_BRIEF_BYTES : MAX_SCRIPT_BYTES;
    const proposedText = safeString(
        input.proposed_text,
        'PLANNING_AGENT_SUGGESTION_TEXT_INVALID',
        maxTextBytes,
    );
    const summary = safeString(
        input.summary,
        'PLANNING_AGENT_SUGGESTION_SUMMARY_INVALID',
        MAX_PLANNING_AGENT_SUMMARY_BYTES,
    );
    const proposedTextSha256 = sha256(Buffer.from(`${proposedText}\n`, 'utf8'));
    const sourceHash = request.stage === 'brief' ? request.brief_sha256 : request.script_sha256;
    if (proposedTextSha256 === sourceHash) {
        throw bootstrapError('PLANNING_AGENT_SUGGESTION_NOOP', 'Planning agent suggestion does not change the target text');
    }
    const loaded = loadDraft(context);
    if (loaded.status !== 'restored' || !loaded.paths) {
        throw bootstrapError('PLANNING_AGENT_DRAFT_NOT_SAVED', 'A saved draft is required for agent suggestion');
    }
    ensurePrivatePlanningAgentDirectories(loaded.paths, [PLANNING_AGENT_SUGGESTION_DIRECTORY]);
    const appModelCalled = context.appModelCalled === true;
    const token = planningAgentSuggestionToken({ request, proposedTextSha256, summary, appModelCalled });
    const filePath = suggestionPath(loaded.paths, request.request_id);
    let existing;
    try { existing = readPlanningAgentSuggestion(loaded.paths, request); } catch (error) { throw error; }
    if (existing) {
        if (existing.suggestion_token !== token
            || existing.proposed_text !== proposedText
            || existing.summary !== summary) {
            throw bootstrapError('PLANNING_AGENT_SUGGESTION_CONFLICT', 'A different suggestion already exists for this request');
        }
        return {
            ok: true,
            published: true,
            already_published: true,
            suggestion_token: token,
            request_id: request.request_id,
            proposed_text_sha256: proposedTextSha256,
            proposed_text_bytes: Buffer.byteLength(proposedText, 'utf8'),
            status: 'ready_for_review',
            app_model_called: existing.app_model_called,
        };
    }
    const record = {
        schema_version: PLANNING_AGENT_SUGGESTION_SCHEMA,
        suggestion_token: token,
        request_id: request.request_id,
        stage: request.stage,
        base_revision_sha256: request.draft_revision_sha256,
        target_source_sha256: sourceHash,
        proposed_text_sha256: proposedTextSha256,
        proposed_text: proposedText,
        summary,
        published_at: new Date().toISOString(),
        produced_by_agent: true,
        app_model_called: appModelCalled,
        status: 'ready_for_review',
    };
    validatePlanningAgentSuggestion(record, request);
    const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
    if (buffer.byteLength > MAX_PLANNING_AGENT_SUGGESTION_BYTES) {
        throw bootstrapError('PLANNING_AGENT_SUGGESTION_TOO_LARGE', 'Planning agent suggestion is too large');
    }
    try {
        atomicPublishPrivateFile(filePath, buffer, context);
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const raced = readPlanningAgentSuggestion(loaded.paths, request);
        if (!raced || raced.suggestion_token !== token) {
            throw bootstrapError('PLANNING_AGENT_SUGGESTION_CONFLICT', 'Concurrent planning agent suggestion differs');
        }
        return {
            ok: true, published: true, already_published: true,
            suggestion_token: token, request_id: request.request_id,
            proposed_text_sha256: proposedTextSha256,
            proposed_text_bytes: Buffer.byteLength(proposedText, 'utf8'),
            status: 'ready_for_review', app_model_called: raced.app_model_called,
        };
    }
    return {
        ok: true,
        published: true,
        already_published: false,
        suggestion_token: token,
        request_id: request.request_id,
        proposed_text_sha256: proposedTextSha256,
        proposed_text_bytes: Buffer.byteLength(proposedText, 'utf8'),
        status: 'ready_for_review',
        app_model_called: appModelCalled,
    };
}

function findPlanningSuggestion(paths, suggestionToken, currentDraft) {
    if (typeof suggestionToken !== 'string' || !/^suggestion_[a-f0-9]{64}$/.test(suggestionToken)) {
        throw bootstrapError('PLANNING_AGENT_SUGGESTION_TOKEN_INVALID', 'Planning agent suggestion token is invalid');
    }
    const queueStats = assertDirectory(
        paths.planningAgentQueueRoot,
        'PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE',
        { privateMode: true },
    );
    if (fs.realpathSync.native(paths.planningAgentQueueRoot) !== paths.planningAgentQueueRoot) {
        throw bootstrapError('PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE', 'Planning agent queue is unsafe');
    }
    const entries = fs.readdirSync(paths.planningAgentQueueRoot);
    if (entries.length > MAX_PLANNING_AGENT_REQUEST_FILES || !queueStats.isDirectory()) {
        throw bootstrapError('PLANNING_AGENT_QUEUE_LIMIT_REACHED', 'Planning agent queue limit was reached');
    }
    for (const name of entries) {
        if (!/^request_[a-f0-9]{64}\.json$/.test(name)) {
            throw bootstrapError('PLANNING_AGENT_QUEUE_RECORD_UNSAFE', 'Planning agent queue entry is unsafe');
        }
        const requestId = name.slice(0, -5);
        const request = readPlanningAgentRequest(paths, requestId, currentDraft);
        snapshotForRequest(paths, request, currentDraft);
        const suggestion = readPlanningAgentSuggestion(paths, request);
        if (suggestion?.suggestion_token === suggestionToken) return { request, suggestion };
    }
    throw bootstrapError('PLANNING_AGENT_SUGGESTION_NOT_FOUND', 'Planning agent suggestion was not found');
}

function publishDecisionReceipt(paths, action, suggestion, request, resultRevision, context = {}) {
    ensurePrivatePlanningAgentDirectories(paths, [PLANNING_AGENT_RECEIPT_DIRECTORY]);
    const record = {
        schema_version: PLANNING_AGENT_DECISION_RECEIPT_SCHEMA,
        receipt_id: decisionReceiptId(action, suggestion.suggestion_token),
        suggestion_token: suggestion.suggestion_token,
        request_id: request.request_id,
        stage: request.stage,
        action,
        source_revision_sha256: request.draft_revision_sha256,
        source_target_sha256: suggestion.target_source_sha256,
        proposed_text_sha256: suggestion.proposed_text_sha256,
        result_revision_sha256: resultRevision,
        decided_at: new Date().toISOString(),
        draft_written: action === 'apply',
        one_shot: true,
    };
    validateDecisionReceipt(record, action, suggestion, request);
    const filePath = decisionReceiptPath(paths, action, suggestion.suggestion_token);
    const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
    try {
        atomicPublishPrivateFile(filePath, buffer, context);
        return { receipt: record, alreadyPublished: false };
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = readDecisionReceipt(paths, action, suggestion, request);
        if (!existing) throw bootstrapError('PLANNING_AGENT_DECISION_CONFLICT', 'Decision receipt publish conflicted');
        return { receipt: existing, alreadyPublished: true };
    }
}

function decidePlanningAgentSuggestion(payload, context = {}) {
    assertExactKeys(
        payload,
        ['suggestion_token', 'action', 'expected_revision_sha256'],
        'PLANNING_AGENT_DECISION_SHAPE_INVALID',
    );
    if (!['apply', 'hold'].includes(payload.action)) {
        throw bootstrapError('PLANNING_AGENT_DECISION_ACTION_INVALID', 'Planning agent decision action is invalid');
    }
    if (typeof payload.expected_revision_sha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(payload.expected_revision_sha256)) {
        throw bootstrapError('PLANNING_AGENT_DECISION_REVISION_INVALID', 'Planning agent decision revision is invalid');
    }
    const loaded = loadDraft(context);
    if (loaded.status !== 'restored' || !loaded.paths) {
        throw bootstrapError('PLANNING_AGENT_DRAFT_NOT_SAVED', 'A saved draft is required for planning decision');
    }
    const { request, suggestion } = findPlanningSuggestion(
        loaded.paths,
        payload.suggestion_token,
        loaded.draft,
    );
    ensurePrivatePlanningAgentDirectories(loaded.paths, [PLANNING_AGENT_RECEIPT_DIRECTORY]);
    const existingApply = readDecisionReceipt(loaded.paths, 'apply', suggestion, request);
    const currentEvidence = draftRevisionEvidence(loaded.draft);
    const currentTargetHash = request.stage === 'brief'
        ? currentEvidence.briefSha256
        : currentEvidence.scriptSha256;
    if (existingApply) {
        return {
            ok: true,
            applied: false,
            held: false,
            already_decided: true,
            receipt_recovered: false,
            suggestion_token: suggestion.suggestion_token,
            request_id: request.request_id,
            stage: request.stage,
            status: currentTargetHash === suggestion.proposed_text_sha256
                ? 'already_applied'
                : 'applied_then_edited',
            reapply_allowed: false,
            result_revision_sha256: existingApply.result_revision_sha256,
            state: getNewProjectDraftState(context),
        };
    }
    if (payload.action === 'apply' && currentTargetHash === suggestion.proposed_text_sha256) {
        const recovered = publishDecisionReceipt(
            loaded.paths,
            'apply',
            suggestion,
            request,
            currentEvidence.revisionSha256,
            context,
        );
        return {
            ok: true, applied: false, held: false, already_decided: false,
            receipt_recovered: !recovered.alreadyPublished,
            suggestion_token: suggestion.suggestion_token, request_id: request.request_id,
            stage: request.stage, status: 'applied', reapply_allowed: false,
            result_revision_sha256: currentEvidence.revisionSha256,
            state: getNewProjectDraftState(context),
        };
    }
    if (currentEvidence.revisionSha256 !== payload.expected_revision_sha256) {
        throw bootstrapError('PLANNING_AGENT_DECISION_STALE', 'The draft changed before the planning decision');
    }
    if (payload.action === 'hold') {
        const existingHold = readDecisionReceipt(loaded.paths, 'hold', suggestion, request);
        if (existingHold) {
            return {
                ok: true, applied: false, held: true, already_decided: true,
                receipt_recovered: false, suggestion_token: suggestion.suggestion_token,
                request_id: request.request_id, stage: request.stage, status: 'held',
                reapply_allowed: true, result_revision_sha256: currentEvidence.revisionSha256,
                state: getNewProjectDraftState(context),
            };
        }
        publishDecisionReceipt(
            loaded.paths,
            'hold',
            suggestion,
            request,
            currentEvidence.revisionSha256,
            context,
        );
        return {
            ok: true, applied: false, held: true, already_decided: false,
            receipt_recovered: false, suggestion_token: suggestion.suggestion_token,
            request_id: request.request_id, stage: request.stage, status: 'held',
            reapply_allowed: true, result_revision_sha256: currentEvidence.revisionSha256,
            state: getNewProjectDraftState(context),
        };
    }

    if (currentTargetHash !== suggestion.target_source_sha256) {
        throw bootstrapError('PLANNING_AGENT_SUGGESTION_STALE', 'The target text changed before suggestion apply');
    }
    const nextDraft = {
        ...loaded.draft,
        [request.stage]: suggestion.proposed_text,
    };
    const saved = saveNewProjectDraft(nextDraft, context);
    const resultRevision = saved.revision_sha256;
    publishDecisionReceipt(
        loaded.paths,
        'apply',
        suggestion,
        request,
        resultRevision,
        context,
    );
    return {
        ok: true, applied: true, held: false, already_decided: false,
        receipt_recovered: false, suggestion_token: suggestion.suggestion_token,
        request_id: request.request_id, stage: request.stage, status: 'applied',
        reapply_allowed: false, result_revision_sha256: resultRevision,
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
    LEGACY_PLANNING_AGENT_REQUEST_SCHEMA,
    PLANNING_DRAFT_SNAPSHOT_SCHEMA,
    PLANNING_AGENT_SUGGESTION_SCHEMA,
    PLANNING_AGENT_DECISION_RECEIPT_SCHEMA,
    defaultDraft,
    validateNewProjectDraft,
    exactDraftPaths,
    getNewProjectDraftState,
    saveNewProjectDraft,
    enqueuePlanningAgentRequest,
    preparePlanningAgentHandoff,
    publishPlanningAgentSuggestion,
    decidePlanningAgentSuggestion,
    copyNewProjectBuildCommand,
};
