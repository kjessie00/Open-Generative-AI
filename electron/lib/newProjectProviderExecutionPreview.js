const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PREVIEW_SCHEMA = 'film_pipeline.provider_execution_preview.v1';
const DEFAULT_RUNTIME_PATHS = Object.freeze({
    dstPython: '/Users/jessiek/StudioProjects/deepSearchTeam/.venv/bin/python',
    dstModule: '/Users/jessiek/StudioProjects/deepSearchTeam/dst',
});

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function resolvedFile(filePath) {
    try {
        if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return '';
        const resolved = fs.realpathSync.native(filePath);
        return path.isAbsolute(resolved) && fs.statSync(resolved).isFile() ? resolved : '';
    } catch { return ''; }
}

function resolvedDirectory(directoryPath) {
    try {
        if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) return '';
        const resolved = fs.realpathSync.native(directoryPath);
        return path.isAbsolute(resolved) && fs.statSync(resolved).isDirectory() ? resolved : '';
    } catch { return ''; }
}

function resolvedReferenceFile(reference) {
    try {
        if (!reference || typeof reference !== 'object' || Array.isArray(reference)
            || typeof reference.path !== 'string' || !path.isAbsolute(reference.path)
            || typeof reference.result_token !== 'string' || typeof reference.sha256 !== 'string') return null;
        const stats = fs.lstatSync(reference.path);
        if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600
            || fs.realpathSync.native(reference.path) !== reference.path) return null;
        return reference;
    } catch { return null; }
}

function commandSpec(values = {}) {
    return {
        command: '', args: [], cwd: '', shell: false,
        preview_only: true, live_submit_allowed: false, copy_allowed: false,
        ...values,
    };
}

function contract(task, provider, readiness, blockers, spec) {
    const base = {
        schema_version: PREVIEW_SCHEMA,
        provider,
        operation: task.lane === 'image' ? 'image' : 'video',
        readiness,
        blockers,
        output_kind: task.lane === 'image' ? 'image' : 'video',
        output_count: 1,
        command_spec: spec,
    };
    const revision = {
        task_token: task.task_token || '', source_id: task.source_id || '', prompt: task.prompt || '',
        aspect_ratio: task.aspect_ratio || '', duration_seconds: task.duration_seconds,
        reference_result_tokens: task.reference_result_tokens,
        reference_files: task.reference_files.map((reference) => ({
            result_token: reference.result_token,
            task_token: reference.task_token,
            mime_type: reference.mime_type,
            byte_length: reference.byte_length,
            sha256: reference.sha256,
            path: reference.path,
        })),
        preview: base,
    };
    return { ...base, contract_revision_sha256: sha256(JSON.stringify(revision)) };
}

function blocked(task, provider, blocker) {
    return contract(task, provider, 'blocked', [blocker], commandSpec());
}

function dstPreview(task, runtime) {
    if (task.kind === 'scene_image') {
        if (!task.reference_result_tokens.length
            || task.reference_files.length !== task.reference_result_tokens.length) {
            return blocked(task, 'dst', 'DST_REFERENCE_STAGING_REQUIRED');
        }
    } else if (task.reference_result_tokens.length > 0) {
        return blocked(task, 'dst', 'DST_TASK_KIND_UNSUPPORTED');
    }
    if (!['character_sheet', 'location_sheet', 'scene_image'].includes(task.kind)) {
        return blocked(task, 'dst', 'DST_TASK_KIND_UNSUPPORTED');
    }
    const python = resolvedFile(runtime.dstPython);
    const moduleDirectory = resolvedDirectory(runtime.dstModule);
    if (!python || !moduleDirectory) {
        return blocked(task, 'dst', 'DST_RUNTIME_MISSING');
    }
    const args = [
        '-m', 'dst', 'image', task.prompt,
        '-p', 'goldpure369', '--count', '1', '--set-count', '1',
        '--aspect', task.aspect_ratio,
    ];
    task.reference_files.forEach((reference) => args.push('--attach', reference.path));
    return contract(task, 'dst', 'preview_ready', [], commandSpec({
        command: python,
        args,
        cwd: path.dirname(moduleDirectory),
    }));
}

function flowPreview(task) {
    const referenceCount = task.reference_result_tokens.length;
    if (![0, 2].includes(referenceCount)) {
        return blocked(task, 'flow', 'FLOW_REFERENCE_COUNT_MUST_BE_ZERO_OR_TWO');
    }
    if (referenceCount === 2 && task.reference_files.length !== 2) {
        return blocked(task, 'flow', 'FLOW_REFERENCE_STAGING_REQUIRED');
    }
    return blocked(task, 'flow', 'FLOW_PRIVATE_RUNTIME_CONTEXT_REQUIRED');
}

function grokPreview(task) {
    if (![6, 10, 15].includes(task.duration_seconds)) {
        return blocked(task, 'grok', 'GROK_DURATION_UNSUPPORTED');
    }
    if (task.reference_result_tokens.length > 0
        && task.reference_files.length !== task.reference_result_tokens.length) {
        return blocked(task, 'grok', 'GROK_REFERENCE_STAGING_REQUIRED');
    }
    return blocked(task, 'grok', 'GROK_NO_NONSUBMIT_MODE');
}

function buildProviderExecutionPreview(task, context = {}) {
    const runtime = { ...DEFAULT_RUNTIME_PATHS, ...(context.runtimePaths || {}) };
    const normalized = {
        ...task,
        reference_result_tokens: Array.isArray(task?.reference_result_tokens)
            ? task.reference_result_tokens : [],
        reference_files: Array.isArray(task?.reference_files)
            ? task.reference_files.map(resolvedReferenceFile).filter(Boolean) : [],
    };
    if (normalized.lane === 'image') return dstPreview(normalized, runtime);
    if (normalized.provider === 'flow') return flowPreview(normalized);
    if (normalized.provider === 'grok') return grokPreview(normalized);
    const blocker = normalized.provider === 'replicate'
        ? 'MISSING_REPLICATE_GENERATION_ADAPTER'
        : normalized.provider === 'bytedance'
            ? 'MISSING_BYTEDANCE_GENERATION_ADAPTER'
            : 'MISSING_PROVIDER_ADAPTER';
    return blocked(normalized, normalized.provider || 'unknown', blocker);
}

module.exports = {
    PREVIEW_SCHEMA,
    buildProviderExecutionPreview,
};
