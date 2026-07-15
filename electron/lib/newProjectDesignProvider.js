const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const newProjectDraftProvider = require('./newProjectDraftProvider');

const BOARD_FILE = 'board.json';
const DESIGN_DIRECTORY = 'design';
const COLLABORATION_DIRECTORY = 'collaboration';
const QUEUE_DIRECTORY = 'queue';
const SNAPSHOT_DIRECTORY = 'snapshots';
const SUGGESTION_DIRECTORY = 'suggestions';
const RECEIPT_DIRECTORY = 'receipts';
const REQUEST_SCHEMA = 'film_pipeline.design_agent_request.v1';
const SNAPSHOT_SCHEMA = 'film_pipeline.design_agent_snapshot.v1';
const SUGGESTION_SCHEMA = 'film_pipeline.design_agent_suggestion.v1';
const RECEIPT_SCHEMA = 'film_pipeline.design_agent_decision_receipt.v1';
const MAX_BOARD_BYTES = 512 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_SNAPSHOT_MANIFEST_BYTES = 16 * 1024;
const MAX_SUGGESTION_BYTES = 768 * 1024;
const MAX_RECEIPT_BYTES = 16 * 1024;
const MAX_INSTRUCTION_BYTES = 16 * 1024;
const MAX_SUMMARY_BYTES = 2 * 1024;
const MAX_REQUESTS = 200;
const MAX_RECENT_REQUESTS = 20;
const MAX_CHARACTERS = 12;
const MAX_LOCATIONS = 12;
const MAX_SCENES = 20;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const SHA256 = /^[a-f0-9]{64}$/;

function failure(code, message = code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function isWellFormedUnicode(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF) {
            if (index + 1 >= value.length) return false;
            const next = value.charCodeAt(index + 1);
            if (next < 0xDC00 || next > 0xDFFF) return false;
            index += 1;
        } else if (code >= 0xDC00 && code <= 0xDFFF) return false;
    }
    return true;
}

function exactKeys(value, expected, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
        throw failure(code, 'Design object shape is invalid');
    }
}

function text(value, code, maxBytes, { allowEmpty = false } = {}) {
    if (typeof value !== 'string' || value.includes('\0') || !isWellFormedUnicode(value)) {
        throw failure(code, 'Design text is invalid');
    }
    const normalized = value.trim();
    if ((!allowEmpty && !normalized) || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
        throw failure(code, 'Design text is empty or too large');
    }
    return normalized;
}

function id(value, code) {
    const normalized = text(value, code, 64);
    if (!SAFE_ID.test(normalized) || normalized.includes('..')) throw failure(code, 'Design id is invalid');
    return normalized;
}

function boundedArray(value, maximum, code) {
    if (!Array.isArray(value) || value.length > maximum) throw failure(code, 'Design array is invalid');
    return value;
}

function validateBoard(value, { allowEmpty = false } = {}) {
    exactKeys(value, ['characters', 'locations', 'scenes'], 'DESIGN_BOARD_SHAPE_INVALID');
    const characters = boundedArray(value.characters, MAX_CHARACTERS, 'DESIGN_CHARACTERS_INVALID').map((item) => {
        exactKeys(item, ['id', 'name', 'role', 'appearance', 'wardrobe', 'continuity'], 'DESIGN_CHARACTER_SHAPE_INVALID');
        return {
            id: id(item.id, 'DESIGN_CHARACTER_ID_INVALID'),
            name: text(item.name, 'DESIGN_CHARACTER_TEXT_INVALID', 512),
            role: text(item.role, 'DESIGN_CHARACTER_TEXT_INVALID', 2048, { allowEmpty: true }),
            appearance: text(item.appearance, 'DESIGN_CHARACTER_TEXT_INVALID', 8192, { allowEmpty: true }),
            wardrobe: text(item.wardrobe, 'DESIGN_CHARACTER_TEXT_INVALID', 8192, { allowEmpty: true }),
            continuity: text(item.continuity, 'DESIGN_CHARACTER_TEXT_INVALID', 8192, { allowEmpty: true }),
        };
    });
    const locations = boundedArray(value.locations, MAX_LOCATIONS, 'DESIGN_LOCATIONS_INVALID').map((item) => {
        exactKeys(item, ['id', 'name', 'space', 'lighting', 'props', 'continuity'], 'DESIGN_LOCATION_SHAPE_INVALID');
        return {
            id: id(item.id, 'DESIGN_LOCATION_ID_INVALID'),
            name: text(item.name, 'DESIGN_LOCATION_TEXT_INVALID', 512),
            space: text(item.space, 'DESIGN_LOCATION_TEXT_INVALID', 8192, { allowEmpty: true }),
            lighting: text(item.lighting, 'DESIGN_LOCATION_TEXT_INVALID', 8192, { allowEmpty: true }),
            props: text(item.props, 'DESIGN_LOCATION_TEXT_INVALID', 8192, { allowEmpty: true }),
            continuity: text(item.continuity, 'DESIGN_LOCATION_TEXT_INVALID', 8192, { allowEmpty: true }),
        };
    });
    const scenes = boundedArray(value.scenes, MAX_SCENES, 'DESIGN_SCENES_INVALID').map((item) => {
        exactKeys(item, [
            'id', 'title', 'dramatic_beat', 'characters', 'location_id', 'duration',
            'first_frame', 'action', 'camera', 'lighting', 'audio_sfx_dialogue',
        ], 'DESIGN_SCENE_SHAPE_INVALID');
        const duration = Number(item.duration);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
            throw failure('DESIGN_SCENE_DURATION_INVALID', 'Design scene duration is invalid');
        }
        const characterIds = boundedArray(item.characters, MAX_CHARACTERS, 'DESIGN_SCENE_CHARACTERS_INVALID')
            .map((entry) => id(entry, 'DESIGN_SCENE_CHARACTER_ID_INVALID'));
        if (new Set(characterIds).size !== characterIds.length) {
            throw failure('DESIGN_SCENE_CHARACTERS_INVALID', 'Design scene character references are duplicated');
        }
        return {
            id: id(item.id, 'DESIGN_SCENE_ID_INVALID'),
            title: text(item.title, 'DESIGN_SCENE_TEXT_INVALID', 1024),
            dramatic_beat: text(item.dramatic_beat, 'DESIGN_SCENE_TEXT_INVALID', 8192),
            characters: characterIds,
            location_id: id(item.location_id, 'DESIGN_SCENE_LOCATION_ID_INVALID'),
            duration,
            first_frame: text(item.first_frame, 'DESIGN_SCENE_TEXT_INVALID', 8192, { allowEmpty: true }),
            action: text(item.action, 'DESIGN_SCENE_TEXT_INVALID', 8192),
            camera: text(item.camera, 'DESIGN_SCENE_TEXT_INVALID', 8192, { allowEmpty: true }),
            lighting: text(item.lighting, 'DESIGN_SCENE_TEXT_INVALID', 8192, { allowEmpty: true }),
            audio_sfx_dialogue: text(item.audio_sfx_dialogue, 'DESIGN_SCENE_TEXT_INVALID', 8192, { allowEmpty: true }),
        };
    });

    for (const [records, code] of [
        [characters, 'DESIGN_CHARACTER_ID_DUPLICATE'],
        [locations, 'DESIGN_LOCATION_ID_DUPLICATE'],
        [scenes, 'DESIGN_SCENE_ID_DUPLICATE'],
    ]) {
        if (new Set(records.map((record) => record.id)).size !== records.length) {
            throw failure(code, 'Design ids must be unique');
        }
    }
    if (!allowEmpty && (!characters.length || !locations.length || !scenes.length)) {
        throw failure('DESIGN_BOARD_INCOMPLETE', 'Saved design requires characters, locations, and scenes');
    }
    const characterIds = new Set(characters.map((record) => record.id));
    const locationIds = new Set(locations.map((record) => record.id));
    for (const scene of scenes) {
        if (!locationIds.has(scene.location_id)) throw failure('DESIGN_SCENE_LOCATION_UNKNOWN');
        if (scene.characters.some((characterId) => !characterIds.has(characterId))) {
            throw failure('DESIGN_SCENE_CHARACTER_UNKNOWN');
        }
    }
    const board = { characters, locations, scenes };
    if (Buffer.byteLength(JSON.stringify(board), 'utf8') > MAX_BOARD_BYTES) {
        throw failure('DESIGN_BOARD_TOO_LARGE');
    }
    return board;
}

function emptyBoard() {
    return { characters: [], locations: [], scenes: [] };
}

function exactPaths(userDataPath) {
    const draft = newProjectDraftProvider.exactDraftPaths(userDataPath);
    const designRoot = path.join(draft.draftRoot, DESIGN_DIRECTORY);
    const collaborationRoot = path.join(designRoot, COLLABORATION_DIRECTORY);
    return {
        ...draft,
        designRoot,
        boardPath: path.join(designRoot, BOARD_FILE),
        collaborationRoot,
        queueRoot: path.join(collaborationRoot, QUEUE_DIRECTORY),
        snapshotsRoot: path.join(collaborationRoot, SNAPSHOT_DIRECTORY),
        suggestionsRoot: path.join(collaborationRoot, SUGGESTION_DIRECTORY),
        receiptsRoot: path.join(collaborationRoot, RECEIPT_DIRECTORY),
    };
}

function assertDirectory(directoryPath, code, privateMode = true) {
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw failure(code); }
    if (stats.isSymbolicLink() || !stats.isDirectory() || (privateMode && (stats.mode & 0o077) !== 0)
        || fs.realpathSync.native(directoryPath) !== directoryPath) throw failure(code);
    return stats;
}

function ensureDirectories(paths, children = []) {
    const draftStats = assertDirectory(paths.draftRoot, 'DESIGN_DRAFT_ROOT_UNSAFE');
    let parent = paths.draftRoot;
    for (const component of [DESIGN_DIRECTORY, ...(children.length ? [COLLABORATION_DIRECTORY, ...children] : [])]) {
        const current = path.join(parent, component);
        try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        const stats = assertDirectory(current, 'DESIGN_DIRECTORY_UNSAFE');
        if (stats.dev !== draftStats.dev || !fs.realpathSync.native(current).startsWith(paths.draftRoot + path.sep)) {
            throw failure('DESIGN_DIRECTORY_UNSAFE');
        }
        parent = current;
        if (component === DESIGN_DIRECTORY && children.length) parent = paths.designRoot;
        if (component === COLLABORATION_DIRECTORY) parent = paths.collaborationRoot;
    }
}

function stableIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function readPrivateFile(filePath, maximum, missingCode = 'DESIGN_FILE_MISSING') {
    let before;
    try { before = fs.lstatSync(filePath); } catch (error) { if (error.code === 'ENOENT') throw failure(missingCode); throw error; }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > maximum || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure('DESIGN_FILE_UNSAFE');
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!stableIdentity(before, opened)) throw failure('DESIGN_FILE_CHANGED');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(filePath);
        if (buffer.byteLength !== before.size || !stableIdentity(opened, after) || !stableIdentity(opened, pathAfter)) {
            throw failure('DESIGN_FILE_CHANGED');
        }
        return buffer;
    } finally { fs.closeSync(descriptor); }
}

function fsyncDirectory(directoryPath) {
    const descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function privateWrite(filePath, buffer, options = {}, { exclusive = false } = {}) {
    const parent = path.dirname(filePath);
    const before = assertDirectory(parent, 'DESIGN_DIRECTORY_UNSAFE');
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('DESIGN_NOFOLLOW_UNAVAILABLE');
    const randomBytes = options.randomBytes || crypto.randomBytes;
    const temporary = path.join(parent, `.design-${process.pid}-${randomBytes(12).toString('hex')}`);
    let descriptor;
    let published = false;
    try {
        descriptor = fs.openSync(
            temporary,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
            0o600,
        );
        fs.fchmodSync(descriptor, 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        const after = assertDirectory(parent, 'DESIGN_DIRECTORY_UNSAFE');
        if (before.dev !== after.dev || before.ino !== after.ino) throw failure('DESIGN_DIRECTORY_CHANGED');
        if (exclusive) {
            (options.linkFile || fs.linkSync)(temporary, filePath);
            published = true;
            const tempStats = fs.lstatSync(temporary);
            const finalStats = fs.lstatSync(filePath);
            if (!stableIdentity(tempStats, finalStats) || (finalStats.mode & 0o777) !== 0o600) {
                throw failure('DESIGN_PUBLISH_UNSAFE');
            }
        } else {
            try {
                const target = fs.lstatSync(filePath);
                if (!target.isFile() || target.isSymbolicLink()) throw failure('DESIGN_FILE_UNSAFE');
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
            (options.renameFile || fs.renameSync)(temporary, filePath);
            published = true;
        }
        fsyncDirectory(parent);
    } finally {
        if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!published) { /* another exclusive publisher may own the target */ }
    }
}

function loadPlanning(context) {
    const state = newProjectDraftProvider.getNewProjectDraftState(context);
    if (!state.ok || !SHA256.test(state.revision_sha256 || '') || !state.draft?.production_id) {
        throw failure('DESIGN_PLANNING_DRAFT_REQUIRED');
    }
    return {
        draft: state.draft,
        revisionSha256: state.revision_sha256,
        briefSha256: sha256(Buffer.from(`${state.draft.brief}\n`, 'utf8')),
        scriptSha256: sha256(Buffer.from(`${state.draft.script}\n`, 'utf8')),
    };
}

function boardHash(board) {
    return sha256(JSON.stringify(board));
}

function revisionFor(planningRevision, board) {
    return sha256(JSON.stringify({ planning_revision_sha256: planningRevision, board }));
}

function loadBoard(paths) {
    assertDirectory(paths.designRoot, 'DESIGN_DIRECTORY_UNSAFE');
    try {
        const value = JSON.parse(readPrivateFile(paths.boardPath, MAX_BOARD_BYTES + 1).toString('utf8'));
        return { board: validateBoard(value), exists: true };
    } catch (error) {
        if (error.code === 'DESIGN_FILE_MISSING') return { board: emptyBoard(), exists: false };
        if (error instanceof SyntaxError) throw failure('DESIGN_BOARD_INVALID');
        throw error;
    }
}

function saveBoard(paths, board, options = {}) {
    ensureDirectories(paths);
    const buffer = Buffer.from(`${JSON.stringify(board, null, 2)}\n`, 'utf8');
    privateWrite(paths.boardPath, buffer, options);
}

function emptyCollaboration() {
    return {
        status: 'empty', total_request_count: 0, ready_suggestion_count: 0,
        stale_suggestion_count: 0, applied_suggestion_count: 0,
        recent_requests: [], truncated: false, blockers: [],
    };
}

function requestId(input) {
    return `request_${sha256(JSON.stringify({ schema_version: REQUEST_SCHEMA, ...input }))}`;
}

function snapshotPaths(paths, revision) {
    const root = path.join(paths.snapshotsRoot, `revision_${revision}`);
    return {
        root,
        manifest: path.join(root, 'manifest.json'),
        brief: path.join(root, 'brief.md'),
        script: path.join(root, 'script.txt'),
        design: path.join(root, 'design.json'),
    };
}

function readSnapshot(paths, revision) {
    if (!SHA256.test(revision)) throw failure('DESIGN_AGENT_SNAPSHOT_INVALID');
    const target = snapshotPaths(paths, revision);
    const stats = assertDirectory(target.root, 'DESIGN_AGENT_SNAPSHOT_UNSAFE');
    const parent = assertDirectory(paths.snapshotsRoot, 'DESIGN_AGENT_SNAPSHOT_UNSAFE');
    if (stats.dev !== parent.dev || fs.realpathSync.native(target.root) !== target.root
        || fs.readdirSync(target.root).sort().join(',') !== 'brief.md,design.json,manifest.json,script.txt') {
        throw failure('DESIGN_AGENT_SNAPSHOT_UNSAFE');
    }
    let manifest;
    let board;
    try {
        manifest = JSON.parse(readPrivateFile(target.manifest, MAX_SNAPSHOT_MANIFEST_BYTES).toString('utf8'));
        board = JSON.parse(readPrivateFile(target.design, MAX_BOARD_BYTES + 1).toString('utf8'));
    } catch (error) { if (error instanceof SyntaxError) throw failure('DESIGN_AGENT_SNAPSHOT_INVALID'); throw error; }
    const brief = readPrivateFile(target.brief, newProjectDraftProvider.MAX_BRIEF_BYTES + 1).toString('utf8').replace(/\n$/, '');
    const script = readPrivateFile(target.script, newProjectDraftProvider.MAX_SCRIPT_BYTES + 1).toString('utf8').replace(/\n$/, '');
    const normalizedBoard = validateBoard(board, { allowEmpty: true });
    exactKeys(manifest, [
        'schema_version', 'production_id', 'planning_revision_sha256', 'design_revision_sha256',
        'board_sha256', 'brief_sha256', 'script_sha256', 'created_at',
    ], 'DESIGN_AGENT_SNAPSHOT_INVALID');
    if (manifest.schema_version !== SNAPSHOT_SCHEMA || manifest.design_revision_sha256 !== revision
        || manifest.board_sha256 !== boardHash(normalizedBoard)
        || manifest.brief_sha256 !== sha256(Buffer.from(`${brief}\n`, 'utf8'))
        || manifest.script_sha256 !== sha256(Buffer.from(`${script}\n`, 'utf8'))
        || revisionFor(manifest.planning_revision_sha256, normalizedBoard) !== revision
        || !Number.isFinite(Date.parse(manifest.created_at))) throw failure('DESIGN_AGENT_SNAPSHOT_INVALID');
    return { manifest, board: normalizedBoard, brief, script };
}

function publishSnapshot(paths, planning, board, options = {}) {
    ensureDirectories(paths, [SNAPSHOT_DIRECTORY]);
    const revision = revisionFor(planning.revisionSha256, board);
    try { return readSnapshot(paths, revision); } catch (error) { if (error.code !== 'DESIGN_AGENT_SNAPSHOT_UNSAFE') throw error; }
    const staging = path.join(paths.snapshotsRoot, `.snapshot-${process.pid}-${(options.randomBytes || crypto.randomBytes)(12).toString('hex')}`);
    fs.mkdirSync(staging, { mode: 0o700 });
    let moved = false;
    try {
        const manifest = {
            schema_version: SNAPSHOT_SCHEMA,
            production_id: planning.draft.production_id,
            planning_revision_sha256: planning.revisionSha256,
            design_revision_sha256: revision,
            board_sha256: boardHash(board),
            brief_sha256: planning.briefSha256,
            script_sha256: planning.scriptSha256,
            created_at: new Date().toISOString(),
        };
        const write = (name, value) => privateWrite(path.join(staging, name), Buffer.from(value), options, { exclusive: true });
        write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
        write('brief.md', `${planning.draft.brief}\n`);
        write('script.txt', `${planning.draft.script}\n`);
        write('design.json', `${JSON.stringify(board, null, 2)}\n`);
        const target = snapshotPaths(paths, revision).root;
        try {
            (options.renameDirectory || fs.renameSync)(staging, target);
            moved = true;
            fsyncDirectory(paths.snapshotsRoot);
        } catch (error) {
            if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        }
    } finally { if (!moved) fs.rmSync(staging, { recursive: true, force: true }); }
    return readSnapshot(paths, revision);
}

function requestPath(paths, idValue) {
    if (!/^request_[a-f0-9]{64}$/.test(idValue || '')) throw failure('DESIGN_AGENT_REQUEST_ID_INVALID');
    return path.join(paths.queueRoot, `${idValue}.json`);
}

function validateRequest(record) {
    exactKeys(record, [
        'schema_version', 'request_id', 'stage', 'instruction', 'production_id',
        'planning_revision_sha256', 'design_revision_sha256', 'board_sha256',
        'snapshot_revision_sha256', 'status', 'requested_at', 'executed', 'model_called',
    ], 'DESIGN_AGENT_REQUEST_INVALID');
    const instruction = text(record.instruction, 'DESIGN_AGENT_REQUEST_INVALID', MAX_INSTRUCTION_BYTES);
    const identity = {
        production_id: record.production_id,
        planning_revision_sha256: record.planning_revision_sha256,
        design_revision_sha256: record.design_revision_sha256,
        board_sha256: record.board_sha256,
        snapshot_revision_sha256: record.snapshot_revision_sha256,
        stage: 'design', instruction,
    };
    if (record.schema_version !== REQUEST_SCHEMA || record.request_id !== requestId(identity)
        || record.stage !== 'design' || record.instruction !== instruction || !SAFE_ID.test(record.production_id)
        || ![record.planning_revision_sha256, record.design_revision_sha256, record.board_sha256].every((value) => SHA256.test(value))
        || record.snapshot_revision_sha256 !== record.design_revision_sha256
        || record.status !== 'queued_local_handoff' || !Number.isFinite(Date.parse(record.requested_at))
        || record.executed !== false || record.model_called !== false) throw failure('DESIGN_AGENT_REQUEST_INVALID');
    return record;
}

function readRequest(paths, idValue) {
    let record;
    try { record = JSON.parse(readPrivateFile(requestPath(paths, idValue), MAX_REQUEST_BYTES).toString('utf8')); }
    catch (error) { if (error instanceof SyntaxError) throw failure('DESIGN_AGENT_REQUEST_INVALID'); throw error; }
    validateRequest(record);
    if (`${record.request_id}.json` !== path.basename(requestPath(paths, idValue))) throw failure('DESIGN_AGENT_REQUEST_INVALID');
    const snapshot = readSnapshot(paths, record.snapshot_revision_sha256);
    if (snapshot.manifest.production_id !== record.production_id
        || snapshot.manifest.planning_revision_sha256 !== record.planning_revision_sha256
        || snapshot.manifest.board_sha256 !== record.board_sha256) throw failure('DESIGN_AGENT_SNAPSHOT_INVALID');
    return record;
}

function suggestionToken(request, proposedHash, summary, appModelCalled = false) {
    return `suggestion_${sha256(JSON.stringify({
        schema_version: SUGGESTION_SCHEMA, request_id: request.request_id, stage: 'design',
        base_revision_sha256: request.design_revision_sha256,
        target_source_sha256: request.board_sha256,
        proposed_board_sha256: proposedHash, summary,
        produced_by_agent: true, app_model_called: appModelCalled,
    }))}`;
}

function suggestionPath(paths, request) {
    return path.join(paths.suggestionsRoot, `${request.request_id}.json`);
}

function validateSuggestion(record, request) {
    exactKeys(record, [
        'schema_version', 'suggestion_token', 'request_id', 'stage', 'base_revision_sha256',
        'target_source_sha256', 'proposed_board_sha256', 'proposed_board', 'summary',
        'published_at', 'produced_by_agent', 'app_model_called', 'status',
    ], 'DESIGN_AGENT_SUGGESTION_INVALID');
    const board = validateBoard(record.proposed_board);
    const summary = text(record.summary, 'DESIGN_AGENT_SUGGESTION_INVALID', MAX_SUMMARY_BYTES);
    const proposedHash = boardHash(board);
    if (record.schema_version !== SUGGESTION_SCHEMA
        || record.suggestion_token !== suggestionToken(request, proposedHash, summary, record.app_model_called)
        || record.request_id !== request.request_id || record.stage !== 'design'
        || record.base_revision_sha256 !== request.design_revision_sha256
        || record.target_source_sha256 !== request.board_sha256
        || record.proposed_board_sha256 !== proposedHash || record.summary !== summary
        || JSON.stringify(record.proposed_board) !== JSON.stringify(board)
        || !Number.isFinite(Date.parse(record.published_at))
        || record.produced_by_agent !== true || typeof record.app_model_called !== 'boolean'
        || record.status !== 'ready_for_review') throw failure('DESIGN_AGENT_SUGGESTION_INVALID');
    if (proposedHash === request.board_sha256) throw failure('DESIGN_AGENT_SUGGESTION_NOOP');
    return { ...record, proposed_board: board };
}

function readSuggestion(paths, request) {
    let buffer;
    try { buffer = readPrivateFile(suggestionPath(paths, request), MAX_SUGGESTION_BYTES); }
    catch (error) { if (error.code === 'DESIGN_FILE_MISSING') return null; throw error; }
    try { return validateSuggestion(JSON.parse(buffer.toString('utf8')), request); }
    catch (error) { if (error instanceof SyntaxError) throw failure('DESIGN_AGENT_SUGGESTION_INVALID'); throw error; }
}

function receiptPath(paths, action, token) {
    return path.join(paths.receiptsRoot, `${action}_${token}.json`);
}

function receiptId(action, token) {
    return `decision_${sha256(JSON.stringify({ schema_version: RECEIPT_SCHEMA, action, suggestion_token: token }))}`;
}

function validateReceipt(record, action, suggestion, request) {
    exactKeys(record, [
        'schema_version', 'receipt_id', 'suggestion_token', 'request_id', 'stage', 'action',
        'source_revision_sha256', 'source_target_sha256', 'proposed_board_sha256',
        'result_revision_sha256', 'decided_at', 'board_written', 'one_shot',
    ], 'DESIGN_AGENT_RECEIPT_INVALID');
    if (record.schema_version !== RECEIPT_SCHEMA || record.receipt_id !== receiptId(action, suggestion.suggestion_token)
        || record.suggestion_token !== suggestion.suggestion_token || record.request_id !== request.request_id
        || record.stage !== 'design' || record.action !== action
        || record.source_revision_sha256 !== request.design_revision_sha256
        || record.source_target_sha256 !== suggestion.target_source_sha256
        || record.proposed_board_sha256 !== suggestion.proposed_board_sha256
        || !SHA256.test(record.result_revision_sha256) || !Number.isFinite(Date.parse(record.decided_at))
        || record.board_written !== (action === 'apply') || record.one_shot !== true) throw failure('DESIGN_AGENT_RECEIPT_INVALID');
    return record;
}

function readReceipt(paths, action, suggestion, request) {
    let buffer;
    try { buffer = readPrivateFile(receiptPath(paths, action, suggestion.suggestion_token), MAX_RECEIPT_BYTES); }
    catch (error) { if (error.code === 'DESIGN_FILE_MISSING') return null; throw error; }
    try { return validateReceipt(JSON.parse(buffer.toString('utf8')), action, suggestion, request); }
    catch (error) { if (error instanceof SyntaxError) throw failure('DESIGN_AGENT_RECEIPT_INVALID'); throw error; }
}

function validateArtifactDirectory(root, pattern, maximum) {
    let entries;
    try {
        assertDirectory(root, 'DESIGN_AGENT_DIRECTORY_UNSAFE');
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (error) { if (error.code === 'DESIGN_AGENT_DIRECTORY_UNSAFE' && !fs.existsSync(root)) return []; throw error; }
    if (entries.length > maximum || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !pattern.test(entry.name))) {
        throw failure('DESIGN_AGENT_DIRECTORY_UNSAFE');
    }
    return entries;
}

function readCollaboration(paths, planning, board) {
    if (!fs.existsSync(paths.collaborationRoot)) return emptyCollaboration();
    try {
        assertDirectory(paths.collaborationRoot, 'DESIGN_AGENT_DIRECTORY_UNSAFE');
        if (!fs.existsSync(paths.queueRoot)) return emptyCollaboration();
        const entries = validateArtifactDirectory(paths.queueRoot, /^request_[a-f0-9]{64}\.json$/, MAX_REQUESTS);
        validateArtifactDirectory(paths.suggestionsRoot, /^request_[a-f0-9]{64}\.json$/, MAX_REQUESTS);
        validateArtifactDirectory(paths.receiptsRoot, /^(?:apply|hold)_suggestion_[a-f0-9]{64}\.json$/, MAX_REQUESTS * 2);
        const records = entries.map((entry) => readRequest(paths, entry.name.slice(0, -5)))
            .sort((left, right) => Date.parse(right.requested_at) - Date.parse(left.requested_at));
        const currentBoardHash = boardHash(board);
        const currentRevision = revisionFor(planning.revisionSha256, board);
        let ready = 0;
        let stale = 0;
        let applied = 0;
        const projected = records.map((request) => {
            const suggestion = readSuggestion(paths, request);
            if (!suggestion) return request;
            const applyReceipt = readReceipt(paths, 'apply', suggestion, request);
            const holdReceipt = readReceipt(paths, 'hold', suggestion, request);
            let reviewStatus;
            let applyAllowed = false;
            if (applyReceipt) {
                applied += 1;
                reviewStatus = currentRevision === applyReceipt.result_revision_sha256
                    && currentBoardHash === suggestion.proposed_board_sha256
                    ? 'applied'
                    : 'applied_then_edited';
            } else if (currentRevision === request.design_revision_sha256
                && currentBoardHash === suggestion.target_source_sha256) {
                ready += 1;
                applyAllowed = true;
                reviewStatus = holdReceipt ? 'held' : 'ready';
            } else {
                stale += 1;
                reviewStatus = 'stale';
            }
            return {
                ...request,
                suggestion: {
                    suggestion_token: suggestion.suggestion_token,
                    review_status: reviewStatus,
                    summary: suggestion.summary,
                    proposed_board: suggestion.proposed_board,
                    published_at: suggestion.published_at,
                    apply_allowed: applyAllowed,
                    reapply_allowed: false,
                    applied_at: applyReceipt?.decided_at || '',
                    held_at: holdReceipt?.decided_at || '',
                },
            };
        });
        const status = applied && !ready && !stale ? 'applied' : ready ? 'suggestion_ready' : stale ? 'stale' : records.length ? 'queued' : 'empty';
        return {
            status, total_request_count: records.length, ready_suggestion_count: ready,
            stale_suggestion_count: stale, applied_suggestion_count: applied,
            recent_requests: projected.slice(0, MAX_RECENT_REQUESTS),
            truncated: records.length > MAX_RECENT_REQUESTS, blockers: [],
        };
    } catch (error) {
        return { ...emptyCollaboration(), status: 'blocked', blockers: [error.code || 'DESIGN_AGENT_READ_FAILED'] };
    }
}

function getNewProjectDesignState(context = {}) {
    let planning;
    let paths;
    try {
        planning = loadPlanning(context);
        paths = exactPaths(context.userDataPath);
        const loaded = fs.existsSync(paths.designRoot) ? loadBoard(paths) : { board: emptyBoard(), exists: false };
        const revision = revisionFor(planning.revisionSha256, loaded.board);
        const collaboration = readCollaboration(paths, planning, loaded.board);
        const blockers = [...collaboration.blockers];
        if (!loaded.exists) blockers.push('NEW_PROJECT_DESIGN_BOARD_EMPTY');
        return {
            ok: collaboration.status !== 'blocked',
            status: collaboration.status === 'blocked' ? 'blocked' : loaded.exists ? 'restored' : 'empty',
            board: loaded.board,
            revision_sha256: revision,
            planning_revision_sha256: planning.revisionSha256,
            collaboration,
            blockers,
        };
    } catch (error) {
        return {
            ok: false, status: 'blocked', board: emptyBoard(), revision_sha256: '',
            planning_revision_sha256: '', collaboration: emptyCollaboration(),
            blockers: [error.code || 'NEW_PROJECT_DESIGN_READ_FAILED'],
        };
    }
}

function saveNewProjectDesignBoard(payload, context = {}) {
    exactKeys(payload, ['board', 'expected_planning_revision_sha256', 'expected_design_revision_sha256'], 'DESIGN_SAVE_SHAPE_INVALID');
    const planning = loadPlanning(context);
    const paths = exactPaths(context.userDataPath);
    const current = fs.existsSync(paths.designRoot) ? loadBoard(paths).board : emptyBoard();
    const currentRevision = revisionFor(planning.revisionSha256, current);
    if (payload.expected_planning_revision_sha256 !== planning.revisionSha256) throw failure('DESIGN_PLANNING_REVISION_STALE');
    if (payload.expected_design_revision_sha256 !== currentRevision) throw failure('DESIGN_REVISION_STALE');
    const board = validateBoard(payload.board);
    saveBoard(paths, board, context);
    return { ...getNewProjectDesignState(context), status: 'saved' };
}

function enqueueDesignAgentRequest(payload, context = {}) {
    exactKeys(payload, ['instruction', 'expected_planning_revision_sha256', 'expected_design_revision_sha256'], 'DESIGN_AGENT_REQUEST_SHAPE_INVALID');
    const instruction = text(payload.instruction, 'DESIGN_AGENT_INSTRUCTION_INVALID', MAX_INSTRUCTION_BYTES);
    const planning = loadPlanning(context);
    const paths = exactPaths(context.userDataPath);
    const board = fs.existsSync(paths.designRoot) ? loadBoard(paths).board : emptyBoard();
    const revision = revisionFor(planning.revisionSha256, board);
    if (payload.expected_planning_revision_sha256 !== planning.revisionSha256) throw failure('DESIGN_PLANNING_REVISION_STALE');
    if (payload.expected_design_revision_sha256 !== revision) throw failure('DESIGN_REVISION_STALE');
    publishSnapshot(paths, planning, board, context);
    ensureDirectories(paths, [QUEUE_DIRECTORY]);
    const queueEntries = validateArtifactDirectory(
        paths.queueRoot,
        /^request_[a-f0-9]{64}\.json$/,
        MAX_REQUESTS,
    );
    queueEntries.forEach((entry) => readRequest(paths, entry.name.slice(0, -5)));
    const identity = {
        production_id: planning.draft.production_id,
        planning_revision_sha256: planning.revisionSha256,
        design_revision_sha256: revision,
        board_sha256: boardHash(board),
        snapshot_revision_sha256: revision,
        stage: 'design', instruction,
    };
    const idValue = requestId(identity);
    const filePath = requestPath(paths, idValue);
    let alreadyQueued = false;
    try {
        const existing = readRequest(paths, idValue);
        if (existing.request_id !== idValue) throw failure('DESIGN_AGENT_REQUEST_CONFLICT');
        alreadyQueued = true;
    } catch (error) {
        if (error.code !== 'DESIGN_FILE_MISSING') throw error;
    }
    if (!alreadyQueued) {
        if (queueEntries.length >= MAX_REQUESTS) throw failure('DESIGN_AGENT_QUEUE_LIMIT_REACHED');
        const record = {
            schema_version: REQUEST_SCHEMA, request_id: idValue, stage: 'design', instruction,
            production_id: planning.draft.production_id,
            planning_revision_sha256: planning.revisionSha256,
            design_revision_sha256: revision,
            board_sha256: identity.board_sha256,
            snapshot_revision_sha256: revision,
            status: 'queued_local_handoff', requested_at: new Date().toISOString(),
            executed: false, model_called: false,
        };
        validateRequest(record);
        const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
        try { privateWrite(filePath, buffer, context, { exclusive: true }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; alreadyQueued = true; }
    }
    return {
        ok: true, queued: true, already_queued: alreadyQueued, request_id: idValue,
        status: 'queued_local_handoff', executed: false, model_called: false,
        state: getNewProjectDesignState(context),
    };
}

function prepareDesignAgentHandoff(payload, context = {}) {
    exactKeys(payload, ['request_id'], 'DESIGN_AGENT_PREPARE_SHAPE_INVALID');
    const paths = exactPaths(context.userDataPath);
    const request = readRequest(paths, payload.request_id);
    const snapshot = readSnapshot(paths, request.snapshot_revision_sha256);
    return { ok: true, request, snapshot };
}

function publishDesignAgentSuggestion(payload, context = {}) {
    exactKeys(payload, ['request_id', 'proposed_board', 'summary'], 'DESIGN_AGENT_SUGGESTION_SHAPE_INVALID');
    const handoff = prepareDesignAgentHandoff({ request_id: payload.request_id }, context);
    const board = validateBoard(payload.proposed_board);
    const summary = text(payload.summary, 'DESIGN_AGENT_SUMMARY_INVALID', MAX_SUMMARY_BYTES);
    const proposedHash = boardHash(board);
    if (proposedHash === handoff.request.board_sha256) throw failure('DESIGN_AGENT_SUGGESTION_NOOP');
    const appModelCalled = context.appModelCalled === true;
    const token = suggestionToken(handoff.request, proposedHash, summary, appModelCalled);
    const paths = exactPaths(context.userDataPath);
    ensureDirectories(paths, [SUGGESTION_DIRECTORY]);
    const existing = readSuggestion(paths, handoff.request);
    if (existing) {
        if (existing.suggestion_token !== token) throw failure('DESIGN_AGENT_SUGGESTION_CONFLICT');
        return {
            ok: true, published: true, already_published: true, request_id: handoff.request.request_id,
            suggestion_token: token, proposed_board_sha256: proposedHash,
            proposed_board_bytes: Buffer.byteLength(JSON.stringify(board)), status: 'ready_for_review', app_model_called: existing.app_model_called,
        };
    }
    const record = {
        schema_version: SUGGESTION_SCHEMA, suggestion_token: token,
        request_id: handoff.request.request_id, stage: 'design',
        base_revision_sha256: handoff.request.design_revision_sha256,
        target_source_sha256: handoff.request.board_sha256,
        proposed_board_sha256: proposedHash, proposed_board: board, summary,
        published_at: new Date().toISOString(), produced_by_agent: true,
        app_model_called: appModelCalled, status: 'ready_for_review',
    };
    validateSuggestion(record, handoff.request);
    const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    if (buffer.byteLength > MAX_SUGGESTION_BYTES) throw failure('DESIGN_AGENT_SUGGESTION_TOO_LARGE');
    try { privateWrite(suggestionPath(paths, handoff.request), buffer, context, { exclusive: true }); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const raced = readSuggestion(paths, handoff.request);
        if (raced?.suggestion_token !== token) throw failure('DESIGN_AGENT_SUGGESTION_CONFLICT');
        return {
            ok: true, published: true, already_published: true, request_id: handoff.request.request_id,
            suggestion_token: token, proposed_board_sha256: proposedHash,
            proposed_board_bytes: Buffer.byteLength(JSON.stringify(board)), status: 'ready_for_review', app_model_called: raced.app_model_called,
        };
    }
    return {
        ok: true, published: true, already_published: false, request_id: handoff.request.request_id,
        suggestion_token: token, proposed_board_sha256: proposedHash,
        proposed_board_bytes: Buffer.byteLength(JSON.stringify(board)), status: 'ready_for_review', app_model_called: appModelCalled,
    };
}

function findSuggestion(paths, token) {
    if (!/^suggestion_[a-f0-9]{64}$/.test(token || '')) throw failure('DESIGN_AGENT_SUGGESTION_TOKEN_INVALID');
    const entries = validateArtifactDirectory(paths.queueRoot, /^request_[a-f0-9]{64}\.json$/, MAX_REQUESTS);
    for (const entry of entries) {
        const request = readRequest(paths, entry.name.slice(0, -5));
        const suggestion = readSuggestion(paths, request);
        if (suggestion?.suggestion_token === token) return { request, suggestion };
    }
    throw failure('DESIGN_AGENT_SUGGESTION_NOT_FOUND');
}

function publishReceipt(paths, action, suggestion, request, resultRevision, context = {}) {
    ensureDirectories(paths, [RECEIPT_DIRECTORY]);
    const record = {
        schema_version: RECEIPT_SCHEMA, receipt_id: receiptId(action, suggestion.suggestion_token),
        suggestion_token: suggestion.suggestion_token, request_id: request.request_id,
        stage: 'design', action, source_revision_sha256: request.design_revision_sha256,
        source_target_sha256: suggestion.target_source_sha256,
        proposed_board_sha256: suggestion.proposed_board_sha256,
        result_revision_sha256: resultRevision, decided_at: new Date().toISOString(),
        board_written: action === 'apply', one_shot: true,
    };
    validateReceipt(record, action, suggestion, request);
    try {
        privateWrite(receiptPath(paths, action, suggestion.suggestion_token), Buffer.from(`${JSON.stringify(record, null, 2)}\n`), context, { exclusive: true });
        return { receipt: record, alreadyPublished: false };
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = readReceipt(paths, action, suggestion, request);
        if (!existing) throw failure('DESIGN_AGENT_DECISION_CONFLICT');
        return { receipt: existing, alreadyPublished: true };
    }
}

function decideDesignAgentSuggestion(payload, context = {}) {
    exactKeys(payload, ['suggestion_token', 'action', 'expected_design_revision_sha256'], 'DESIGN_AGENT_DECISION_SHAPE_INVALID');
    if (!['apply', 'hold'].includes(payload.action)) throw failure('DESIGN_AGENT_DECISION_ACTION_INVALID');
    if (!SHA256.test(payload.expected_design_revision_sha256 || '')) throw failure('DESIGN_AGENT_DECISION_REVISION_INVALID');
    const planning = loadPlanning(context);
    const paths = exactPaths(context.userDataPath);
    const currentBoard = fs.existsSync(paths.designRoot) ? loadBoard(paths).board : emptyBoard();
    const currentRevision = revisionFor(planning.revisionSha256, currentBoard);
    const currentHash = boardHash(currentBoard);
    const { request, suggestion } = findSuggestion(paths, payload.suggestion_token);
    const existingApply = readReceipt(paths, 'apply', suggestion, request);
    if (existingApply) {
        return {
            ok: true, applied: false, held: false, already_decided: true, receipt_recovered: false,
            suggestion_token: suggestion.suggestion_token, request_id: request.request_id, stage: 'design',
            status: currentRevision === existingApply.result_revision_sha256
                && currentHash === suggestion.proposed_board_sha256
                ? 'already_applied'
                : 'applied_then_edited',
            reapply_allowed: false, result_revision_sha256: existingApply.result_revision_sha256,
            state: getNewProjectDesignState(context),
        };
    }
    if (payload.action === 'apply' && planning.revisionSha256 === request.planning_revision_sha256
        && currentHash === suggestion.proposed_board_sha256) {
        const recovered = publishReceipt(paths, 'apply', suggestion, request, currentRevision, context);
        return {
            ok: true, applied: false, held: false, already_decided: false,
            receipt_recovered: !recovered.alreadyPublished, suggestion_token: suggestion.suggestion_token,
            request_id: request.request_id, stage: 'design', status: 'applied', reapply_allowed: false,
            result_revision_sha256: currentRevision, state: getNewProjectDesignState(context),
        };
    }
    if (currentRevision !== payload.expected_design_revision_sha256) throw failure('DESIGN_AGENT_DECISION_STALE');
    if (payload.action === 'hold') {
        const existingHold = readReceipt(paths, 'hold', suggestion, request);
        if (!existingHold) publishReceipt(paths, 'hold', suggestion, request, currentRevision, context);
        return {
            ok: true, applied: false, held: true, already_decided: Boolean(existingHold), receipt_recovered: false,
            suggestion_token: suggestion.suggestion_token, request_id: request.request_id, stage: 'design',
            status: 'held', reapply_allowed: true, result_revision_sha256: currentRevision,
            state: getNewProjectDesignState(context),
        };
    }
    if (planning.revisionSha256 !== request.planning_revision_sha256
        || currentHash !== suggestion.target_source_sha256) throw failure('DESIGN_AGENT_SUGGESTION_STALE');
    saveBoard(paths, suggestion.proposed_board, context);
    const resultRevision = revisionFor(planning.revisionSha256, suggestion.proposed_board);
    publishReceipt(paths, 'apply', suggestion, request, resultRevision, context);
    return {
        ok: true, applied: true, held: false, already_decided: false, receipt_recovered: false,
        suggestion_token: suggestion.suggestion_token, request_id: request.request_id, stage: 'design',
        status: 'applied', reapply_allowed: false, result_revision_sha256: resultRevision,
        state: getNewProjectDesignState(context),
    };
}

module.exports = {
    REQUEST_SCHEMA,
    SNAPSHOT_SCHEMA,
    SUGGESTION_SCHEMA,
    RECEIPT_SCHEMA,
    emptyBoard,
    validateBoard,
    exactPaths,
    getNewProjectDesignState,
    saveNewProjectDesignBoard,
    enqueueDesignAgentRequest,
    prepareDesignAgentHandoff,
    publishDesignAgentSuggestion,
    decideDesignAgentSuggestion,
};
