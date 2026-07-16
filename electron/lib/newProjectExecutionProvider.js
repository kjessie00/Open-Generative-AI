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
const REPLICATE_CLAIM_SCHEMA = 'film_pipeline.replicate_output_claim.v1';
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

function replicateClaimPath(paths, taskToken) {
    if (!TASK_TOKEN.test(taskToken || '')) throw failure('EXECUTION_TASK_TOKEN_INVALID');
    return path.join(paths.outputsRoot, `${taskToken}.claim.json`);
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

function loadExecutionOutputTargets(selection, context = {}, referencesByTask = new Map()) {
    if (selection.manifest.lane !== 'video') return new Map();
    assertPrivateDirectory(selection.paths.outputsRoot, 'EXECUTION_OUTPUT_DIRECTORY_UNSAFE');
    const targets = new Map();
    const expectedNames = new Set(selection.manifest.tasks
        .filter((task) => task.provider === 'replicate')
        .map((task) => `${task.task_token}.claim.json`));
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
    if (entries.length !== expectedNames.size || entries.some((entry) => !entry.isFile()
        || entry.isSymbolicLink() || !expectedNames.has(entry.name))) {
        throw failure('EXECUTION_OUTPUT_DIRECTORY_UNSAFE');
    }
    return targets;
}

function stageExecutionOutputs(selection, context = {}, referencesByTask = new Map()) {
    if (selection.manifest.lane !== 'video') return new Map();
    ensureRunDirectories(selection.paths);
    ensureDirectory(selection.paths.outputsRoot, selection.paths.runRoot);
    const expectedNames = new Set(selection.manifest.tasks
        .filter((task) => task.provider === 'replicate')
        .map((task) => `${task.task_token}.claim.json`));
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
        loadExecutionOutputTargets(selection, context, referencesByTask);
        return true;
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
        const duration = lane === 'video' ? settings.sceneDurations.get(task.source_id) : 0;
        if (lane === 'video' && (!Number.isFinite(duration) || duration <= 0 || duration > 60)) {
            throw failure('EXECUTION_DURATION_REQUIRED');
        }
        const conflictingAspect = settings.aspectRatio === '9:16' ? '16:9' : '9:16';
        if (task.prompt.includes(conflictingAspect)) throw failure('EXECUTION_ASPECT_PROMPT_CONFLICT');
        return {
            task_token: task.task_token, lane, kind: task.kind, source_id: task.source_id,
            sequence: index + 1, label: task.label,
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

function validateTask(task, lane, index, schema) {
    const expected = [
        'task_token', 'lane', 'kind', 'sequence', 'label', 'provider', 'provider_label',
        'prompt', 'preparation_token', 'reference_task_tokens', 'reference_result_tokens',
    ];
    if (schema === MANIFEST_SCHEMA) expected.push('source_id', 'duration_seconds');
    exactKeys(task, expected, 'EXECUTION_MANIFEST_INVALID');
    if (!TASK_TOKEN.test(task.task_token || '') || task.lane !== lane || task.sequence !== index + 1
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
    value.tasks.forEach((task, index) => validateTask(task, value.lane, index, schema));
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
            }, context);
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
        task.execution_preview = executionPreview(task);
        delete task.provider_preview_readiness;
        delete task.provider_preview_blockers;
        delete task.reference_setup_missing;
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
