const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const newProjectDesignProvider = require('./newProjectDesignProvider');
const newProjectImagePlanProvider = require('./newProjectImagePlanProvider');
const newProjectVideoPlanProvider = require('./newProjectVideoPlanProvider');
const dstBundleImportProvider = require('./dstBundleImportProvider');
const videoResultImportProvider = require('./videoResultImportProvider');

const MANIFEST_SCHEMA = 'film_pipeline.new_project_execution.v1';
const RECEIPT_SCHEMA = 'film_pipeline.new_project_execution_receipt.v1';
const ROOT_DIRECTORY = 'execution';
const RUNS_DIRECTORY = 'runs';
const MANIFEST_FILE = 'manifest.json';
const RECEIPTS_DIRECTORY = 'receipts';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const TASK_TOKEN = /^task_[a-f0-9]{64}$/;
const PREPARATION_TOKEN = /^preparation_[a-f0-9]{64}$/;
const RUN_TOKEN = /^run_[a-f0-9]{64}$/;
const STATUS_LABELS = Object.freeze({
    queued: '대기', running: '진행 중', succeeded: '결과 도착', failed: '실패',
});
const FAILURE_LABELS = Object.freeze({
    AUTH_REQUIRED: '인증 필요',
    PROVIDER_UNAVAILABLE: '생성 도구 연결 불가',
    RATE_LIMITED: '요청이 많아 잠시 대기',
    GENERATION_FAILED: '생성 실패',
    RESULT_INVALID: '결과 확인 필요',
    CANCELLED: '중단됨',
    UNKNOWN: '원인 확인 필요',
});
const FAILURE_CODES = new Set(Object.keys(FAILURE_LABELS));
const DEFAULT_RUNTIME_PATHS = Object.freeze({
    dstPython: '/Users/jessiek/StudioProjects/deepSearchTeam/.venv/bin/python',
    dstModule: '/Users/jessiek/StudioProjects/deepSearchTeam/dst',
    flowText: '/Users/jessiek/StudioProjects/google_labs_flow_auto/scripts/flow_cdp_video_text_smoke.py',
    flowRefs: '/Users/jessiek/StudioProjects/google_labs_flow_auto/scripts/flow_cdp_video_refs_smoke.py',
    grokPython: '/Users/jessiek/.pyenv/versions/3.11.7/bin/python3',
    grokCli: '/Users/jessiek/StudioProjects/grok-auto/grok-browser/grok_imagine_bot.py',
});

function failure(code) {
    const error = new Error(code);
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

function text(value, maxBytes, code, { empty = false } = {}) {
    if (typeof value !== 'string' || value.includes('\0')) throw failure(code);
    const normalized = value.trim();
    if ((!empty && !normalized) || Buffer.byteLength(normalized, 'utf8') > maxBytes) throw failure(code);
    return normalized;
}

function exactPaths(userDataPath, runToken = '') {
    const design = newProjectDesignProvider.exactPaths(userDataPath);
    const root = path.join(design.draftRoot, ROOT_DIRECTORY);
    const runsRoot = path.join(root, RUNS_DIRECTORY);
    if (!runToken) return { draftRoot: design.draftRoot, root, runsRoot };
    if (!RUN_TOKEN.test(runToken)) throw failure('EXECUTION_RUN_TOKEN_INVALID');
    const runRoot = path.join(runsRoot, runToken);
    return {
        draftRoot: design.draftRoot, root, runsRoot, runRoot,
        manifestPath: path.join(runRoot, MANIFEST_FILE),
        receiptsRoot: path.join(runRoot, RECEIPTS_DIRECTORY),
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
    const parent = assertPrivateDirectory(parentPath, 'EXECUTION_PARENT_UNSAFE');
    try { fs.mkdirSync(directoryPath, { mode: 0o700 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const current = assertPrivateDirectory(directoryPath, 'EXECUTION_DIRECTORY_UNSAFE');
    if (current.dev !== parent.dev || path.dirname(fs.realpathSync.native(directoryPath)) !== parentPath) {
        throw failure('EXECUTION_DIRECTORY_UNSAFE');
    }
}

function ensureRunDirectories(paths) {
    assertPrivateDirectory(paths.draftRoot, 'EXECUTION_DRAFT_ROOT_UNSAFE');
    ensureDirectory(paths.root, paths.draftRoot);
    ensureDirectory(paths.runsRoot, paths.root);
    ensureDirectory(paths.runRoot, paths.runsRoot);
    ensureDirectory(paths.receiptsRoot, paths.runRoot);
}

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function readPrivate(filePath, maximum, missingCode) {
    let before;
    try { before = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') throw failure(missingCode);
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > maximum || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure('EXECUTION_FILE_UNSAFE');
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw failure('EXECUTION_FILE_CHANGED');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(filePath);
        if (buffer.byteLength !== before.size || !sameFile(opened, after) || !sameFile(opened, final)) {
            throw failure('EXECUTION_FILE_CHANGED');
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
    assertPrivateDirectory(parent, 'EXECUTION_DIRECTORY_UNSAFE');
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw failure('EXECUTION_WRITE_INVALID');
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW;
    if (exclusive) {
        const descriptor = fs.openSync(filePath, flags | fs.constants.O_EXCL, 0o600);
        try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
        fsyncDirectory(parent);
        return;
    }
    const temporary = path.join(parent, `.execution-${crypto.randomBytes(12).toString('hex')}.tmp`);
    const descriptor = fs.openSync(temporary, flags | fs.constants.O_EXCL, 0o600);
    try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    try {
        let current;
        try { current = fs.lstatSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current && (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o777) !== 0o600)) {
            throw failure('EXECUTION_FILE_UNSAFE');
        }
        fs.renameSync(temporary, filePath);
        fsyncDirectory(parent);
    } finally { try { fs.unlinkSync(temporary); } catch { /* renamed or removed */ } }
}

function availablePreparation(state) {
    return Boolean(state?.ok && state.status === 'restored' && !state.blockers?.length
        && state.preparation?.status === 'queued'
        && PREPARATION_TOKEN.test(state.preparation.preparation_token || ''));
}

function baseFromPlan(state, lane) {
    if (!availablePreparation(state)) return null;
    const selected = new Set(state.preparation.task_tokens);
    if (selected.size !== state.preparation.task_count) throw failure('EXECUTION_PREPARATION_INVALID');
    const source = state.tasks.filter((task) => selected.has(task.task_token));
    if (!source.length || source.length !== selected.size) throw failure('EXECUTION_PREPARATION_STALE');
    const resultByTask = new Map(state.tasks.map((task) => [task.task_token, task.result_token || '']));
    const tasks = source.map((task, index) => {
        const referenceTaskTokens = lane === 'image'
            ? Array.isArray(task.reference_task_ids) ? task.reference_task_ids : []
            : [task.reference_image_task_token].filter(Boolean);
        const referenceResultTokens = lane === 'image'
            ? referenceTaskTokens.map((token) => resultByTask.get(token)).filter(Boolean)
            : [task.reference_image_result_token].filter(Boolean);
        return {
        task_token: task.task_token, lane, kind: task.kind, sequence: index + 1, label: task.label,
        provider: lane === 'image' ? 'dst_image' : task.provider,
        provider_label: lane === 'image' ? 'DST 이미지' : task.provider_label,
        prompt: task.prompt, preparation_token: state.preparation.preparation_token,
            reference_task_tokens: referenceTaskTokens,
            reference_result_tokens: referenceResultTokens,
        };
    });
    const base = {
        lane,
        design_revision_sha256: state.design_revision_sha256,
        image_plan_revision_sha256: state.revision_sha256,
        video_plan_revision_sha256: lane === 'video' ? state.revision_sha256 : '',
        preparation_token: state.preparation.preparation_token,
        tasks,
    };
    if (lane === 'video') base.image_plan_revision_sha256 = state.image_plan_revision_sha256;
    if (!SHA256.test(base.design_revision_sha256 || '') || !SHA256.test(base.image_plan_revision_sha256 || '')
        || (base.video_plan_revision_sha256 && !SHA256.test(base.video_plan_revision_sha256))) {
        throw failure('EXECUTION_REVISION_INVALID');
    }
    return { ...base, preparation_revision_sha256: sha256(JSON.stringify(base)) };
}

function manifestFor(base, attempt, createdAt = new Date().toISOString()) {
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 1000) throw failure('EXECUTION_ATTEMPT_INVALID');
    const runRevision = sha256(JSON.stringify({
        preparation_revision_sha256: base.preparation_revision_sha256, attempt,
    }));
    return {
        schema_version: MANIFEST_SCHEMA, run_token: `run_${runRevision}`,
        run_revision_sha256: runRevision, preparation_revision_sha256: base.preparation_revision_sha256,
        attempt, lane: base.lane, design_revision_sha256: base.design_revision_sha256,
        image_plan_revision_sha256: base.image_plan_revision_sha256,
        video_plan_revision_sha256: base.video_plan_revision_sha256,
        preparation_token: base.preparation_token, tasks: base.tasks,
        external_call_performed: false, model_called: false, generation_executed: false,
        created_at: createdAt,
    };
}

function validateTask(task, lane, index) {
    exactKeys(task, [
        'task_token', 'lane', 'kind', 'sequence', 'label', 'provider', 'provider_label',
        'prompt', 'preparation_token', 'reference_task_tokens', 'reference_result_tokens',
    ], 'EXECUTION_MANIFEST_INVALID');
    if (!TASK_TOKEN.test(task.task_token || '') || task.lane !== lane || task.sequence !== index + 1
        || !PREPARATION_TOKEN.test(task.preparation_token || '')) throw failure('EXECUTION_MANIFEST_INVALID');
    text(task.kind, 64, 'EXECUTION_MANIFEST_INVALID');
    text(task.label, 1024, 'EXECUTION_MANIFEST_INVALID');
    text(task.provider, 64, 'EXECUTION_MANIFEST_INVALID');
    text(task.provider_label, 64, 'EXECUTION_MANIFEST_INVALID');
    text(task.prompt, 32 * 1024, 'EXECUTION_MANIFEST_INVALID');
    if (!Array.isArray(task.reference_task_tokens) || task.reference_task_tokens.length > 44
        || task.reference_task_tokens.some((token) => !TASK_TOKEN.test(token))
        || new Set(task.reference_task_tokens).size !== task.reference_task_tokens.length
        || !Array.isArray(task.reference_result_tokens) || task.reference_result_tokens.length > 44
        || task.reference_result_tokens.some((token) => !/^result_[a-f0-9]{64}$/.test(token))
        || new Set(task.reference_result_tokens).size !== task.reference_result_tokens.length) {
        throw failure('EXECUTION_MANIFEST_INVALID');
    }
    return task;
}

function validateManifest(value) {
    exactKeys(value, [
        'schema_version', 'run_token', 'run_revision_sha256', 'preparation_revision_sha256',
        'attempt', 'lane', 'design_revision_sha256', 'image_plan_revision_sha256',
        'video_plan_revision_sha256', 'preparation_token', 'tasks', 'external_call_performed',
        'model_called', 'generation_executed', 'created_at',
    ], 'EXECUTION_MANIFEST_INVALID');
    if (value.schema_version !== MANIFEST_SCHEMA || !RUN_TOKEN.test(value.run_token || '')
        || !SHA256.test(value.run_revision_sha256 || '') || !SHA256.test(value.preparation_revision_sha256 || '')
        || !Number.isSafeInteger(value.attempt) || value.attempt < 1 || value.attempt > 1000
        || !['image', 'video'].includes(value.lane) || !SHA256.test(value.design_revision_sha256 || '')
        || !SHA256.test(value.image_plan_revision_sha256 || '')
        || (value.video_plan_revision_sha256 && !SHA256.test(value.video_plan_revision_sha256))
        || !PREPARATION_TOKEN.test(value.preparation_token || '') || !Array.isArray(value.tasks) || !value.tasks.length
        || value.external_call_performed !== false || value.model_called !== false
        || value.generation_executed !== false || !Number.isFinite(Date.parse(value.created_at))) {
        throw failure('EXECUTION_MANIFEST_INVALID');
    }
    value.tasks.forEach((task, index) => validateTask(task, value.lane, index));
    const base = {
        lane: value.lane, design_revision_sha256: value.design_revision_sha256,
        image_plan_revision_sha256: value.image_plan_revision_sha256,
        video_plan_revision_sha256: value.video_plan_revision_sha256,
        preparation_token: value.preparation_token, tasks: value.tasks,
    };
    const baseRevision = sha256(JSON.stringify(base));
    const runRevision = sha256(JSON.stringify({ preparation_revision_sha256: baseRevision, attempt: value.attempt }));
    if (baseRevision !== value.preparation_revision_sha256 || runRevision !== value.run_revision_sha256
        || value.run_token !== `run_${runRevision}`) throw failure('EXECUTION_MANIFEST_INVALID');
    return value;
}

function loadManifest(paths) {
    let value;
    try { value = JSON.parse(readPrivate(paths.manifestPath, MAX_MANIFEST_BYTES, 'EXECUTION_MANIFEST_MISSING').toString('utf8')); }
    catch (error) { if (error.code) throw error; throw failure('EXECUTION_MANIFEST_INVALID'); }
    return validateManifest(value);
}

function listManifests(context = {}) {
    const roots = exactPaths(context.userDataPath);
    let rootStats;
    try { rootStats = fs.lstatSync(roots.root); } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw failure('EXECUTION_DIRECTORY_UNSAFE');
    assertPrivateDirectory(roots.root, 'EXECUTION_DIRECTORY_UNSAFE');
    let runsStats;
    try { runsStats = fs.lstatSync(roots.runsRoot); } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    if (!runsStats.isDirectory() || runsStats.isSymbolicLink()) throw failure('EXECUTION_DIRECTORY_UNSAFE');
    assertPrivateDirectory(roots.runsRoot, 'EXECUTION_DIRECTORY_UNSAFE');
    const entries = fs.readdirSync(roots.runsRoot, { withFileTypes: true });
    if (entries.length > 200 || entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink()
        || !RUN_TOKEN.test(entry.name))) throw failure('EXECUTION_HISTORY_UNSAFE');
    return entries.map((entry) => {
        const paths = exactPaths(context.userDataPath, entry.name);
        assertPrivateDirectory(paths.runRoot, 'EXECUTION_DIRECTORY_UNSAFE');
        assertPrivateDirectory(paths.receiptsRoot, 'EXECUTION_DIRECTORY_UNSAFE');
        const manifest = loadManifest(paths);
        return { paths, manifest };
    });
}

function planBases(context) {
    const image = (context.getNewProjectImagePlan || newProjectImagePlanProvider.getNewProjectImagePlan)(context);
    const video = (context.getNewProjectVideoPlan || newProjectVideoPlanProvider.getNewProjectVideoPlan)(context);
    return [baseFromPlan(image, 'image'), baseFromPlan(video, 'video')].filter(Boolean);
}

function selectLanes(context = {}) {
    const manifests = listManifests(context);
    const bases = new Map(planBases(context).map((base) => [base.lane, base]));
    return ['image', 'video'].flatMap((lane) => {
        const base = bases.get(lane);
        const candidates = manifests.filter(({ manifest }) => manifest.lane === lane
            && (!base || manifest.preparation_revision_sha256 === base.preparation_revision_sha256));
        candidates.sort((left, right) => right.manifest.attempt - left.manifest.attempt
            || String(right.manifest.created_at).localeCompare(String(left.manifest.created_at)));
        if (candidates.length) return [{ ...candidates[0], prepared: true }];
        if (base) {
            const manifest = manifestFor(base, 1);
            return [{ paths: exactPaths(context.userDataPath, manifest.run_token), manifest, prepared: false }];
        }
        const historical = manifests.filter(({ manifest }) => manifest.lane === lane)
            .sort((left, right) => String(right.manifest.created_at).localeCompare(String(left.manifest.created_at)));
        return historical.length ? [{ ...historical[0], prepared: true }] : [];
    });
}

function validateReceipt(value) {
    exactKeys(value, [
        'schema_version', 'run_revision_sha256', 'task_token', 'status', 'progress',
        'failure_code', 'result_received', 'result_locator', 'external_call_performed',
        'model_called', 'generation_executed', 'reported_at',
    ], 'EXECUTION_RECEIPT_INVALID');
    if (value.schema_version !== RECEIPT_SCHEMA || !SHA256.test(value.run_revision_sha256 || '')
        || !TASK_TOKEN.test(value.task_token || '') || !['running', 'succeeded', 'failed'].includes(value.status)
        || !Number.isInteger(value.progress) || value.progress < 0 || value.progress > 100
        || typeof value.result_received !== 'boolean' || typeof value.external_call_performed !== 'boolean'
        || typeof value.model_called !== 'boolean' || typeof value.generation_executed !== 'boolean'
        || (value.model_called && !value.external_call_performed)
        || (value.generation_executed && !value.model_called) || !Number.isFinite(Date.parse(value.reported_at))) {
        throw failure('EXECUTION_RECEIPT_INVALID');
    }
    const failureCode = text(value.failure_code, 64, 'EXECUTION_RECEIPT_INVALID', { empty: true });
    const locator = text(value.result_locator, 256, 'EXECUTION_RECEIPT_INVALID', { empty: true });
    if (locator && !/^[A-Za-z0-9._:-]+$/.test(locator)) throw failure('EXECUTION_RECEIPT_INVALID');
    if (value.status === 'running' && (value.progress >= 100 || failureCode || value.result_received || locator)) {
        throw failure('EXECUTION_RECEIPT_INVALID');
    }
    if (value.status === 'succeeded' && (value.progress !== 100 || failureCode || !value.result_received || !locator)) {
        throw failure('EXECUTION_RECEIPT_INVALID');
    }
    if (value.status === 'failed' && (!FAILURE_CODES.has(failureCode) || value.result_received || locator)) {
        throw failure('EXECUTION_RECEIPT_INVALID');
    }
    return { ...value, failure_code: failureCode, result_locator: locator };
}

function receiptPath(paths, taskToken) {
    if (!TASK_TOKEN.test(taskToken)) throw failure('EXECUTION_TASK_TOKEN_INVALID');
    return path.join(paths.receiptsRoot, `${taskToken}.json`);
}

function loadReceipt(paths, taskToken, { missing = true } = {}) {
    try {
        const value = JSON.parse(readPrivate(receiptPath(paths, taskToken), MAX_RECEIPT_BYTES, 'EXECUTION_RECEIPT_MISSING').toString('utf8'));
        return validateReceipt(value);
    } catch (error) {
        if (missing && error.code === 'EXECUTION_RECEIPT_MISSING') return null;
        if (error.code) throw error;
        throw failure('EXECUTION_RECEIPT_INVALID');
    }
}

function laneReceipts(selection) {
    return selection.prepared
        ? selection.manifest.tasks.map((task) => loadReceipt(selection.paths, task.task_token))
        : selection.manifest.tasks.map(() => null);
}

function aggregateStatus(counts, total) {
    if (counts.failed) return 'failed';
    if (counts.succeeded === total) return 'succeeded';
    if (counts.running || counts.succeeded) return 'running';
    return 'queued';
}

function regularFile(filePath) {
    try {
        const resolved = fs.realpathSync.native(filePath);
        return path.isAbsolute(resolved) && fs.statSync(resolved).isFile();
    } catch { return false; }
}

function realDirectory(directoryPath) {
    try {
        const stats = fs.lstatSync(directoryPath);
        return stats.isDirectory() && !stats.isSymbolicLink() && fs.realpathSync.native(directoryPath) === directoryPath;
    } catch { return false; }
}

function providerReadiness(task, context = {}) {
    const runtime = { ...DEFAULT_RUNTIME_PATHS, ...(context.runtimePaths || {}) };
    if (task.lane === 'image') {
        const installed = regularFile(runtime.dstPython) && realDirectory(runtime.dstModule);
        return {
            provider_readiness: installed ? 'result_ready_live_blocked' : 'runtime_missing',
            provider_status_label: installed ? '결과 확인 준비됨 · 생성 연결 전' : '이미지 도구 준비 필요',
        };
    }
    if (task.provider === 'flow') {
        const installed = regularFile(runtime.flowText) && regularFile(runtime.flowRefs);
        return {
            provider_readiness: installed ? 'reference_contract_blocked' : 'runtime_missing',
            provider_status_label: installed ? '참조 방식 준비 필요' : '플로우 도구 준비 필요',
        };
    }
    if (task.provider === 'grok') {
        const installed = regularFile(runtime.grokPython) && regularFile(runtime.grokCli);
        return {
            provider_readiness: installed ? 'preview_ready_live_blocked' : 'runtime_missing',
            provider_status_label: installed ? '로컬 명령 확인됨 · 생성 연결 전' : '그록 도구 준비 필요',
        };
    }
    if (task.provider === 'replicate') {
        return { provider_readiness: 'result_only', provider_status_label: '결과 영수증 확인 가능 · 생성 연결 전' };
    }
    return { provider_readiness: 'adapter_missing', provider_status_label: '직접 생성 연결 없음' };
}

function resultIndexes(context, needsImage, needsVideo) {
    const image = new Map();
    const video = new Map();
    if (needsImage) {
        image.set('resolve', context.resolveDstExecutionResultLocator
            || dstBundleImportProvider.resolveDstExecutionResultLocator);
    }
    if (needsVideo) {
        video.set('resolve', context.resolveVideoExecutionResultLocator
            || videoResultImportProvider.resolveVideoExecutionResultLocator);
    }
    return { image, video };
}

function connectedTaskTokens(context = {}) {
    const connected = new Set();
    for (const load of [
        context.getNewProjectImagePlan || newProjectImagePlanProvider.getNewProjectImagePlan,
        context.getNewProjectVideoPlan || newProjectVideoPlanProvider.getNewProjectVideoPlan,
    ]) {
        try {
            const state = load(context);
            for (const task of Array.isArray(state?.tasks) ? state.tasks : []) {
                if (task.result_token && task.status === '결과연결') connected.add(task.task_token);
            }
        } catch { /* current workbench may not be ready yet */ }
    }
    return connected;
}

function publicSelections(selections, context = {}) {
    const tasks = [];
    for (const selection of selections) {
        const receipts = laneReceipts(selection);
        selection.manifest.tasks.forEach((task, index) => {
            const receipt = receipts[index];
            const status = receipt?.status || 'queued';
            tasks.push({
                task_token: task.task_token, lane: task.lane, kind: task.kind, sequence: task.sequence,
                label: task.label, provider_label: task.provider_label, status, status_label: STATUS_LABELS[status],
                progress: receipt?.progress || 0, failure_label: receipt?.failure_code ? FAILURE_LABELS[receipt.failure_code] : '',
                result_received: status === 'succeeded',
                external_call_performed: receipt?.external_call_performed || false,
                model_called: receipt?.model_called || false,
                generation_executed: receipt?.generation_executed || false,
                result_locator: receipt?.result_locator || '',
                ...providerReadiness(task, context),
            });
        });
    }
    const indexes = resultIndexes(
        context,
        tasks.some((task) => task.lane === 'image' && task.status === 'succeeded'),
        tasks.some((task) => task.lane === 'video' && task.status === 'succeeded'),
    );
    const connected = connectedTaskTokens(context);
    for (const task of tasks) {
        let match = null;
        if (task.status === 'succeeded') {
            const resolver = (task.lane === 'image' ? indexes.image : indexes.video).get('resolve');
            try { match = typeof resolver === 'function' ? resolver(task.result_locator, context) : null; } catch { match = null; }
        }
        const candidateToken = connected.has(task.task_token) ? '' : match?.candidate_token || '';
        task.workbench_connected = connected.has(task.task_token);
        task.result_match_status = task.status === 'succeeded'
            ? task.workbench_connected ? 'connected' : candidateToken ? 'ready' : 'waiting'
            : '';
        task.result_candidate_token = candidateToken;
        task.result_image_index = !task.workbench_connected && task.lane === 'image' && Number.isSafeInteger(match?.image_index)
            ? match.image_index : 0;
        delete task.result_locator;
    }
    const counts = Object.fromEntries(Object.keys(STATUS_LABELS)
        .map((status) => [status, tasks.filter((task) => task.status === status).length]));
    const status = aggregateStatus(counts, tasks.length);
    return {
        ok: true, status, status_label: STATUS_LABELS[status],
        prepared: selections.length > 0 && selections.every((selection) => selection.prepared),
        revision_sha256: sha256(JSON.stringify(selections.map(({ manifest }) => manifest.run_revision_sha256))),
        task_count: tasks.length, tasks, summary: counts,
        external_call_performed: tasks.some((task) => task.external_call_performed),
        model_called: tasks.some((task) => task.model_called),
        generation_executed: tasks.some((task) => task.generation_executed),
        blockers: [],
    };
}

function blockedState(code) {
    return {
        ok: false, status: 'blocked', status_label: '준비 필요', prepared: false,
        revision_sha256: '', task_count: 0, tasks: [],
        summary: { queued: 0, running: 0, succeeded: 0, failed: 0 },
        external_call_performed: false, model_called: false, generation_executed: false,
        blockers: [code],
    };
}

function getNewProjectExecutionState(context = {}) {
    try {
        const selections = selectLanes(context);
        if (!selections.length) throw failure('EXECUTION_PREPARATION_REQUIRED');
        return publicSelections(selections, context);
    } catch (error) { return blockedState(error.code || 'EXECUTION_STATE_BLOCKED'); }
}

function materialize(selection) {
    if (selection.prepared) return { ...selection, alreadyPrepared: true };
    ensureRunDirectories(selection.paths);
    const record = selection.manifest;
    try {
        privateWrite(selection.paths.manifestPath, Buffer.from(`${JSON.stringify(record, null, 2)}\n`), { exclusive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const loaded = loadManifest(selection.paths);
    if (loaded.run_revision_sha256 !== record.run_revision_sha256) throw failure('EXECUTION_MANIFEST_CONFLICT');
    return { paths: selection.paths, manifest: loaded, prepared: true, alreadyPrepared: false };
}

function prepareNewProjectExecution(payload, context = {}) {
    exactKeys(payload, ['expected_revision_sha256', 'new_attempt'], 'EXECUTION_PREPARE_SHAPE_INVALID');
    if (typeof payload.new_attempt !== 'boolean') throw failure('EXECUTION_PREPARE_SHAPE_INVALID');
    let selections = selectLanes(context);
    if (!selections.length) throw failure('EXECUTION_PREPARATION_REQUIRED');
    const current = publicSelections(selections, context);
    if (!SHA256.test(payload.expected_revision_sha256 || '')
        || payload.expected_revision_sha256 !== current.revision_sha256) throw failure('EXECUTION_REVISION_STALE');
    if (payload.new_attempt) {
        const laneStates = selections.map((selection) => ({ selection, state: publicSelections([selection], context) }));
        if (laneStates.some(({ state }) => state.summary.failed > 0 && state.summary.failed < state.task_count)) {
            throw failure('EXECUTION_RETRY_PREPARATION_REQUIRED');
        }
        const retryable = laneStates.filter(({ selection, state }) => selection.prepared
            && state.summary.failed === state.task_count).map(({ selection }) => selection);
        if (!retryable.length) throw failure('EXECUTION_RETRY_NOT_AVAILABLE');
        selections = selections.map((selection) => {
            if (!retryable.includes(selection)) return selection;
            const manifest = manifestFor({
                lane: selection.manifest.lane,
                design_revision_sha256: selection.manifest.design_revision_sha256,
                image_plan_revision_sha256: selection.manifest.image_plan_revision_sha256,
                video_plan_revision_sha256: selection.manifest.video_plan_revision_sha256,
                preparation_token: selection.manifest.preparation_token,
                tasks: selection.manifest.tasks,
                preparation_revision_sha256: selection.manifest.preparation_revision_sha256,
            }, selection.manifest.attempt + 1);
            return { paths: exactPaths(context.userDataPath, manifest.run_token), manifest, prepared: false };
        });
    }
    const materialized = selections.map(materialize);
    return {
        ...publicSelections(materialized, context),
        already_prepared: materialized.every((selection) => selection.alreadyPrepared),
    };
}

function acquireLock(paths) {
    const lockPath = path.join(paths.runRoot, '.publish.lock');
    const open = () => {
        const descriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT
            | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        try {
            fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
            fs.fsyncSync(descriptor);
            fsyncDirectory(paths.runRoot);
            return descriptor;
        } catch (error) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
            try { fs.unlinkSync(lockPath); } catch { /* best-effort cleanup */ }
            throw error;
        }
    };
    let descriptor;
    try { descriptor = open(); } catch (error) {
        if (error.code === 'EEXIST') throw failure('EXECUTION_RECEIPT_LOCKED');
        throw error;
    }
    return () => {
        try { fs.closeSync(descriptor); } finally {
            try { fs.unlinkSync(lockPath); fsyncDirectory(paths.runRoot); } catch { /* best-effort unlock */ }
        }
    };
}

function assertSelectedRun(receipt, context) {
    const paths = exactPaths(context.userDataPath, `run_${receipt.run_revision_sha256}`);
    const manifest = loadManifest(paths);
    const selected = selectLanes(context).find((item) => item.manifest.lane === manifest.lane);
    if (!selected || !selected.prepared
        || selected.manifest.run_revision_sha256 !== manifest.run_revision_sha256) throw failure('EXECUTION_REVISION_STALE');
    return { paths, manifest };
}

function publishExecutionReceipt(payload, context = {}) {
    const receipt = validateReceipt(payload);
    const { paths, manifest } = assertSelectedRun(receipt, context);
    const taskIndex = manifest.tasks.findIndex((task) => task.task_token === receipt.task_token);
    if (taskIndex < 0) throw failure('EXECUTION_TASK_UNKNOWN');
    const release = acquireLock(paths);
    try {
        const receipts = manifest.tasks.map((task) => loadReceipt(paths, task.task_token));
        const prior = receipts[taskIndex];
        if (prior && JSON.stringify(prior) === JSON.stringify(receipt)) {
            return { ok: true, already_published: true, state: publicSelections(selectLanes(context), context) };
        }
        if (prior && Date.parse(receipt.reported_at) <= Date.parse(prior.reported_at)) {
            throw failure('EXECUTION_RECEIPT_TIMESTAMP_STALE');
        }
        if (prior) {
            const comparable = (value) => JSON.stringify({ ...value, reported_at: '' });
            if (comparable(prior) === comparable(receipt)) {
                return { ok: true, already_published: true, state: publicSelections(selectLanes(context), context) };
            }
        }
        const active = receipts.filter((item) => item?.status === 'running');
        if (!prior) {
            const nextIndex = receipts.findIndex((item) => !item || !['succeeded', 'failed'].includes(item.status));
            if (receipt.status !== 'running' || taskIndex !== nextIndex || active.length) {
                throw failure('EXECUTION_RECEIPT_SEQUENCE_INVALID');
            }
        } else {
            if (prior.status !== 'running' || active.length !== 1 || active[0].task_token !== receipt.task_token
                || receipt.progress < prior.progress
                || (prior.external_call_performed && !receipt.external_call_performed)
                || (prior.model_called && !receipt.model_called)
                || (prior.generation_executed && !receipt.generation_executed)) {
                throw failure('EXECUTION_RECEIPT_TRANSITION_INVALID');
            }
        }
        if (receipt.status === 'succeeded') {
            const task = manifest.tasks[taskIndex];
            const expectedProvider = task.lane === 'image' ? 'dst' : task.provider;
            if (!receipt.result_locator.startsWith(`${expectedProvider}:`)) {
                throw failure('EXECUTION_RESULT_PROVIDER_MISMATCH');
            }
        }
        privateWrite(receiptPath(paths, receipt.task_token), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
        return { ok: true, already_published: false, state: publicSelections(selectLanes(context), context) };
    } finally { release(); }
}

function inspectExecutionHandoff(context = {}, options = {}) {
    exactKeys(options, ['new_attempt'], 'EXECUTION_INSPECT_SHAPE_INVALID');
    if (typeof options.new_attempt !== 'boolean') throw failure('EXECUTION_INSPECT_SHAPE_INVALID');
    let selections = selectLanes(context);
    if (!selections.length) throw failure('EXECUTION_PREPARATION_REQUIRED');
    if (options.new_attempt || selections.some((selection) => !selection.prepared)) {
        prepareNewProjectExecution({
            expected_revision_sha256: publicSelections(selections, context).revision_sha256,
            new_attempt: options.new_attempt,
        }, context);
        selections = selectLanes(context);
    }
    return {
        schema_version: 'film_pipeline.new_project_execution_handoff.v1',
        tasks: selections.flatMap((selection) => selection.manifest.tasks.map((task) => ({
            ...task, run_revision_sha256: selection.manifest.run_revision_sha256,
            attempt: selection.manifest.attempt,
        }))),
        receipts: selections.flatMap((selection) => laneReceipts(selection).filter(Boolean)),
        external_call_performed: false, model_called: false, generation_executed: false,
    };
}

function getNewProjectExecutionHistory(context = {}) {
    try {
        const runs = listManifests(context).sort((left, right) =>
            String(right.manifest.created_at).localeCompare(String(left.manifest.created_at)));
        return {
            ok: true,
            runs: runs.map((run) => ({
                lane: run.manifest.lane, attempt: run.manifest.attempt,
                ...publicSelections([{ ...run, prepared: true }], context),
            })),
            blockers: [],
        };
    } catch (error) { return { ok: false, runs: [], blockers: [error.code || 'EXECUTION_HISTORY_BLOCKED'] }; }
}

module.exports = {
    MANIFEST_SCHEMA,
    RECEIPT_SCHEMA,
    STATUS_LABELS,
    FAILURE_CODES,
    FAILURE_LABELS,
    exactPaths,
    getNewProjectExecutionState,
    prepareNewProjectExecution,
    publishExecutionReceipt,
    inspectExecutionHandoff,
    getNewProjectExecutionHistory,
};
