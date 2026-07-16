const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PREVIEW_SCHEMA = 'film_pipeline.provider_execution_preview.v1';
const DEFAULT_RUNTIME_PATHS = Object.freeze({
    dstPython: '/Users/jessiek/StudioProjects/deepSearchTeam/.venv/bin/python',
    dstModule: '/Users/jessiek/StudioProjects/deepSearchTeam/dst',
    grokPython: '/Users/jessiek/.pyenv/versions/3.11.7/bin/python3',
    grokCli: '/Users/jessiek/StudioProjects/grok-auto/grok-browser/grok_imagine_bot.py',
    grokRoot: '/Users/jessiek/StudioProjects/grok-auto/grok-browser',
});
const TASK_TOKEN = /^task_[a-f0-9]{64}$/;
const GROK_DURATIONS = new Set([6, 10, 15]);
const GROK_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '3:2', '2:3']);
const REPLICATE_DURATIONS = new Set([5, 10]);
const REPLICATE_MODEL = 'bytedance/seedance-1-pro';
const REPLICATE_URL = `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`;
const MAX_REPLICATE_DATA_URI_BYTES = 1024 * 1024;

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

function contract(task, provider, readiness, blockers, spec, extra = {}) {
    const base = {
        schema_version: PREVIEW_SCHEMA,
        provider,
        operation: task.lane === 'image' ? 'image' : 'video',
        readiness,
        blockers,
        output_kind: task.lane === 'image' ? 'image' : 'video',
        output_count: 1,
        command_spec: spec,
        ...extra,
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

function blocked(task, provider, blockers) {
    return contract(task, provider, 'blocked', Array.isArray(blockers) ? blockers : [blockers], commandSpec());
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

function grokOutputPath(task) {
    try {
        if (!TASK_TOKEN.test(task.task_token || '') || typeof task.output_path !== 'string'
            || !path.isAbsolute(task.output_path) || path.normalize(task.output_path) !== task.output_path
            || path.basename(task.output_path) !== `${task.task_token}.mp4`) return '';
        const parent = path.dirname(task.output_path);
        const parentStats = fs.lstatSync(parent);
        if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || (parentStats.mode & 0o777) !== 0o700
            || fs.realpathSync.native(parent) !== parent) return '';
        try {
            fs.lstatSync(task.output_path);
            return '';
        } catch (error) {
            return error.code === 'ENOENT' ? task.output_path : '';
        }
    } catch { return ''; }
}

function grokRuntime(runtime) {
    const python = resolvedFile(runtime.grokPython);
    const cli = resolvedFile(runtime.grokCli);
    const root = resolvedDirectory(runtime.grokRoot);
    if (!python || !cli || !root || path.dirname(cli) !== root
        || path.basename(cli) !== 'grok_imagine_bot.py') return null;
    return { python, cli, root };
}

function grokPreview(task, runtime) {
    if (!GROK_DURATIONS.has(task.duration_seconds)) {
        return blocked(task, 'grok', 'GROK_DURATION_UNSUPPORTED');
    }
    const referenceCount = task.reference_result_tokens.length;
    if (![0, 1].includes(referenceCount)) {
        return blocked(task, 'grok', 'GROK_REFERENCE_COUNT_MUST_BE_ZERO_OR_ONE');
    }
    if (task.reference_files.length !== referenceCount) {
        return blocked(task, 'grok', 'GROK_REFERENCE_STAGING_REQUIRED');
    }
    const resolvedRuntime = grokRuntime(runtime);
    if (!resolvedRuntime) return blocked(task, 'grok', 'GROK_RUNTIME_MISSING');
    const outputPath = grokOutputPath(task);
    if (!outputPath) return blocked(task, 'grok', 'GROK_OUTPUT_STAGING_REQUIRED');

    const blockers = ['GROK_NO_NONSUBMIT_MODE', 'GROK_ACCOUNT_ROTATION_CANNOT_BE_DISABLED'];
    let args;
    if (referenceCount === 1) {
        blockers.push('GROK_I2V_RATIO_NOT_CONFIGURABLE');
        args = [
            resolvedRuntime.cli, 'i2v', '--image', task.reference_files[0].path,
            '--prompt', task.prompt, '--duration', String(task.duration_seconds),
            '--output', outputPath, '--timeout', '180',
        ];
    } else {
        if (!GROK_ASPECT_RATIOS.has(task.aspect_ratio)) {
            return blocked(task, 'grok', 'GROK_ASPECT_RATIO_UNSUPPORTED');
        }
        args = [
            resolvedRuntime.cli, 'video', '--prompt', task.prompt,
            '--ratio', task.aspect_ratio, '--duration', String(task.duration_seconds),
            '--quality', '480p', '--output', outputPath, '--timeout', '180',
        ];
    }
    return contract(task, 'grok', 'preview_ready_live_blocked', blockers, commandSpec({
        command: resolvedRuntime.python,
        args,
        cwd: resolvedRuntime.root,
    }));
}

function referenceBytes(reference) {
    try {
        const before = fs.lstatSync(reference.path);
        if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
            || fs.realpathSync.native(reference.path) !== reference.path
            || typeof fs.constants.O_NOFOLLOW !== 'number') return null;
        const descriptor = fs.openSync(reference.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
            const opened = fs.fstatSync(descriptor);
            const buffer = fs.readFileSync(descriptor);
            const after = fs.fstatSync(descriptor);
            const final = fs.lstatSync(reference.path);
            const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino
                && left.mode === right.mode && left.size === right.size
                && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
            const signatureValid = reference.mime_type === 'image/png'
                ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
                : reference.mime_type === 'image/jpeg'
                    ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
                    : reference.mime_type === 'image/webp'
                        ? buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
                            && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
                        : false;
            if (!opened.isFile() || !final.isFile() || final.isSymbolicLink()
                || (final.mode & 0o777) !== 0o600 || !sameFile(before, opened)
                || !sameFile(opened, after) || !sameFile(opened, final) || after.size !== buffer.byteLength
                || reference.byte_length !== buffer.byteLength || reference.sha256 !== sha256(buffer)
                || !signatureValid) return null;
            return buffer;
        } finally { fs.closeSync(descriptor); }
    } catch { return null; }
}

function replicatePreview(task) {
    if (task.reference_result_tokens.length !== 1) {
        return blocked(task, 'replicate', 'REPLICATE_REFERENCE_COUNT_MUST_BE_ONE');
    }
    if (task.reference_files.length !== 1
        || task.reference_files[0].result_token !== task.reference_result_tokens[0]) {
        return blocked(task, 'replicate', 'REPLICATE_REFERENCE_STAGING_REQUIRED');
    }
    if (!REPLICATE_DURATIONS.has(task.duration_seconds)) {
        return blocked(task, 'replicate', 'REPLICATE_DURATION_UNSUPPORTED');
    }
    const reference = task.reference_files[0];
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(reference.mime_type)) {
        return blocked(task, 'replicate', 'REPLICATE_REFERENCE_TYPE_UNSUPPORTED');
    }
    const buffer = referenceBytes(reference);
    if (!buffer) return blocked(task, 'replicate', 'REPLICATE_REFERENCE_DRIFT');
    const image = `data:${reference.mime_type};base64,${buffer.toString('base64')}`;
    if (Buffer.byteLength(image, 'utf8') > MAX_REPLICATE_DATA_URI_BYTES) {
        return blocked(task, 'replicate', 'REPLICATE_REFERENCE_TOO_LARGE');
    }
    const base = {
        model_slug: REPLICATE_MODEL,
        method: 'POST',
        url: REPLICATE_URL,
        header_names: ['Authorization', 'Content-Type', 'Prefer'],
        headers: { 'Content-Type': 'application/json', Prefer: 'wait' },
        authorization_env: 'REPLICATE_API_TOKEN',
        body: {
            input: {
                prompt: task.prompt,
                image,
                duration: task.duration_seconds,
                resolution: '1080p',
                fps: 24,
                camera_fixed: false,
            },
        },
        preview_only: true,
        live_submit_allowed: false,
        external_call_performed: false,
    };
    const requestSpec = { ...base, request_revision_sha256: sha256(JSON.stringify(base)) };
    return contract(task, 'replicate', 'preview_ready', [], commandSpec(), { request_spec: requestSpec });
}

function buildProviderExecutionPreview(task, context = {}) {
    const runtime = { ...DEFAULT_RUNTIME_PATHS, ...(context.runtimePaths || {}) };
    const normalized = {
        ...task,
        reference_result_tokens: Array.isArray(task?.reference_result_tokens)
            ? task.reference_result_tokens : [],
        reference_files: Array.isArray(task?.reference_files)
            ? task.reference_files.map(resolvedReferenceFile).filter(Boolean) : [],
        output_path: typeof task?.output_path === 'string' ? task.output_path : '',
    };
    if (normalized.lane === 'image') return dstPreview(normalized, runtime);
    if (normalized.provider === 'flow') return flowPreview(normalized);
    if (normalized.provider === 'grok') return grokPreview(normalized, runtime);
    if (normalized.provider === 'replicate') return replicatePreview(normalized);
    const blocker = normalized.provider === 'bytedance'
            ? 'MISSING_BYTEDANCE_GENERATION_ADAPTER'
            : 'MISSING_PROVIDER_ADAPTER';
    return blocked(normalized, normalized.provider || 'unknown', blocker);
}

module.exports = {
    PREVIEW_SCHEMA,
    buildProviderExecutionPreview,
};
