const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const newProjectDraftProvider = require('./newProjectDraftProvider');
const newProjectDesignProvider = require('./newProjectDesignProvider');
const newProjectImagePlanProvider = require('./newProjectImagePlanProvider');
const newProjectVideoPlanProvider = require('./newProjectVideoPlanProvider');
const dstBundleImportProvider = require('./dstBundleImportProvider');
const videoResultImportProvider = require('./videoResultImportProvider');
const providerExecutionPreview = require('./newProjectProviderExecutionPreview');
const replicateExecutionAdapter = require('./replicateExecutionAdapter');

const LEGACY_MANIFEST_SCHEMA = 'film_pipeline.new_project_execution.v1';
const MANIFEST_SCHEMA = 'film_pipeline.new_project_execution.v2';
const RECEIPT_SCHEMA = 'film_pipeline.new_project_execution_receipt.v1';
const ROOT_DIRECTORY = 'execution';
const RUNS_DIRECTORY = 'runs';
const MANIFEST_FILE = 'manifest.json';
const RECEIPTS_DIRECTORY = 'receipts';
const REFERENCES_DIRECTORY = 'references';
const OUTPUTS_DIRECTORY = 'outputs';
const REFERENCES_MANIFEST_FILE = 'manifest.json';
const REFERENCES_SCHEMA = 'film_pipeline.new_project_execution_references.v1';
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCES_MANIFEST_BYTES = 1024 * 1024;
const MAX_OUTPUT_CLAIM_BYTES = 8 * 1024;
const MAX_REPLICATE_SUBMISSION_BYTES = 8 * 1024;
const MAX_REPLICATE_COMPLETION_BYTES = 8 * 1024;
const MAX_REPLICATE_UNCERTAIN_BYTES = 4 * 1024;
const REPLICATE_LOCK_TTL_MS = 15 * 60 * 1000;
const REPLICATE_LOCK_TIME_SKEW_MS = 2000;
const REPLICATE_CLAIM_SCHEMA = 'film_pipeline.replicate_output_claim.v1';
const REPLICATE_DOWNLOAD_RESULT_SCHEMA = 'film_pipeline.replicate_download_result.v1';
const REPLICATE_SUBMISSION_SCHEMA = 'film_pipeline.replicate_submission.v1';
const REPLICATE_COMPLETION_SCHEMA = 'film_pipeline.replicate_completion.v1';
const REPLICATE_UNCERTAIN_SCHEMA = 'film_pipeline.replicate_uncertain_submission.v1';
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
        referencesRoot: path.join(runRoot, REFERENCES_DIRECTORY),
        referencesManifestPath: path.join(runRoot, REFERENCES_DIRECTORY, REFERENCES_MANIFEST_FILE),
        outputsRoot: path.join(runRoot, OUTPUTS_DIRECTORY),
        flowPreflightRoot: path.join(runRoot, 'flow-preflight'),
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

function ensureReferencesDirectory(paths) {
    ensureRunDirectories(paths);
    ensureDirectory(paths.referencesRoot, paths.runRoot);
}

function executionOutputPath(paths, taskToken) {
    if (!TASK_TOKEN.test(taskToken || '')) throw failure('EXECUTION_TASK_TOKEN_INVALID');
    return path.join(paths.outputsRoot, `${taskToken}.mp4`);
}

function flowPreflightOutputDirectory(paths, taskToken) {
    if (!TASK_TOKEN.test(taskToken || '')) throw failure('EXECUTION_TASK_TOKEN_INVALID');
    return path.join(paths.flowPreflightRoot, taskToken);
}

function replicateClaimPath(paths, taskToken) {
    if (!TASK_TOKEN.test(taskToken || '')) throw failure('EXECUTION_TASK_TOKEN_INVALID');
    return path.join(paths.outputsRoot, `${taskToken}.claim.json`);
}

function replicateSubmissionPath(paths, taskToken) {
    if (!TASK_TOKEN.test(taskToken || '')) throw failure('EXECUTION_TASK_TOKEN_INVALID');
    return path.join(paths.outputsRoot, `${taskToken}.replicate-submission.json`);
}

function replicateCompletionPath(paths, taskToken) {
    if (!TASK_TOKEN.test(taskToken || '')) throw failure('EXECUTION_TASK_TOKEN_INVALID');
    return path.join(paths.outputsRoot, `${taskToken}.replicate-completion.json`);
}

function validateReplicateSubmission(value, expectedBinding) {
    exactKeys(value, [
        'schema_version', 'run_revision_sha256', 'task_token', 'request_revision_sha256',
        'output_claim_sha256', 'prediction_id', 'get_url', 'submitted_at',
    ], 'EXECUTION_REPLICATE_SUBMISSION_INVALID');
    if (value.schema_version !== REPLICATE_SUBMISSION_SCHEMA
        || value.run_revision_sha256 !== expectedBinding.run_revision_sha256
        || value.task_token !== expectedBinding.task_token
        || value.request_revision_sha256 !== expectedBinding.request_revision_sha256
        || value.output_claim_sha256 !== expectedBinding.output_claim_sha256
        || !/^[A-Za-z0-9_-]{1,160}$/.test(value.prediction_id || '')
        || typeof value.get_url !== 'string' || Buffer.byteLength(value.get_url, 'utf8') > 2048
        || typeof value.submitted_at !== 'string' || Buffer.byteLength(value.submitted_at, 'utf8') > 64
        || !Number.isFinite(Date.parse(value.submitted_at))) {
        throw failure('EXECUTION_REPLICATE_SUBMISSION_INVALID');
    }
    return value;
}

function loadReplicateSubmission(selection, task, expectedBinding, { missing = true } = {}) {
    try {
        const value = JSON.parse(readPrivate(
            replicateSubmissionPath(selection.paths, task.task_token),
            MAX_REPLICATE_SUBMISSION_BYTES,
            'EXECUTION_REPLICATE_SUBMISSION_MISSING',
        ).toString('utf8'));
        return validateReplicateSubmission(value, expectedBinding);
    } catch (error) {
        if (missing && error.code === 'EXECUTION_REPLICATE_SUBMISSION_MISSING') return null;
        if (error.code) throw error;
        throw failure('EXECUTION_REPLICATE_SUBMISSION_INVALID');
    }
}

function publishReplicateSubmission(selection, task, binding, submission) {
    const record = validateReplicateSubmission({
        schema_version: REPLICATE_SUBMISSION_SCHEMA,
        ...binding,
        prediction_id: submission.prediction_id,
        get_url: submission.get_url,
        submitted_at: submission.submitted_at,
    }, binding);
    const submissionPath = replicateSubmissionPath(selection.paths, task.task_token);
    try {
        privateWrite(submissionPath, Buffer.from(`${JSON.stringify(record, null, 2)}\n`), { exclusive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const loaded = loadReplicateSubmission(selection, task, binding, { missing: false });
    if (JSON.stringify(loaded) !== JSON.stringify(record)) {
        throw failure('EXECUTION_REPLICATE_SUBMISSION_CONFLICT');
    }
    return loaded;
}

function loadReplicateCompletion(selection, task, binding, { missing = true } = {}) {
    try {
        const value = JSON.parse(readPrivate(
            replicateCompletionPath(selection.paths, task.task_token),
            MAX_REPLICATE_COMPLETION_BYTES,
            'EXECUTION_REPLICATE_COMPLETION_MISSING',
        ).toString('utf8'));
        exactKeys(value, [
            'schema_version', 'run_revision_sha256', 'task_token', 'request_revision_sha256',
            'output_claim_sha256', 'prediction_id', 'completed_at',
            'output_url_sha256', 'recorded_at',
        ], 'EXECUTION_REPLICATE_COMPLETION_INVALID');
        if (value.schema_version !== REPLICATE_COMPLETION_SCHEMA
            || value.run_revision_sha256 !== binding.run_revision_sha256
            || value.task_token !== binding.task_token
            || value.request_revision_sha256 !== binding.request_revision_sha256
            || value.output_claim_sha256 !== binding.output_claim_sha256
            || !/^[A-Za-z0-9_-]{1,160}$/.test(value.prediction_id || '')
            || !SHA256.test(value.output_url_sha256 || '')
            || typeof value.completed_at !== 'string' || Buffer.byteLength(value.completed_at, 'utf8') > 64
            || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.completed_at)
            || !Number.isFinite(Date.parse(value.completed_at))
            || typeof value.recorded_at !== 'string' || Buffer.byteLength(value.recorded_at, 'utf8') > 64
            || !Number.isFinite(Date.parse(value.recorded_at))) {
            throw failure('EXECUTION_REPLICATE_COMPLETION_INVALID');
        }
        return value;
    } catch (error) {
        if (missing && error.code === 'EXECUTION_REPLICATE_COMPLETION_MISSING') return null;
        if (error.code) throw error;
        throw failure('EXECUTION_REPLICATE_COMPLETION_INVALID');
    }
}

function publishReplicateCompletionRecord(selection, task, binding, value) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(value?.prediction_id || '')
        || typeof value.output_url !== 'string' || !value.output_url
        || typeof value.completed_at !== 'string' || !Number.isFinite(Date.parse(value.completed_at))) {
        throw failure('EXECUTION_REPLICATE_COMPLETION_INVALID');
    }
    const expected = {
        schema_version: REPLICATE_COMPLETION_SCHEMA,
        ...binding,
        prediction_id: value.prediction_id,
        completed_at: value.completed_at,
        output_url_sha256: sha256(value.output_url),
    };
    const existing = loadReplicateCompletion(selection, task, binding);
    if (existing) {
        const comparable = ({ recorded_at: ignored, ...record }) => record;
        if (JSON.stringify(comparable(existing)) !== JSON.stringify(expected)) {
            throw failure('EXECUTION_REPLICATE_COMPLETION_CONFLICT');
        }
        return existing;
    }
    const record = { ...expected, recorded_at: new Date().toISOString() };
    try {
        privateWrite(
            replicateCompletionPath(selection.paths, task.task_token),
            Buffer.from(`${JSON.stringify(record, null, 2)}\n`),
            { exclusive: true },
        );
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const loaded = loadReplicateCompletion(selection, task, binding, { missing: false });
    const comparable = ({ recorded_at: ignored, ...stored }) => stored;
    if (JSON.stringify(comparable(loaded)) !== JSON.stringify(expected)) {
        throw failure('EXECUTION_REPLICATE_COMPLETION_CONFLICT');
    }
    return loaded;
}

function replicateUncertainPath(selection, task, requestRevision) {
    if (!TASK_TOKEN.test(task.task_token || '') || !SHA256.test(requestRevision || '')) {
        throw failure('EXECUTION_REPLICATE_UNCERTAIN_INVALID');
    }
    return path.join(selection.paths.root,
        `.replicate-uncertain-${task.task_token}-${requestRevision.slice(0, 24)}.json`);
}

function loadReplicateUncertain(selection, task, requestRevision, { missing = true } = {}) {
    try {
        const value = JSON.parse(readPrivate(
            replicateUncertainPath(selection, task, requestRevision),
            MAX_REPLICATE_UNCERTAIN_BYTES,
            'EXECUTION_REPLICATE_UNCERTAIN_MISSING',
        ).toString('utf8'));
        exactKeys(value, [
            'schema_version', 'task_token', 'request_revision_sha256',
            'uncertain_run_revision_sha256', 'created_at',
        ], 'EXECUTION_REPLICATE_UNCERTAIN_INVALID');
        if (value.schema_version !== REPLICATE_UNCERTAIN_SCHEMA
            || value.task_token !== task.task_token
            || value.request_revision_sha256 !== requestRevision
            || !SHA256.test(value.uncertain_run_revision_sha256 || '')
            || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at))) {
            throw failure('EXECUTION_REPLICATE_UNCERTAIN_INVALID');
        }
        return value;
    } catch (error) {
        if (missing && error.code === 'EXECUTION_REPLICATE_UNCERTAIN_MISSING') return null;
        if (error.code) throw error;
        throw failure('EXECUTION_REPLICATE_UNCERTAIN_INVALID');
    }
}

function publishReplicateUncertain(selection, task, requestRevision) {
    const existing = loadReplicateUncertain(selection, task, requestRevision);
    if (existing) return existing;
    const record = {
        schema_version: REPLICATE_UNCERTAIN_SCHEMA,
        task_token: task.task_token,
        request_revision_sha256: requestRevision,
        uncertain_run_revision_sha256: selection.manifest.run_revision_sha256,
        created_at: new Date().toISOString(),
    };
    try {
        privateWrite(
            replicateUncertainPath(selection, task, requestRevision),
            Buffer.from(`${JSON.stringify(record, null, 2)}\n`),
            { exclusive: true },
        );
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    return loadReplicateUncertain(selection, task, requestRevision, { missing: false });
}

function replicateRequestPreview(selection, task, referencesByTask, outputPath, context) {
    const preview = providerExecutionPreview.buildProviderExecutionPreview({
        ...task,
        aspect_ratio: selection.manifest.aspect_ratio,
        reference_files: referencesByTask.get(task.task_token) || [],
        output_path: outputPath,
    }, context);
    if (preview.readiness !== 'preview_ready' || preview.blockers.length
        || !SHA256.test(preview.request_spec?.request_revision_sha256 || '')) {
        throw failure('EXECUTION_REPLICATE_REQUEST_INVALID');
    }
    return preview;
}

function replicateClaimRecord(selection, task, requestRevision) {
    return {
        schema_version: REPLICATE_CLAIM_SCHEMA,
        run_revision_sha256: selection.manifest.run_revision_sha256,
        task_token: task.task_token,
        request_revision_sha256: requestRevision,
        output_basename: `${task.task_token}.mp4`,
    };
}

function loadReplicateClaim(selection, task, expected) {
    const claimPath = replicateClaimPath(selection.paths, task.task_token);
    let value;
    try {
        value = JSON.parse(readPrivate(claimPath, MAX_OUTPUT_CLAIM_BYTES,
            'EXECUTION_REPLICATE_CLAIM_MISSING').toString('utf8'));
    } catch (error) {
        if (error.code) throw error;
        throw failure('EXECUTION_REPLICATE_CLAIM_INVALID');
    }
    exactKeys(value, [
        'schema_version', 'run_revision_sha256', 'task_token',
        'request_revision_sha256', 'output_basename',
    ], 'EXECUTION_REPLICATE_CLAIM_INVALID');
    if (value.schema_version !== REPLICATE_CLAIM_SCHEMA || JSON.stringify(value) !== JSON.stringify(expected)) {
        throw failure('EXECUTION_REPLICATE_CLAIM_CONFLICT');
    }
    return claimPath;
}

function publishReplicateClaim(selection, task, preview) {
    const record = replicateClaimRecord(selection, task, preview.request_spec.request_revision_sha256);
    const claimPath = replicateClaimPath(selection.paths, task.task_token);
    try {
        privateWrite(claimPath, Buffer.from(`${JSON.stringify(record, null, 2)}\n`), { exclusive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try { return loadReplicateClaim(selection, task, record); } catch (error) {
            if (!['EXECUTION_REPLICATE_CLAIM_MISSING', 'EXECUTION_REPLICATE_CLAIM_INVALID',
                'EXECUTION_FILE_UNSAFE', 'EXECUTION_FILE_CHANGED']
                .includes(error.code) || attempt === 19) throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
    }
    throw failure('EXECUTION_REPLICATE_CLAIM_INVALID');
}

function replicateExecutionBinding(selection, task, context = {}) {
    const referencesByTask = referenceFilesByTask(
        selection.manifest,
        loadReferenceCommit(selection.paths, selection.manifest),
    );
    const outputPath = executionOutputPath(selection.paths, task.task_token);
    const preview = replicateRequestPreview(selection, task, referencesByTask, outputPath, context);
    const claimRecord = replicateClaimRecord(
        selection,
        task,
        preview.request_spec.request_revision_sha256,
    );
    const claimPath = loadReplicateClaim(selection, task, claimRecord);
    const claimBytes = readPrivate(claimPath, MAX_OUTPUT_CLAIM_BYTES, 'EXECUTION_REPLICATE_CLAIM_MISSING');
    return {
        run_revision_sha256: selection.manifest.run_revision_sha256,
        task_token: task.task_token,
        request_revision_sha256: preview.request_spec.request_revision_sha256,
        output_claim_sha256: sha256(claimBytes),
    };
}

function loadExecutionOutputTargets(selection, context = {}, referencesByTask = new Map()) {
    if (selection.manifest.lane !== 'video') return new Map();
    assertPrivateDirectory(selection.paths.outputsRoot, 'EXECUTION_OUTPUT_DIRECTORY_UNSAFE');
    const targets = new Map();
    const requiredNames = new Set(selection.manifest.tasks
        .filter((task) => task.provider === 'replicate')
        .map((task) => `${task.task_token}.claim.json`));
    const allowedNames = new Set(requiredNames);
    selection.manifest.tasks.filter((task) => task.provider === 'replicate')
        .forEach((task) => {
            allowedNames.add(`${task.task_token}.replicate-submission.json`);
            allowedNames.add(`${task.task_token}.replicate-completion.json`);
        });
    for (const task of selection.manifest.tasks) {
        const target = executionOutputPath(selection.paths, task.task_token);
        try {
            fs.lstatSync(target);
            throw failure('EXECUTION_OUTPUT_TARGET_EXISTS');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        if (task.provider === 'replicate') {
            const preview = replicateRequestPreview(selection, task, referencesByTask, target, context);
            const record = replicateClaimRecord(selection, task, preview.request_spec.request_revision_sha256);
            loadReplicateClaim(selection, task, record);
        }
        targets.set(task.task_token, target);
    }
    const entries = fs.readdirSync(selection.paths.outputsRoot, { withFileTypes: true });
    const present = new Set(entries.map((entry) => entry.name));
    if ([...requiredNames].some((name) => !present.has(name))
        || entries.some((entry) => !entry.isFile()
            || entry.isSymbolicLink() || !allowedNames.has(entry.name))) {
        throw failure('EXECUTION_OUTPUT_DIRECTORY_UNSAFE');
    }
    return targets;
}

function replicateDownloadedOutputsPrepared(selection, context, referencesByTask) {
    if (selection.manifest.lane !== 'video') return false;
    assertPrivateDirectory(selection.paths.outputsRoot, 'EXECUTION_OUTPUT_DIRECTORY_UNSAFE');
    const allowedNames = new Set();
    let downloaded = 0;
    for (const task of selection.manifest.tasks) {
        const outputName = `${task.task_token}.mp4`;
        const outputPath = executionOutputPath(selection.paths, task.task_token);
        if (task.provider === 'replicate') {
            allowedNames.add(`${task.task_token}.claim.json`);
            allowedNames.add(`${task.task_token}.replicate-submission.json`);
            allowedNames.add(`${task.task_token}.replicate-completion.json`);
            allowedNames.add(outputName);
            const preview = replicateRequestPreview(selection, task, referencesByTask, outputPath, context);
            loadReplicateClaim(selection, task,
                replicateClaimRecord(selection, task, preview.request_spec.request_revision_sha256));
            let before;
            try { before = fs.lstatSync(outputPath); } catch (error) {
                if (error.code === 'ENOENT') continue;
                throw error;
            }
            if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
                || before.size <= 0 || before.size > 512 * 1024 * 1024) {
                throw failure('EXECUTION_OUTPUT_TARGET_UNSAFE');
            }
            const descriptor = fs.openSync(outputPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            try {
                const opened = fs.fstatSync(descriptor);
                const final = fs.lstatSync(outputPath);
                if (!sameFile(before, opened) || !sameFile(opened, final)) {
                    throw failure('EXECUTION_OUTPUT_TARGET_UNSAFE');
                }
            } finally { fs.closeSync(descriptor); }
            downloaded += 1;
        } else {
            try {
                fs.lstatSync(outputPath);
                throw failure('EXECUTION_OUTPUT_TARGET_EXISTS');
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    }
    const entries = fs.readdirSync(selection.paths.outputsRoot, { withFileTypes: true });
    if (!downloaded
        || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !allowedNames.has(entry.name))) {
        throw failure('EXECUTION_OUTPUT_DIRECTORY_UNSAFE');
    }
    return true;
}

function stageExecutionOutputs(selection, context = {}, referencesByTask = new Map()) {
    if (selection.manifest.lane !== 'video') return new Map();
    ensureRunDirectories(selection.paths);
    ensureDirectory(selection.paths.outputsRoot, selection.paths.runRoot);
    const flowTasks = selection.manifest.tasks.filter((task) => task.provider === 'flow');
    if (flowTasks.length) {
        ensureDirectory(selection.paths.flowPreflightRoot, selection.paths.runRoot);
        flowTasks.forEach((task) => ensureDirectory(
            flowPreflightOutputDirectory(selection.paths, task.task_token),
            selection.paths.flowPreflightRoot,
        ));
    }
    const expectedNames = new Set(selection.manifest.tasks
        .filter((task) => task.provider === 'replicate')
        .map((task) => `${task.task_token}.claim.json`));
    selection.manifest.tasks.filter((task) => task.provider === 'replicate')
        .forEach((task) => {
            expectedNames.add(`${task.task_token}.replicate-submission.json`);
            expectedNames.add(`${task.task_token}.replicate-completion.json`);
        });
    const outputNames = new Set(selection.manifest.tasks
        .map((task) => `${task.task_token}.mp4`));
    const entries = fs.readdirSync(selection.paths.outputsRoot, { withFileTypes: true });
    if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()
        || (!expectedNames.has(entry.name) && !outputNames.has(entry.name)))) {
        throw failure('EXECUTION_OUTPUT_DIRECTORY_UNSAFE');
    }
    for (const task of selection.manifest.tasks.filter((item) => item.provider === 'replicate')) {
        const outputPath = executionOutputPath(selection.paths, task.task_token);
        const preview = replicateRequestPreview(selection, task, referencesByTask, outputPath, context);
        publishReplicateClaim(selection, task, preview);
    }
    return loadExecutionOutputTargets(selection, context, referencesByTask);
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

function publishImmutableReference(filePath, buffer) {
    const parent = path.dirname(filePath);
    const stagingParent = path.dirname(parent);
    assertPrivateDirectory(parent, 'EXECUTION_REFERENCE_DIRECTORY_UNSAFE');
    assertPrivateDirectory(stagingParent, 'EXECUTION_REFERENCE_DIRECTORY_UNSAFE');
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_REFERENCE_BYTES) {
        throw failure('EXECUTION_REFERENCE_INVALID');
    }
    try {
        const existing = readPrivate(filePath, MAX_REFERENCE_BYTES, 'EXECUTION_REFERENCE_MISSING');
        if (!existing.equals(buffer)) throw failure('EXECUTION_REFERENCE_CONFLICT');
        return false;
    } catch (error) {
        if (error.code !== 'EXECUTION_REFERENCE_MISSING') throw error;
    }
    const temporary = path.join(stagingParent, `.execution-reference-${crypto.randomBytes(12).toString('hex')}.tmp`);
    const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    let published = false;
    try {
        try {
            fs.linkSync(temporary, filePath);
            published = true;
            fsyncDirectory(parent);
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const existing = readPrivate(filePath, MAX_REFERENCE_BYTES, 'EXECUTION_REFERENCE_MISSING');
            if (!existing.equals(buffer)) throw failure('EXECUTION_REFERENCE_CONFLICT');
        }
    } finally {
        try { fs.unlinkSync(temporary); fsyncDirectory(stagingParent); } catch { /* task-owned temporary already absent */ }
    }
    return published;
}

function referencePairs(manifest) {
    const pairs = [];
    for (const task of manifest.tasks) {
        if (task.reference_task_tokens.length !== task.reference_result_tokens.length) {
            throw failure('EXECUTION_REFERENCE_COUNT_MISMATCH');
        }
        task.reference_result_tokens.forEach((resultToken, index) => {
            pairs.push({
                result_token: resultToken,
                task_token: task.reference_task_tokens[index],
            });
        });
    }
    return pairs;
}

function validateReferenceDirectory(paths, expectedNames) {
    assertPrivateDirectory(paths.referencesRoot, 'EXECUTION_REFERENCE_DIRECTORY_UNSAFE');
    const entries = fs.readdirSync(paths.referencesRoot, { withFileTypes: true });
    if (entries.length > 45 || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink()
        || !expectedNames.has(entry.name))) throw failure('EXECUTION_REFERENCE_DIRECTORY_UNSAFE');
}

function referenceManifestBase(manifest, references) {
    return {
        schema_version: REFERENCES_SCHEMA,
        run_revision_sha256: manifest.run_revision_sha256,
        image_plan_revision_sha256: manifest.image_plan_revision_sha256,
        references,
    };
}

function matchesReferenceSignature(buffer, mimeType) {
    if (mimeType === 'image/png') {
        return buffer.length >= 8 && buffer.subarray(0, 8)
            .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === 'image/jpeg') {
        return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mimeType === 'image/webp') {
        return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    return false;
}

function loadReferenceCommit(paths, manifest) {
    const pairs = referencePairs(manifest);
    if (!pairs.length) return [];
    assertPrivateDirectory(paths.referencesRoot, 'EXECUTION_REFERENCE_DIRECTORY_UNSAFE');
    let value;
    try {
        value = JSON.parse(readPrivate(
            paths.referencesManifestPath,
            MAX_REFERENCES_MANIFEST_BYTES,
            'EXECUTION_REFERENCES_MANIFEST_MISSING',
        ).toString('utf8'));
    } catch (error) {
        if (error.code) throw error;
        throw failure('EXECUTION_REFERENCES_MANIFEST_INVALID');
    }
    exactKeys(value, [
        'schema_version', 'run_revision_sha256', 'image_plan_revision_sha256',
        'reference_revision_sha256', 'references',
    ], 'EXECUTION_REFERENCES_MANIFEST_INVALID');
    if (value.schema_version !== REFERENCES_SCHEMA
        || value.run_revision_sha256 !== manifest.run_revision_sha256
        || value.image_plan_revision_sha256 !== manifest.image_plan_revision_sha256
        || !Array.isArray(value.references) || !value.references.length || value.references.length > 44) {
        throw failure('EXECUTION_REFERENCES_MANIFEST_INVALID');
    }
    const allowedPairs = new Set(pairs.map((item) => `${item.task_token}\0${item.result_token}`));
    const expectedResultCount = new Set(pairs.map((item) => item.result_token)).size;
    const seen = new Set();
    for (const reference of value.references) {
        exactKeys(reference, [
            'result_token', 'task_token', 'mime_type', 'byte_length', 'sha256', 'relative_path',
        ], 'EXECUTION_REFERENCES_MANIFEST_INVALID');
        const extension = reference.mime_type === 'image/png' ? '.png'
            : reference.mime_type === 'image/jpeg' ? '.jpg'
                : reference.mime_type === 'image/webp' ? '.webp' : '';
        const key = `${reference.task_token}\0${reference.result_token}`;
        if (!TASK_TOKEN.test(reference.task_token || '') || !/^result_[a-f0-9]{64}$/.test(reference.result_token || '')
            || !allowedPairs.has(key) || seen.has(reference.result_token) || !extension
            || !Number.isSafeInteger(reference.byte_length) || reference.byte_length <= 0
            || reference.byte_length > MAX_REFERENCE_BYTES || !SHA256.test(reference.sha256 || '')
            || reference.relative_path !== `${reference.result_token}${extension}`) {
            throw failure('EXECUTION_REFERENCES_MANIFEST_INVALID');
        }
        seen.add(reference.result_token);
    }
    const sorted = [...value.references].sort((left, right) => left.result_token.localeCompare(right.result_token));
    if (seen.size !== expectedResultCount || JSON.stringify(sorted) !== JSON.stringify(value.references)
        || value.reference_revision_sha256 !== sha256(JSON.stringify(referenceManifestBase(manifest, value.references)))) {
        throw failure('EXECUTION_REFERENCES_MANIFEST_INVALID');
    }
    const expectedNames = new Set([REFERENCES_MANIFEST_FILE]);
    for (const reference of value.references) {
        expectedNames.add(reference.relative_path);
        const buffer = readPrivate(path.join(paths.referencesRoot, reference.relative_path), MAX_REFERENCE_BYTES,
            'EXECUTION_REFERENCE_MISSING');
        if (buffer.byteLength !== reference.byte_length || sha256(buffer) !== reference.sha256
            || reference.result_token !== `result_${sha256(`${reference.task_token}\0${reference.sha256}`)}`
            || !matchesReferenceSignature(buffer, reference.mime_type)) {
            throw failure('EXECUTION_REFERENCE_CONFLICT');
        }
    }
    validateReferenceDirectory(paths, expectedNames);
    return value.references.map((reference) => ({
        ...reference,
        path: path.join(paths.referencesRoot, reference.relative_path),
    }));
}

function referenceFilesByTask(manifest, references) {
    const byToken = new Map(references.map((reference) => [reference.result_token, reference]));
    return new Map(manifest.tasks.map((task) => [
        task.task_token,
        task.reference_result_tokens.map((token) => byToken.get(token)).filter(Boolean),
    ]));
}

function stageExecutionReferences(selection, context) {
    const pairs = referencePairs(selection.manifest);
    if (!pairs.length) return [];
    ensureReferencesDirectory(selection.paths);
    const unique = new Map();
    for (const pair of pairs) {
        const prior = unique.get(pair.result_token);
        if (prior && prior.task_token !== pair.task_token) throw failure('EXECUTION_REFERENCE_TASK_MISMATCH');
        if (prior) continue;
        const source = newProjectImagePlanProvider.readNewProjectImageExecutionReference({
            result_token: pair.result_token,
            expected_task_token: pair.task_token,
            expected_design_revision_sha256: selection.manifest.design_revision_sha256,
            expected_image_plan_revision_sha256: selection.manifest.image_plan_revision_sha256,
        }, context);
        const relativePath = `${source.result_token}${source.extension}`;
        publishImmutableReference(path.join(selection.paths.referencesRoot, relativePath), source.buffer);
        unique.set(pair.result_token, {
            result_token: source.result_token,
            task_token: source.task_token,
            mime_type: source.mime_type,
            byte_length: source.byte_length,
            sha256: source.sha256,
            relative_path: relativePath,
        });
    }
    const references = [...unique.values()].sort((left, right) => left.result_token.localeCompare(right.result_token));
    const base = referenceManifestBase(selection.manifest, references);
    const record = { ...base, reference_revision_sha256: sha256(JSON.stringify(base)) };
    const expectedNames = new Set([REFERENCES_MANIFEST_FILE, ...references.map((item) => item.relative_path)]);
    const presentNames = new Set(fs.readdirSync(selection.paths.referencesRoot));
    for (const name of presentNames) {
        if (!expectedNames.has(name)) throw failure('EXECUTION_REFERENCE_DIRECTORY_UNSAFE');
    }
    publishImmutableReference(
        selection.paths.referencesManifestPath,
        Buffer.from(`${JSON.stringify(record, null, 2)}\n`),
    );
    return loadReferenceCommit(selection.paths, selection.manifest);
}

function recoverReplicateOrphanPartials(selection, context) {
    if (selection.manifest.lane !== 'video') return;
    let lock;
    try { lock = loadReplicateExecutionLock(selection.paths, context); }
    catch { return; }
    if (!lock?.recoverable) return;
    const tasks = new Map(selection.manifest.tasks
        .filter((task) => task.provider === 'replicate')
        .map((task) => [
            `.${task.task_token}.mp4.${lock.record.pid}.${lock.record.owner_nonce}.partial`, task,
        ]));
    const entries = fs.readdirSync(selection.paths.outputsRoot, { withFileTypes: true });
    for (const entry of entries) {
        const task = tasks.get(entry.name);
        if (!task) continue;
        const binding = replicateExecutionBinding(selection, task, context);
        if (!loadReplicateSubmission(selection, task, binding)) continue;
        const partialPath = path.join(selection.paths.outputsRoot, entry.name);
        const before = fs.lstatSync(partialPath);
        if (!entry.isFile() || entry.isSymbolicLink() || !before.isFile() || before.isSymbolicLink()
            || (before.mode & 0o777) !== 0o600 || before.nlink < 1 || before.nlink > 2
            || fs.realpathSync.native(partialPath) !== partialPath) {
            throw failure('EXECUTION_REPLICATE_PARTIAL_UNSAFE');
        }
        const after = fs.lstatSync(partialPath);
        if (!sameFile(before, after)) throw failure('EXECUTION_REPLICATE_PARTIAL_UNSAFE');
        fs.unlinkSync(partialPath);
        fsyncDirectory(selection.paths.outputsRoot);
    }
}

function selectionPrepared(selection, context = {}) {
    try {
        let referencesByTask = new Map();
        if (referencePairs(selection.manifest).length) {
            const image = (context.getNewProjectImagePlan || newProjectImagePlanProvider.getNewProjectImagePlan)(context);
            if (!image?.ok || image.status !== 'restored' || image.blockers?.length
                || image.design_revision_sha256 !== selection.manifest.design_revision_sha256
                || image.revision_sha256 !== selection.manifest.image_plan_revision_sha256) return false;
            referencesByTask = referenceFilesByTask(
                selection.manifest,
                loadReferenceCommit(selection.paths, selection.manifest),
            );
        }
        recoverReplicateOrphanPartials(selection, context);
        try {
            loadExecutionOutputTargets(selection, context, referencesByTask);
            return true;
        } catch {
            return replicateDownloadedOutputsPrepared(selection, context, referencesByTask);
        }
    } catch { return false; }
}

function availablePreparation(state) {
    return Boolean(state?.ok && state.status === 'restored' && !state.blockers?.length
        && state.preparation?.status === 'queued'
        && PREPARATION_TOKEN.test(state.preparation.preparation_token || ''));
}

function baseFromPlan(state, lane, settings) {
    if (!availablePreparation(state)) return null;
    const selected = new Set(state.preparation.task_tokens);
    if (selected.size !== state.preparation.task_count) throw failure('EXECUTION_PREPARATION_INVALID');
    const source = state.tasks.filter((task) => selected.has(task.task_token))
        .sort((left, right) => left.sequence - right.sequence);
    if (!source.length || source.length !== selected.size) throw failure('EXECUTION_PREPARATION_STALE');
    const taskBySequence = new Map(state.tasks.map((task) => [task.sequence, task]));
    const resultByTask = new Map(state.tasks.map((task) => [task.task_token, task.result_token || '']));
    const tasks = source.map((task) => {
        let referenceTaskTokens;
        let referenceResultTokens;
        if (lane === 'image') {
            referenceTaskTokens = Array.isArray(task.reference_task_ids) ? task.reference_task_ids : [];
            referenceResultTokens = referenceTaskTokens.map((token) => resultByTask.get(token)).filter(Boolean);
        } else if (task.provider === 'flow') {
            const nextTask = taskBySequence.get(task.sequence + 1);
            referenceTaskTokens = nextTask
                ? [task.reference_image_task_token, nextTask.reference_image_task_token]
                : [];
            referenceResultTokens = nextTask
                ? [task.reference_image_result_token, nextTask.reference_image_result_token]
                : [];
        } else {
            referenceTaskTokens = [task.reference_image_task_token].filter(Boolean);
            referenceResultTokens = [task.reference_image_result_token].filter(Boolean);
        }
        const duration = lane === 'video' ? settings.sceneDurations.get(task.source_id) : 0;
        if (lane === 'video' && (!Number.isFinite(duration) || duration <= 0 || duration > 60)) {
            throw failure('EXECUTION_DURATION_REQUIRED');
        }
        const conflictingAspect = settings.aspectRatio === '9:16' ? '16:9' : '9:16';
        if (task.prompt.includes(conflictingAspect)) throw failure('EXECUTION_ASPECT_PROMPT_CONFLICT');
        return {
            task_token: task.task_token, lane, kind: task.kind, source_id: task.source_id,
            sequence: task.sequence, label: task.label,
            provider: lane === 'image' ? 'dst_image' : task.provider,
            provider_label: lane === 'image' ? 'DST 이미지' : task.provider_label,
            prompt: task.prompt, preparation_token: state.preparation.preparation_token,
            reference_task_tokens: referenceTaskTokens,
            reference_result_tokens: referenceResultTokens,
            duration_seconds: lane === 'video' ? duration : null,
        };
    });
    const base = {
        schema_version: MANIFEST_SCHEMA,
        planning_revision_sha256: settings.planningRevision,
        aspect_ratio: settings.aspectRatio,
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
    if (base.design_revision_sha256 !== settings.designRevision) throw failure('EXECUTION_DESIGN_STALE');
    return { ...base, preparation_revision_sha256: sha256(JSON.stringify(preparationBase(base))) };
}

function preparationBase(value, schema = value.schema_version || MANIFEST_SCHEMA) {
    const common = {
        lane: value.lane,
        design_revision_sha256: value.design_revision_sha256,
        image_plan_revision_sha256: value.image_plan_revision_sha256,
        video_plan_revision_sha256: value.video_plan_revision_sha256,
        preparation_token: value.preparation_token,
        tasks: value.tasks,
    };
    return schema === LEGACY_MANIFEST_SCHEMA
        ? common
        : {
            schema_version: MANIFEST_SCHEMA,
            planning_revision_sha256: value.planning_revision_sha256,
            ...common,
            aspect_ratio: value.aspect_ratio,
        };
}

function manifestFor(base, attempt, createdAt = new Date().toISOString()) {
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 1000) throw failure('EXECUTION_ATTEMPT_INVALID');
    const schema = base.schema_version || MANIFEST_SCHEMA;
    const preparationRevision = sha256(JSON.stringify(preparationBase(base, schema)));
    if (base.preparation_revision_sha256 && base.preparation_revision_sha256 !== preparationRevision) {
        throw failure('EXECUTION_PREPARATION_INVALID');
    }
    const runRevision = sha256(JSON.stringify(schema === LEGACY_MANIFEST_SCHEMA
        ? { preparation_revision_sha256: preparationRevision, attempt }
        : { schema_version: MANIFEST_SCHEMA, preparation_revision_sha256: preparationRevision, attempt }));
    const manifest = {
        schema_version: schema, run_token: `run_${runRevision}`,
        run_revision_sha256: runRevision, preparation_revision_sha256: preparationRevision,
        attempt, lane: base.lane, design_revision_sha256: base.design_revision_sha256,
        image_plan_revision_sha256: base.image_plan_revision_sha256,
        video_plan_revision_sha256: base.video_plan_revision_sha256,
        preparation_token: base.preparation_token, tasks: base.tasks,
        external_call_performed: false, model_called: false, generation_executed: false,
        created_at: createdAt,
    };
    if (schema === MANIFEST_SCHEMA) {
        manifest.planning_revision_sha256 = base.planning_revision_sha256;
        manifest.aspect_ratio = base.aspect_ratio;
    }
    return manifest;
}

function validateTask(task, lane, schema) {
    const expected = [
        'task_token', 'lane', 'kind', 'sequence', 'label', 'provider', 'provider_label',
        'prompt', 'preparation_token', 'reference_task_tokens', 'reference_result_tokens',
    ];
    if (schema === MANIFEST_SCHEMA) expected.push('source_id', 'duration_seconds');
    exactKeys(task, expected, 'EXECUTION_MANIFEST_INVALID');
    if (!TASK_TOKEN.test(task.task_token || '') || task.lane !== lane
        || !Number.isSafeInteger(task.sequence) || task.sequence < 1
        || !PREPARATION_TOKEN.test(task.preparation_token || '')) throw failure('EXECUTION_MANIFEST_INVALID');
    text(task.kind, 64, 'EXECUTION_MANIFEST_INVALID');
    if (schema === MANIFEST_SCHEMA) text(task.source_id, 128, 'EXECUTION_MANIFEST_INVALID');
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
    if (schema === MANIFEST_SCHEMA) {
        const duration = task.duration_seconds;
        if ((lane === 'image' && duration !== null)
            || (lane === 'video' && (!Number.isFinite(duration) || duration <= 0 || duration > 60))
            || task.reference_task_tokens.length !== task.reference_result_tokens.length) {
            throw failure('EXECUTION_MANIFEST_INVALID');
        }
    }
    return task;
}

function validateManifest(value) {
    const schema = value?.schema_version;
    if (![LEGACY_MANIFEST_SCHEMA, MANIFEST_SCHEMA].includes(schema)) throw failure('EXECUTION_MANIFEST_INVALID');
    const expected = [
        'schema_version', 'run_token', 'run_revision_sha256', 'preparation_revision_sha256',
        'attempt', 'lane', 'design_revision_sha256', 'image_plan_revision_sha256',
        'video_plan_revision_sha256', 'preparation_token', 'tasks', 'external_call_performed',
        'model_called', 'generation_executed', 'created_at',
    ];
    if (schema === MANIFEST_SCHEMA) expected.push('planning_revision_sha256', 'aspect_ratio');
    exactKeys(value, expected, 'EXECUTION_MANIFEST_INVALID');
    if (!RUN_TOKEN.test(value.run_token || '')
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
    if (schema === MANIFEST_SCHEMA && (!SHA256.test(value.planning_revision_sha256 || '')
        || !['9:16', '16:9'].includes(value.aspect_ratio))) {
        throw failure('EXECUTION_MANIFEST_INVALID');
    }
    let priorSequence = 0;
    value.tasks.forEach((task) => {
        validateTask(task, value.lane, schema);
        if (task.sequence <= priorSequence) throw failure('EXECUTION_MANIFEST_INVALID');
        priorSequence = task.sequence;
    });
    const baseRevision = sha256(JSON.stringify(preparationBase(value, schema)));
    const runRevision = sha256(JSON.stringify(schema === LEGACY_MANIFEST_SCHEMA
        ? { preparation_revision_sha256: baseRevision, attempt: value.attempt }
        : { schema_version: MANIFEST_SCHEMA, preparation_revision_sha256: baseRevision, attempt: value.attempt }));
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

function executionSettings(context) {
    const draft = (context.getNewProjectDraftState || newProjectDraftProvider.getNewProjectDraftState)(context);
    const design = (context.getNewProjectDesignState || newProjectDesignProvider.getNewProjectDesignState)(context);
    if (!draft?.ok || !SHA256.test(draft.revision_sha256 || '')
        || !design?.ok || design.status !== 'restored' || !SHA256.test(design.revision_sha256 || '')
        || design.planning_revision_sha256 !== draft.revision_sha256
        || !['9:16', '16:9'].includes(draft.draft?.aspect_ratio)) {
        throw failure('EXECUTION_SETTINGS_STALE');
    }
    return {
        planningRevision: draft.revision_sha256,
        designRevision: design.revision_sha256,
        aspectRatio: draft.draft.aspect_ratio,
        sceneDurations: new Map(design.board.scenes.map((scene) => [scene.id, scene.duration])),
    };
}

function planBases(context) {
    const image = (context.getNewProjectImagePlan || newProjectImagePlanProvider.getNewProjectImagePlan)(context);
    const video = (context.getNewProjectVideoPlan || newProjectVideoPlanProvider.getNewProjectVideoPlan)(context);
    if (![image, video].some(availablePreparation)) return [];
    const settings = executionSettings(context);
    return [baseFromPlan(image, 'image', settings), baseFromPlan(video, 'video', settings)].filter(Boolean);
}

function selectLanes(context = {}) {
    const manifests = listManifests(context);
    const bases = new Map(planBases(context).map((base) => [base.lane, base]));
    return ['image', 'video'].flatMap((lane) => {
        const base = bases.get(lane);
        const candidates = manifests.filter(({ manifest }) => manifest.schema_version === MANIFEST_SCHEMA
            && manifest.lane === lane
            && (!base || manifest.preparation_revision_sha256 === base.preparation_revision_sha256));
        candidates.sort((left, right) => right.manifest.attempt - left.manifest.attempt
            || String(right.manifest.created_at).localeCompare(String(left.manifest.created_at)));
        if (candidates.length) {
            const selected = candidates[0];
            return [{ ...selected, prepared: selectionPrepared(selected, context) }];
        }
        if (base) {
            const manifest = manifestFor(base, 1);
            return [{ paths: exactPaths(context.userDataPath, manifest.run_token), manifest, prepared: false }];
        }
        const historical = manifests.filter(({ manifest }) => manifest.schema_version === MANIFEST_SCHEMA
            && manifest.lane === lane)
            .sort((left, right) => String(right.manifest.created_at).localeCompare(String(left.manifest.created_at)));
        if (!historical.length) return [];
        const selected = historical[0];
        return [{ ...selected, prepared: selectionPrepared(selected, context) }];
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
    return selection.manifest.tasks.map((task) => loadReceipt(selection.paths, task.task_token));
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
        const installed = regularFile(runtime.flowPython) && realDirectory(runtime.flowRoot)
            && regularFile(runtime.flowText) && regularFile(runtime.flowRefs);
        const runtimeContext = Boolean(context.runtimePaths?.flowCdpUrl
            || process.env.OPEN_GENERATIVE_AI_FLOW_CDP_URL || process.env.FLOW_CDP_URL);
        return {
            provider_readiness: installed
                ? (runtimeContext ? 'preview_ready' : 'runtime_context_required')
                : 'runtime_missing',
            provider_status_label: installed
                ? (runtimeContext ? '플로우 작업 확인 가능' : '플로우 작업창 연결 필요')
                : '플로우 도구 준비 필요',
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

function workbenchTaskStates(context = {}) {
    const states = new Map();
    for (const load of [
        context.getNewProjectImagePlan || newProjectImagePlanProvider.getNewProjectImagePlan,
        context.getNewProjectVideoPlan || newProjectVideoPlanProvider.getNewProjectVideoPlan,
    ]) {
        try {
            const state = load(context);
            const decisions = new Map((state?.review_decisions || [])
                .map((decision) => [decision.task_token, decision.decision]));
            for (const task of Array.isArray(state?.tasks) ? state.tasks : []) {
                if (task.result_token) states.set(task.task_token, {
                    connected: true,
                    quality_decision: task.status === '재제작' ? 'retry'
                        : decisions.get(task.task_token) === 'use' ? 'use' : 'pending',
                });
            }
        } catch { /* current workbench may not be ready yet */ }
    }
    return states;
}

function publicSelections(selections, context = {}) {
    const tasks = [];
    for (const selection of selections) {
        const receipts = laneReceipts(selection);
        let referencesByTask = new Map();
        let outputTargets = new Map();
        if (selection.prepared && referencePairs(selection.manifest).length) {
            try {
                referencesByTask = referenceFilesByTask(
                    selection.manifest,
                    loadReferenceCommit(selection.paths, selection.manifest),
                );
            } catch { /* incomplete staging stays a simple setup state */ }
        }
        if (selection.prepared && selection.manifest.lane === 'video') {
            try { outputTargets = loadExecutionOutputTargets(selection, context, referencesByTask); }
            catch { /* missing or unsafe output staging stays private and blocked */ }
        }
        selection.manifest.tasks.forEach((task, index) => {
            const receipt = receipts[index];
            const status = receipt?.status || 'queued';
            const referenceFiles = referencesByTask.get(task.task_token) || [];
            const providerPreview = providerExecutionPreview.buildProviderExecutionPreview({
                ...task, aspect_ratio: selection.manifest.aspect_ratio, reference_files: referenceFiles,
                output_path: outputTargets.get(task.task_token) || '',
                flow_output_dir: selection.prepared && task.provider === 'flow'
                    ? flowPreflightOutputDirectory(selection.paths, task.task_token) : '',
            }, context);
            let executionResultBinding = null;
            if (receipt?.status === 'succeeded' && task.lane === 'video' && task.provider === 'replicate') {
                try { executionResultBinding = replicateExecutionBinding(selection, task, context); }
                catch { /* missing or changed private binding keeps the result unavailable */ }
            }
            tasks.push({
                task_token: task.task_token, lane: task.lane, kind: task.kind, sequence: task.sequence,
                label: task.label, provider_label: task.provider_label, provider_id: task.provider,
                status, status_label: STATUS_LABELS[status],
                progress: receipt?.progress || 0, failure_label: receipt?.failure_code ? FAILURE_LABELS[receipt.failure_code] : '',
                result_received: status === 'succeeded',
                external_call_performed: receipt?.external_call_performed || false,
                model_called: receipt?.model_called || false,
                generation_executed: receipt?.generation_executed || false,
                result_locator: receipt?.result_locator || '',
                provider_preview_readiness: providerPreview.readiness,
                provider_preview_blockers: providerPreview.blockers,
                reference_setup_missing: task.reference_result_tokens.length > referenceFiles.length,
                execution_result_binding: executionResultBinding,
                ...providerReadiness(task, context),
            });
        });
    }
    const indexes = resultIndexes(
        context,
        tasks.some((task) => task.lane === 'image' && task.status === 'succeeded'),
        tasks.some((task) => task.lane === 'video' && task.status === 'succeeded'),
    );
    const workbenchStates = workbenchTaskStates(context);
    for (const task of tasks) {
        let match = null;
        if (task.status === 'succeeded') {
            if (task.lane === 'video' && task.provider_id === 'replicate') {
                if (task.execution_result_binding) {
                    const resolver = context.resolveVideoExecutionResultLocatorForExecution
                        || videoResultImportProvider.resolveVideoExecutionResultLocatorForExecution;
                    try { match = resolver(task.result_locator, task.execution_result_binding, context); }
                    catch { match = null; }
                }
            } else {
                const resolver = (task.lane === 'image' ? indexes.image : indexes.video).get('resolve');
                try { match = typeof resolver === 'function' ? resolver(task.result_locator, context) : null; } catch { match = null; }
            }
        }
        const workbench = workbenchStates.get(task.task_token);
        const candidateToken = workbench?.connected ? '' : match?.candidate_token || '';
        task.workbench_connected = workbench?.connected === true;
        task.quality_decision = workbench?.quality_decision || 'pending';
        task.result_match_status = task.status === 'succeeded'
            ? task.workbench_connected ? 'connected' : candidateToken ? 'ready' : 'waiting'
            : '';
        task.result_candidate_token = candidateToken;
        task.result_image_index = !task.workbench_connected && task.lane === 'image' && Number.isSafeInteger(match?.image_index)
            ? match.image_index : 0;
        task.execution_preview = executionPreview(task);
        delete task.provider_preview_readiness;
        delete task.provider_preview_blockers;
        delete task.reference_setup_missing;
        delete task.execution_result_binding;
        delete task.provider_id;
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

function executionPreview(task) {
    const resultAvailable = task.result_match_status === 'ready';
    const previewBlockers = Array.isArray(task.provider_preview_blockers)
        ? task.provider_preview_blockers : [];
    if (!resultAvailable && previewBlockers.includes('GROK_DURATION_UNSUPPORTED')) {
        return {
            mode: 'setup_required',
            status_label: '준비 필요',
            reason: 'video_duration_required',
            user_status: '영상 길이를 지원되는 값으로 바꿔야 합니다.',
            next_action: '설계에서 장면 길이를 6초, 10초 또는 15초로 바꾸세요.',
            output_kind: 'video',
            output_count: 1,
            preview_only: true,
        };
    }
    if (!resultAvailable && previewBlockers.includes('FLOW_REFERENCE_COUNT_MUST_BE_ZERO_OR_TWO')) {
        return {
            mode: 'setup_required',
            status_label: '준비 필요',
            reason: 'video_reference_count_required',
            user_status: '영상 참조 이미지 구성을 다시 확인해야 합니다.',
            next_action: '영상 작업에서 참조 이미지를 0장 또는 2장으로 맞추세요.',
            output_kind: 'video',
            output_count: 1,
            preview_only: true,
        };
    }
    if (!resultAvailable && previewBlockers.includes('FLOW_PRIVATE_RUNTIME_CONTEXT_REQUIRED')) {
        return {
            mode: 'setup_required',
            status_label: '작업창 연결 필요',
            reason: 'provider_runtime_context_required',
            user_status: '플로우 작업창 연결을 확인해야 합니다.',
            next_action: '설정에서 현재 플로우 작업창 연결을 확인하세요.',
            output_kind: 'video',
            output_count: 1,
            preview_only: true,
        };
    }
    if (!resultAvailable && task.lane === 'video'
        && task.provider_preview_readiness === 'preview_ready_live_blocked') {
        return {
            mode: 'review_required',
            status_label: '실행 전 확인',
            reason: 'private_review_required',
            user_status: '작업 내용은 준비되었지만 실행 전 확인이 필요합니다.',
            next_action: '영상 작업에서 프롬프트와 길이를 확인하세요.',
            output_kind: 'video',
            output_count: 1,
            preview_only: true,
        };
    }
    if (!resultAvailable && task.lane === 'video' && task.provider_id === 'replicate'
        && task.provider_preview_readiness === 'preview_ready') {
        return {
            mode: 'preview_ready',
            status_label: '요청 내용 확인 가능',
            reason: 'private_replicate_request_ready',
            user_status: 'Replicate에 보낼 영상 요청이 준비되었습니다. 아직 전송되지 않았습니다.',
            next_action: '영상 작업에서 프롬프트·길이·첫 화면을 확인하세요.',
            output_kind: 'video',
            output_count: 1,
            preview_only: true,
        };
    }
    if (!resultAvailable && task.lane === 'image' && task.kind === 'scene_image'
        && task.provider_preview_readiness === 'preview_ready') {
        return {
            mode: 'preview_ready',
            status_label: '내용 확인 가능',
            reason: 'private_preview_ready',
            user_status: '참조 이미지와 작업 내용이 준비되었습니다.',
            next_action: '이미지 작업에서 장면 프롬프트를 확인하세요.',
            output_kind: 'image',
            output_count: 1,
            preview_only: true,
        };
    }
    if (!resultAvailable && task.lane === 'image' && task.kind === 'scene_image'
        && task.reference_setup_missing) {
        return {
            mode: 'setup_required',
            status_label: '준비 필요',
            reason: 'reference_staging_required',
            user_status: '참조 이미지를 다시 연결해야 합니다.',
            next_action: '이미지 작업에서 인물·장소 결과를 확인하세요.',
            output_kind: 'image',
            output_count: 1,
            preview_only: true,
        };
    }
    if (!resultAvailable && task.provider_preview_readiness === 'preview_ready') {
        return {
            mode: 'preview_ready',
            status_label: '내용 확인 가능',
            reason: 'private_preview_ready',
            user_status: '작업 내용이 준비되었습니다.',
            next_action: '이미지 작업에서 프롬프트를 확인하세요.',
            output_kind: task.lane === 'image' ? 'image' : 'video',
            output_count: 1,
            preview_only: true,
        };
    }
    return {
        mode: 'result_only',
        status_label: '결과만 연결',
        reason: resultAvailable ? 'result_available' : 'waiting_for_result',
        user_status: resultAvailable
            ? '연결할 완료 결과가 있습니다.'
            : '다른 곳에서 완성한 결과를 가져와 연결하세요.',
        next_action: resultAvailable
            ? `${task.lane === 'image' ? '이미지' : '영상'} 결과를 확인하세요.`
            : `${task.lane === 'image' ? '이미지' : '영상'} 작업에서 준비 상태를 확인하세요.`,
        output_kind: task.lane === 'image' ? 'image' : 'video',
        output_count: 1,
        preview_only: true,
    };
}

function materialize(selection, context) {
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
    const staged = { paths: selection.paths, manifest: loaded, prepared: false };
    const stagedReferences = stageExecutionReferences(staged, context);
    stageExecutionOutputs(staged, context, referenceFilesByTask(staged.manifest, stagedReferences));
    if (!selectionPrepared(staged, context)) throw failure(selection.manifest.lane === 'video'
        ? 'EXECUTION_OUTPUT_PREPARATION_INCOMPLETE' : 'EXECUTION_REFERENCE_PREPARATION_INCOMPLETE');
    return { ...staged, prepared: true, alreadyPrepared: false };
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
                schema_version: selection.manifest.schema_version,
                planning_revision_sha256: selection.manifest.planning_revision_sha256,
                aspect_ratio: selection.manifest.aspect_ratio,
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
    const materialized = selections.map((selection) => materialize(selection, context));
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

function replicateLockTtl(context = {}) {
    if (context.replicateLoopbackTestOnly === true
        && Number.isInteger(context.replicateTestLockTtlMs)
        && context.replicateTestLockTtlMs >= 30
        && context.replicateTestLockTtlMs <= 60 * 1000) {
        return context.replicateTestLockTtlMs;
    }
    return REPLICATE_LOCK_TTL_MS;
}

function loadReplicateExecutionLock(paths, context = {}, { missing = true } = {}) {
    const lockPath = path.join(paths.runRoot, '.replicate-execute.lock');
    let before;
    try { before = fs.lstatSync(lockPath); } catch (error) {
        if (missing && error.code === 'ENOENT') return null;
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || fs.realpathSync.native(lockPath) !== lockPath) {
        throw failure('EXECUTION_REPLICATE_LOCK_UNSAFE');
    }
    let record;
    let bytes;
    try {
        bytes = readPrivate(lockPath, 1024, 'EXECUTION_REPLICATE_LOCK_MISSING');
        record = JSON.parse(bytes.toString('utf8'));
    }
    catch (error) { if (error.code) throw error; throw failure('EXECUTION_REPLICATE_LOCK_UNSAFE'); }
    exactKeys(record, ['pid', 'owner_nonce', 'created_at'], 'EXECUTION_REPLICATE_LOCK_UNSAFE');
    const createdAt = Date.parse(record.created_at);
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0
        || typeof record.owner_nonce !== 'string' || !/^[a-f0-9]{32}$/.test(record.owner_nonce)
        || typeof record.created_at !== 'string' || !Number.isFinite(createdAt)) {
        throw failure('EXECUTION_REPLICATE_LOCK_UNSAFE');
    }
    const after = fs.lstatSync(lockPath);
    const now = Date.now();
    if (!sameFile(before, after)
        || after.mtimeMs < createdAt - REPLICATE_LOCK_TIME_SKEW_MS
        || after.mtimeMs > now + REPLICATE_LOCK_TIME_SKEW_MS) {
        throw failure('EXECUTION_REPLICATE_LOCK_UNSAFE');
    }
    let alive = record.pid === process.pid;
    if (!alive) {
        try { process.kill(record.pid, 0); alive = true; }
        catch (error) { if (error.code !== 'ESRCH') alive = true; }
    }
    return {
        path: lockPath,
        stats: after,
        bytes,
        record,
        recoverable: !alive || after.mtimeMs + replicateLockTtl(context) <= now,
    };
}

function acquireReplicateExecutionLock(paths, context = {}) {
    const lockPath = path.join(paths.runRoot, '.replicate-execute.lock');
    const ownerNonce = crypto.randomBytes(16).toString('hex');
    const createdAt = new Date();
    const lockRecord = {
        pid: process.pid,
        owner_nonce: ownerNonce,
        created_at: createdAt.toISOString(),
    };
    const create = () => {
        let descriptor;
        let created = false;
        try {
            descriptor = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT
                | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
            created = true;
            fs.writeFileSync(descriptor,
                `${JSON.stringify(lockRecord)}\n`);
            fs.fsyncSync(descriptor);
            fsyncDirectory(paths.runRoot);
            return descriptor;
        } catch (error) {
            if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* already closed */ }
            if (created) {
                try { fs.unlinkSync(lockPath); fsyncDirectory(paths.runRoot); } catch { /* best effort */ }
            }
            throw error;
        }
    };
    const recoverStale = () => {
        const lock = loadReplicateExecutionLock(paths, context, { missing: false });
        if (!lock.recoverable) return false;
        const after = fs.lstatSync(lockPath);
        if (!sameFile(lock.stats, after)) throw failure('EXECUTION_REPLICATE_LOCK_UNSAFE');
        fs.unlinkSync(lockPath);
        fsyncDirectory(paths.runRoot);
        return true;
    };
    let descriptor;
    try { descriptor = create(); } catch (error) {
        if (error.code !== 'EEXIST' || !recoverStale()) {
            if (error.code === 'EEXIST') throw failure('EXECUTION_REPLICATE_ALREADY_RUNNING');
            throw error;
        }
        try { descriptor = create(); } catch (retryError) {
            if (retryError.code === 'EEXIST') throw failure('EXECUTION_REPLICATE_ALREADY_RUNNING');
            throw retryError;
        }
    }
    const identity = fs.fstatSync(descriptor);
    let released = false;
    const heartbeat = () => {
        if (released) throw failure('EXECUTION_REPLICATE_LOCK_UNSAFE');
        const current = loadReplicateExecutionLock(paths, context, { missing: false });
        const opened = fs.fstatSync(descriptor);
        if (identity.dev !== current.stats.dev || identity.ino !== current.stats.ino
            || identity.dev !== opened.dev || identity.ino !== opened.ino
            || (opened.mode & 0o777) !== 0o600
            || current.record.pid !== process.pid
            || current.record.owner_nonce !== ownerNonce
            || current.record.created_at !== lockRecord.created_at) {
            throw failure('EXECUTION_REPLICATE_LOCK_UNSAFE');
        }
        const immutableBytes = readPrivate(lockPath, 1024, 'EXECUTION_REPLICATE_LOCK_MISSING');
        if (!immutableBytes.equals(current.bytes)) throw failure('EXECUTION_REPLICATE_LOCK_UNSAFE');
        fs.futimesSync(descriptor, opened.atime, new Date());
        fs.fsyncSync(descriptor);
        fsyncDirectory(paths.runRoot);
        const verified = loadReplicateExecutionLock(paths, context, { missing: false });
        const verifiedOpened = fs.fstatSync(descriptor);
        if (identity.dev !== verified.stats.dev || identity.ino !== verified.stats.ino
            || identity.dev !== verifiedOpened.dev || identity.ino !== verifiedOpened.ino
            || (verified.stats.mode & 0o777) !== 0o600
            || verified.record.owner_nonce !== ownerNonce
            || !verified.bytes.equals(immutableBytes)) {
            throw failure('EXECUTION_REPLICATE_LOCK_UNSAFE');
        }
    };
    const release = () => {
        released = true;
        try { fs.closeSync(descriptor); } finally {
            try {
                const current = fs.lstatSync(lockPath);
                if (current.dev === identity.dev && current.ino === identity.ino) {
                    fs.unlinkSync(lockPath);
                    fsyncDirectory(paths.runRoot);
                }
            } catch { /* best-effort unlock */ }
        }
    };
    release.ownerNonce = ownerNonce;
    release.heartbeat = heartbeat;
    release.heartbeatIntervalMs = Math.max(10, Math.floor(replicateLockTtl(context) / 3));
    return release;
}

function nextReceiptTimestamp(receipt) {
    const now = Date.now();
    const prior = receipt ? Date.parse(receipt.reported_at) : 0;
    return new Date(Math.max(now, prior + 1)).toISOString();
}

function replicateRunningReceipt(selection, task, prior, values = {}) {
    return {
        schema_version: RECEIPT_SCHEMA,
        run_revision_sha256: selection.manifest.run_revision_sha256,
        task_token: task.task_token,
        status: 'running',
        progress: Math.max(prior?.progress || 0, values.progress || 1),
        failure_code: '', result_received: false, result_locator: '',
        external_call_performed: values.external_call_performed ?? prior?.external_call_performed ?? false,
        model_called: values.model_called ?? prior?.model_called ?? false,
        generation_executed: values.generation_executed ?? prior?.generation_executed ?? false,
        reported_at: nextReceiptTimestamp(prior),
    };
}

function replicateFailedReceipt(selection, task, prior, code, values = {}) {
    return {
        schema_version: RECEIPT_SCHEMA,
        run_revision_sha256: selection.manifest.run_revision_sha256,
        task_token: task.task_token,
        status: 'failed', progress: prior?.progress || 1,
        failure_code: FAILURE_CODES.has(code) ? code : 'RESULT_INVALID',
        result_received: false, result_locator: '',
        external_call_performed: values.external_call_performed ?? prior?.external_call_performed ?? false,
        model_called: values.model_called ?? prior?.model_called ?? false,
        generation_executed: values.generation_executed ?? prior?.generation_executed ?? false,
        reported_at: nextReceiptTimestamp(prior),
    };
}

function publishReplicateCompletion(selection, task, resultLocator, context) {
    const prior = loadReceipt(selection.paths, task.task_token, { missing: false });
    const completed = publishExecutionReceipt({
        schema_version: RECEIPT_SCHEMA,
        run_revision_sha256: selection.manifest.run_revision_sha256,
        task_token: task.task_token,
        status: 'succeeded', progress: 100, failure_code: '', result_received: true,
        result_locator: resultLocator,
        external_call_performed: true, model_called: true, generation_executed: true,
        reported_at: nextReceiptTimestamp(prior),
    }, context);
    return { ok: true, status: 'succeeded', state: completed.state };
}

async function executeNextReplicateTask(payload, context = {}) {
    exactKeys(payload, ['expected_revision_sha256', 'confirm_live'], 'EXECUTION_REPLICATE_EXECUTE_SHAPE_INVALID');
    if (payload.confirm_live !== true || !SHA256.test(payload.expected_revision_sha256 || '')) {
        throw failure('EXECUTION_REPLICATE_LIVE_CONFIRMATION_REQUIRED');
    }
    const selections = selectLanes(context);
    const current = publicSelections(selections, context);
    if (current.revision_sha256 !== payload.expected_revision_sha256) throw failure('EXECUTION_REVISION_STALE');
    const selection = selections.find((item) => item.manifest.lane === 'video');
    if (selection && !selection.prepared) {
        const lock = loadReplicateExecutionLock(selection.paths, context);
        if (lock && !lock.recoverable) throw failure('EXECUTION_REPLICATE_ALREADY_RUNNING');
    }
    if (!selection?.prepared) throw failure('EXECUTION_PREPARATION_REQUIRED');
    const receipts = laneReceipts(selection);
    const taskIndex = receipts.findIndex((item) => !item || !['succeeded', 'failed'].includes(item.status));
    if (taskIndex < 0) throw failure('EXECUTION_REPLICATE_TASK_NOT_AVAILABLE');
    const task = selection.manifest.tasks[taskIndex];
    if (task.provider !== 'replicate') throw failure('EXECUTION_REPLICATE_TASK_NOT_NEXT');

    const release = acquireReplicateExecutionLock(selection.paths, context);
    let running = receipts[taskIndex];
    let submission = null;
    let requestRevision = '';
    try {
        const outputPath = executionOutputPath(selection.paths, task.task_token);
        let outputExists = false;
        try {
            fs.lstatSync(outputPath);
            outputExists = true;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        const referencesByTask = referenceFilesByTask(
            selection.manifest,
            loadReferenceCommit(selection.paths, selection.manifest),
        );
        const preview = replicateRequestPreview(selection, task, referencesByTask, outputPath, context);
        requestRevision = preview.request_spec.request_revision_sha256;
        const binding = replicateExecutionBinding(selection, task, context);
        submission = loadReplicateSubmission(selection, task, binding);
        const completion = submission ? loadReplicateCompletion(selection, task, binding) : null;
        if (completion && completion.prediction_id !== submission.prediction_id) {
            throw failure('EXECUTION_REPLICATE_COMPLETION_CONFLICT');
        }
        if (loadReplicateUncertain(selection, task, requestRevision)) {
            throw failure('EXECUTION_REPLICATE_SUBMISSION_UNCERTAIN');
        }
        if (outputExists && !submission) throw failure('RESULT_INVALID');

        let canonicalResult = null;
        if (submission) {
            const resolver = context.resolvePublishedReplicateExecutionResult
                || videoResultImportProvider.resolvePublishedReplicateExecutionResult;
            canonicalResult = resolver({
                prediction_id: submission.prediction_id,
                execution_binding: binding,
            }, context);
        }
        const localCompletionAvailable = Boolean(canonicalResult)
            || (Boolean(submission) && Boolean(completion) && outputExists);
        if (!localCompletionAvailable
            && (typeof context.replicateApiToken !== 'string' || !context.replicateApiToken.trim()
                || context.replicateApiToken.includes('\0'))) throw failure('AUTH_REQUIRED');

        let allowSubmit = false;
        if (!running) {
            const started = publishExecutionReceipt(
                replicateRunningReceipt(selection, task, null), context,
            );
            allowSubmit = started.already_published === false;
            running = loadReceipt(selection.paths, task.task_token, { missing: false });
        } else if (running.status !== 'running') {
            throw failure('EXECUTION_REPLICATE_TASK_NOT_AVAILABLE');
        }
        if (!submission && !allowSubmit) throw failure('EXECUTION_REPLICATE_SUBMISSION_MISSING');

        if (canonicalResult) {
            return publishReplicateCompletion(
                selection, task, canonicalResult.result_locator, context,
            );
        }
        if (submission && completion && outputExists) {
            const published = publishReplicateResultReceipt({
                schema_version: REPLICATE_DOWNLOAD_RESULT_SCHEMA,
                run_revision_sha256: selection.manifest.run_revision_sha256,
                task_token: task.task_token,
                prediction_id: submission.prediction_id,
                status: 'succeeded',
                completed_at: completion.completed_at,
            }, context);
            return publishReplicateCompletion(selection, task, published.result_locator, context);
        }

        const result = await replicateExecutionAdapter.executeReplicatePrediction({
            requestSpec: preview.request_spec,
            apiToken: context.replicateApiToken,
            priorSubmission: submission,
            allowSubmit,
            outputPath,
            persistSubmission: async (value) => {
                submission = publishReplicateSubmission(selection, task, binding, value);
            },
            persistSucceeded: async (value) => {
                publishReplicateCompletionRecord(selection, task, binding, value);
            },
            onStatus: async (status) => {
                if (!['starting', 'processing'].includes(status)) return;
                const prior = loadReceipt(selection.paths, task.task_token, { missing: false });
                const progress = status === 'processing' ? 60 : 15;
                publishExecutionReceipt(replicateRunningReceipt(selection, task, prior, {
                    progress,
                    external_call_performed: true,
                    model_called: true,
                    generation_executed: true,
                }), context);
            },
            heartbeat: release.heartbeat,
            heartbeatIntervalMs: release.heartbeatIntervalMs,
        }, { ...context, replicateExecutionOwnerNonce: release.ownerNonce });
        const publishedResult = publishReplicateResultReceipt({
            schema_version: REPLICATE_DOWNLOAD_RESULT_SCHEMA,
            run_revision_sha256: selection.manifest.run_revision_sha256,
            task_token: task.task_token,
            prediction_id: result.prediction_id,
            status: 'succeeded',
            completed_at: result.completed_at,
        }, context);
        return publishReplicateCompletion(selection, task, publishedResult.result_locator, context);
    } catch (error) {
        if (!submission && requestRevision && error.externalCallPerformed === true
            && error.definitiveRejection !== true) {
            try { publishReplicateUncertain(selection, task, requestRevision); }
            catch { /* the receipt still fails closed below */ }
        }
        const prior = loadReceipt(selection.paths, task.task_token);
        if (submission && error.definitivePredictionTerminal !== true) throw error;
        if (prior?.status === 'running') {
            const accepted = Boolean(submission) || prior.model_called === true;
            try {
                publishExecutionReceipt(replicateFailedReceipt(selection, task, prior, error.code, {
                    external_call_performed: error.externalCallPerformed === true
                        || prior.external_call_performed || accepted,
                    model_called: error.modelCalled === true || prior.model_called || accepted,
                    generation_executed: error.generationExecuted === true
                        || prior.generation_executed || accepted,
                }), context);
            } catch { /* retain the original safe execution error */ }
        }
        throw error;
    } finally { release(); }
}

function assertSelectedRun(receipt, context) {
    const paths = exactPaths(context.userDataPath, `run_${receipt.run_revision_sha256}`);
    const manifest = loadManifest(paths);
    const selected = selectLanes(context).find((item) => item.manifest.lane === manifest.lane);
    if (!selected || !selected.prepared
        || selected.manifest.run_revision_sha256 !== manifest.run_revision_sha256) throw failure('EXECUTION_REVISION_STALE');
    return { paths, manifest };
}

function publishReplicateResultReceipt(payload, context = {}) {
    exactKeys(payload, [
        'schema_version', 'run_revision_sha256', 'task_token',
        'prediction_id', 'status', 'completed_at',
    ], 'EXECUTION_REPLICATE_RESULT_INPUT_INVALID');
    if (payload.schema_version !== REPLICATE_DOWNLOAD_RESULT_SCHEMA
        || !SHA256.test(payload.run_revision_sha256 || '')
        || !TASK_TOKEN.test(payload.task_token || '')
        || typeof payload.prediction_id !== 'string'
        || !/^[A-Za-z0-9_-]{1,160}$/.test(payload.prediction_id)
        || payload.status !== 'succeeded'
        || typeof payload.completed_at !== 'string'
        || Buffer.byteLength(payload.completed_at, 'utf8') > 64
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(payload.completed_at)
        || !Number.isFinite(Date.parse(payload.completed_at))) {
        throw failure('EXECUTION_REPLICATE_RESULT_INPUT_INVALID');
    }
    const paths = exactPaths(context.userDataPath, `run_${payload.run_revision_sha256}`);
    const manifest = loadManifest(paths);
    const selected = selectLanes(context).find((item) => item.manifest.lane === manifest.lane
        && item.manifest.run_revision_sha256 === manifest.run_revision_sha256);
    if (!selected) throw failure('EXECUTION_REVISION_STALE');
    const task = manifest.tasks.find((item) => item.task_token === payload.task_token);
    if (!task) throw failure('EXECUTION_TASK_UNKNOWN');
    if (task.lane !== 'video' || task.provider !== 'replicate') {
        throw failure('EXECUTION_REPLICATE_RESULT_TASK_INVALID');
    }
    const binding = replicateExecutionBinding({ paths, manifest }, task, context);
    return videoResultImportProvider.publishReplicateExecutionResult({
        prediction_id: payload.prediction_id,
        source_path: executionOutputPath(paths, task.task_token),
        completed_at: payload.completed_at,
        execution_binding: binding,
    }, context);
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
            if (task.lane === 'video' && task.provider === 'replicate') {
                const binding = replicateExecutionBinding({ paths, manifest }, task, context);
                const resolver = context.resolveVideoExecutionResultLocatorForExecution
                    || videoResultImportProvider.resolveVideoExecutionResultLocatorForExecution;
                const match = resolver(receipt.result_locator, binding, context);
                if (!match?.candidate_token) throw failure('EXECUTION_RESULT_LOCATOR_INVALID');
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
    const tasks = selections.flatMap((selection) => {
        const referencesByTask = referenceFilesByTask(
            selection.manifest,
            stageExecutionReferences(selection, context),
        );
        const outputTargets = stageExecutionOutputs(selection, context, referencesByTask);
        return selection.manifest.tasks.map((task) => {
            const referenceFiles = referencesByTask.get(task.task_token) || [];
            const outputPath = outputTargets.get(task.task_token) || '';
            const privateTask = {
                ...task, run_revision_sha256: selection.manifest.run_revision_sha256,
                attempt: selection.manifest.attempt, aspect_ratio: selection.manifest.aspect_ratio,
                reference_files: referenceFiles, output_path: outputPath,
                provider_execution_preview: providerExecutionPreview.buildProviderExecutionPreview({
                    ...task, aspect_ratio: selection.manifest.aspect_ratio, reference_files: referenceFiles,
                    output_path: outputPath,
                    flow_output_dir: task.provider === 'flow'
                        ? flowPreflightOutputDirectory(selection.paths, task.task_token) : '',
                }, context),
            };
            if (task.provider === 'replicate') {
                privateTask.output_claim_path = replicateClaimPath(selection.paths, task.task_token);
            }
            return privateTask;
        });
    });
    return {
        schema_version: 'film_pipeline.new_project_execution_handoff.v4',
        tasks,
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
    LEGACY_MANIFEST_SCHEMA,
    MANIFEST_SCHEMA,
    RECEIPT_SCHEMA,
    REFERENCES_SCHEMA,
    REPLICATE_CLAIM_SCHEMA,
    REPLICATE_DOWNLOAD_RESULT_SCHEMA,
    REPLICATE_SUBMISSION_SCHEMA,
    REPLICATE_COMPLETION_SCHEMA,
    STATUS_LABELS,
    FAILURE_CODES,
    FAILURE_LABELS,
    exactPaths,
    getNewProjectExecutionState,
    prepareNewProjectExecution,
    executeNextReplicateTask,
    publishReplicateResultReceipt,
    publishExecutionReceipt,
    inspectExecutionHandoff,
    getNewProjectExecutionHistory,
};
