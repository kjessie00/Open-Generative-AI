const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dstBundleImportProvider = require('./dstBundleImportProvider');
const newProjectDesignProvider = require('./newProjectDesignProvider');

const PLAN_SCHEMA = 'film_pipeline.new_project_image_plan.v1';
const PREPARATION_SCHEMA = 'film_pipeline.new_project_image_preparation.v1';
const RESULT_SCHEMA = 'film_pipeline.new_project_image_result.v1';
const ROOT_DIRECTORY = 'image_plan';
const PLAN_FILE = 'plan.json';
const QUEUE_DIRECTORY = 'queue';
const RESULTS_DIRECTORY = 'results';
const MAX_PLAN_BYTES = 1024 * 1024;
const MAX_QUEUE_BYTES = 1024 * 1024;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_QUEUE_ITEMS = 100;
const SHA256 = /^[a-f0-9]{64}$/;
const TASK_TOKEN = /^task_[a-f0-9]{64}$/;
const RESULT_TOKEN = /^result_[a-f0-9]{64}$/;
const PREPARATION_TOKEN = /^preparation_[a-f0-9]{64}$/;
const TASK_KINDS = new Set(['character_sheet', 'location_sheet', 'scene_image']);
const TASK_STATUSES = new Set(['준비', '결과연결', '재제작']);

function failure(code, message = code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) throw failure(code);
}

function boundedText(value, maximum, code, { allowEmpty = false } = {}) {
    if (typeof value !== 'string' || value.includes('\0')) throw failure(code);
    const normalized = value.trim();
    if ((!allowEmpty && !normalized) || Buffer.byteLength(normalized, 'utf8') > maximum) throw failure(code);
    return normalized;
}

function exactPaths(userDataPath) {
    const design = newProjectDesignProvider.exactPaths(userDataPath);
    const root = path.join(design.draftRoot, ROOT_DIRECTORY);
    return {
        draftRoot: design.draftRoot,
        root,
        planPath: path.join(root, PLAN_FILE),
        queueRoot: path.join(root, QUEUE_DIRECTORY),
        resultsRoot: path.join(root, RESULTS_DIRECTORY),
    };
}

function assertPrivateDirectory(directoryPath, code) {
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw failure(code); }
    if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700
        || fs.realpathSync.native(directoryPath) !== directoryPath) throw failure(code);
    return stats;
}

function ensureDirectory(directoryPath, parentPath) {
    const parent = assertPrivateDirectory(parentPath, 'IMAGE_PLAN_PARENT_UNSAFE');
    try { fs.mkdirSync(directoryPath, { mode: 0o700 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const current = assertPrivateDirectory(directoryPath, 'IMAGE_PLAN_DIRECTORY_UNSAFE');
    if (current.dev !== parent.dev || path.dirname(fs.realpathSync.native(directoryPath)) !== parentPath) {
        throw failure('IMAGE_PLAN_DIRECTORY_UNSAFE');
    }
}

function ensureRoot(paths) {
    assertPrivateDirectory(paths.draftRoot, 'IMAGE_PLAN_DRAFT_ROOT_UNSAFE');
    ensureDirectory(paths.root, paths.draftRoot);
}

function ensureChild(paths, child) {
    ensureRoot(paths);
    ensureDirectory(child, paths.root);
}

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function readPrivate(filePath, maximum, missingCode = 'IMAGE_PLAN_FILE_MISSING') {
    let before;
    try { before = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') throw failure(missingCode);
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > maximum || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure('IMAGE_PLAN_FILE_UNSAFE');
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw failure('IMAGE_PLAN_FILE_CHANGED');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(filePath);
        if (buffer.byteLength !== before.size || !sameFile(opened, after) || !sameFile(opened, final)) {
            throw failure('IMAGE_PLAN_FILE_CHANGED');
        }
        return buffer;
    } finally { fs.closeSync(descriptor); }
}

function fsyncDirectory(directoryPath) {
    const descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function privateWrite(filePath, buffer, { exclusive = false } = {}) {
    const parent = path.dirname(filePath);
    assertPrivateDirectory(parent, 'IMAGE_PLAN_DIRECTORY_UNSAFE');
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw failure('IMAGE_PLAN_WRITE_INVALID');
    if (exclusive) {
        const descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT
            | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        fsyncDirectory(parent);
        return;
    }
    const temp = path.join(parent, `.image-plan-${crypto.randomBytes(12).toString('hex')}.tmp`);
    const descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    try {
        let current;
        try { current = fs.lstatSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current && (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o777) !== 0o600)) {
            throw failure('IMAGE_PLAN_FILE_UNSAFE');
        }
        fs.renameSync(temp, filePath);
        fsyncDirectory(parent);
    } finally { try { fs.unlinkSync(temp); } catch { /* renamed or already removed */ } }
}

function taskToken(kind, sourceId) {
    return `task_${sha256(`${kind}\0${sourceId}`)}`;
}

function promptParts(parts) {
    return parts.map((part) => part.trim()).filter(Boolean).join(' / ');
}

function deriveTasks(board) {
    const tasks = [];
    const characterTokens = new Map();
    const locationTokens = new Map();
    for (const character of board.characters) {
        const token = taskToken('character_sheet', character.id);
        characterTokens.set(character.id, token);
        tasks.push({
            task_token: token,
            kind: 'character_sheet',
            source_id: character.id,
            sequence: tasks.length + 1,
            label: `인물 시트 · ${character.name}`,
            prompt: promptParts([
                `9:16 세로형 영화 제작용 인물 시트. ${character.name}`,
                character.role && `역할: ${character.role}`,
                character.appearance && `외형: ${character.appearance}`,
                character.wardrobe && `의상: ${character.wardrobe}`,
                character.continuity && `연속성 고정: ${character.continuity}`,
                '정면·측면·전신에서 동일 인물로 식별 가능, 텍스트·로고·워터마크 없음',
            ]),
            reference_task_ids: [], status: '준비', result_token: '',
        });
    }
    for (const location of board.locations) {
        const token = taskToken('location_sheet', location.id);
        locationTokens.set(location.id, token);
        tasks.push({
            task_token: token,
            kind: 'location_sheet',
            source_id: location.id,
            sequence: tasks.length + 1,
            label: `장소 시트 · ${location.name}`,
            prompt: promptParts([
                `9:16 세로형 영화 제작용 장소 시트. ${location.name}`,
                location.space && `공간: ${location.space}`,
                location.lighting && `조명: ${location.lighting}`,
                location.props && `소품: ${location.props}`,
                location.continuity && `연속성 고정: ${location.continuity}`,
                '여러 장면에서 구조와 소품 위치가 일관되도록 표현, 텍스트·로고·워터마크 없음',
            ]),
            reference_task_ids: [], status: '준비', result_token: '',
        });
    }
    const characterNames = new Map(board.characters.map((item) => [item.id, item.name]));
    const locationNames = new Map(board.locations.map((item) => [item.id, item.name]));
    for (const scene of board.scenes) {
        const selected = new Set(scene.characters);
        const references = board.characters.filter((item) => selected.has(item.id))
            .map((item) => characterTokens.get(item.id));
        references.push(locationTokens.get(scene.location_id));
        const names = board.characters.filter((item) => selected.has(item.id)).map((item) => characterNames.get(item.id));
        tasks.push({
            task_token: taskToken('scene_image', scene.id),
            kind: 'scene_image', source_id: scene.id, sequence: tasks.length + 1,
            label: `장면 이미지 · ${scene.title}`,
            prompt: promptParts([
                `9:16 세로형 시네마틱 스토리보드 장면. ${scene.title}`,
                `등장인물: ${names.length ? names.join(', ') : '없음'}`,
                `장소: ${locationNames.get(scene.location_id)}`,
                scene.first_frame && `첫 프레임: ${scene.first_frame}`,
                `행동: ${scene.action}`,
                scene.camera && `카메라: ${scene.camera}`,
                scene.lighting && `조명: ${scene.lighting}`,
                `극적 순간: ${scene.dramatic_beat}`,
                '참조 시트와 인물·의상·장소 연속성 유지, 텍스트·로고·워터마크 없음',
            ]),
            reference_task_ids: references, status: '준비', result_token: '',
        });
    }
    return tasks;
}

function validateTask(value, sequence) {
    exactKeys(value, [
        'task_token', 'kind', 'source_id', 'sequence', 'label', 'prompt',
        'reference_task_ids', 'status', 'result_token',
    ], 'IMAGE_PLAN_TASK_SHAPE_INVALID');
    if (!TASK_TOKEN.test(value.task_token) || !TASK_KINDS.has(value.kind)
        || value.sequence !== sequence || !TASK_STATUSES.has(value.status)) throw failure('IMAGE_PLAN_TASK_INVALID');
    const sourceId = boundedText(value.source_id, 128, 'IMAGE_PLAN_TASK_INVALID');
    const label = boundedText(value.label, 1024, 'IMAGE_PLAN_TASK_INVALID');
    const prompt = boundedText(value.prompt, MAX_PROMPT_BYTES, 'IMAGE_PLAN_PROMPT_INVALID');
    if (!Array.isArray(value.reference_task_ids)
        || value.reference_task_ids.some((token) => !TASK_TOKEN.test(token))) throw failure('IMAGE_PLAN_REFERENCE_INVALID');
    if (new Set(value.reference_task_ids).size !== value.reference_task_ids.length) throw failure('IMAGE_PLAN_REFERENCE_INVALID');
    if (value.result_token && !RESULT_TOKEN.test(value.result_token)) throw failure('IMAGE_PLAN_RESULT_TOKEN_INVALID');
    if (value.status === '준비' && value.result_token) throw failure('IMAGE_PLAN_TASK_STATUS_INVALID');
    if (value.status !== '준비' && !value.result_token) throw failure('IMAGE_PLAN_TASK_STATUS_INVALID');
    return { ...value, source_id: sourceId, label, prompt };
}

function validateTasks(value) {
    if (!Array.isArray(value) || !value.length || value.length > 44) throw failure('IMAGE_PLAN_TASKS_INVALID');
    const tasks = value.map((task, index) => validateTask(task, index + 1));
    if (new Set(tasks.map((task) => task.task_token)).size !== tasks.length) throw failure('IMAGE_PLAN_TASK_TOKEN_DUPLICATE');
    const preceding = new Set();
    for (const task of tasks) {
        if (task.reference_task_ids.some((token) => !preceding.has(token))) throw failure('IMAGE_PLAN_REFERENCE_ORDER_INVALID');
        preceding.add(task.task_token);
    }
    return tasks;
}

function validateIdentity(tasks, derived) {
    if (tasks.length !== derived.length) throw failure('IMAGE_PLAN_TASK_SET_MISMATCH');
    for (let index = 0; index < tasks.length; index += 1) {
        for (const key of ['task_token', 'kind', 'source_id', 'sequence', 'label']) {
            if (tasks[index][key] !== derived[index][key]) throw failure('IMAGE_PLAN_TASK_SET_MISMATCH');
        }
        if (JSON.stringify(tasks[index].reference_task_ids) !== JSON.stringify(derived[index].reference_task_ids)) {
            throw failure('IMAGE_PLAN_TASK_SET_MISMATCH');
        }
    }
}

function revisionFor(designRevision, tasks) {
    return sha256(JSON.stringify({ design_revision_sha256: designRevision, tasks }));
}

function loadDesign(context) {
    const state = newProjectDesignProvider.getNewProjectDesignState({ userDataPath: context.userDataPath });
    if (state.status !== 'restored' || !state.revision_sha256 || state.blockers.length) {
        throw failure('IMAGE_PLAN_SAVED_DESIGN_REQUIRED');
    }
    return state;
}

function validatePlanRecord(value) {
    exactKeys(value, ['schema_version', 'design_revision_sha256', 'tasks', 'saved_at'], 'IMAGE_PLAN_FILE_INVALID');
    if (value.schema_version !== PLAN_SCHEMA || !SHA256.test(value.design_revision_sha256)
        || !Number.isFinite(Date.parse(value.saved_at))) throw failure('IMAGE_PLAN_FILE_INVALID');
    return { ...value, tasks: validateTasks(value.tasks) };
}

function loadPlan(paths) {
    const buffer = readPrivate(paths.planPath, MAX_PLAN_BYTES);
    let parsed;
    try { parsed = JSON.parse(buffer.toString('utf8')); } catch { throw failure('IMAGE_PLAN_FILE_INVALID'); }
    return validatePlanRecord(parsed);
}

function validatePreparation(value) {
    exactKeys(value, [
        'schema_version', 'preparation_token', 'design_revision_sha256', 'image_plan_revision_sha256',
        'tasks', 'status', 'queued_at', 'executed', 'model_called', 'generation_executed',
    ], 'IMAGE_PLAN_QUEUE_INVALID');
    if (value.schema_version !== PREPARATION_SCHEMA || !PREPARATION_TOKEN.test(value.preparation_token || '')
        || !SHA256.test(value.design_revision_sha256 || '') || !SHA256.test(value.image_plan_revision_sha256 || '')
        || !Array.isArray(value.tasks) || !value.tasks.length || value.status !== 'queued_preview'
        || !Number.isFinite(Date.parse(value.queued_at)) || value.executed !== false
        || value.model_called !== false || value.generation_executed !== false) throw failure('IMAGE_PLAN_QUEUE_INVALID');
    return value;
}

function latestPreparation(paths, designRevision, planRevision) {
    if (!fs.existsSync(paths.queueRoot)) return { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false };
    assertPrivateDirectory(paths.queueRoot, 'IMAGE_PLAN_QUEUE_UNSAFE');
    const entries = fs.readdirSync(paths.queueRoot, { withFileTypes: true });
    if (entries.length > MAX_QUEUE_ITEMS || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()
        || !/^preparation_[a-f0-9]{64}\.json$/.test(entry.name))) throw failure('IMAGE_PLAN_QUEUE_UNSAFE');
    if (!entries.length) return { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false };
    const records = entries.map((entry) => {
        const buffer = readPrivate(path.join(paths.queueRoot, entry.name), MAX_QUEUE_BYTES);
        let value;
        try { value = JSON.parse(buffer.toString('utf8')); } catch { throw failure('IMAGE_PLAN_QUEUE_INVALID'); }
        return validatePreparation(value);
    }).filter((value) => value.design_revision_sha256 === designRevision
        && value.image_plan_revision_sha256 === planRevision);
    if (!records.length) return { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false };
    records.sort((left, right) => String(right.queued_at).localeCompare(String(left.queued_at)));
    const latest = records[0];
    return {
        status: 'queued', preparation_token: latest.preparation_token,
        task_count: latest.tasks.length, task_tokens: latest.tasks.map((task) => task.task_token),
        executed: false, model_called: false,
    };
}

function blockedState(code) {
    return {
        ok: false, status: 'blocked', design_revision_sha256: '', revision_sha256: '', tasks: [],
        preparation: { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false },
        blockers: [code], executed: false, generation_executed: false, model_called: false,
    };
}

function getNewProjectImagePlan(context = {}) {
    try {
        const design = loadDesign(context);
        const paths = exactPaths(context.userDataPath);
        const derived = deriveTasks(design.board);
        let tasks = derived;
        let status = 'derived';
        const blockers = [];
        if (fs.existsSync(paths.planPath)) {
            const plan = loadPlan(paths);
            tasks = plan.tasks;
            status = 'restored';
            if (plan.design_revision_sha256 !== design.revision_sha256) {
                status = 'design_changed';
                tasks = derived;
                blockers.push('IMAGE_PLAN_DESIGN_STALE');
            } else validateIdentity(tasks, derived);
        }
        const revision = revisionFor(design.revision_sha256, tasks);
        return {
            ok: blockers.length === 0, status, design_revision_sha256: design.revision_sha256,
            revision_sha256: revision,
            tasks, preparation: blockers.length ? {
                status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false,
            } : latestPreparation(paths, design.revision_sha256, revision), blockers,
            executed: false, generation_executed: false, model_called: false,
        };
    } catch (error) { return blockedState(error.code || 'IMAGE_PLAN_READ_FAILED'); }
}

function assertExpected(payload, state) {
    if (!SHA256.test(payload.expected_design_revision_sha256 || '')
        || !SHA256.test(payload.expected_image_plan_revision_sha256 || '')) throw failure('IMAGE_PLAN_REVISION_INVALID');
    if (state.status === 'blocked') throw failure(state.blockers[0] || 'IMAGE_PLAN_BLOCKED');
    if (payload.expected_design_revision_sha256 !== state.design_revision_sha256) throw failure('IMAGE_PLAN_DESIGN_STALE');
    if (payload.expected_image_plan_revision_sha256 !== state.revision_sha256) throw failure('IMAGE_PLAN_REVISION_STALE');
}

function writePlan(paths, designRevision, tasks) {
    ensureRoot(paths);
    const record = {
        schema_version: PLAN_SCHEMA, design_revision_sha256: designRevision,
        tasks, saved_at: new Date().toISOString(),
    };
    const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    if (buffer.byteLength > MAX_PLAN_BYTES) throw failure('IMAGE_PLAN_TOO_LARGE');
    privateWrite(paths.planPath, buffer);
}

function saveNewProjectImagePlan(payload, context = {}) {
    exactKeys(payload, ['tasks', 'expected_design_revision_sha256', 'expected_image_plan_revision_sha256'], 'IMAGE_PLAN_SAVE_SHAPE_INVALID');
    const state = getNewProjectImagePlan(context);
    assertExpected(payload, state);
    const tasks = validateTasks(payload.tasks);
    const design = loadDesign(context);
    validateIdentity(tasks, deriveTasks(design.board));
    const current = new Map(state.tasks.map((task) => [task.task_token, task]));
    for (const task of tasks) {
        const prior = current.get(task.task_token);
        if (task.status !== prior.status || task.result_token !== prior.result_token) throw failure('IMAGE_PLAN_RESULT_STATE_IMMUTABLE');
    }
    const paths = exactPaths(context.userDataPath);
    writePlan(paths, design.revision_sha256, tasks);
    return { ...getNewProjectImagePlan(context), status: 'saved' };
}

function requireSavedAlignedPlan(payload, context) {
    const state = getNewProjectImagePlan(context);
    assertExpected(payload, state);
    if (state.blockers.length) throw failure(state.blockers[0]);
    if (!fs.existsSync(exactPaths(context.userDataPath).planPath)) throw failure('IMAGE_PLAN_SAVE_REQUIRED');
    return state;
}

function prepareNewProjectImagePlan(payload, context = {}) {
    exactKeys(payload, ['expected_design_revision_sha256', 'expected_image_plan_revision_sha256'], 'IMAGE_PLAN_PREPARE_SHAPE_INVALID');
    const state = requireSavedAlignedPlan(payload, context);
    const tasks = state.tasks.filter((task) => !task.result_token || task.status === '재제작');
    if (!tasks.length) throw failure('IMAGE_PLAN_PREPARATION_EMPTY');
    const identity = JSON.stringify({ design: state.design_revision_sha256, revision: state.revision_sha256, tasks });
    const token = `preparation_${sha256(identity)}`;
    const paths = exactPaths(context.userDataPath);
    ensureChild(paths, paths.queueRoot);
    const entries = fs.readdirSync(paths.queueRoot, { withFileTypes: true });
    if (entries.length > MAX_QUEUE_ITEMS || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()
        || !/^preparation_[a-f0-9]{64}\.json$/.test(entry.name))) throw failure('IMAGE_PLAN_QUEUE_UNSAFE');
    const record = {
        schema_version: PREPARATION_SCHEMA, preparation_token: token,
        design_revision_sha256: state.design_revision_sha256,
        image_plan_revision_sha256: state.revision_sha256,
        tasks: tasks.map((task) => ({
            task_token: task.task_token, kind: task.kind, source_id: task.source_id,
            sequence: task.sequence, label: task.label, prompt: task.prompt,
            reference_task_ids: task.reference_task_ids, status: task.status,
        })),
        status: 'queued_preview', queued_at: new Date().toISOString(),
        executed: false, model_called: false, generation_executed: false,
    };
    const filePath = path.join(paths.queueRoot, `${token}.json`);
    let alreadyQueued = false;
    try { readPrivate(filePath, MAX_QUEUE_BYTES); alreadyQueued = true; } catch (error) {
        if (error.code !== 'IMAGE_PLAN_FILE_MISSING') throw error;
    }
    if (!alreadyQueued) {
        if (entries.length >= MAX_QUEUE_ITEMS) throw failure('IMAGE_PLAN_QUEUE_LIMIT_REACHED');
        privateWrite(filePath, Buffer.from(`${JSON.stringify(record, null, 2)}\n`), { exclusive: true });
    }
    return {
        ok: true, queued: true, already_queued: alreadyQueued, preparation_token: token,
        status: 'queued_preview', task_count: tasks.length, tasks: record.tasks,
        executed: false, model_called: false, generation_executed: false,
        state: getNewProjectImagePlan(context),
    };
}

function getNewProjectImageResultWorkspace(context = {}) {
    const source = (context.getDstBundleImportWorkspace || dstBundleImportProvider.getDstBundleImportWorkspace)(context);
    return {
        ok: source.status !== 'blocked', status: source.status,
        candidates: source.candidates.map((candidate) => ({
            candidate_token: candidate.candidate_token,
            created_at: candidate.created_at,
            image_count: candidate.image_count,
        })),
        blockers: source.blockers, executed: false, generation_executed: false,
    };
}

function decodePreview(preview) {
    if (!preview?.ready || !preview.preview || !['image/png', 'image/jpeg', 'image/webp'].includes(preview.preview.mime_type)) {
        throw failure(preview?.blockers?.[0] || 'IMAGE_PLAN_RESULT_PREVIEW_BLOCKED');
    }
    const buffer = Buffer.from(preview.preview.base64, 'base64');
    if (!buffer.length || buffer.byteLength !== preview.preview.byte_length || buffer.byteLength > MAX_RESULT_BYTES
        || buffer.toString('base64') !== preview.preview.base64) throw failure('IMAGE_PLAN_RESULT_PREVIEW_INVALID');
    return { buffer, mimeType: preview.preview.mime_type };
}

function connectNewProjectImageResult(payload, context = {}) {
    exactKeys(payload, [
        'task_token', 'candidate_token', 'image_index',
        'expected_design_revision_sha256', 'expected_image_plan_revision_sha256',
    ], 'IMAGE_PLAN_CONNECT_SHAPE_INVALID');
    const state = requireSavedAlignedPlan(payload, context);
    if (!TASK_TOKEN.test(payload.task_token || '') || typeof payload.candidate_token !== 'string'
        || !Number.isSafeInteger(payload.image_index) || payload.image_index < 1) throw failure('IMAGE_PLAN_CONNECT_INVALID');
    const task = state.tasks.find((item) => item.task_token === payload.task_token);
    if (!task) throw failure('IMAGE_PLAN_TASK_NOT_FOUND');
    const previewFn = context.getDstBundleImportPreview || dstBundleImportProvider.getDstBundleImportPreview;
    const preview = previewFn({ candidateToken: payload.candidate_token, imageIndex: payload.image_index }, context);
    const decoded = decodePreview(preview);
    const contentSha = sha256(decoded.buffer);
    const resultToken = `result_${sha256(`${task.task_token}\0${contentSha}`)}`;
    const paths = exactPaths(context.userDataPath);
    ensureChild(paths, paths.resultsRoot);
    const imagePath = path.join(paths.resultsRoot, `${resultToken}.bin`);
    const manifestPath = path.join(paths.resultsRoot, `${resultToken}.json`);
    const manifest = {
        schema_version: RESULT_SCHEMA, result_token: resultToken, task_token: task.task_token,
        mime_type: decoded.mimeType, byte_length: decoded.buffer.byteLength, sha256: contentSha,
        candidate_token: payload.candidate_token, image_index: payload.image_index,
        linked_at: new Date().toISOString(), generation_executed: false,
    };
    try { privateWrite(imagePath, decoded.buffer, { exclusive: true }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!readPrivate(imagePath, MAX_RESULT_BYTES).equals(decoded.buffer)) throw failure('IMAGE_PLAN_RESULT_CONFLICT');
    }
    try { privateWrite(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), { exclusive: true }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = JSON.parse(readPrivate(manifestPath, MAX_QUEUE_BYTES).toString('utf8'));
        if (existing.result_token !== resultToken || existing.sha256 !== contentSha || existing.task_token !== task.task_token) {
            throw failure('IMAGE_PLAN_RESULT_CONFLICT');
        }
    }
    const tasks = state.tasks.map((item) => item.task_token === task.task_token
        ? { ...item, status: '결과연결', result_token: resultToken } : item);
    writePlan(paths, state.design_revision_sha256, tasks);
    return {
        ok: true, connected: true, task_token: task.task_token, result_token: resultToken,
        status: '결과연결', executed: false, generation_executed: false,
        state: getNewProjectImagePlan(context),
    };
}

function readResult(paths, token) {
    if (!RESULT_TOKEN.test(token || '')) throw failure('IMAGE_PLAN_RESULT_TOKEN_INVALID');
    let manifest;
    try { manifest = JSON.parse(readPrivate(path.join(paths.resultsRoot, `${token}.json`), MAX_QUEUE_BYTES).toString('utf8')); }
    catch (error) { if (error.code) throw error; throw failure('IMAGE_PLAN_RESULT_INVALID'); }
    exactKeys(manifest, [
        'schema_version', 'result_token', 'task_token', 'mime_type', 'byte_length', 'sha256',
        'candidate_token', 'image_index', 'linked_at', 'generation_executed',
    ], 'IMAGE_PLAN_RESULT_INVALID');
    if (manifest.schema_version !== RESULT_SCHEMA || manifest.result_token !== token
        || !TASK_TOKEN.test(manifest.task_token) || !SHA256.test(manifest.sha256)
        || manifest.generation_executed !== false) throw failure('IMAGE_PLAN_RESULT_INVALID');
    const buffer = readPrivate(path.join(paths.resultsRoot, `${token}.bin`), MAX_RESULT_BYTES);
    if (buffer.byteLength !== manifest.byte_length || sha256(buffer) !== manifest.sha256) throw failure('IMAGE_PLAN_RESULT_INVALID');
    return { manifest, buffer };
}

function getNewProjectImageResultPreview(payload, context = {}) {
    exactKeys(payload, ['result_token'], 'IMAGE_PLAN_RESULT_PREVIEW_SHAPE_INVALID');
    try {
        const result = readResult(exactPaths(context.userDataPath), payload.result_token);
        return {
            ok: true, status: 'ready', ready: true, result_token: result.manifest.result_token,
            preview: { mime_type: result.manifest.mime_type, byte_length: result.buffer.byteLength, base64: result.buffer.toString('base64') },
            blockers: [], executed: false, generation_executed: false,
        };
    } catch (error) {
        return { ok: false, status: 'blocked', ready: false, result_token: '', preview: null,
            blockers: [error.code || 'IMAGE_PLAN_RESULT_PREVIEW_BLOCKED'], executed: false, generation_executed: false };
    }
}

function saveNewProjectImageRetrySelection(payload, context = {}) {
    exactKeys(payload, [
        'task_tokens', 'expected_design_revision_sha256', 'expected_image_plan_revision_sha256',
    ], 'IMAGE_PLAN_RETRY_SHAPE_INVALID');
    if (!Array.isArray(payload.task_tokens) || payload.task_tokens.some((token) => !TASK_TOKEN.test(token))
        || new Set(payload.task_tokens).size !== payload.task_tokens.length) throw failure('IMAGE_PLAN_RETRY_INVALID');
    const state = requireSavedAlignedPlan(payload, context);
    const selected = new Set(payload.task_tokens);
    for (const token of selected) {
        const task = state.tasks.find((item) => item.task_token === token);
        if (!task || !task.result_token) throw failure('IMAGE_PLAN_RETRY_RESULT_REQUIRED');
    }
    const tasks = state.tasks.map((task) => {
        if (!task.result_token) return task;
        return { ...task, status: selected.has(task.task_token) ? '재제작' : '결과연결' };
    });
    const paths = exactPaths(context.userDataPath);
    writePlan(paths, state.design_revision_sha256, tasks);
    return { ...getNewProjectImagePlan(context), status: 'saved' };
}

module.exports = {
    PLAN_SCHEMA,
    PREPARATION_SCHEMA,
    RESULT_SCHEMA,
    exactPaths,
    deriveTasks,
    getNewProjectImagePlan,
    saveNewProjectImagePlan,
    prepareNewProjectImagePlan,
    getNewProjectImageResultWorkspace,
    connectNewProjectImageResult,
    getNewProjectImageResultPreview,
    saveNewProjectImageRetrySelection,
};
