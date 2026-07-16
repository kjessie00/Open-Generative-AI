const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const newProjectDesignProvider = require('./newProjectDesignProvider');
const newProjectImagePlanProvider = require('./newProjectImagePlanProvider');
const videoResultImportProvider = require('./videoResultImportProvider');

const PLAN_SCHEMA = 'film_pipeline.new_project_video_plan.v1';
const PREPARATION_SCHEMA = 'film_pipeline.new_project_video_preparation.v1';
const RESULT_SCHEMA = 'film_pipeline.new_project_video_result.v1';
const REVIEW_SCHEMA = 'film_pipeline.new_project_video_review.v1';
const ROOT_DIRECTORY = 'video_plan';
const PLAN_FILE = 'plan.json';
const REVIEW_FILE = 'review-decisions.json';
const QUEUE_DIRECTORY = 'queue';
const RESULTS_DIRECTORY = 'results';
const MAX_PLAN_BYTES = 1024 * 1024;
const MAX_QUEUE_BYTES = 1024 * 1024;
const MAX_RESULT_BYTES = 512 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const MAX_REVIEW_BYTES = 128 * 1024;
const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_QUEUE_ITEMS = 100;
const SHA256 = /^[a-f0-9]{64}$/;
const TASK_TOKEN = /^task_[a-f0-9]{64}$/;
const RESULT_TOKEN = /^result_[a-f0-9]{64}$/;
const PREPARATION_TOKEN = /^preparation_[a-f0-9]{64}$/;
const PROVIDER_LABELS = Object.freeze({
    flow: '플로우',
    grok: '그록',
    replicate: '리플리케이트',
    bytedance: '바이트댄스',
});
const PROVIDERS = new Set(Object.keys(PROVIDER_LABELS));
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

function boundedText(value, maximum, code) {
    if (typeof value !== 'string' || value.includes('\0')) throw failure(code);
    const normalized = value.trim();
    if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) throw failure(code);
    return normalized;
}

function exactPaths(userDataPath) {
    const design = newProjectDesignProvider.exactPaths(userDataPath);
    const root = path.join(design.draftRoot, ROOT_DIRECTORY);
    return {
        draftRoot: design.draftRoot,
        root,
        planPath: path.join(root, PLAN_FILE),
        reviewPath: path.join(root, REVIEW_FILE),
        queueRoot: path.join(root, QUEUE_DIRECTORY),
        resultsRoot: path.join(root, RESULTS_DIRECTORY),
    };
}

function validateReviewRecord(value) {
    exactKeys(value, ['schema_version', 'decisions', 'updated_at'], 'VIDEO_PLAN_REVIEW_INVALID');
    if (value.schema_version !== REVIEW_SCHEMA || !Array.isArray(value.decisions)
        || value.decisions.length > 20 || !Number.isFinite(Date.parse(value.updated_at))) {
        throw failure('VIDEO_PLAN_REVIEW_INVALID');
    }
    const decisions = value.decisions.map((decision) => {
        exactKeys(decision, [
            'task_token', 'result_token', 'design_revision_sha256', 'image_plan_revision_sha256',
            'decision', 'decided_at',
        ], 'VIDEO_PLAN_REVIEW_INVALID');
        if (!TASK_TOKEN.test(decision.task_token || '') || !RESULT_TOKEN.test(decision.result_token || '')
            || !SHA256.test(decision.design_revision_sha256 || '')
            || !SHA256.test(decision.image_plan_revision_sha256 || '') || decision.decision !== 'use'
            || !Number.isFinite(Date.parse(decision.decided_at))) throw failure('VIDEO_PLAN_REVIEW_INVALID');
        return decision;
    });
    if (new Set(decisions.map((decision) => decision.task_token)).size !== decisions.length) {
        throw failure('VIDEO_PLAN_REVIEW_INVALID');
    }
    return decisions;
}

function readReviewDecisions(paths) {
    if (!fs.existsSync(paths.reviewPath)) return { decisions: [], blockers: [] };
    try {
        const value = JSON.parse(readPrivate(paths.reviewPath, MAX_REVIEW_BYTES).toString('utf8'));
        return { decisions: validateReviewRecord(value), blockers: [] };
    } catch (error) {
        return { decisions: [], blockers: [error.code || 'VIDEO_PLAN_REVIEW_INVALID'] };
    }
}

function requireReviewDecisions(paths) {
    const review = readReviewDecisions(paths);
    if (review.blockers.length) throw failure(review.blockers[0]);
    return review.decisions;
}

function writeReviewDecisions(paths, decisions) {
    ensureRoot(paths);
    const record = { schema_version: REVIEW_SCHEMA, decisions, updated_at: new Date().toISOString() };
    const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    if (buffer.byteLength > MAX_REVIEW_BYTES) throw failure('VIDEO_PLAN_REVIEW_TOO_LARGE');
    privateWrite(paths.reviewPath, buffer);
}

function publicReviewDecisions(tasks, designRevision, imagePlanRevision, stored, blockers = []) {
    const accepted = blockers.length ? new Map() : new Map(stored.filter((decision) => (
        decision.design_revision_sha256 === designRevision
        && decision.image_plan_revision_sha256 === imagePlanRevision
    )).map((decision) => [decision.task_token, decision]));
    return tasks.filter((task) => task.result_token).map((task) => ({
        task_token: task.task_token,
        result_token: task.result_token,
        decision: task.status === '재제작' ? 'retry'
            : accepted.get(task.task_token)?.result_token === task.result_token ? 'use' : 'pending',
    }));
}

function assertPrivateDirectory(directoryPath, code) {
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw failure(code); }
    if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700
        || fs.realpathSync.native(directoryPath) !== directoryPath) throw failure(code);
    return stats;
}

function ensureDirectory(directoryPath, parentPath) {
    const parent = assertPrivateDirectory(parentPath, 'VIDEO_PLAN_PARENT_UNSAFE');
    try { fs.mkdirSync(directoryPath, { mode: 0o700 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const current = assertPrivateDirectory(directoryPath, 'VIDEO_PLAN_DIRECTORY_UNSAFE');
    if (current.dev !== parent.dev || path.dirname(fs.realpathSync.native(directoryPath)) !== parentPath) {
        throw failure('VIDEO_PLAN_DIRECTORY_UNSAFE');
    }
}

function ensureRoot(paths) {
    assertPrivateDirectory(paths.draftRoot, 'VIDEO_PLAN_DRAFT_ROOT_UNSAFE');
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

function readPrivate(filePath, maximum, missingCode = 'VIDEO_PLAN_FILE_MISSING') {
    let before;
    try { before = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') throw failure(missingCode);
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > maximum || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure('VIDEO_PLAN_FILE_UNSAFE');
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw failure('VIDEO_PLAN_FILE_CHANGED');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(filePath);
        if (buffer.byteLength !== before.size || !sameFile(opened, after) || !sameFile(opened, final)) {
            throw failure('VIDEO_PLAN_FILE_CHANGED');
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
    assertPrivateDirectory(parent, 'VIDEO_PLAN_DIRECTORY_UNSAFE');
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw failure('VIDEO_PLAN_WRITE_INVALID');
    if (exclusive) {
        const descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT
            | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        fsyncDirectory(parent);
        return;
    }
    const temp = path.join(parent, `.video-plan-${crypto.randomBytes(12).toString('hex')}.tmp`);
    const descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    try {
        let current;
        try { current = fs.lstatSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current && (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o777) !== 0o600)) {
            throw failure('VIDEO_PLAN_FILE_UNSAFE');
        }
        fs.renameSync(temp, filePath);
        fsyncDirectory(parent);
    } finally { try { fs.unlinkSync(temp); } catch { /* renamed or already removed */ } }
}

function taskToken(sceneId) {
    return `task_${sha256(`scene_video\0${sceneId}`)}`;
}

function promptParts(parts) {
    return parts.map((part) => part.trim()).filter(Boolean).join(' / ');
}

function loadUpstream(context) {
    const design = newProjectDesignProvider.getNewProjectDesignState({ userDataPath: context.userDataPath });
    if (design.status !== 'restored' || !design.revision_sha256 || design.blockers.length) {
        throw failure('VIDEO_PLAN_SAVED_DESIGN_REQUIRED');
    }
    const imagePlan = (context.getNewProjectImagePlan || newProjectImagePlanProvider.getNewProjectImagePlan)(context);
    if (!imagePlan || imagePlan.status !== 'restored' || imagePlan.blockers?.length
        || imagePlan.design_revision_sha256 !== design.revision_sha256 || !SHA256.test(imagePlan.revision_sha256 || '')) {
        throw failure('VIDEO_PLAN_SAVED_ALIGNED_IMAGE_PLAN_REQUIRED');
    }
    const imageReviews = new Map((imagePlan.review_decisions || [])
        .map((decision) => [decision.task_token, decision.decision]));
    if (imagePlan.review_blockers?.length || imagePlan.tasks.some((task) => (
        !task.result_token || task.status !== '결과연결' || imageReviews.get(task.task_token) !== 'use'
    ))) throw failure('VIDEO_PLAN_IMAGE_REVIEW_REQUIRED');
    const sceneImages = new Map();
    for (const task of imagePlan.tasks) {
        if (task.kind === 'scene_image') sceneImages.set(task.source_id, task);
    }
    for (const scene of design.board.scenes) {
        const image = sceneImages.get(scene.id);
        if (!image || !TASK_TOKEN.test(image.task_token || '') || !RESULT_TOKEN.test(image.result_token || '')
            || image.status !== '결과연결') {
            throw failure('VIDEO_PLAN_REFERENCE_IMAGE_REQUIRED');
        }
    }
    return { design, imagePlan, sceneImages };
}

function deriveTasks(board, imageTasks, aspectRatio = '9:16') {
    const format = aspectRatio === '16:9' ? '16:9 가로형' : '9:16 세로형';
    return board.scenes.map((scene, index) => {
        const reference = imageTasks instanceof Map
            ? imageTasks.get(scene.id)
            : imageTasks.find((task) => task.kind === 'scene_image' && task.source_id === scene.id);
        if (!reference?.result_token) throw failure('VIDEO_PLAN_REFERENCE_IMAGE_REQUIRED');
        return {
            task_token: taskToken(scene.id),
            kind: 'scene_video',
            source_id: scene.id,
            sequence: index + 1,
            label: `장면 영상 · ${scene.title}`,
            provider: 'flow',
            provider_label: PROVIDER_LABELS.flow,
            prompt: promptParts([
                `${format} 시네마틱 영상. ${scene.title}`,
                scene.first_frame && `첫 프레임: ${scene.first_frame}`,
                `동작: ${scene.action}`,
                scene.camera && `카메라: ${scene.camera}`,
                scene.lighting && `조명: ${scene.lighting}`,
                scene.audio_sfx_dialogue && `소리와 대사: ${scene.audio_sfx_dialogue}`,
                `길이: ${scene.duration}초`,
                '참조 이미지의 인물·의상·장소 연속성을 유지하고 움직임은 자연스럽게, 텍스트·로고·워터마크 없음',
            ]),
            reference_image_task_token: reference.task_token,
            reference_image_result_token: reference.result_token,
            status: '준비',
            result_token: '',
        };
    });
}

function validateTask(value, sequence, { canonicalizeProviderLabel = false } = {}) {
    exactKeys(value, [
        'task_token', 'kind', 'source_id', 'sequence', 'label', 'provider', 'provider_label', 'prompt',
        'reference_image_task_token', 'reference_image_result_token', 'status', 'result_token',
    ], 'VIDEO_PLAN_TASK_SHAPE_INVALID');
    const task = canonicalizeProviderLabel
        ? { ...value, provider_label: PROVIDER_LABELS[value.provider] }
        : value;
    if (!TASK_TOKEN.test(task.task_token) || task.kind !== 'scene_video' || task.sequence !== sequence
        || !PROVIDERS.has(task.provider) || task.provider_label !== PROVIDER_LABELS[task.provider]
        || !TASK_TOKEN.test(task.reference_image_task_token) || !RESULT_TOKEN.test(task.reference_image_result_token)
        || !TASK_STATUSES.has(task.status)) throw failure('VIDEO_PLAN_TASK_INVALID');
    if (task.result_token && !RESULT_TOKEN.test(task.result_token)) throw failure('VIDEO_PLAN_RESULT_TOKEN_INVALID');
    if (task.status === '준비' && task.result_token) throw failure('VIDEO_PLAN_TASK_STATUS_INVALID');
    if (task.status !== '준비' && !task.result_token) throw failure('VIDEO_PLAN_TASK_STATUS_INVALID');
    return {
        ...task,
        source_id: boundedText(task.source_id, 128, 'VIDEO_PLAN_TASK_INVALID'),
        label: boundedText(task.label, 1024, 'VIDEO_PLAN_TASK_INVALID'),
        prompt: boundedText(task.prompt, MAX_PROMPT_BYTES, 'VIDEO_PLAN_PROMPT_INVALID'),
    };
}

function validateTasks(value, options) {
    if (!Array.isArray(value) || !value.length || value.length > 20) throw failure('VIDEO_PLAN_TASKS_INVALID');
    const tasks = value.map((task, index) => validateTask(task, index + 1, options));
    if (new Set(tasks.map((task) => task.task_token)).size !== tasks.length) throw failure('VIDEO_PLAN_TASK_TOKEN_DUPLICATE');
    return tasks;
}

function validateIdentity(tasks, derived) {
    if (tasks.length !== derived.length) throw failure('VIDEO_PLAN_TASK_SET_MISMATCH');
    for (let index = 0; index < tasks.length; index += 1) {
        for (const key of [
            'task_token', 'kind', 'source_id', 'sequence', 'label',
            'reference_image_task_token', 'reference_image_result_token',
        ]) {
            if (tasks[index][key] !== derived[index][key]) throw failure('VIDEO_PLAN_TASK_SET_MISMATCH');
        }
    }
}

function revisionFor(designRevision, imagePlanRevision, tasks) {
    return sha256(JSON.stringify({
        design_revision_sha256: designRevision,
        image_plan_revision_sha256: imagePlanRevision,
        tasks,
    }));
}

function validatePlanRecord(value) {
    exactKeys(value, [
        'schema_version', 'design_revision_sha256', 'image_plan_revision_sha256', 'tasks', 'saved_at',
    ], 'VIDEO_PLAN_FILE_INVALID');
    if (value.schema_version !== PLAN_SCHEMA || !SHA256.test(value.design_revision_sha256)
        || !SHA256.test(value.image_plan_revision_sha256) || !Number.isFinite(Date.parse(value.saved_at))) {
        throw failure('VIDEO_PLAN_FILE_INVALID');
    }
    return { ...value, tasks: validateTasks(value.tasks) };
}

function loadPlan(paths) {
    let parsed;
    try { parsed = JSON.parse(readPrivate(paths.planPath, MAX_PLAN_BYTES).toString('utf8')); }
    catch (error) { if (error.code) throw error; throw failure('VIDEO_PLAN_FILE_INVALID'); }
    return validatePlanRecord(parsed);
}

function validatePreparation(value) {
    exactKeys(value, [
        'schema_version', 'preparation_token', 'design_revision_sha256', 'image_plan_revision_sha256',
        'video_plan_revision_sha256', 'tasks', 'status', 'queued_at', 'executed', 'model_called',
        'generation_executed',
    ], 'VIDEO_PLAN_QUEUE_INVALID');
    if (value.schema_version !== PREPARATION_SCHEMA || !PREPARATION_TOKEN.test(value.preparation_token || '')
        || !SHA256.test(value.design_revision_sha256 || '') || !SHA256.test(value.image_plan_revision_sha256 || '')
        || !SHA256.test(value.video_plan_revision_sha256 || '') || !Array.isArray(value.tasks) || !value.tasks.length
        || value.status !== 'queued_preview' || !Number.isFinite(Date.parse(value.queued_at))
        || value.executed !== false || value.model_called !== false || value.generation_executed !== false) {
        throw failure('VIDEO_PLAN_QUEUE_INVALID');
    }
    const tasks = value.tasks.map((task, index) => {
        exactKeys(task, [
            'task_token', 'kind', 'source_id', 'sequence', 'label', 'provider', 'provider_label', 'prompt',
            'reference_image_task_token', 'reference_image_result_token', 'status',
        ], 'VIDEO_PLAN_QUEUE_INVALID');
        if (!TASK_TOKEN.test(task.task_token || '') || task.kind !== 'scene_video'
            || !Number.isSafeInteger(task.sequence) || task.sequence < 1 || task.sequence > 20
            || (index > 0 && task.sequence <= value.tasks[index - 1].sequence)
            || !PROVIDERS.has(task.provider) || task.provider_label !== PROVIDER_LABELS[task.provider]
            || !TASK_TOKEN.test(task.reference_image_task_token || '')
            || !RESULT_TOKEN.test(task.reference_image_result_token || '')
            || !['준비', '재제작'].includes(task.status)) throw failure('VIDEO_PLAN_QUEUE_INVALID');
        boundedText(task.source_id, 128, 'VIDEO_PLAN_QUEUE_INVALID');
        boundedText(task.label, 1024, 'VIDEO_PLAN_QUEUE_INVALID');
        boundedText(task.prompt, MAX_PROMPT_BYTES, 'VIDEO_PLAN_QUEUE_INVALID');
        return task;
    });
    if (new Set(tasks.map((task) => task.task_token)).size !== tasks.length) throw failure('VIDEO_PLAN_QUEUE_INVALID');
    return { ...value, tasks };
}

function latestPreparation(paths, designRevision, imagePlanRevision, videoPlanRevision) {
    const empty = { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false };
    if (!fs.existsSync(paths.queueRoot)) return empty;
    assertPrivateDirectory(paths.queueRoot, 'VIDEO_PLAN_QUEUE_UNSAFE');
    const entries = fs.readdirSync(paths.queueRoot, { withFileTypes: true });
    if (entries.length > MAX_QUEUE_ITEMS || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()
        || !/^preparation_[a-f0-9]{64}\.json$/.test(entry.name))) throw failure('VIDEO_PLAN_QUEUE_UNSAFE');
    const records = entries.map((entry) => {
        let value;
        try { value = JSON.parse(readPrivate(path.join(paths.queueRoot, entry.name), MAX_QUEUE_BYTES).toString('utf8')); }
        catch (error) { if (error.code) throw error; throw failure('VIDEO_PLAN_QUEUE_INVALID'); }
        return validatePreparation(value);
    }).filter((value) => value.design_revision_sha256 === designRevision
        && value.image_plan_revision_sha256 === imagePlanRevision
        && value.video_plan_revision_sha256 === videoPlanRevision);
    if (!records.length) return empty;
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
        ok: false, status: 'blocked', design_revision_sha256: '', image_plan_revision_sha256: '',
        revision_sha256: '', tasks: [], providers: PROVIDER_LABELS,
        review_decisions: [], review_blockers: [code],
        preparation: { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false },
        blockers: [code], executed: false, generation_executed: false, model_called: false,
    };
}

function getNewProjectVideoPlan(context = {}) {
    try {
        const upstream = loadUpstream(context);
        const paths = exactPaths(context.userDataPath);
        const derived = deriveTasks(upstream.design.board, upstream.sceneImages, upstream.design.aspect_ratio);
        let tasks = derived;
        let status = 'derived';
        const blockers = [];
        if (fs.existsSync(paths.planPath)) {
            const plan = loadPlan(paths);
            tasks = plan.tasks;
            status = 'restored';
            if (plan.design_revision_sha256 !== upstream.design.revision_sha256
                || plan.image_plan_revision_sha256 !== upstream.imagePlan.revision_sha256) {
                status = 'upstream_changed';
                tasks = derived;
                blockers.push('VIDEO_PLAN_UPSTREAM_STALE');
            } else validateIdentity(tasks, derived);
        }
        const revision = revisionFor(upstream.design.revision_sha256, upstream.imagePlan.revision_sha256, tasks);
        const review = readReviewDecisions(paths);
        return {
            ok: blockers.length === 0,
            status,
            design_revision_sha256: upstream.design.revision_sha256,
            image_plan_revision_sha256: upstream.imagePlan.revision_sha256,
            revision_sha256: revision,
            tasks,
            review_decisions: publicReviewDecisions(
                tasks, upstream.design.revision_sha256, upstream.imagePlan.revision_sha256,
                review.decisions, review.blockers,
            ),
            review_blockers: review.blockers,
            providers: PROVIDER_LABELS,
            preparation: blockers.length ? {
                status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false,
            } : latestPreparation(paths, upstream.design.revision_sha256, upstream.imagePlan.revision_sha256, revision),
            blockers,
            executed: false,
            generation_executed: false,
            model_called: false,
        };
    } catch (error) { return blockedState(error.code || 'VIDEO_PLAN_READ_FAILED'); }
}

function assertExpected(payload, state) {
    if (!SHA256.test(payload.expected_design_revision_sha256 || '')
        || !SHA256.test(payload.expected_image_plan_revision_sha256 || '')
        || !SHA256.test(payload.expected_video_plan_revision_sha256 || '')) throw failure('VIDEO_PLAN_REVISION_INVALID');
    if (state.status === 'blocked') throw failure(state.blockers[0] || 'VIDEO_PLAN_BLOCKED');
    if (payload.expected_design_revision_sha256 !== state.design_revision_sha256) throw failure('VIDEO_PLAN_DESIGN_STALE');
    if (payload.expected_image_plan_revision_sha256 !== state.image_plan_revision_sha256) throw failure('VIDEO_PLAN_IMAGE_PLAN_STALE');
    if (payload.expected_video_plan_revision_sha256 !== state.revision_sha256) throw failure('VIDEO_PLAN_REVISION_STALE');
}

function writePlan(paths, designRevision, imagePlanRevision, tasks) {
    ensureRoot(paths);
    const record = {
        schema_version: PLAN_SCHEMA,
        design_revision_sha256: designRevision,
        image_plan_revision_sha256: imagePlanRevision,
        tasks,
        saved_at: new Date().toISOString(),
    };
    const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    if (buffer.byteLength > MAX_PLAN_BYTES) throw failure('VIDEO_PLAN_TOO_LARGE');
    privateWrite(paths.planPath, buffer);
}

function saveNewProjectVideoPlan(payload, context = {}) {
    exactKeys(payload, [
        'tasks', 'expected_design_revision_sha256', 'expected_image_plan_revision_sha256',
        'expected_video_plan_revision_sha256',
    ], 'VIDEO_PLAN_SAVE_SHAPE_INVALID');
    const state = getNewProjectVideoPlan(context);
    assertExpected(payload, state);
    const tasks = validateTasks(payload.tasks, { canonicalizeProviderLabel: true });
    const upstream = loadUpstream(context);
    const derived = deriveTasks(upstream.design.board, upstream.sceneImages, upstream.design.aspect_ratio);
    validateIdentity(tasks, derived);
    const current = new Map(state.tasks.map((task) => [task.task_token, task]));
    for (const task of tasks) {
        const prior = current.get(task.task_token);
        if (task.status !== prior.status || task.result_token !== prior.result_token) {
            throw failure('VIDEO_PLAN_RESULT_STATE_IMMUTABLE');
        }
        if (prior.status === '결과연결'
            && (task.provider !== prior.provider || task.prompt !== prior.prompt)) {
            throw failure('VIDEO_PLAN_ACCEPTED_TASK_EDIT_REQUIRES_RETRY');
        }
    }
    const paths = exactPaths(context.userDataPath);
    writePlan(paths, upstream.design.revision_sha256, upstream.imagePlan.revision_sha256, tasks);
    return { ...getNewProjectVideoPlan(context), status: 'saved' };
}

function requireSavedAlignedPlan(payload, context) {
    const state = getNewProjectVideoPlan(context);
    assertExpected(payload, state);
    if (state.blockers.length) throw failure(state.blockers[0]);
    if (!fs.existsSync(exactPaths(context.userDataPath).planPath)) throw failure('VIDEO_PLAN_SAVE_REQUIRED');
    return state;
}

function prepareNewProjectVideoPlan(payload, context = {}) {
    exactKeys(payload, [
        'expected_design_revision_sha256', 'expected_image_plan_revision_sha256',
        'expected_video_plan_revision_sha256',
    ], 'VIDEO_PLAN_PREPARE_SHAPE_INVALID');
    const state = requireSavedAlignedPlan(payload, context);
    const tasks = state.tasks.filter((task) => !task.result_token || task.status === '재제작');
    if (!tasks.length) throw failure('VIDEO_PLAN_PREPARATION_EMPTY');
    const identity = JSON.stringify({
        design: state.design_revision_sha256,
        image: state.image_plan_revision_sha256,
        revision: state.revision_sha256,
        tasks,
    });
    const token = `preparation_${sha256(identity)}`;
    const paths = exactPaths(context.userDataPath);
    ensureChild(paths, paths.queueRoot);
    const entries = fs.readdirSync(paths.queueRoot, { withFileTypes: true });
    if (entries.length > MAX_QUEUE_ITEMS || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()
        || !/^preparation_[a-f0-9]{64}\.json$/.test(entry.name))) throw failure('VIDEO_PLAN_QUEUE_UNSAFE');
    const record = {
        schema_version: PREPARATION_SCHEMA,
        preparation_token: token,
        design_revision_sha256: state.design_revision_sha256,
        image_plan_revision_sha256: state.image_plan_revision_sha256,
        video_plan_revision_sha256: state.revision_sha256,
        tasks: tasks.map((task) => ({
            task_token: task.task_token,
            kind: task.kind,
            source_id: task.source_id,
            sequence: task.sequence,
            label: task.label,
            provider: task.provider,
            provider_label: task.provider_label,
            prompt: task.prompt,
            reference_image_task_token: task.reference_image_task_token,
            reference_image_result_token: task.reference_image_result_token,
            status: task.status,
        })),
        status: 'queued_preview',
        queued_at: new Date().toISOString(),
        executed: false,
        model_called: false,
        generation_executed: false,
    };
    const filePath = path.join(paths.queueRoot, `${token}.json`);
    let alreadyQueued = false;
    try {
        const buffer = readPrivate(filePath, MAX_QUEUE_BYTES);
        let parsed;
        try { parsed = JSON.parse(buffer.toString('utf8')); } catch { throw failure('VIDEO_PLAN_QUEUE_INVALID'); }
        const existing = validatePreparation(parsed);
        for (const key of [
            'schema_version', 'preparation_token', 'design_revision_sha256', 'image_plan_revision_sha256',
            'video_plan_revision_sha256', 'status', 'executed', 'model_called', 'generation_executed',
        ]) {
            if (existing[key] !== record[key]) throw failure('VIDEO_PLAN_QUEUE_CONFLICT');
        }
        if (JSON.stringify(existing.tasks) !== JSON.stringify(record.tasks)) throw failure('VIDEO_PLAN_QUEUE_CONFLICT');
        alreadyQueued = true;
    } catch (error) {
        if (error.code !== 'VIDEO_PLAN_FILE_MISSING') throw error;
    }
    if (!alreadyQueued) {
        if (entries.length >= MAX_QUEUE_ITEMS) throw failure('VIDEO_PLAN_QUEUE_LIMIT_REACHED');
        privateWrite(filePath, Buffer.from(`${JSON.stringify(record, null, 2)}\n`), { exclusive: true });
    }
    return {
        ok: true,
        queued: true,
        already_queued: alreadyQueued,
        preparation_token: token,
        status: 'queued_preview',
        task_count: tasks.length,
        tasks: record.tasks,
        executed: false,
        model_called: false,
        generation_executed: false,
        state: getNewProjectVideoPlan(context),
    };
}

function videoWorkspace(context) {
    return (context.getVideoResultImportWorkspace || videoResultImportProvider.getVideoResultImportWorkspace)(context);
}

function getNewProjectVideoResultWorkspace(context = {}) {
    const source = videoWorkspace(context);
    return {
        ok: source.status !== 'blocked',
        status: source.status,
        candidates: source.candidates.map((candidate) => ({
            candidate_token: candidate.candidate_token,
            provider: candidate.provider,
            provider_label: PROVIDER_LABELS[candidate.provider] || candidate.provider,
            duration_seconds: candidate.duration_seconds,
            width: candidate.width,
            height: candidate.height,
        })),
        blockers: source.blockers,
        executed: false,
        generation_executed: false,
    };
}

function hashPrivateResult(filePath) {
    let before;
    try { before = fs.lstatSync(filePath); } catch { throw failure('VIDEO_PLAN_RESULT_INVALID'); }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > MAX_RESULT_BYTES || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure('VIDEO_PLAN_RESULT_INVALID');
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw failure('VIDEO_PLAN_RESULT_CHANGED');
        const digest = crypto.createHash('sha256');
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (position < opened.size) {
            const count = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, opened.size - position), position);
            if (count <= 0) throw failure('VIDEO_PLAN_RESULT_CHANGED');
            digest.update(chunk.subarray(0, count));
            position += count;
        }
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(filePath);
        if (position !== opened.size || !sameFile(opened, after) || !sameFile(opened, final)) {
            throw failure('VIDEO_PLAN_RESULT_CHANGED');
        }
        return { sha256: digest.digest('hex'), byte_length: position };
    } finally { fs.closeSync(descriptor); }
}

function connectNewProjectVideoResult(payload, context = {}) {
    exactKeys(payload, [
        'task_token', 'candidate_token', 'expected_design_revision_sha256',
        'expected_image_plan_revision_sha256', 'expected_video_plan_revision_sha256',
    ], 'VIDEO_PLAN_CONNECT_SHAPE_INVALID');
    const state = requireSavedAlignedPlan(payload, context);
    if (!TASK_TOKEN.test(payload.task_token || '') || typeof payload.candidate_token !== 'string') {
        throw failure('VIDEO_PLAN_CONNECT_INVALID');
    }
    const task = state.tasks.find((item) => item.task_token === payload.task_token);
    if (!task) throw failure('VIDEO_PLAN_TASK_NOT_FOUND');
    if (task.result_token && task.status !== '재제작') throw failure('VIDEO_PLAN_RETRY_SELECTION_REQUIRED');
    const candidate = videoWorkspace(context).candidates.find((item) => item.candidate_token === payload.candidate_token);
    if (!candidate || candidate.provider !== task.provider) throw failure('VIDEO_PLAN_PROVIDER_RESULT_MISMATCH');
    const paths = exactPaths(context.userDataPath);
    ensureChild(paths, paths.resultsRoot);
    const stagingPath = path.join(paths.resultsRoot, `.video-source-${crypto.randomBytes(12).toString('hex')}.tmp`);
    const copyFn = context.copyVideoResultCandidateToPrivateFile
        || videoResultImportProvider.copyVideoResultCandidateToPrivateFile;
    let copied;
    try {
        copied = copyFn({
            candidateToken: payload.candidate_token,
            destinationPath: stagingPath,
            destinationRoot: paths.resultsRoot,
        }, context);
    } catch (error) {
        try { fs.unlinkSync(stagingPath); } catch { /* absent */ }
        throw error;
    }
    if (!copied || copied.provider !== task.provider || copied.provider !== candidate.provider
        || !SHA256.test(copied.source_sha256 || '')
        || !Number.isSafeInteger(copied.byte_length) || copied.byte_length <= 0
        || copied.byte_length > MAX_RESULT_BYTES
        || !Number.isFinite(copied.duration_seconds) || copied.duration_seconds <= 0
        || !Number.isSafeInteger(copied.width) || copied.width <= 0
        || !Number.isSafeInteger(copied.height) || copied.height <= 0
        || typeof copied.provenance_kind !== 'string' || Buffer.byteLength(copied.provenance_kind, 'utf8') > 128) {
        try { fs.unlinkSync(stagingPath); } catch { /* absent */ }
        throw failure('VIDEO_PLAN_PRIVATE_COPY_INVALID');
    }
    const staged = hashPrivateResult(stagingPath);
    if (staged.sha256 !== copied.source_sha256 || staged.byte_length !== copied.byte_length) {
        try { fs.unlinkSync(stagingPath); } catch { /* absent */ }
        throw failure('VIDEO_PLAN_PRIVATE_COPY_INVALID');
    }
    const contentSha = copied.source_sha256;
    const resultToken = `result_${sha256(`${task.task_token}\0${contentSha}`)}`;
    const videoPath = path.join(paths.resultsRoot, `${resultToken}.mp4`);
    const manifestPath = path.join(paths.resultsRoot, `${resultToken}.json`);
    const manifest = {
        schema_version: RESULT_SCHEMA,
        result_token: resultToken,
        task_token: task.task_token,
        provider: candidate.provider,
        mime_type: 'video/mp4',
        byte_length: copied.byte_length,
        sha256: contentSha,
        duration_seconds: copied.duration_seconds,
        width: copied.width,
        height: copied.height,
        source_provenance: copied.provenance_kind,
        linked_at: new Date().toISOString(),
        generation_executed: false,
    };
    try {
        let existing;
        try { existing = fs.lstatSync(videoPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (existing) {
            const current = hashPrivateResult(videoPath);
            if (current.sha256 !== contentSha || current.byte_length !== copied.byte_length) {
                throw failure('VIDEO_PLAN_RESULT_CONFLICT');
            }
            fs.unlinkSync(stagingPath);
        } else {
            fs.renameSync(stagingPath, videoPath);
            fsyncDirectory(paths.resultsRoot);
        }
    } catch (error) {
        try { fs.unlinkSync(stagingPath); } catch { /* renamed or absent */ }
        throw error;
    }
    try { privateWrite(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), { exclusive: true }); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = JSON.parse(readPrivate(manifestPath, MAX_QUEUE_BYTES).toString('utf8'));
        if (existing.result_token !== resultToken || existing.sha256 !== contentSha
            || existing.task_token !== task.task_token || existing.provider !== candidate.provider) {
            throw failure('VIDEO_PLAN_RESULT_CONFLICT');
        }
    }
    const tasks = state.tasks.map((item) => item.task_token === task.task_token
        ? { ...item, status: '결과연결', result_token: resultToken } : item);
    writePlan(paths, state.design_revision_sha256, state.image_plan_revision_sha256, tasks);
    return {
        ok: true,
        connected: true,
        task_token: task.task_token,
        result_token: resultToken,
        status: '결과연결',
        executed: false,
        generation_executed: false,
        state: getNewProjectVideoPlan(context),
    };
}

function readResult(paths, token) {
    if (!RESULT_TOKEN.test(token || '')) throw failure('VIDEO_PLAN_RESULT_TOKEN_INVALID');
    let manifest;
    try { manifest = JSON.parse(readPrivate(path.join(paths.resultsRoot, `${token}.json`), MAX_QUEUE_BYTES).toString('utf8')); }
    catch (error) { if (error.code) throw error; throw failure('VIDEO_PLAN_RESULT_INVALID'); }
    exactKeys(manifest, [
        'schema_version', 'result_token', 'task_token', 'provider', 'mime_type', 'byte_length', 'sha256',
        'duration_seconds', 'width', 'height', 'source_provenance', 'linked_at', 'generation_executed',
    ], 'VIDEO_PLAN_RESULT_INVALID');
    if (manifest.schema_version !== RESULT_SCHEMA || manifest.result_token !== token
        || !TASK_TOKEN.test(manifest.task_token) || !PROVIDERS.has(manifest.provider)
        || manifest.mime_type !== 'video/mp4' || !SHA256.test(manifest.sha256)
        || !Number.isSafeInteger(manifest.byte_length) || manifest.byte_length <= 0
        || manifest.byte_length > MAX_RESULT_BYTES
        || !Number.isFinite(manifest.duration_seconds) || manifest.duration_seconds <= 0
        || !Number.isSafeInteger(manifest.width) || manifest.width <= 0
        || !Number.isSafeInteger(manifest.height) || manifest.height <= 0
        || typeof manifest.source_provenance !== 'string'
        || Buffer.byteLength(manifest.source_provenance, 'utf8') > 128
        || !Number.isFinite(Date.parse(manifest.linked_at))
        || manifest.generation_executed !== false) throw failure('VIDEO_PLAN_RESULT_INVALID');
    if (manifest.byte_length > MAX_PREVIEW_BYTES) throw failure('VIDEO_PLAN_RESULT_PREVIEW_TOO_LARGE');
    const buffer = readPrivate(path.join(paths.resultsRoot, `${token}.mp4`), MAX_PREVIEW_BYTES);
    if (buffer.byteLength !== manifest.byte_length || sha256(buffer) !== manifest.sha256) {
        throw failure('VIDEO_PLAN_RESULT_INVALID');
    }
    return { manifest, buffer };
}

// Main-process-only evidence for accepted-range authoring. Unlike the renderer
// preview path this validates the complete private result without loading it
// into memory or applying the 32 MiB preview ceiling.
function getValidatedVideoSelectionSources(context = {}) {
    const state = getNewProjectVideoPlan(context);
    if (state.status !== 'restored' || state.blockers.length || state.review_blockers.length) {
        throw failure(state.blockers[0] || state.review_blockers[0] || 'CLIP_SELECTION_VIDEO_PLAN_REQUIRED');
    }
    const decisions = new Map(state.review_decisions.map((item) => [item.task_token, item]));
    if (state.tasks.some((task) => task.status !== '결과연결' || !task.result_token
        || decisions.get(task.task_token)?.decision !== 'use')) {
        throw failure('CLIP_SELECTION_VIDEO_REVIEW_REQUIRED');
    }
    const paths = exactPaths(context.userDataPath);
    const sources = state.tasks.map((task) => {
        const manifestPath = path.join(paths.resultsRoot, `${task.result_token}.json`);
        let manifest;
        try { manifest = JSON.parse(readPrivate(manifestPath, MAX_QUEUE_BYTES).toString('utf8')); }
        catch (error) { if (error.code) throw error; throw failure('VIDEO_PLAN_RESULT_INVALID'); }
        exactKeys(manifest, [
            'schema_version', 'result_token', 'task_token', 'provider', 'mime_type', 'byte_length', 'sha256',
            'duration_seconds', 'width', 'height', 'source_provenance', 'linked_at', 'generation_executed',
        ], 'VIDEO_PLAN_RESULT_INVALID');
        if (manifest.schema_version !== RESULT_SCHEMA || manifest.result_token !== task.result_token
            || manifest.task_token !== task.task_token || manifest.provider !== task.provider
            || manifest.mime_type !== 'video/mp4' || !SHA256.test(manifest.sha256)
            || !Number.isSafeInteger(manifest.byte_length) || manifest.byte_length <= 0
            || manifest.byte_length > MAX_RESULT_BYTES
            || !Number.isFinite(manifest.duration_seconds) || manifest.duration_seconds <= 0
            || !Number.isSafeInteger(manifest.width) || manifest.width <= 0
            || !Number.isSafeInteger(manifest.height) || manifest.height <= 0
            || typeof manifest.source_provenance !== 'string'
            || Buffer.byteLength(manifest.source_provenance, 'utf8') > 128
            || !Number.isFinite(Date.parse(manifest.linked_at)) || manifest.generation_executed !== false) {
            throw failure('VIDEO_PLAN_RESULT_INVALID');
        }
        const evidence = hashPrivateResult(path.join(paths.resultsRoot, `${task.result_token}.mp4`));
        if (evidence.sha256 !== manifest.sha256 || evidence.byte_length !== manifest.byte_length) {
            throw failure('VIDEO_PLAN_RESULT_INVALID');
        }
        return {
            task_token: task.task_token,
            result_token: task.result_token,
            result_sha256: manifest.sha256,
            duration_seconds: manifest.duration_seconds,
            sequence: task.sequence,
            source_id: task.source_id,
            label: task.label,
        };
    });
    return {
        design_revision_sha256: state.design_revision_sha256,
        image_plan_revision_sha256: state.image_plan_revision_sha256,
        video_plan_revision_sha256: state.revision_sha256,
        sources,
    };
}

function getNewProjectVideoResultPreview(payload, context = {}) {
    exactKeys(payload, ['result_token'], 'VIDEO_PLAN_RESULT_PREVIEW_SHAPE_INVALID');
    try {
        const result = readResult(exactPaths(context.userDataPath), payload.result_token);
        return {
            ok: true,
            loaded: true,
            status: 'ready',
            result_token: result.manifest.result_token,
            mime_type: result.manifest.mime_type,
            byte_length: result.buffer.byteLength,
            base64: result.buffer.toString('base64'),
            blockers: [],
            executed: false,
            generation_executed: false,
        };
    } catch (error) {
        return {
            ok: false, loaded: false, status: 'blocked', result_token: '', mime_type: '', byte_length: 0,
            base64: '', blockers: [error.code || 'VIDEO_PLAN_RESULT_PREVIEW_BLOCKED'],
            executed: false, generation_executed: false,
        };
    }
}

function currentVideoUseDecisions(state, stored) {
    const tasks = new Map(state.tasks.map((task) => [task.task_token, task]));
    return stored.filter((decision) => {
        const task = tasks.get(decision.task_token);
        return decision.design_revision_sha256 === state.design_revision_sha256
            && decision.image_plan_revision_sha256 === state.image_plan_revision_sha256
            && task?.result_token === decision.result_token && task.status !== '재제작';
    });
}

function saveNewProjectVideoReviewDecision(payload, context = {}) {
    exactKeys(payload, [
        'task_token', 'decision', 'expected_design_revision_sha256',
        'expected_image_plan_revision_sha256', 'expected_video_plan_revision_sha256',
    ], 'VIDEO_PLAN_REVIEW_SHAPE_INVALID');
    if (!TASK_TOKEN.test(payload.task_token || '') || !['use', 'retry'].includes(payload.decision)) {
        throw failure('VIDEO_PLAN_REVIEW_DECISION_INVALID');
    }
    let state = requireSavedAlignedPlan(payload, context);
    const task = state.tasks.find((item) => item.task_token === payload.task_token);
    if (!task?.result_token) throw failure('VIDEO_PLAN_REVIEW_RESULT_REQUIRED');
    const paths = exactPaths(context.userDataPath);
    const stored = currentVideoUseDecisions(state, requireReviewDecisions(paths));
    const withoutTarget = stored.filter((decision) => decision.task_token !== task.task_token);

    if (payload.decision === 'retry') {
        writeReviewDecisions(paths, withoutTarget);
        if (task.status !== '재제작') {
            const tasks = state.tasks.map((item) => item.task_token === task.task_token
                ? { ...item, status: '재제작' } : item);
            writePlan(paths, state.design_revision_sha256, state.image_plan_revision_sha256, tasks);
        }
        return { ...getNewProjectVideoPlan(context), status: 'saved' };
    }

    if (task.status === '재제작') {
        const tasks = state.tasks.map((item) => item.task_token === task.task_token
            ? { ...item, status: '결과연결' } : item);
        writePlan(paths, state.design_revision_sha256, state.image_plan_revision_sha256, tasks);
        state = getNewProjectVideoPlan(context);
        if (!state.ok || state.blockers.length) throw failure(state.blockers[0] || 'VIDEO_PLAN_REVIEW_SAVE_FAILED');
    }
    const alreadyCurrent = state.review_decisions.some((decision) => (
        decision.task_token === task.task_token && decision.result_token === task.result_token
        && decision.decision === 'use'
    ));
    if (!alreadyCurrent) {
        writeReviewDecisions(paths, [
            ...currentVideoUseDecisions(state, withoutTarget),
            {
                task_token: task.task_token,
                result_token: task.result_token,
                design_revision_sha256: state.design_revision_sha256,
                image_plan_revision_sha256: state.image_plan_revision_sha256,
                decision: 'use',
                decided_at: new Date().toISOString(),
            },
        ]);
    }
    return { ...getNewProjectVideoPlan(context), status: 'saved' };
}

function saveNewProjectVideoRetrySelection(payload, context = {}) {
    exactKeys(payload, [
        'task_tokens', 'expected_design_revision_sha256', 'expected_image_plan_revision_sha256',
        'expected_video_plan_revision_sha256',
    ], 'VIDEO_PLAN_RETRY_SHAPE_INVALID');
    if (!Array.isArray(payload.task_tokens) || payload.task_tokens.some((token) => !TASK_TOKEN.test(token))
        || new Set(payload.task_tokens).size !== payload.task_tokens.length) throw failure('VIDEO_PLAN_RETRY_INVALID');
    const state = requireSavedAlignedPlan(payload, context);
    const selected = new Set(payload.task_tokens);
    for (const token of selected) {
        const task = state.tasks.find((item) => item.task_token === token);
        if (!task || !task.result_token) throw failure('VIDEO_PLAN_RETRY_RESULT_REQUIRED');
    }
    const paths = exactPaths(context.userDataPath);
    const changed = new Set(state.tasks.filter((task) => task.result_token
        && (task.status === '재제작') !== selected.has(task.task_token)).map((task) => task.task_token));
    const decisions = currentVideoUseDecisions(state, requireReviewDecisions(paths))
        .filter((decision) => !changed.has(decision.task_token));
    if (changed.size) writeReviewDecisions(paths, decisions);
    const tasks = state.tasks.map((task) => {
        if (!task.result_token) return task;
        return { ...task, status: selected.has(task.task_token) ? '재제작' : '결과연결' };
    });
    writePlan(paths, state.design_revision_sha256, state.image_plan_revision_sha256, tasks);
    return { ...getNewProjectVideoPlan(context), status: 'saved' };
}

module.exports = {
    PLAN_SCHEMA,
    PREPARATION_SCHEMA,
    RESULT_SCHEMA,
    PROVIDER_LABELS,
    exactPaths,
    deriveTasks,
    getNewProjectVideoPlan,
    saveNewProjectVideoPlan,
    prepareNewProjectVideoPlan,
    getNewProjectVideoResultWorkspace,
    connectNewProjectVideoResult,
    getNewProjectVideoResultPreview,
    getValidatedVideoSelectionSources,
    saveNewProjectVideoReviewDecision,
    saveNewProjectVideoRetrySelection,
};
