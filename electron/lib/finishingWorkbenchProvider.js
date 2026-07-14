const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const FINISHING_OUTPUT_CONTRACT_VERSION = 'film_pipeline.finishing_workbench.v1';
const FINISHING_PROBE_SCHEMA = 'film_pipeline.finishing_probe.v1';
const FINISHING_RECEIPT_SCHEMA = 'film_pipeline.finishing_receipt.v1';
const FINISHING_POINTER_SCHEMA = 'film_pipeline.finishing_current.v1';
const PLAN_TTL_MS = 2 * 60 * 1000;
const MAX_JSON_BYTES = 512 * 1024;
const MAX_HARNESS_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;
const MAX_RUNS = 1000;
const OUTPUT_DURATION_TOLERANCE_SECONDS = 0.35;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const RUN_ID_PATTERN = /^[a-f0-9]{24}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SENSITIVE_SEGMENT_PATTERN = /(^|[._-])(auth|cookie|credential|keychain|secret|session|token)([._-]|$)/i;
const DEFAULT_ADAPTER_PATH = path.resolve(__dirname, '../../scripts/run_selected_range_roughcut.py');
const DEFAULT_HARNESS_ROOT = '/Users/jessiek/StudioProjects/happyVideoFactory';

const CANONICAL_FILES = Object.freeze([
    'beats.json',
    'shot_manifest.json',
    'selected_takes.json',
    'qc_report.json',
]);

const HARNESS_FILES = Object.freeze([
    'video_core/short_drama/edit/timeline_builder.py',
    'video_core/short_drama/edit/roughcut_ffmpeg.py',
    'video_core/short_drama/edit/timeline_model.py',
    'video_core/ffmpeg/duration.py',
    'video_core/ffmpeg_runtime.py',
    'video_core/short_drama_room/contracts.py',
    'video_core/short_drama_room/validator.py',
]);

const defaultPlanStore = new Map();

function failure(code, message = code) {
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    return error;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
    }
    return value;
}

function stableJson(value) {
    return JSON.stringify(stableValue(value));
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).sort().join(',') === [...expected].sort().join(','));
}

function safeId(value) {
    return typeof value === 'string' && SAFE_ID_PATTERN.test(value) ? value : '';
}

function finiteNumber(value, minimum = -Infinity, maximum = Infinity) {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
        ? value
        : null;
}

function publicErrorCode(error, fallback = 'FINISHING_WORKBENCH_BLOCKED') {
    return /^FINISHING_[A-Z0-9_]+$/.test(error?.code || '') ? error.code : fallback;
}

function assertNormalizedAbsolute(value, code) {
    if (typeof value !== 'string' || !value || value.includes('\0')
        || !path.isAbsolute(value) || path.normalize(value) !== value) {
        throw failure(code);
    }
    return value;
}

function assertRoot(rootPath) {
    const root = assertNormalizedAbsolute(rootPath, 'FINISHING_PRODUCTION_ROOT_INVALID');
    let stats;
    try {
        stats = fs.lstatSync(root);
    } catch {
        throw failure('FINISHING_PRODUCTION_ROOT_MISSING');
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw failure('FINISHING_PRODUCTION_ROOT_UNSAFE');
    }
    const realRoot = fs.realpathSync.native(root);
    return { root, realRoot, dev: stats.dev, ino: stats.ino };
}

function assertPathComponents(rootInfo, targetPath, { directory = false, maxBytes = Infinity } = {}) {
    const target = assertNormalizedAbsolute(targetPath, 'FINISHING_SOURCE_PATH_INVALID');
    if (target !== rootInfo.root && !target.startsWith(`${rootInfo.root}${path.sep}`)) {
        throw failure('FINISHING_SOURCE_OUTSIDE_PRODUCTION');
    }
    const relative = path.relative(rootInfo.root, target);
    const components = relative ? relative.split(path.sep) : [];
    if (components.some((component) => !component || component === '.' || component === '..'
        || component.includes('\0') || SENSITIVE_SEGMENT_PATTERN.test(component))) {
        throw failure('FINISHING_SOURCE_PATH_FORBIDDEN');
    }
    let current = rootInfo.root;
    for (let index = 0; index < components.length; index += 1) {
        current = path.join(current, components[index]);
        let stats;
        try {
            stats = fs.lstatSync(current);
        } catch {
            throw failure(index === components.length - 1 ? 'FINISHING_SOURCE_MISSING' : 'FINISHING_SOURCE_PARENT_MISSING');
        }
        if (stats.isSymbolicLink()) throw failure('FINISHING_SOURCE_SYMLINK_FORBIDDEN');
        if (index < components.length - 1 && !stats.isDirectory()) throw failure('FINISHING_SOURCE_PARENT_UNSAFE');
        if (index === components.length - 1) {
            if (directory ? !stats.isDirectory() : !stats.isFile()) throw failure('FINISHING_SOURCE_TYPE_INVALID');
            if (!directory && (stats.size <= 0 || stats.size > maxBytes)) throw failure('FINISHING_SOURCE_SIZE_INVALID');
        }
    }
    const realTarget = fs.realpathSync.native(target);
    if (realTarget !== rootInfo.realRoot && !realTarget.startsWith(`${rootInfo.realRoot}${path.sep}`)) {
        throw failure('FINISHING_SOURCE_REALPATH_ESCAPE');
    }
    return { target, relative, stats: fs.lstatSync(target), realTarget };
}

function readStrictFile(filePath, maxBytes, codePrefix) {
    let before;
    try {
        before = fs.lstatSync(filePath);
    } catch {
        throw failure(`${codePrefix}_MISSING`);
    }
    if (before.isSymbolicLink() || !before.isFile()) throw failure(`${codePrefix}_UNSAFE`);
    if (before.size <= 0 || before.size > maxBytes) throw failure(`${codePrefix}_SIZE_INVALID`);
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('FINISHING_NOFOLLOW_UNAVAILABLE');
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
            throw failure(`${codePrefix}_CHANGED`);
        }
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
            || after.mtimeMs !== opened.mtimeMs || buffer.byteLength !== opened.size) {
            throw failure(`${codePrefix}_CHANGED`);
        }
        return {
            buffer,
            sha256: sha256(buffer),
            size: buffer.byteLength,
            mtimeMs: opened.mtimeMs,
            identity: `${opened.dev}:${opened.ino}:${opened.size}:${opened.mtimeMs}`,
        };
    } finally {
        fs.closeSync(descriptor);
    }
}

function readStrictJson(filePath, maxBytes, codePrefix) {
    const record = readStrictFile(filePath, maxBytes, codePrefix);
    const text = record.buffer.toString('utf8');
    if (text.includes('\0')) throw failure(`${codePrefix}_MALFORMED`);
    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
        return { ...record, value };
    } catch {
        throw failure(`${codePrefix}_MALFORMED`);
    }
}

async function hashStableRegularFile(filePath, maxBytes, codePrefix) {
    let before;
    try {
        before = fs.lstatSync(filePath);
    } catch {
        throw failure(`${codePrefix}_MISSING`);
    }
    if (before.isSymbolicLink() || !before.isFile()) throw failure(`${codePrefix}_UNSAFE`);
    if (before.size <= 0 || before.size > maxBytes) throw failure(`${codePrefix}_SIZE_INVALID`);
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('FINISHING_NOFOLLOW_UNAVAILABLE');
    const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
            throw failure(`${codePrefix}_CHANGED`);
        }
        const digest = crypto.createHash('sha256');
        let bytes = 0;
        const stream = handle.createReadStream({ autoClose: false });
        for await (const chunk of stream) {
            bytes += chunk.byteLength;
            if (bytes > maxBytes) throw failure(`${codePrefix}_SIZE_INVALID`);
            digest.update(chunk);
        }
        const after = await handle.stat();
        if (bytes !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino
            || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) {
            throw failure(`${codePrefix}_CHANGED`);
        }
        return {
            sha256: digest.digest('hex'),
            size: bytes,
            mtimeMs: opened.mtimeMs,
            identity: `${opened.dev}:${opened.ino}:${opened.size}:${opened.mtimeMs}`,
        };
    } finally {
        await handle.close();
    }
}

function parseRate(value) {
    if (typeof value !== 'string' || !value) return 0;
    if (value.includes('/')) {
        const [numerator, denominator] = value.split('/').map(Number);
        return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : 0;
    }
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function killProcessTree(child, signal) {
    if (!child?.pid) return;
    try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
    } catch {}
}

function runBoundedProcess(executable, args, options = {}) {
    assertNormalizedAbsolute(executable, 'FINISHING_BINARY_PATH_INVALID');
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
        return Promise.reject(failure('FINISHING_PROCESS_ARGUMENT_INVALID'));
    }
    const timeoutMs = options.timeoutMs || 30_000;
    const maxOutputBytes = options.maxOutputBytes || MAX_PROCESS_OUTPUT_BYTES;
    return new Promise((resolve, reject) => {
        let settled = false;
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        let timedOut = false;
        let outputExceeded = false;
        const child = spawn(executable, args, {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            detached: process.platform !== 'win32',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const append = (current, chunk) => {
            const next = Buffer.concat([current, Buffer.from(chunk)]);
            if (next.byteLength > maxOutputBytes) {
                outputExceeded = true;
                killProcessTree(child, 'SIGTERM');
                return next.subarray(0, maxOutputBytes);
            }
            return next;
        };
        child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
        child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(failure('FINISHING_PROCESS_START_FAILED', error.code || 'start failed'));
        });
        const timer = setTimeout(() => {
            timedOut = true;
            killProcessTree(child, 'SIGTERM');
            setTimeout(() => killProcessTree(child, 'SIGKILL'), 2_000).unref();
        }, timeoutMs);
        child.on('close', (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (timedOut) return reject(failure('FINISHING_PROCESS_TIMEOUT'));
            if (outputExceeded) return reject(failure('FINISHING_PROCESS_OUTPUT_TOO_LARGE'));
            resolve({
                code,
                signal,
                stdout: stdout.toString('utf8'),
                stderr: stderr.toString('utf8'),
            });
        });
    });
}

function minimalEnvironment(runtime, harnessRoot) {
    const pathEntries = Array.from(new Set([
        path.dirname(runtime.ffmpeg.path),
        path.dirname(runtime.ffprobe.path),
        path.dirname(runtime.python.path),
        '/usr/bin',
        '/bin',
    ]));
    return Object.freeze({
        PATH: pathEntries.join(path.delimiter),
        PYTHONPATH: harnessRoot,
        HVF_FFMPEG_PATH: runtime.ffmpeg.path,
        HVF_FFPROBE_PATH: runtime.ffprobe.path,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
    });
}

function versionLine(text, prefix) {
    const line = String(text || '').split(/\r?\n/, 1)[0].trim().slice(0, 160);
    if (!line) throw failure(`${prefix}_VERSION_UNAVAILABLE`);
    return line;
}

function pythonCandidates() {
    const values = [
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
        '/usr/local/anaconda3/bin/python3',
        '/usr/bin/python3',
    ];
    const versionsRoot = path.join(os.homedir(), '.pyenv', 'versions');
    try {
        for (const version of fs.readdirSync(versionsRoot).sort().reverse()) {
            if (/^3\.\d+\.\d+$/.test(version)) values.unshift(path.join(versionsRoot, version, 'bin', 'python3'));
        }
    } catch {}
    return values;
}

const FFMPEG_CANDIDATES = Object.freeze([
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/local/anaconda3/bin/ffmpeg',
    '/usr/bin/ffmpeg',
]);
const FFPROBE_CANDIDATES = Object.freeze(FFMPEG_CANDIDATES.map((candidate) => path.join(path.dirname(candidate), 'ffprobe')));

async function workingBinary(candidates, versionArgs, codePrefix) {
    for (const candidate of candidates) {
        try {
            const realPath = fs.realpathSync.native(candidate);
            const fingerprint = await hashStableRegularFile(realPath, 1024 * 1024 * 1024, `${codePrefix}_BINARY`);
            if ((fs.statSync(realPath).mode & 0o111) === 0) continue;
            const result = await runBoundedProcess(realPath, versionArgs, {
                cwd: '/', env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, timeoutMs: 5_000, maxOutputBytes: 32 * 1024,
            });
            if (result.code !== 0) continue;
            return { path: realPath, version: versionLine(`${result.stdout}\n${result.stderr}`, codePrefix), identity: fingerprint.sha256 };
        } catch {}
    }
    throw failure(`${codePrefix}_BINARY_UNAVAILABLE`);
}

async function defaultRuntimeResolver(context) {
    const [ffmpeg, ffprobe] = await Promise.all([
        workingBinary(FFMPEG_CANDIDATES, ['-version'], 'FINISHING_FFMPEG'),
        workingBinary(FFPROBE_CANDIDATES, ['-version'], 'FINISHING_FFPROBE'),
    ]);
    for (const candidate of pythonCandidates()) {
        try {
            const python = await workingBinary([candidate], ['--version'], 'FINISHING_PYTHON');
            const runtime = { python, ffmpeg, ffprobe };
            const check = await runBoundedProcess(python.path, [context.adapterPath, '--check'], {
                cwd: context.harnessRoot,
                env: minimalEnvironment(runtime, context.harnessRoot),
                timeoutMs: 10_000,
                maxOutputBytes: 32 * 1024,
            });
            if (check.code !== 0) continue;
            const checkValue = JSON.parse(check.stdout);
            if (checkValue?.ok === true) return runtime;
        } catch {}
    }
    throw failure('FINISHING_HARNESS_IMPORT_FAILED');
}

async function defaultMediaProbe(sourcePath, context, runtime) {
    const result = await runBoundedProcess(runtime.ffprobe.path, [
        '-v', 'error',
        '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
        '-of', 'json',
        '--', sourcePath,
    ], {
        cwd: context.harnessRoot,
        env: minimalEnvironment(runtime, context.harnessRoot),
        timeoutMs: 30_000,
        maxOutputBytes: 128 * 1024,
    });
    if (result.code !== 0) throw failure('FINISHING_FFPROBE_FAILED');
    let value;
    try { value = JSON.parse(result.stdout); } catch { throw failure('FINISHING_FFPROBE_MALFORMED'); }
    const duration = Number(value?.format?.duration);
    const streams = Array.isArray(value?.streams) && value.streams.length <= 32 ? value.streams : [];
    const video = streams.find((stream) => stream?.codec_type === 'video');
    const audio = streams.find((stream) => stream?.codec_type === 'audio');
    if (!Number.isFinite(duration) || duration <= 0 || !video) throw failure('FINISHING_MEDIA_PROBE_INVALID');
    return {
        duration_seconds: duration,
        has_video: true,
        has_audio: Boolean(audio),
        video_codec: String(video.codec_name || '').slice(0, 40),
        audio_codec: String(audio?.codec_name || '').slice(0, 40),
        width: Number.isInteger(video.width) && video.width > 0 ? video.width : 0,
        height: Number.isInteger(video.height) && video.height > 0 ? video.height : 0,
        fps: parseRate(video.r_frame_rate),
    };
}

async function defaultRender({ outputPath, payloadPath, context, runtime }) {
    const result = await runBoundedProcess(runtime.python.path, [
        context.adapterPath,
        '--payload', payloadPath,
        '--output', outputPath,
        '--ffmpeg', runtime.ffmpeg.path,
        '--ffprobe', runtime.ffprobe.path,
    ], {
        cwd: context.harnessRoot,
        env: minimalEnvironment(runtime, context.harnessRoot),
        timeoutMs: 30 * 60 * 1000,
        maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
    });
    if (result.code !== 0) throw failure('FINISHING_RENDER_FAILED');
    let value;
    try { value = JSON.parse(result.stdout); } catch { throw failure('FINISHING_RENDER_RESULT_MALFORMED'); }
    if (value?.success !== true) throw failure('FINISHING_RENDER_FAILED');
    return value;
}

function validateRuntime(runtime) {
    if (!exactKeys(runtime, ['python', 'ffmpeg', 'ffprobe'])) throw failure('FINISHING_RUNTIME_INVALID');
    for (const key of ['python', 'ffmpeg', 'ffprobe']) {
        const item = runtime[key];
        if (!item || typeof item.path !== 'string' || !path.isAbsolute(item.path)
            || typeof item.version !== 'string' || !item.version || item.version.length > 160
            || typeof item.identity !== 'string' || !item.identity) {
            throw failure('FINISHING_RUNTIME_INVALID');
        }
    }
    return runtime;
}

async function fingerprintHarness(context) {
    const rootInfo = assertRoot(context.harnessRoot);
    const records = [];
    for (const relativePath of HARNESS_FILES) {
        const absolutePath = path.join(rootInfo.root, ...relativePath.split('/'));
        const record = readStrictFile(absolutePath, MAX_HARNESS_BYTES, 'FINISHING_HARNESS_FILE');
        const real = fs.realpathSync.native(absolutePath);
        if (!real.startsWith(`${rootInfo.realRoot}${path.sep}`)) throw failure('FINISHING_HARNESS_ESCAPE');
        records.push({ relativePath, sha256: record.sha256, identity: record.identity, size: record.size });
    }
    const adapter = readStrictFile(context.adapterPath, MAX_HARNESS_BYTES, 'FINISHING_ADAPTER');
    return { files: records, adapter: { sha256: adapter.sha256, identity: adapter.identity, size: adapter.size } };
}

function validateCanonicalShape(documents) {
    const beats = documents['beats.json'].value;
    const manifest = documents['shot_manifest.json'].value;
    const selected = documents['selected_takes.json'].value;
    const qc = documents['qc_report.json'].value;
    const blockers = [];
    const add = (code) => { if (!blockers.includes(code)) blockers.push(code); };

    if (!exactKeys(beats, ['schema_version', 'project_id', 'episode_id', 'runtime_target_sec', 'beats'])
        || beats.schema_version !== 'short-drama-room-beats-v1' || !Array.isArray(beats.beats)
        || beats.beats.length < 1 || beats.beats.length > 1000) add('FINISHING_BEATS_INVALID');
    if (!exactKeys(manifest, ['schema_version', 'project_id', 'episode_id', 'runtime_target_sec', 'aspect_ratio', 'shots'])
        || manifest.schema_version !== 'short-drama-room-shot-manifest-v1' || !Array.isArray(manifest.shots)
        || manifest.shots.length < 1 || manifest.shots.length > 1000) add('FINISHING_SHOT_MANIFEST_INVALID');
    if (!exactKeys(selected, ['schema_version', 'project_id', 'episode_id', 'takes'])
        || selected.schema_version !== 'short-drama-room-selected-takes-v1' || !Array.isArray(selected.takes)
        || selected.takes.length < 1 || selected.takes.length > 1000) add('FINISHING_SELECTED_TAKES_INVALID');
    if (!exactKeys(qc, ['schema_version', 'project_id', 'episode_id', 'shot_qc', 'subtitle_audio_drift_s'])
        || qc.schema_version !== 'short-drama-room-qc-report-v1' || !Array.isArray(qc.shot_qc)
        || qc.shot_qc.length < 1 || qc.shot_qc.length > 1000) add('FINISHING_QC_INVALID');
    if (blockers.length) return { blockers };

    const projectId = safeId(selected.project_id);
    const episodeId = safeId(selected.episode_id);
    if (!projectId || !episodeId || [beats, manifest, qc].some((doc) => doc.project_id !== projectId || doc.episode_id !== episodeId)) {
        add('FINISHING_PROJECT_METADATA_MISMATCH');
    }
    if (documents['qc_report.json'].mtimeMs < documents['selected_takes.json'].mtimeMs) add('FINISHING_QC_STALE');
    if (beats.beats.length !== manifest.shots.length || selected.takes.length !== beats.beats.length
        || qc.shot_qc.length !== selected.takes.length) add('FINISHING_CANONICAL_COVERAGE_MISMATCH');

    const beatIds = new Set();
    const shotIds = new Set();
    const takeByBeat = new Map();
    const takeByShot = new Map();
    const qcByShot = new Map();
    let previousOrder = -Infinity;
    const expectedOrder = [];
    const timelineScenes = [];
    const sceneMap = new Map();

    for (let index = 0; index < beats.beats.length; index += 1) {
        const beat = beats.beats[index];
        const shot = manifest.shots[index];
        if (!beat || typeof beat !== 'object' || Array.isArray(beat)
            || !safeId(beat.beat_id) || !safeId(beat.scene_id)
            || !Number.isInteger(beat.order) || beat.order <= previousOrder || beatIds.has(beat.beat_id)) {
            add('FINISHING_BEAT_ORDER_INVALID');
            continue;
        }
        previousOrder = beat.order;
        beatIds.add(beat.beat_id);
        if (!shot || typeof shot !== 'object' || Array.isArray(shot)
            || !safeId(shot.shot_id) || !safeId(shot.scene_id) || shot.scene_id !== beat.scene_id
            || shotIds.has(shot.shot_id) || !Array.isArray(shot.dialogue)) {
            add('FINISHING_BEAT_SHOT_ADAPTER_INVALID');
            continue;
        }
        shotIds.add(shot.shot_id);
        const dialogueLines = [];
        for (const line of shot.dialogue) {
            if (!line || typeof line !== 'object' || Array.isArray(line)
                || typeof line.character !== 'string' || typeof line.line !== 'string'
                || line.character.length > 128 || line.line.length > 2000) {
                add('FINISHING_DIALOGUE_ADAPTER_INVALID');
                continue;
            }
            dialogueLines.push({ character_id: line.character, line_text_ko: line.line });
        }
        if (!sceneMap.has(beat.scene_id)) {
            const scene = { beats: [] };
            sceneMap.set(beat.scene_id, scene);
            timelineScenes.push(scene);
        }
        sceneMap.get(beat.scene_id).beats.push({ beat_id: beat.beat_id, dialogue_lines: dialogueLines });
        expectedOrder.push({ shot_id: shot.shot_id, beat_id: beat.beat_id });
    }

    for (const take of selected.takes) {
        const allowed = ['shot_id', 'chosen_provider', 'video_path', 'dialogue_source', 'qc_report_ref', 'selected_at', 'beat_id', 'take_id', 'source_in_sec', 'source_out_sec', 'transition_in'];
        if (!exactKeys(take, allowed) || !safeId(take.shot_id) || !safeId(take.beat_id) || !safeId(take.take_id)
            || !['seedance', 'flow'].includes(take.chosen_provider)
            || !['native_video_lipsync', 'tts_adr_overlay'].includes(take.dialogue_source)
            || typeof take.qc_report_ref !== 'string' || !take.qc_report_ref
            || typeof take.selected_at !== 'string' || !take.selected_at
            || takeByBeat.has(take.beat_id) || takeByShot.has(take.shot_id)) {
            add('FINISHING_SELECTED_TAKE_INVALID');
            continue;
        }
        const sourceIn = finiteNumber(take.source_in_sec, 0);
        const sourceOut = finiteNumber(take.source_out_sec, 0);
        if (sourceIn === null || sourceOut === null || sourceOut <= sourceIn) add('FINISHING_SOURCE_RANGE_INVALID');
        if (!exactKeys(take.transition_in, ['type', 'dur'])
            || take.transition_in.type !== 'cut' || take.transition_in.dur !== 0) add('FINISHING_TRANSITION_UNSUPPORTED');
        takeByBeat.set(take.beat_id, take);
        takeByShot.set(take.shot_id, take);
    }
    for (const entry of qc.shot_qc) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !safeId(entry.shot_id)
            || qcByShot.has(entry.shot_id) || !['seedance', 'flow'].includes(entry.provider)
            || entry.deterministic_checks_passed !== true || entry.decision !== 'accept'
            || !Array.isArray(entry.gemini_findings) || entry.gemini_findings.length > 1000
            || finiteNumber(entry.dialogue_intelligibility_score, 0, 1) === null
            || typeof entry.pronunciation_risk_flag !== 'boolean') {
            add('FINISHING_QC_NOT_READY');
            continue;
        }
        qcByShot.set(entry.shot_id, entry);
    }

    for (const expected of expectedOrder) {
        const take = takeByBeat.get(expected.beat_id);
        const qcEntry = qcByShot.get(expected.shot_id);
        if (!take || take.shot_id !== expected.shot_id || !qcEntry
            || qcEntry.provider !== take.chosen_provider) add('FINISHING_CANONICAL_MAPPING_MISMATCH');
        if (take) {
            expected.source_in_sec = take.source_in_sec;
            expected.source_out_sec = take.source_out_sec;
        }
    }
    return { blockers, projectId, episodeId, expectedOrder, timelineBeats: { scenes: timelineScenes }, takeByBeat };
}

function outputPaths(root) {
    const finalRoot = path.join(root, 'final');
    const runsRoot = path.join(finalRoot, 'workbench_runs');
    return { finalRoot, runsRoot, currentPath: path.join(runsRoot, 'current.json'), lockPath: path.join(runsRoot, '.workbench.lock') };
}

function inspectOutputState(rootInfo) {
    const paths = outputPaths(rootInfo.root);
    const blockers = [];
    const records = [];
    for (const [label, target] of [['final', paths.finalRoot], ['runs', paths.runsRoot]]) {
        try {
            const stats = fs.lstatSync(target);
            if (stats.isSymbolicLink() || !stats.isDirectory()) blockers.push(`FINISHING_${label.toUpperCase()}_DIRECTORY_UNSAFE`);
            else records.push({ label, type: 'directory', identity: `${stats.dev}:${stats.ino}:${stats.mtimeMs}`, mode: stats.mode & 0o777 });
        } catch (error) {
            if (error.code !== 'ENOENT') blockers.push(`FINISHING_${label.toUpperCase()}_DIRECTORY_UNREADABLE`);
            records.push({ label, type: 'missing' });
        }
    }
    if (fs.existsSync(paths.runsRoot)) {
        const names = fs.readdirSync(paths.runsRoot).sort();
        if (names.length > MAX_RUNS + 3) blockers.push('FINISHING_WORKBENCH_RUN_LIMIT_EXCEEDED');
        for (const name of names) {
            const target = path.join(paths.runsRoot, name);
            const stats = fs.lstatSync(target);
            if (stats.isSymbolicLink()) blockers.push('FINISHING_OUTPUT_SYMLINK_FORBIDDEN');
            if (name.startsWith('.staging-')) blockers.push('FINISHING_PARTIAL_PUBLICATION_PRESENT');
            else if (name === '.workbench.lock') blockers.push('FINISHING_CONCURRENT_LOCKED');
            else if (name !== 'current.json' && !RUN_ID_PATTERN.test(name)) blockers.push('FINISHING_OUTPUT_ENTRY_INVALID');
            if (name === 'current.json' && (!stats.isFile() || stats.size > MAX_JSON_BYTES)) blockers.push('FINISHING_CURRENT_POINTER_INVALID');
            records.push({ name, type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other', size: stats.size, identity: `${stats.dev}:${stats.ino}:${stats.mtimeMs}` });
        }
    }
    return { paths, blockers: Array.from(new Set(blockers)), digest: sha256(stableJson(records)) };
}

async function readCurrentRun(rootInfo, inputSnapshotId = '') {
    const { paths } = inspectOutputState(rootInfo);
    if (!fs.existsSync(paths.currentPath)) return { status: 'empty', blockers: [], current: null };
    try {
        const pointerRecord = readStrictJson(paths.currentPath, MAX_JSON_BYTES, 'FINISHING_CURRENT_POINTER');
        const pointer = pointerRecord.value;
        if (!exactKeys(pointer, ['schema_version', 'run_id', 'receipt_sha256', 'updated_at'])
            || pointer.schema_version !== FINISHING_POINTER_SCHEMA || !RUN_ID_PATTERN.test(pointer.run_id)
            || !/^[a-f0-9]{64}$/.test(pointer.receipt_sha256) || typeof pointer.updated_at !== 'string') {
            throw failure('FINISHING_CURRENT_POINTER_INVALID');
        }
        const runRoot = path.join(paths.runsRoot, pointer.run_id);
        assertPathComponents(rootInfo, runRoot, { directory: true });
        const runStats = fs.lstatSync(runRoot);
        if ((runStats.mode & 0o077) !== 0) throw failure('FINISHING_RUN_PERMISSIONS_INVALID');
        const names = fs.readdirSync(runRoot).sort();
        if (names.join(',') !== 'fresh_probe.json,receipt.json,roughcut.mp4') throw failure('FINISHING_RUN_CONTENT_INVALID');
        const receiptRecord = readStrictJson(path.join(runRoot, 'receipt.json'), MAX_JSON_BYTES, 'FINISHING_RECEIPT');
        if (receiptRecord.sha256 !== pointer.receipt_sha256) throw failure('FINISHING_RECEIPT_HASH_MISMATCH');
        const receipt = receiptRecord.value;
        const receiptKeys = [
            'schema_version', 'contract_version', 'run_id', 'input_snapshot_id', 'project_id', 'episode_id',
            'selected_range_count', 'selected_duration_seconds', 'output_sha256', 'output_size_bytes',
            'probe_sha256', 'render_started_at', 'render_completed_at', 'tool_versions',
            'fresh_probe_verified', 'output_quality_approved', 'canonical_delivery_modified',
        ];
        if (!exactKeys(receipt, receiptKeys) || receipt.schema_version !== FINISHING_RECEIPT_SCHEMA
            || receipt.contract_version !== FINISHING_OUTPUT_CONTRACT_VERSION || receipt.run_id !== pointer.run_id
            || !/^[a-f0-9]{64}$/.test(receipt.input_snapshot_id) || !safeId(receipt.project_id)
            || !safeId(receipt.episode_id) || receipt.fresh_probe_verified !== true
            || receipt.output_quality_approved !== false || receipt.canonical_delivery_modified !== false) {
            throw failure('FINISHING_RECEIPT_INVALID');
        }
        const outputPath = path.join(runRoot, 'roughcut.mp4');
        const probePath = path.join(runRoot, 'fresh_probe.json');
        for (const target of [outputPath, probePath, path.join(runRoot, 'receipt.json')]) {
            const stats = fs.lstatSync(target);
            if ((stats.mode & 0o077) !== 0) throw failure('FINISHING_RUN_PERMISSIONS_INVALID');
        }
        const output = await hashStableRegularFile(outputPath, MAX_MEDIA_BYTES, 'FINISHING_CURRENT_OUTPUT');
        if (output.sha256 !== receipt.output_sha256 || output.size !== receipt.output_size_bytes) throw failure('FINISHING_CURRENT_OUTPUT_HASH_MISMATCH');
        const probeRecord = readStrictJson(probePath, MAX_JSON_BYTES, 'FINISHING_CURRENT_PROBE');
        if (probeRecord.sha256 !== receipt.probe_sha256) throw failure('FINISHING_CURRENT_PROBE_HASH_MISMATCH');
        const probe = probeRecord.value;
        const probeKeys = [
            'schema_version', 'contract_version', 'run_id', 'input_snapshot_id', 'probed_at',
            'duration_seconds', 'selected_duration_seconds', 'duration_tolerance_seconds',
            'has_video', 'has_audio', 'video_codec', 'audio_codec', 'width', 'height', 'fps',
            'output_sha256', 'output_size_bytes', 'tool_versions', 'fresh_probe_verified',
            'output_quality_approved',
        ];
        if (!exactKeys(probe, probeKeys) || probe.schema_version !== FINISHING_PROBE_SCHEMA
            || probe.contract_version !== FINISHING_OUTPUT_CONTRACT_VERSION || probe.run_id !== pointer.run_id
            || probe.input_snapshot_id !== receipt.input_snapshot_id || probe.output_sha256 !== receipt.output_sha256
            || probe.output_size_bytes !== receipt.output_size_bytes || probe.fresh_probe_verified !== true
            || probe.output_quality_approved !== false || probe.has_video !== true || probe.has_audio !== true
            || Math.abs(probe.duration_seconds - probe.selected_duration_seconds) > probe.duration_tolerance_seconds) {
            throw failure('FINISHING_CURRENT_PROBE_INVALID');
        }
        const stale = Boolean(inputSnapshotId && receipt.input_snapshot_id !== inputSnapshotId);
        return {
            status: stale ? 'stale' : 'success',
            blockers: stale ? ['FINISHING_CURRENT_INPUT_STALE'] : [],
            current: {
                run_id: receipt.run_id,
                input_snapshot_id: receipt.input_snapshot_id,
                selected_range_count: receipt.selected_range_count,
                selected_duration_seconds: receipt.selected_duration_seconds,
                output_duration_seconds: probe.duration_seconds,
                output_size_bytes: receipt.output_size_bytes,
                output_sha256_short: `${receipt.output_sha256.slice(0, 12)}…`,
                fresh_probe_verified: true,
                output_quality_approved: false,
                render_completed_at: receipt.render_completed_at,
            },
        };
    } catch (error) {
        return { status: 'blocked', blockers: [publicErrorCode(error, 'FINISHING_CURRENT_ARTIFACT_INVALID')], current: null };
    }
}

async function inspectProduction(context) {
    const rootInfo = assertRoot(context.config?.productionRoot);
    const documents = {};
    for (const name of CANONICAL_FILES) {
        documents[name] = readStrictJson(path.join(rootInfo.root, name), MAX_JSON_BYTES, `FINISHING_${name.replace(/\W/g, '_').toUpperCase()}`);
    }
    const canonical = validateCanonicalShape(documents);
    const blockers = [...canonical.blockers];
    const harness = await fingerprintHarness(context).catch((error) => {
        blockers.push(publicErrorCode(error, 'FINISHING_HARNESS_UNAVAILABLE'));
        return null;
    });
    const runtime = await context.runtimeResolver(context).then(validateRuntime).catch((error) => {
        blockers.push(publicErrorCode(error, 'FINISHING_RUNTIME_UNAVAILABLE'));
        return null;
    });
    const sources = [];
    const renderTakes = [];
    if (!blockers.some((code) => code.includes('CANONICAL') || code.includes('BEAT') || code.includes('SELECTED') || code.includes('PROJECT'))) {
        for (const expected of canonical.expectedOrder || []) {
            const take = canonical.takeByBeat.get(expected.beat_id);
            try {
                const sourceEvidence = assertPathComponents(rootInfo, take.video_path, { maxBytes: MAX_MEDIA_BYTES });
                const [fingerprint, probe] = await Promise.all([
                    hashStableRegularFile(sourceEvidence.target, MAX_MEDIA_BYTES, 'FINISHING_SOURCE'),
                    runtime ? context.mediaProbe(sourceEvidence.target, context, runtime) : Promise.reject(failure('FINISHING_RUNTIME_UNAVAILABLE')),
                ]);
                if (!probe || finiteNumber(probe.duration_seconds, 0) === null || probe.has_video !== true || probe.has_audio !== true) {
                    throw failure('FINISHING_SOURCE_MEDIA_INVALID');
                }
                if (take.source_out_sec > probe.duration_seconds + 0.05) throw failure('FINISHING_SOURCE_RANGE_EXCEEDS_MEDIA');
                const sourceIndex = sources.length;
                sources.push({
                    shot_id: expected.shot_id,
                    beat_id: expected.beat_id,
                    source_index: sourceIndex,
                    source_path: sourceEvidence.target,
                    source_relative_path: sourceEvidence.relative,
                    source_in_sec: take.source_in_sec,
                    source_out_sec: take.source_out_sec,
                    fingerprint,
                    probe: {
                        duration_seconds: probe.duration_seconds,
                        has_video: true,
                        has_audio: true,
                        width: probe.width || 0,
                        height: probe.height || 0,
                        fps: probe.fps || 0,
                    },
                });
                renderTakes.push({ ...take, video_path: sourceEvidence.target });
            } catch (error) {
                blockers.push(publicErrorCode(error, 'FINISHING_SOURCE_INVALID'));
            }
        }
    }
    const outputState = inspectOutputState(rootInfo);
    blockers.push(...outputState.blockers);
    const uniqueBlockers = Array.from(new Set(blockers));
    const selectedDuration = (canonical.expectedOrder || []).reduce((sum, entry) => {
        const duration = Number(entry.source_out_sec) - Number(entry.source_in_sec);
        return Number.isFinite(duration) && duration > 0 ? sum + duration : sum;
    }, 0);
    const snapshotCore = {
        contract: FINISHING_OUTPUT_CONTRACT_VERSION,
        project_id: canonical.projectId || '',
        episode_id: canonical.episodeId || '',
        canonical: Object.fromEntries(CANONICAL_FILES.map((name) => [name, {
            sha256: documents[name].sha256,
            size: documents[name].size,
            identity: documents[name].identity,
        }])),
        expected_order: canonical.expectedOrder || [],
        sources: sources.map((source) => ({
            shot_id: source.shot_id,
            beat_id: source.beat_id,
            source_relative_path: source.source_relative_path,
            source_in_sec: source.source_in_sec,
            source_out_sec: source.source_out_sec,
            fingerprint: source.fingerprint,
            probe: source.probe,
        })),
        harness,
        runtime: runtime ? Object.fromEntries(['python', 'ffmpeg', 'ffprobe'].map((key) => [key, {
            identity: runtime[key].identity,
            version: runtime[key].version,
        }])) : null,
    };
    const inputSnapshotId = sha256(stableJson(snapshotCore));
    const current = await readCurrentRun(rootInfo, inputSnapshotId);
    const securityBlockers = current.status === 'blocked' ? current.blockers : [];
    uniqueBlockers.push(...securityBlockers);
    const finalBlockers = Array.from(new Set(uniqueBlockers));
    return {
        rootInfo,
        documents,
        canonical,
        harness,
        runtime,
        sources,
        outputState,
        inputSnapshotId,
        runId: inputSnapshotId.slice(0, 24),
        selectedDuration,
        current,
        blockers: finalBlockers,
        renderPayload: {
            schema_version: 'film_pipeline.finishing_render_payload.v1',
            selected_takes: {
                schema_version: 'short-drama-room-selected-takes-v1',
                project_id: canonical.projectId,
                episode_id: canonical.episodeId,
                takes: renderTakes,
            },
            timeline_beats: canonical.timelineBeats,
            expected_order: canonical.expectedOrder,
        },
    };
}

function publicCurrent(current) {
    return current?.current ? { ...current.current } : null;
}

function publicWorkspace(inspection) {
    const hardBlocked = inspection.blockers.length > 0;
    const alreadyCurrent = !hardBlocked && inspection.current.status === 'success';
    const status = hardBlocked ? 'blocked' : alreadyCurrent ? 'success' : inspection.current.status === 'stale' ? 'stale' : 'ready_to_plan';
    return {
        ok: !hardBlocked,
        schema_version: FINISHING_OUTPUT_CONTRACT_VERSION,
        status,
        ready_to_plan: !hardBlocked && !alreadyCurrent,
        already_current: alreadyCurrent,
        project_id: inspection.canonical.projectId || '',
        episode_id: inspection.canonical.episodeId || '',
        selected_range_count: inspection.canonical.expectedOrder?.length || 0,
        selected_duration_seconds: Number(inspection.selectedDuration.toFixed(3)),
        input_ready: inspection.sources.length > 0 && inspection.sources.length === inspection.canonical.expectedOrder?.length,
        qc_ready: !inspection.blockers.includes('FINISHING_QC_NOT_READY') && !inspection.blockers.includes('FINISHING_QC_STALE'),
        harness_ready: Boolean(inspection.harness),
        runtime_ready: Boolean(inspection.runtime),
        output_contract: {
            version: FINISHING_OUTPUT_CONTRACT_VERSION,
            location: 'production/final/workbench_runs/<content-derived-run-id>',
            canonical_delivery_untouched: true,
        },
        tool_status: inspection.runtime ? {
            python: inspection.runtime.python.version,
            ffmpeg: inspection.runtime.ffmpeg.version,
            ffprobe: inspection.runtime.ffprobe.version,
        } : { python: '사용 불가', ffmpeg: '사용 불가', ffprobe: '사용 불가' },
        current_run: publicCurrent(inspection.current),
        current_blockers: [...(inspection.current.blockers || [])],
        blockers: [...inspection.blockers],
        output_quality_approved: false,
        quality_notice: '렌더 실행 성공 ≠ 영상 품질 승인',
        cooperative_lock_limit: '협조하지 않는 외부 writer가 최종 검사와 rename 사이에 바꾸는 native TOCTOU는 완전히 제거할 수 없습니다.',
    };
}

function blockedWorkspace(error) {
    return {
        ok: false,
        schema_version: FINISHING_OUTPUT_CONTRACT_VERSION,
        status: 'blocked',
        ready_to_plan: false,
        already_current: false,
        project_id: '',
        episode_id: '',
        selected_range_count: 0,
        selected_duration_seconds: 0,
        input_ready: false,
        qc_ready: false,
        harness_ready: false,
        runtime_ready: false,
        output_contract: { version: FINISHING_OUTPUT_CONTRACT_VERSION, location: 'production/final/workbench_runs/<content-derived-run-id>', canonical_delivery_untouched: true },
        tool_status: { python: '사용 불가', ffmpeg: '사용 불가', ffprobe: '사용 불가' },
        current_run: null,
        current_blockers: [],
        blockers: [publicErrorCode(error)],
        output_quality_approved: false,
        quality_notice: '렌더 실행 성공 ≠ 영상 품질 승인',
        cooperative_lock_limit: '협조하지 않는 외부 writer가 최종 검사와 rename 사이에 바꾸는 native TOCTOU는 완전히 제거할 수 없습니다.',
    };
}

function ensureDirectory(target, mode, enforcePrivate = true) {
    let created = false;
    try {
        const stats = fs.lstatSync(target);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure('FINISHING_OUTPUT_DIRECTORY_UNSAFE');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        fs.mkdirSync(target, { mode });
        created = true;
    }
    if (created || enforcePrivate) fs.chmodSync(target, mode);
    const stats = fs.lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isDirectory()
        || (enforcePrivate && (stats.mode & 0o077) !== 0)) throw failure('FINISHING_OUTPUT_DIRECTORY_UNSAFE');
}

function writeExclusive(target, buffer, mode = 0o600) {
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
        | (typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0);
    const descriptor = fs.openSync(target, flags, mode);
    try {
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
    fs.chmodSync(target, mode);
}

function fsyncDirectory(target) {
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function assertRenderSummary(summary, inspection) {
    const expected = inspection.canonical.expectedOrder;
    if (!summary || summary.success !== true
        || !Array.isArray(summary.shot_ids) || !Array.isArray(summary.beat_ids) || !Array.isArray(summary.ranges)
        || summary.shot_ids.join('\0') !== expected.map((entry) => entry.shot_id).join('\0')
        || summary.beat_ids.join('\0') !== expected.map((entry) => entry.beat_id).join('\0')
        || summary.ranges.length !== expected.length
        || summary.ranges.some((range, index) => !Array.isArray(range) || range.length !== 2
            || range[0] !== expected[index].source_in_sec || range[1] !== expected[index].source_out_sec)
        || Math.abs(Number(summary.total_duration_seconds) - inspection.selectedDuration) > 0.001) {
        throw failure('FINISHING_RENDER_SUMMARY_MISMATCH');
    }
}

function atomicWriteCurrent(paths, pointer, randomBytes) {
    const currentExists = fs.existsSync(paths.currentPath);
    if (currentExists) {
        const stats = fs.lstatSync(paths.currentPath);
        if (stats.isSymbolicLink() || !stats.isFile()) throw failure('FINISHING_CURRENT_POINTER_UNSAFE');
    }
    const temp = path.join(paths.runsRoot, `.current-${process.pid}-${randomBytes(8).toString('hex')}`);
    let renamed = false;
    try {
        writeExclusive(temp, Buffer.from(`${JSON.stringify(pointer, null, 2)}\n`));
        fs.renameSync(temp, paths.currentPath);
        renamed = true;
        fs.chmodSync(paths.currentPath, 0o600);
        fsyncDirectory(paths.runsRoot);
    } finally {
        if (!renamed) {
            try { fs.unlinkSync(temp); } catch {}
        }
    }
}

function createFinishingWorkbenchProvider(options = {}) {
    const context = {
        config: options.config || {},
        harnessRoot: options.harnessRoot || DEFAULT_HARNESS_ROOT,
        adapterPath: options.adapterPath || DEFAULT_ADAPTER_PATH,
        runtimeResolver: options.runtimeResolver || defaultRuntimeResolver,
        mediaProbe: options.mediaProbe || defaultMediaProbe,
        render: options.render || defaultRender,
        now: options.now || (() => new Date()),
        nowMs: options.nowMs || (() => Date.now()),
        randomBytes: options.randomBytes || crypto.randomBytes,
        planStore: options.planStore || defaultPlanStore,
        planTtlMs: options.planTtlMs || PLAN_TTL_MS,
    };

    async function getWorkspace() {
        try {
            return publicWorkspace(await inspectProduction(context));
        } catch (error) {
            return blockedWorkspace(error);
        }
    }

    async function plan() {
        let inspection;
        try {
            inspection = await inspectProduction(context);
        } catch (error) {
            return { ...blockedWorkspace(error), ready: false, plan_token: '', expires_at: '' };
        }
        const workspace = publicWorkspace(inspection);
        if (!workspace.ok || workspace.already_current) {
            return {
                ...workspace,
                status: workspace.already_current ? 'already_current' : workspace.status,
                ready: false,
                plan_token: '',
                expires_at: '',
            };
        }
        const createdAtMs = context.nowMs();
        const expiresAtMs = createdAtMs + context.planTtlMs;
        const planToken = context.randomBytes(32).toString('hex');
        context.planStore.set(planToken, {
            createdAtMs,
            expiresAtMs,
            projectId: inspection.canonical.projectId,
            inputSnapshotId: inspection.inputSnapshotId,
            outputStateDigest: inspection.outputState.digest,
            runId: inspection.runId,
        });
        return {
            ...workspace,
            status: 'ready',
            ready: true,
            plan_token: planToken,
            expires_at: new Date(expiresAtMs).toISOString(),
        };
    }

    async function execute(payload) {
        const token = payload?.planToken;
        if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw failure('FINISHING_PLAN_TOKEN_INVALID');
        const planRecord = context.planStore.get(token);
        context.planStore.delete(token);
        if (!planRecord) throw failure('FINISHING_PLAN_TOKEN_INVALID');
        if (!exactKeys(payload, ['planToken', 'confirmed', 'projectId'])) throw failure('FINISHING_EXECUTION_ENVELOPE_INVALID');
        if (payload.confirmed !== true) throw failure('FINISHING_CONFIRMATION_REQUIRED');
        if (typeof payload.projectId !== 'string' || payload.projectId !== planRecord.projectId) throw failure('FINISHING_PROJECT_CONFIRMATION_MISMATCH');
        if (context.nowMs() > planRecord.expiresAtMs) throw failure('FINISHING_PLAN_EXPIRED');

        const inspection = await inspectProduction(context);
        if (inspection.inputSnapshotId !== planRecord.inputSnapshotId
            || inspection.outputState.digest !== planRecord.outputStateDigest
            || inspection.runId !== planRecord.runId) throw failure('FINISHING_PLAN_DRIFT');
        if (inspection.blockers.length) throw failure('FINISHING_REVALIDATION_BLOCKED');
        if (inspection.current.status === 'success') {
            return { ...publicWorkspace(inspection), status: 'already_current', executed: false, ready: false };
        }

        const paths = outputPaths(inspection.rootInfo.root);
        ensureDirectory(paths.finalRoot, 0o700, false);
        ensureDirectory(paths.runsRoot, 0o700);
        const lockDescriptor = fs.openSync(
            paths.lockPath,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
                | (typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0),
            0o600,
        );
        fs.writeFileSync(lockDescriptor, `${process.pid}\n`);
        fs.fsyncSync(lockDescriptor);
        fs.closeSync(lockDescriptor);
        const stagingRoot = path.join(paths.runsRoot, `.staging-${inspection.runId}-${context.randomBytes(8).toString('hex')}`);
        const runRoot = path.join(paths.runsRoot, inspection.runId);
        let published = false;
        let startedAt = context.now().toISOString();
        try {
            if (fs.existsSync(runRoot)) throw failure('FINISHING_RUN_TARGET_EXISTS');
            fs.mkdirSync(stagingRoot, { mode: 0o700 });
            fs.chmodSync(stagingRoot, 0o700);
            const payloadPath = path.join(stagingRoot, 'render_payload.json');
            const outputPath = path.join(stagingRoot, 'roughcut.mp4');
            writeExclusive(payloadPath, Buffer.from(`${JSON.stringify(inspection.renderPayload)}\n`));
            const summary = await context.render({
                outputPath,
                payloadPath,
                renderPayload: inspection.renderPayload,
                context,
                runtime: inspection.runtime,
            });
            assertRenderSummary(summary, inspection);
            const outputStats = fs.lstatSync(outputPath);
            if (outputStats.isSymbolicLink() || !outputStats.isFile() || outputStats.size <= 0 || outputStats.size > MAX_MEDIA_BYTES) {
                throw failure('FINISHING_RENDER_OUTPUT_INVALID');
            }
            fs.chmodSync(outputPath, 0o600);
            const outputFingerprint = await hashStableRegularFile(outputPath, MAX_MEDIA_BYTES, 'FINISHING_RENDER_OUTPUT');
            const probe = await context.mediaProbe(outputPath, context, inspection.runtime);
            if (!probe || probe.has_video !== true || probe.has_audio !== true
                || finiteNumber(probe.duration_seconds, 0) === null
                || Math.abs(probe.duration_seconds - inspection.selectedDuration) > OUTPUT_DURATION_TOLERANCE_SECONDS) {
                throw failure('FINISHING_OUTPUT_DURATION_OR_STREAM_MISMATCH');
            }
            const completedAt = context.now().toISOString();
            const toolVersions = {
                python: inspection.runtime.python.version,
                ffmpeg: inspection.runtime.ffmpeg.version,
                ffprobe: inspection.runtime.ffprobe.version,
            };
            const probeDocument = {
                schema_version: FINISHING_PROBE_SCHEMA,
                contract_version: FINISHING_OUTPUT_CONTRACT_VERSION,
                run_id: inspection.runId,
                input_snapshot_id: inspection.inputSnapshotId,
                probed_at: completedAt,
                duration_seconds: Number(probe.duration_seconds.toFixed(6)),
                selected_duration_seconds: Number(inspection.selectedDuration.toFixed(6)),
                duration_tolerance_seconds: OUTPUT_DURATION_TOLERANCE_SECONDS,
                has_video: true,
                has_audio: true,
                video_codec: String(probe.video_codec || '').slice(0, 40),
                audio_codec: String(probe.audio_codec || '').slice(0, 40),
                width: Number.isInteger(probe.width) ? probe.width : 0,
                height: Number.isInteger(probe.height) ? probe.height : 0,
                fps: finiteNumber(probe.fps, 0) || 0,
                output_sha256: outputFingerprint.sha256,
                output_size_bytes: outputFingerprint.size,
                tool_versions: toolVersions,
                fresh_probe_verified: true,
                output_quality_approved: false,
            };
            const probeBuffer = Buffer.from(`${JSON.stringify(probeDocument, null, 2)}\n`);
            const probePath = path.join(stagingRoot, 'fresh_probe.json');
            writeExclusive(probePath, probeBuffer);
            const receiptDocument = {
                schema_version: FINISHING_RECEIPT_SCHEMA,
                contract_version: FINISHING_OUTPUT_CONTRACT_VERSION,
                run_id: inspection.runId,
                input_snapshot_id: inspection.inputSnapshotId,
                project_id: inspection.canonical.projectId,
                episode_id: inspection.canonical.episodeId,
                selected_range_count: inspection.canonical.expectedOrder.length,
                selected_duration_seconds: Number(inspection.selectedDuration.toFixed(6)),
                output_sha256: outputFingerprint.sha256,
                output_size_bytes: outputFingerprint.size,
                probe_sha256: sha256(probeBuffer),
                render_started_at: startedAt,
                render_completed_at: completedAt,
                tool_versions: toolVersions,
                fresh_probe_verified: true,
                output_quality_approved: false,
                canonical_delivery_modified: false,
            };
            const receiptBuffer = Buffer.from(`${JSON.stringify(receiptDocument, null, 2)}\n`);
            writeExclusive(path.join(stagingRoot, 'receipt.json'), receiptBuffer);
            fs.unlinkSync(payloadPath);
            fsyncDirectory(stagingRoot);
            fs.renameSync(stagingRoot, runRoot);
            published = true;
            fsyncDirectory(paths.runsRoot);
            atomicWriteCurrent(paths, {
                schema_version: FINISHING_POINTER_SCHEMA,
                run_id: inspection.runId,
                receipt_sha256: sha256(receiptBuffer),
                updated_at: completedAt,
            }, context.randomBytes);
            const verified = await readCurrentRun(inspection.rootInfo, inspection.inputSnapshotId);
            if (verified.status !== 'success' || !verified.current) throw failure('FINISHING_PUBLICATION_VERIFY_FAILED');
            return {
                ok: true,
                schema_version: FINISHING_OUTPUT_CONTRACT_VERSION,
                status: 'success',
                executed: true,
                already_current: false,
                run_id: inspection.runId,
                selected_range_count: inspection.canonical.expectedOrder.length,
                selected_duration_seconds: Number(inspection.selectedDuration.toFixed(3)),
                output_duration_seconds: Number(probe.duration_seconds.toFixed(3)),
                output_size_bytes: outputFingerprint.size,
                output_sha256_short: `${outputFingerprint.sha256.slice(0, 12)}…`,
                fresh_probe_verified: true,
                output_quality_approved: false,
                quality_notice: '렌더 실행 성공 ≠ 영상 품질 승인',
                render_completed_at: completedAt,
            };
        } catch (error) {
            if (published) {
                try { fs.rmSync(runRoot, { recursive: true, force: true }); } catch {}
            } else {
                try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
            }
            throw failure(publicErrorCode(error, 'FINISHING_EXECUTION_FAILED'));
        } finally {
            try { fs.unlinkSync(paths.lockPath); } catch {}
            try { fsyncDirectory(paths.runsRoot); } catch {}
        }
    }

    return Object.freeze({ getWorkspace, plan, execute });
}

module.exports = {
    createFinishingWorkbenchProvider,
    runBoundedProcess,
    FINISHING_OUTPUT_CONTRACT_VERSION,
    FINISHING_PROBE_SCHEMA,
    FINISHING_RECEIPT_SCHEMA,
    FINISHING_POINTER_SCHEMA,
    OUTPUT_DURATION_TOLERANCE_SECONDS,
    DEFAULT_HARNESS_ROOT,
    DEFAULT_ADAPTER_PATH,
    HARNESS_FILES,
};
