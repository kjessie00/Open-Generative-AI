const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { readProductionFolder } = require('./productionReader');

const WORKSPACE_SCHEMA = 'film_pipeline.video_result_import_workspace.v1';
const PLAN_SCHEMA = 'film_pipeline.video_result_import_plan.v1';
const EXTERNAL_RESULT_SCHEMA = 'film_pipeline.external_video_result.v1';
const EXTERNAL_RESULT_SCHEMA_V2 = 'film_pipeline.external_video_result.v2';
const DEFAULT_FLOW_RESULTS_ROOT = '/Users/jessiek/StudioProjects/google_labs_flow_auto/outputs/generated';
const DEFAULT_GROK_RESULTS_ROOT = '/Users/jessiek/StudioProjects/grok-auto/grok-browser/outputs';
const DEFAULT_REPLICATE_RESULTS_ROOT = '/Users/jessiek/StudioProjects/happyVideoFactory/docs/xhs_ad_tests/20260515_smart_doorbell_ai_reversal/replicate_seedance_clips';
const DEFAULT_REPLICATE_RECEIPT_RESULTS_ROOT = '/Users/jessiek/StudioProjects/happyVideoFactory/outputs/provider_results/replicate';
const DEFAULT_BYTEDANCE_RECEIPT_RESULTS_ROOT = '/Users/jessiek/StudioProjects/happyVideoFactory/outputs/provider_results/bytedance';
const DEFAULT_FFPROBE_PATH = '/opt/homebrew/bin/ffprobe';
const IMPORT_RELATIVE_ROOT = 'media/imports';
const MAX_CANDIDATES = 24;
const MAX_SCAN_ENTRIES = 240;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
const MAX_PROVENANCE_BYTES = 128 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_TARGET_LABEL_BYTES = 512;
const MAX_TARGET_LABEL_CHARACTERS = 160;
const DEFAULT_PLAN_TTL_MS = 2 * 60 * 1000;
const MAX_PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_FFPROBE_OUTPUT_BYTES = 1024 * 1024;
const SESSION_TOKEN_SECRET = crypto.randomBytes(32);
const SESSION_PLAN_STORE = new Map();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const REPLICATE_PREDICTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DEFAULT_REPLICATE_SHA_ALLOWLIST = Object.freeze({
    seedance_1: 'a685206f1e318fe12611c210ff411b3160b02608cf967c81233ba1e81db451ee',
    seedance_2: '300693afb1854374e28476afd8254763b28076e779b41487cd60da52f7f97c36',
    seedance_3: '4324cf0208e44ddfb235ed24c2087efaf0363c04e9527899c21f4b50cbbce9df',
});

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
        || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
        throw failure(code);
    }
}

function safeId(value, code = 'VIDEO_IMPORT_ID_INVALID') {
    if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) throw failure(code);
    return value;
}

function safeOptionalText(value, maximum, code) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value, 'utf8') > maximum) {
        throw failure(code);
    }
    return value;
}

function boundedTargetLabel(value) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
        throw failure('VIDEO_IMPORT_INITIAL_TARGET_LABEL_INVALID');
    }
    const label = value.trim().normalize('NFC');
    if (!label || [...label].length > MAX_TARGET_LABEL_CHARACTERS
        || Buffer.byteLength(label, 'utf8') > MAX_TARGET_LABEL_BYTES) {
        throw failure('VIDEO_IMPORT_INITIAL_TARGET_LABEL_INVALID');
    }
    return label;
}

function identity(stats) {
    return {
        dev: stats.dev,
        ino: stats.ino,
        mode: stats.mode,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
    };
}

function sameIdentity(left, right) {
    return Boolean(left && right)
        && ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'ctimeMs'].every((key) => left[key] === right[key]);
}

function sameDirectoryIdentity(left, right) {
    return Boolean(left && right)
        && ['dev', 'ino', 'mode'].every((key) => left[key] === right[key]);
}

function sameSnapshot(left, right) {
    if (left.exists !== right.exists) return false;
    if (!left.exists) return true;
    return left.sha256 === right.sha256 && left.size === right.size && sameIdentity(left.identity, right.identity);
}

function assertRealDirectory(directoryPath, code, options = {}) {
    if (typeof directoryPath !== 'string' || !directoryPath || directoryPath.includes('\0')
        || !path.isAbsolute(directoryPath) || path.normalize(directoryPath) !== directoryPath) throw failure(code);
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw failure(code); }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure(code);
    const realPath = fs.realpathSync.native(directoryPath);
    if (realPath !== directoryPath) throw failure(code);
    if (options.parentRoot && path.dirname(realPath) !== options.parentRoot) throw failure(code);
    return { path: realPath, realPath, stats, identity: identity(stats) };
}

function optionalRealDirectory(directoryPath, code) {
    try {
        fs.lstatSync(directoryPath);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw failure(code);
    }
    return assertRealDirectory(directoryPath, code);
}

function assertStableDirectory(info, code) {
    const current = fs.lstatSync(info.path);
    if (current.isSymbolicLink() || !current.isDirectory() || fs.realpathSync.native(info.path) !== info.realPath
        || !sameIdentity(info.identity, identity(current))) throw failure(code);
}

function assertAncestors(rootInfo, filePath, code) {
    const relative = path.relative(rootInfo.path, filePath);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw failure(code);
    const parts = relative.split(path.sep);
    let cursor = rootInfo.path;
    for (let index = 0; index < parts.length; index += 1) {
        cursor = path.join(cursor, parts[index]);
        let stats;
        try { stats = fs.lstatSync(cursor); } catch (error) {
            if (error.code === 'ENOENT' && index === parts.length - 1) return;
            throw failure(code);
        }
        if (stats.isSymbolicLink()) throw failure(code);
        if (index < parts.length - 1 && !stats.isDirectory()) throw failure(code);
        if (index === parts.length - 1 && !stats.isFile()) throw failure(code);
        const real = fs.realpathSync.native(cursor);
        if (real !== rootInfo.realPath && !real.startsWith(`${rootInfo.realPath}${path.sep}`)) throw failure(code);
    }
}

function sniffMp4(header, size) {
    if (!Buffer.isBuffer(header) || header.byteLength < 12 || size < 12) throw failure('VIDEO_IMPORT_MP4_TYPE_INVALID');
    const boxSize = header.readUInt32BE(0);
    if (boxSize < 8 || boxSize > size || header.toString('ascii', 4, 8) !== 'ftyp') {
        throw failure('VIDEO_IMPORT_MP4_TYPE_INVALID');
    }
}

function hashStableFile(filePath, maximum = MAX_VIDEO_BYTES, code = 'VIDEO_IMPORT_SOURCE_UNSAFE') {
    let before;
    try { before = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') throw failure(`${code}_MISSING`);
        throw failure(code);
    }
    if (before.isSymbolicLink() || !before.isFile() || before.size <= 0 || before.size > maximum) {
        throw failure(before.size > maximum ? `${code}_TOO_LARGE` : code);
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('VIDEO_IMPORT_NOFOLLOW_UNAVAILABLE');
    let descriptor;
    try {
        descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || !sameIdentity(identity(before), identity(opened))) throw failure(`${code}_CHANGED`);
        const digest = crypto.createHash('sha256');
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        let header = Buffer.alloc(0);
        while (position < opened.size) {
            const count = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, opened.size - position), position);
            if (count <= 0) throw failure(`${code}_CHANGED`);
            if (position === 0) header = Buffer.from(chunk.subarray(0, Math.min(count, 64)));
            digest.update(chunk.subarray(0, count));
            position += count;
        }
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(filePath);
        if (position !== opened.size || !sameIdentity(identity(opened), identity(after))
            || !sameIdentity(identity(opened), identity(pathAfter))) throw failure(`${code}_CHANGED`);
        sniffMp4(header, opened.size);
        return {
            exists: true,
            sha256: digest.digest('hex'),
            size: opened.size,
            identity: identity(opened),
            header,
        };
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function smallFile(filePath, maximum, code, options = {}) {
    let before;
    try { before = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') {
            return { exists: false, buffer: Buffer.alloc(0), sha256: '', size: 0, identity: null };
        }
        throw failure(code);
    }
    if (before.isSymbolicLink() || !before.isFile() || (!options.allowEmpty && before.size <= 0) || before.size > maximum) {
        throw failure(before.size > maximum ? `${code}_TOO_LARGE` : code);
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('VIDEO_IMPORT_NOFOLLOW_UNAVAILABLE');
    let descriptor;
    try {
        descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor);
        if (!sameIdentity(identity(before), identity(opened))) throw failure(`${code}_CHANGED`);
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(filePath);
        if (buffer.byteLength !== opened.size || !sameIdentity(identity(opened), identity(after))
            || !sameIdentity(identity(opened), identity(pathAfter))) throw failure(`${code}_CHANGED`);
        return { exists: true, buffer, sha256: sha256(buffer), size: buffer.byteLength, identity: identity(opened) };
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function parseJson(read, code) {
    if (!read.exists) throw failure(code);
    try {
        const value = JSON.parse(read.buffer.toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
        return value;
    } catch {
        throw failure(code);
    }
}

function ffprobe(filePath, context = {}) {
    const command = context.ffprobePath || DEFAULT_FFPROBE_PATH;
    if (typeof command !== 'string' || !path.isAbsolute(command) || path.normalize(command) !== command) {
        throw failure('VIDEO_IMPORT_FFPROBE_PATH_INVALID');
    }
    const args = [
        '-v', 'error',
        '-show_entries', 'format=format_name,duration:stream=codec_type,width,height,duration',
        '-of', 'json',
        filePath,
    ];
    const run = context.runProcessFn || childProcess.spawnSync;
    const result = run(command, args, {
        encoding: 'utf8',
        maxBuffer: MAX_FFPROBE_OUTPUT_BYTES,
        timeout: 15000,
        windowsHide: true,
        shell: false,
    });
    if (!result || result.error || result.signal || result.status !== 0 || typeof result.stdout !== 'string'
        || Buffer.byteLength(result.stdout, 'utf8') > MAX_FFPROBE_OUTPUT_BYTES) {
        throw failure('VIDEO_IMPORT_FFPROBE_FAILED');
    }
    let value;
    try { value = JSON.parse(result.stdout); } catch { throw failure('VIDEO_IMPORT_FFPROBE_INVALID'); }
    const formatName = value?.format?.format_name;
    const video = Array.isArray(value?.streams) ? value.streams.find((stream) => stream?.codec_type === 'video') : null;
    const duration = Number(value?.format?.duration ?? video?.duration);
    const width = Number(video?.width);
    const height = Number(video?.height);
    if (typeof formatName !== 'string' || !/(?:^|,)(?:mov|mp4)(?:,|$)/.test(formatName)
        || !Number.isFinite(duration) || duration <= 0 || duration > 3600
        || !Number.isSafeInteger(width) || width <= 0 || width > 16384
        || !Number.isSafeInteger(height) || height <= 0 || height > 16384) {
        throw failure('VIDEO_IMPORT_FFPROBE_INVALID');
    }
    return { durationSeconds: duration, width, height };
}

function tokenSecret(context = {}) {
    const secret = context.tokenSecret || SESSION_TOKEN_SECRET;
    if (!Buffer.isBuffer(secret) || secret.byteLength < 32) throw failure('VIDEO_IMPORT_TOKEN_SECRET_INVALID');
    return secret;
}

function candidateToken(candidate, context = {}) {
    return crypto.createHmac('sha256', tokenSecret(context)).update([
        candidate.rootFingerprint,
        candidate.provider,
        candidate.resultId,
        candidate.source.sha256,
        String(candidate.source.size),
        String(candidate.probe.durationSeconds),
        String(candidate.probe.width),
        String(candidate.probe.height),
        candidate.provenance?.sha256 || '',
    ].join('\0')).digest('base64url');
}

function inspectCandidate(provider, resultId, filePath, rootInfo, context = {}, options = {}) {
    safeId(resultId, 'VIDEO_IMPORT_RESULT_ID_INVALID');
    if (path.extname(filePath).toLowerCase() !== '.mp4') throw failure('VIDEO_IMPORT_EXTENSION_INVALID');
    assertAncestors(rootInfo, filePath, 'VIDEO_IMPORT_SOURCE_UNSAFE');
    const before = hashStableFile(filePath, context.maxVideoBytes || MAX_VIDEO_BYTES);
    if (options.expectedSha256 && before.sha256 !== options.expectedSha256) {
        throw failure('VIDEO_IMPORT_SOURCE_HASH_UNAPPROVED');
    }
    if (options.expectedSize && before.size !== options.expectedSize) {
        throw failure('VIDEO_IMPORT_SOURCE_SIZE_MISMATCH');
    }
    const probe = ffprobe(filePath, context);
    const after = hashStableFile(filePath, context.maxVideoBytes || MAX_VIDEO_BYTES);
    if (!sameSnapshot(before, after)) throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
    const candidate = {
        provider,
        resultId,
        filePath,
        rootFingerprint: sha256(`${rootInfo.realPath}\0${rootInfo.stats.dev}\0${rootInfo.stats.ino}`),
        rootIdentity: rootInfo.identity,
        source: after,
        probe,
        provenance: options.provenance || null,
        provenanceKind: options.provenanceKind || '',
        executionBinding: options.executionBinding || null,
        mtimeMs: after.identity.mtimeMs,
    };
    candidate.token = candidateToken(candidate, context);
    return candidate;
}

function boundedEntries(rootInfo, context = {}) {
    const limit = Math.min(MAX_SCAN_ENTRIES, context.maxScanEntries || MAX_SCAN_ENTRIES);
    if (!Number.isSafeInteger(limit) || limit <= 0) throw failure('VIDEO_IMPORT_SCAN_LIMIT_INVALID');
    return fs.readdirSync(rootInfo.path, { withFileTypes: true }).slice(0, limit);
}

function receiptRoot(context, provider) {
    if (provider === 'replicate') {
        return context.replicateReceiptResultsRoot || DEFAULT_REPLICATE_RECEIPT_RESULTS_ROOT;
    }
    if (provider === 'bytedance') {
        return context.bytedanceReceiptResultsRoot || DEFAULT_BYTEDANCE_RECEIPT_RESULTS_ROOT;
    }
    throw failure('VIDEO_IMPORT_RECEIPT_PROVIDER_INVALID');
}

function validateReceipt(value, provider, resultId) {
    const baseKeys = [
        'schema_version', 'provider', 'result_id', 'status', 'output_file',
        'output_sha256', 'output_size_bytes', 'completed_at',
    ];
    const executionBound = value?.schema_version === EXTERNAL_RESULT_SCHEMA_V2;
    exactKeys(value, [
        ...baseKeys,
        ...(executionBound ? [
            'run_revision_sha256', 'task_token', 'request_revision_sha256', 'output_claim_sha256',
        ] : []),
    ], 'VIDEO_IMPORT_RECEIPT_CONTRACT_INVALID');
    if (![EXTERNAL_RESULT_SCHEMA, EXTERNAL_RESULT_SCHEMA_V2].includes(value.schema_version)
        || value.provider !== provider
        || value.result_id !== resultId || value.status !== 'succeeded' || value.output_file !== 'result.mp4'
        || !SHA256_PATTERN.test(value.output_sha256 || '')
        || !Number.isSafeInteger(value.output_size_bytes) || value.output_size_bytes <= 0
        || value.output_size_bytes > MAX_VIDEO_BYTES
        || typeof value.completed_at !== 'string' || Buffer.byteLength(value.completed_at, 'utf8') > 64
        || !ISO_TIME_PATTERN.test(value.completed_at) || !Number.isFinite(Date.parse(value.completed_at))) {
        throw failure('VIDEO_IMPORT_RECEIPT_CONTRACT_INVALID');
    }
    if (executionBound && (provider !== 'replicate'
        || !REPLICATE_PREDICTION_ID_PATTERN.test(value.result_id)
        || !/^task_[a-f0-9]{64}$/.test(value.task_token || '')
        || !SHA256_PATTERN.test(value.run_revision_sha256 || '')
        || !SHA256_PATTERN.test(value.request_revision_sha256 || '')
        || !SHA256_PATTERN.test(value.output_claim_sha256 || ''))) {
        throw failure('VIDEO_IMPORT_RECEIPT_CONTRACT_INVALID');
    }
    return value;
}

function scanCanonicalProvider(provider, context = {}) {
    const codePrefix = `VIDEO_IMPORT_${provider.toUpperCase()}_RECEIPT`;
    const rootInfo = optionalRealDirectory(receiptRoot(context, provider), `${codePrefix}_ROOT_UNSAFE`);
    if (!rootInfo) return { candidates: [], rejected: 0 };
    const candidates = [];
    let rejected = 0;
    const entries = boundedEntries(rootInfo, context)
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        if (candidates.length >= MAX_CANDIDATES) break;
        if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_ID_PATTERN.test(entry.name)) {
            rejected += 1;
            continue;
        }
        try {
            const directory = assertRealDirectory(path.join(rootInfo.path, entry.name), `${codePrefix}_RESULT_UNSAFE`, {
                parentRoot: rootInfo.realPath,
            });
            const resultEntries = fs.readdirSync(directory.path, { withFileTypes: true })
                .sort((left, right) => left.name.localeCompare(right.name));
            if (resultEntries.length !== 2
                || resultEntries[0].name !== 'receipt.json' || !resultEntries[0].isFile() || resultEntries[0].isSymbolicLink()
                || resultEntries[1].name !== 'result.mp4' || !resultEntries[1].isFile() || resultEntries[1].isSymbolicLink()) {
                throw failure(`${codePrefix}_RESULT_UNSAFE`);
            }
            const receiptPath = path.join(directory.path, 'receipt.json');
            const videoPath = path.join(directory.path, 'result.mp4');
            assertAncestors(rootInfo, receiptPath, `${codePrefix}_RECEIPT_UNSAFE`);
            assertAncestors(rootInfo, videoPath, `${codePrefix}_VIDEO_UNSAFE`);
            const receipt = smallFile(receiptPath, MAX_RECEIPT_BYTES, `${codePrefix}_RECEIPT_UNSAFE`);
            const value = validateReceipt(parseJson(receipt, `${codePrefix}_RECEIPT_INVALID`), provider, entry.name);
            const candidate = inspectCandidate(provider, entry.name, videoPath, rootInfo, context, {
                expectedSha256: value.output_sha256,
                expectedSize: value.output_size_bytes,
                provenance: receipt,
                provenanceKind: value.schema_version === EXTERNAL_RESULT_SCHEMA_V2
                    ? 'provider_result_receipt_v2' : 'provider_result_receipt_v1',
                executionBinding: value.schema_version === EXTERNAL_RESULT_SCHEMA_V2 ? {
                    run_revision_sha256: value.run_revision_sha256,
                    task_token: value.task_token,
                    request_revision_sha256: value.request_revision_sha256,
                    output_claim_sha256: value.output_claim_sha256,
                } : null,
            });
            const receiptAfter = smallFile(receiptPath, MAX_RECEIPT_BYTES, `${codePrefix}_RECEIPT_UNSAFE`);
            if (!sameSnapshot(receipt, receiptAfter)) throw failure(`${codePrefix}_RECEIPT_CHANGED`);
            assertStableDirectory(directory, `${codePrefix}_RESULT_CHANGED`);
            candidate.canonicalReceipt = true;
            candidates.push(candidate);
        } catch {
            rejected += 1;
        }
    }
    assertStableDirectory(rootInfo, `${codePrefix}_ROOT_CHANGED`);
    return { candidates, rejected };
}

function scanFlow(context = {}) {
    const rootInfo = assertRealDirectory(context.flowResultsRoot || DEFAULT_FLOW_RESULTS_ROOT, 'VIDEO_IMPORT_FLOW_ROOT_UNSAFE');
    const candidates = [];
    let rejected = 0;
    const entries = boundedEntries(rootInfo, context)
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        if (candidates.length >= MAX_CANDIDATES) break;
        if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_ID_PATTERN.test(entry.name)) {
            if (entry.isSymbolicLink()) rejected += 1;
            continue;
        }
        try {
            const directory = assertRealDirectory(path.join(rootInfo.path, entry.name), 'VIDEO_IMPORT_FLOW_RESULT_UNSAFE', {
                parentRoot: rootInfo.realPath,
            });
            const filePath = path.join(directory.path, 'result_1.mp4');
            candidates.push(inspectCandidate('flow', entry.name, filePath, rootInfo, context));
        } catch {
            rejected += 1;
        }
    }
    assertStableDirectory(rootInfo, 'VIDEO_IMPORT_FLOW_ROOT_CHANGED');
    return { candidates, rejected };
}

function scanGrok(context = {}) {
    const rootInfo = assertRealDirectory(context.grokResultsRoot || DEFAULT_GROK_RESULTS_ROOT, 'VIDEO_IMPORT_GROK_ROOT_UNSAFE');
    const candidates = [];
    let rejected = 0;
    const entries = boundedEntries(rootInfo, context)
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        if (candidates.length >= MAX_CANDIDATES) break;
        if (path.extname(entry.name).toLowerCase() !== '.mp4') continue;
        const resultId = path.basename(entry.name, path.extname(entry.name));
        if (!entry.isFile() || entry.isSymbolicLink() || !SAFE_ID_PATTERN.test(resultId)) {
            rejected += 1;
            continue;
        }
        try {
            candidates.push(inspectCandidate('grok', resultId, path.join(rootInfo.path, entry.name), rootInfo, context));
        } catch {
            rejected += 1;
        }
    }
    assertStableDirectory(rootInfo, 'VIDEO_IMPORT_GROK_ROOT_CHANGED');
    return { candidates, rejected };
}

function replicateAllowlist(context = {}) {
    const value = context.replicateShaAllowlist || DEFAULT_REPLICATE_SHA_ALLOWLIST;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw failure('VIDEO_IMPORT_REPLICATE_ALLOWLIST_INVALID');
    }
    for (const resultId of ['seedance_1', 'seedance_2', 'seedance_3']) {
        if (!SHA256_PATTERN.test(value[resultId] || '')) throw failure('VIDEO_IMPORT_REPLICATE_ALLOWLIST_INVALID');
    }
    return value;
}

function scanHistoricalReplicate(context = {}) {
    const rootInfo = assertRealDirectory(
        context.replicateResultsRoot || DEFAULT_REPLICATE_RESULTS_ROOT,
        'VIDEO_IMPORT_REPLICATE_ROOT_UNSAFE',
    );
    if (path.basename(rootInfo.path) !== 'replicate_seedance_clips') {
        throw failure('VIDEO_IMPORT_REPLICATE_ROOT_UNSAFE');
    }
    const runRoot = assertRealDirectory(path.dirname(rootInfo.path), 'VIDEO_IMPORT_REPLICATE_RUN_ROOT_UNSAFE');
    const statusPath = path.join(runRoot.path, 'run_status.md');
    assertAncestors(runRoot, statusPath, 'VIDEO_IMPORT_REPLICATE_STATUS_UNSAFE');
    const provenance = smallFile(statusPath, MAX_PROVENANCE_BYTES, 'VIDEO_IMPORT_REPLICATE_STATUS_UNSAFE');
    const statusText = provenance.buffer.toString('utf8');
    if (!provenance.exists || !statusText.includes('Replicate Seedance')
        || !statusText.includes('Replicate Seedance fallback')) {
        throw failure('VIDEO_IMPORT_REPLICATE_PROVENANCE_INVALID');
    }
    const allowlist = replicateAllowlist(context);
    const candidates = [];
    let rejected = 0;
    const entries = boundedEntries(rootInfo, context)
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        const match = /^seedance_([1-3])\.mp4$/.exec(entry.name);
        if (!match) {
            if (path.extname(entry.name).toLowerCase() === '.mp4') rejected += 1;
            continue;
        }
        const resultId = `seedance_${match[1]}`;
        if (!entry.isFile() || entry.isSymbolicLink()) {
            rejected += 1;
            continue;
        }
        try {
            candidates.push(inspectCandidate('replicate', resultId, path.join(rootInfo.path, entry.name), rootInfo, context, {
                expectedSha256: allowlist[resultId],
                provenance,
                provenanceKind: 'historical_replicate_seedance_allowlist_v1',
            }));
        } catch {
            rejected += 1;
        }
    }
    const provenanceAfter = smallFile(statusPath, MAX_PROVENANCE_BYTES, 'VIDEO_IMPORT_REPLICATE_STATUS_UNSAFE');
    if (!sameSnapshot(provenance, provenanceAfter)) throw failure('VIDEO_IMPORT_REPLICATE_STATUS_CHANGED');
    assertStableDirectory(runRoot, 'VIDEO_IMPORT_REPLICATE_RUN_ROOT_CHANGED');
    assertStableDirectory(rootInfo, 'VIDEO_IMPORT_REPLICATE_ROOT_CHANGED');
    return { candidates, rejected };
}

function scanInventory(context = {}) {
    const candidates = [];
    const blockers = [];
    let rejectedCount = 0;
    for (const [provider, scan] of [
        ['replicate_receipt', (scanContext) => scanCanonicalProvider('replicate', scanContext)],
        ['bytedance_receipt', (scanContext) => scanCanonicalProvider('bytedance', scanContext)],
        ['flow', scanFlow],
        ['grok', scanGrok],
        ['replicate_history', scanHistoricalReplicate],
    ]) {
        try {
            const result = scan(context);
            candidates.push(...result.candidates);
            rejectedCount += result.rejected;
        } catch (error) {
            blockers.push(error.code || `VIDEO_IMPORT_${provider.toUpperCase()}_SCAN_BLOCKED`);
        }
    }
    const preferred = candidates.sort((left, right) => Number(right.canonicalReceipt === true) - Number(left.canonicalReceipt === true)
        || right.mtimeMs - left.mtimeMs || left.provider.localeCompare(right.provider) || left.resultId.localeCompare(right.resultId));
    const unique = [];
    const resultKeys = new Set();
    const canonicalHashKeys = new Set(preferred.filter((candidate) => candidate.canonicalReceipt === true)
        .map((candidate) => `${candidate.provider}\0${candidate.source.sha256}`));
    for (const candidate of preferred) {
        const resultKey = `${candidate.provider}\0${candidate.resultId}`;
        const hashKey = `${candidate.provider}\0${candidate.source.sha256}`;
        if (resultKeys.has(resultKey)
            || (candidate.canonicalReceipt !== true && canonicalHashKeys.has(hashKey))) continue;
        resultKeys.add(resultKey);
        unique.push(candidate);
    }
    unique.sort((left, right) => right.mtimeMs - left.mtimeMs
        || left.provider.localeCompare(right.provider) || left.resultId.localeCompare(right.resultId));
    const selected = [];
    let totalBytes = 0;
    for (const candidate of unique) {
        if (selected.length >= MAX_CANDIDATES) break;
        totalBytes += candidate.source.size;
        if (totalBytes > (context.maxInventoryBytes || MAX_INVENTORY_BYTES)) {
            blockers.push('VIDEO_IMPORT_INVENTORY_TOO_LARGE');
            break;
        }
        selected.push(candidate);
    }
    if (!selected.length) blockers.push('VIDEO_IMPORT_CANDIDATE_EMPTY');
    return { candidates: selected, blockers: Array.from(new Set(blockers)), rejectedCount };
}

function publicCandidate(candidate) {
    return {
        candidate_token: candidate.token,
        provider: candidate.provider,
        result_id: candidate.resultId,
        size_bytes: candidate.source.size,
        duration_seconds: candidate.probe.durationSeconds,
        width: candidate.probe.width,
        height: candidate.probe.height,
        preview_allowed: candidate.source.size <= MAX_PREVIEW_BYTES,
    };
}

function blockedWorkspace(code) {
    return {
        schema_version: WORKSPACE_SCHEMA,
        status: 'blocked',
        ready: false,
        candidates: [],
        initial_targets: [],
        rejected_count: 0,
        blockers: [code],
        executed: false,
        generation_executed: false,
    };
}

function getVideoResultImportWorkspace(context = {}) {
    try {
        const inventory = scanInventory(context);
        let initialTargets = [];
        try {
            const authority = initialTargetContext(context);
            initialTargets = authority.targets
                .filter((target) => !authority.records.some((record) => (
                    record.kind === 'video' && record.target_id === target.targetId
                )))
                .map(publicInitialTarget);
        } catch {
            // Retry imports remain usable when no authoritative storyboard is available.
        }
        return {
            schema_version: WORKSPACE_SCHEMA,
            status: inventory.candidates.length ? 'ready' : 'empty',
            ready: inventory.candidates.length > 0,
            candidates: inventory.candidates.map(publicCandidate),
            initial_targets: initialTargets,
            rejected_count: inventory.rejectedCount,
            blockers: inventory.blockers,
            executed: false,
            generation_executed: false,
        };
    } catch (error) {
        return blockedWorkspace(error.code || 'VIDEO_IMPORT_WORKSPACE_BLOCKED');
    }
}

// Main-process-only durable execution receipt resolver. Provider/result/hash
// survives app relaunch while the session candidate token does not.
function resolveVideoExecutionResultLocator(locator, context = {}) {
    const match = /^(flow|grok|replicate|bytedance):([A-Za-z0-9][A-Za-z0-9._-]{0,159}):([a-f0-9]{64})$/.exec(locator || '');
    if (!match) return null;
    const inventory = scanInventory(context);
    const candidate = inventory.candidates.find((entry) => (
        entry.provider === match[1] && entry.resultId === match[2] && entry.source.sha256 === match[3]
    ));
    return candidate ? { candidate_token: candidate.token } : null;
}

function resolveVideoExecutionResultLocatorForExecution(locator, expectedBinding, context = {}) {
    exactKeys(expectedBinding, [
        'run_revision_sha256', 'task_token', 'request_revision_sha256', 'output_claim_sha256',
    ], 'EXECUTION_REPLICATE_RESULT_REQUEST_MISMATCH');
    if (!SHA256_PATTERN.test(expectedBinding.run_revision_sha256 || '')
        || !/^task_[a-f0-9]{64}$/.test(expectedBinding.task_token || '')
        || !SHA256_PATTERN.test(expectedBinding.request_revision_sha256 || '')
        || !SHA256_PATTERN.test(expectedBinding.output_claim_sha256 || '')) {
        throw failure('EXECUTION_REPLICATE_RESULT_REQUEST_MISMATCH');
    }
    const match = /^(flow|grok|replicate|bytedance):([A-Za-z0-9][A-Za-z0-9._-]{0,159}):([a-f0-9]{64})$/.exec(locator || '');
    if (!match || match[1] !== 'replicate') return null;
    const inventory = scanInventory(context);
    const candidate = inventory.candidates.find((entry) => (
        entry.provider === match[1] && entry.resultId === match[2] && entry.source.sha256 === match[3]
    ));
    if (!candidate) return null;
    if (!candidate.executionBinding) throw failure('EXECUTION_REPLICATE_RESULT_BINDING_REQUIRED');
    const binding = candidate.executionBinding;
    if (binding.run_revision_sha256 !== expectedBinding.run_revision_sha256
        || binding.task_token !== expectedBinding.task_token
        || binding.request_revision_sha256 !== expectedBinding.request_revision_sha256) {
        throw failure('EXECUTION_REPLICATE_RESULT_REQUEST_MISMATCH');
    }
    if (binding.output_claim_sha256 !== expectedBinding.output_claim_sha256) {
        throw failure('EXECUTION_REPLICATE_RESULT_CLAIM_MISMATCH');
    }
    return { candidate_token: candidate.token };
}

function blockedPreview(code) {
    return {
        ok: false,
        loaded: false,
        status: 'blocked',
        candidate_token: '',
        mime_type: '',
        byte_length: 0,
        base64: '',
        blockers: [code],
        executed: false,
        generation_executed: false,
    };
}

function readPreview(candidate) {
    if (candidate.source.size > MAX_PREVIEW_BYTES) throw failure('VIDEO_IMPORT_PREVIEW_TOO_LARGE');
    const read = smallFile(candidate.filePath, MAX_PREVIEW_BYTES, 'VIDEO_IMPORT_PREVIEW_UNSAFE');
    if (!read.exists || read.sha256 !== candidate.source.sha256 || !sameIdentity(read.identity, candidate.source.identity)) {
        throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
    }
    sniffMp4(read.buffer.subarray(0, 64), read.size);
    return read;
}

function getVideoResultImportPreview(payload, context = {}) {
    try {
        exactKeys(payload, ['candidateToken'], 'VIDEO_IMPORT_PREVIEW_REQUEST_INVALID');
        const token = safeOptionalText(payload.candidateToken, 256, 'VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
        if (!TOKEN_PATTERN.test(token)) throw failure('VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
        const inventory = scanInventory(context);
        const candidate = inventory.candidates.find((entry) => entry.token === token);
        if (!candidate) throw failure('VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
        const read = readPreview(candidate);
        return {
            ok: true,
            loaded: true,
            status: 'ready',
            candidate_token: token,
            mime_type: 'video/mp4',
            byte_length: read.size,
            base64: read.buffer.toString('base64'),
            blockers: [],
            executed: false,
            generation_executed: false,
        };
    } catch (error) {
        return blockedPreview(error.code || 'VIDEO_IMPORT_PREVIEW_BLOCKED');
    }
}

// Main-process-only handoff for private workbench imports. The renderer receives
// only an opaque candidate token; this helper re-scans and re-verifies the
// candidate, then performs a stable, bounded copy into a caller-owned private
// staging directory without exposing the source path or loading the clip into
// renderer memory.
function copyVideoResultCandidateToPrivateFile(payload, context = {}) {
    exactKeys(payload, ['candidateToken', 'destinationPath', 'destinationRoot'], 'VIDEO_IMPORT_PRIVATE_COPY_REQUEST_INVALID');
    const token = safeOptionalText(payload.candidateToken, 256, 'VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
    if (!TOKEN_PATTERN.test(token)) throw failure('VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
    const destinationRoot = assertRealDirectory(payload.destinationRoot, 'VIDEO_IMPORT_PRIVATE_DESTINATION_UNSAFE');
    if ((destinationRoot.stats.mode & 0o777) !== 0o700) throw failure('VIDEO_IMPORT_PRIVATE_DESTINATION_UNSAFE');
    if (typeof payload.destinationPath !== 'string' || !path.isAbsolute(payload.destinationPath)
        || path.normalize(payload.destinationPath) !== payload.destinationPath
        || path.dirname(payload.destinationPath) !== destinationRoot.realPath
        || !/^\.video-source-[a-f0-9]{24}\.tmp$/.test(path.basename(payload.destinationPath))) {
        throw failure('VIDEO_IMPORT_PRIVATE_DESTINATION_UNSAFE');
    }
    const inventory = scanInventory(context);
    const candidate = inventory.candidates.find((entry) => entry.token === token);
    if (!candidate) throw failure('VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('VIDEO_IMPORT_NOFOLLOW_UNAVAILABLE');
    let sourceDescriptor;
    let destinationDescriptor;
    let destinationCreated = false;
    let completed = false;
    try {
        const sourceBefore = fs.lstatSync(candidate.filePath);
        if (sourceBefore.isSymbolicLink() || !sourceBefore.isFile()
            || !sameIdentity(identity(sourceBefore), candidate.source.identity)) throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
        sourceDescriptor = fs.openSync(candidate.filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const sourceOpened = fs.fstatSync(sourceDescriptor);
        if (!sameIdentity(identity(sourceOpened), candidate.source.identity)) throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
        destinationDescriptor = fs.openSync(payload.destinationPath, fs.constants.O_WRONLY | fs.constants.O_CREAT
            | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        destinationCreated = true;
        const digest = crypto.createHash('sha256');
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (position < sourceOpened.size) {
            const count = fs.readSync(sourceDescriptor, chunk, 0, Math.min(chunk.length, sourceOpened.size - position), position);
            if (count <= 0) throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
            fs.writeSync(destinationDescriptor, chunk, 0, count, position);
            digest.update(chunk.subarray(0, count));
            position += count;
        }
        fs.fsyncSync(destinationDescriptor);
        const sourceAfter = fs.fstatSync(sourceDescriptor);
        const sourcePathAfter = fs.lstatSync(candidate.filePath);
        const destinationAfter = fs.fstatSync(destinationDescriptor);
        const copiedSha256 = digest.digest('hex');
        if (position !== candidate.source.size || copiedSha256 !== candidate.source.sha256
            || !sameIdentity(identity(sourceOpened), identity(sourceAfter))
            || !sameIdentity(identity(sourceOpened), identity(sourcePathAfter))
            || !destinationAfter.isFile() || (destinationAfter.mode & 0o777) !== 0o600
            || destinationAfter.size !== position) throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
        fsyncDirectory(destinationRoot.realPath);
        completed = true;
        return {
            provider: candidate.provider,
            source_sha256: copiedSha256,
            byte_length: position,
            duration_seconds: candidate.probe.durationSeconds,
            width: candidate.probe.width,
            height: candidate.probe.height,
            provenance_kind: candidate.provenanceKind || '',
        };
    } finally {
        if (sourceDescriptor !== undefined) {
            try { fs.closeSync(sourceDescriptor); } catch { /* already closed */ }
        }
        if (destinationDescriptor !== undefined) {
            try { fs.closeSync(destinationDescriptor); } catch { /* already closed */ }
        }
        if (!completed && destinationCreated) {
            try { fs.unlinkSync(payload.destinationPath); } catch { /* absent */ }
        }
    }
}

function assertProductionRoot(context = {}) {
    const info = assertRealDirectory(context.config?.productionRoot, 'VIDEO_IMPORT_PRODUCTION_ROOT_UNSAFE');
    return {
        ...info,
        fingerprint: sha256(`${info.realPath}\0${info.stats.dev}\0${info.stats.ino}`),
    };
}

function parsedLedger(snapshot) {
    const records = [];
    const ids = new Set();
    for (const line of snapshot.buffer.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        let value;
        try { value = JSON.parse(line); } catch { throw failure('VIDEO_IMPORT_LEDGER_INVALID'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('VIDEO_IMPORT_LEDGER_INVALID');
        const mediaId = safeId(value.media_id, 'VIDEO_IMPORT_LEDGER_INVALID');
        if (ids.has(mediaId)) throw failure('VIDEO_IMPORT_LEDGER_DUPLICATE_ID');
        ids.add(mediaId);
        records.push(value);
    }
    return records;
}

function storyboardClips(value) {
    for (const key of ['clips', 'storyboard', 'shots', 'scenes']) {
        if (Array.isArray(value?.[key])) return value[key];
    }
    throw failure('VIDEO_IMPORT_INITIAL_STORYBOARD_CONTRACT_INVALID');
}

function initialTargetToken(rootInfo, storyboard, target, context = {}) {
    return crypto.createHmac('sha256', tokenSecret(context)).update([
        rootInfo.fingerprint,
        storyboard.sha256,
        target.kind,
        target.targetId,
        target.targetLabel,
        String(target.sequence),
    ].join('\0')).digest('base64url');
}

function deriveInitialTargets(rootInfo, storyboard, value, context = {}) {
    const targets = [];
    const ids = new Set();
    for (const clip of storyboardClips(value)) {
        if (!clip || typeof clip !== 'object' || Array.isArray(clip) || clip.structural_only === true) continue;
        const targetId = safeId(clip.clip_id, 'VIDEO_IMPORT_INITIAL_TARGET_ID_INVALID');
        if (ids.has(targetId)) throw failure('VIDEO_IMPORT_INITIAL_TARGET_DUPLICATE');
        ids.add(targetId);
        const target = {
            kind: 'video',
            targetId,
            targetLabel: boundedTargetLabel(clip.title || clip.scene_title || clip.scene_id || clip.clip_id),
            sequence: targets.length + 1,
        };
        target.targetToken = initialTargetToken(rootInfo, storyboard, target, context);
        targets.push(target);
    }
    return targets;
}

function publicInitialTarget(target) {
    return {
        target_token: target.targetToken,
        kind: 'video',
        target_id: target.targetId,
        target_label: target.targetLabel,
        sequence: target.sequence,
    };
}

function initialTargetContext(context = {}) {
    const rootInfo = assertProductionRoot(context);
    const read = context.readProductionFolderFn || readProductionFolder;
    const raw = read(rootInfo.path);
    const record = raw?.parsed?.storyboardJson;
    if (!record?.exists || record.parsed !== true || typeof record.path !== 'string') {
        throw failure('VIDEO_IMPORT_INITIAL_STORYBOARD_REQUIRED');
    }
    const relative = path.relative(rootInfo.path, record.path);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
        || !['storyboard/storyboard.json', 'storyboard/clips.json', 'storyboard.json']
            .includes(relative.split(path.sep).join('/'))) {
        throw failure('VIDEO_IMPORT_INITIAL_STORYBOARD_UNSAFE');
    }
    assertAncestors(rootInfo, record.path, 'VIDEO_IMPORT_INITIAL_STORYBOARD_UNSAFE');
    const storyboard = smallFile(record.path, MAX_JSON_BYTES, 'VIDEO_IMPORT_INITIAL_STORYBOARD_UNSAFE');
    const value = parseJson(storyboard, 'VIDEO_IMPORT_INITIAL_STORYBOARD_CONTRACT_INVALID');
    const targets = deriveInitialTargets(rootInfo, storyboard, value, context);
    const storyboardAfter = smallFile(record.path, MAX_JSON_BYTES, 'VIDEO_IMPORT_INITIAL_STORYBOARD_UNSAFE');
    if (!sameSnapshot(storyboard, storyboardAfter)) throw failure('VIDEO_IMPORT_INITIAL_STORYBOARD_CHANGED');
    const ledgerPath = path.join(rootInfo.path, 'media_attempts.jsonl');
    assertAncestors(rootInfo, ledgerPath, 'VIDEO_IMPORT_LEDGER_UNSAFE');
    const ledger = smallFile(ledgerPath, MAX_LEDGER_BYTES, 'VIDEO_IMPORT_LEDGER_UNSAFE', { allowEmpty: true });
    return {
        rootInfo,
        ledgerPath,
        ledger,
        records: parsedLedger(ledger),
        review: null,
        queue: null,
        storyboard: storyboardAfter,
        targets,
    };
}

function retryContext(context, retryMediaId, provider) {
    const rootInfo = assertProductionRoot(context);
    const ledgerPath = path.join(rootInfo.path, 'media_attempts.jsonl');
    const reviewPath = path.join(rootInfo.path, 'reviews', 'media_review_draft.json');
    assertAncestors(rootInfo, ledgerPath, 'VIDEO_IMPORT_LEDGER_UNSAFE');
    assertAncestors(rootInfo, reviewPath, 'VIDEO_IMPORT_REVIEW_UNSAFE');
    const ledger = smallFile(ledgerPath, MAX_LEDGER_BYTES, 'VIDEO_IMPORT_LEDGER_UNSAFE', { allowEmpty: true });
    const review = smallFile(reviewPath, MAX_JSON_BYTES, 'VIDEO_IMPORT_REVIEW_UNSAFE');
    if (!ledger.exists || !review.exists) throw failure('VIDEO_IMPORT_RETRY_SOURCES_REQUIRED');
    const records = parsedLedger(ledger);
    const draft = parseJson(review, 'VIDEO_IMPORT_REVIEW_INVALID');
    exactKeys(draft, ['schema', 'execution', 'reviews', 'retry_queue'], 'VIDEO_IMPORT_REVIEW_CONTRACT_INVALID');
    if (draft.schema !== 'film_pipeline.media_review_draft.v1' || draft.execution !== 'not_run'
        || !Array.isArray(draft.reviews) || !Array.isArray(draft.retry_queue) || draft.retry_queue.length > 100) {
        throw failure('VIDEO_IMPORT_REVIEW_CONTRACT_INVALID');
    }
    const source = records.find((record) => record.media_id === retryMediaId);
    const queueIndex = draft.retry_queue.findIndex((item) => item?.media_id === retryMediaId);
    const queue = queueIndex >= 0 ? draft.retry_queue[queueIndex] : null;
    const reviewRecord = draft.reviews.find((item) => item?.media_id === retryMediaId);
    if (!source || !queue || !reviewRecord) throw failure('VIDEO_IMPORT_RETRY_SOURCE_MISSING');
    exactKeys(queue, [
        'sequence', 'media_id', 'kind', 'target_id', 'provider', 'attempt', 'retry_of', 'review_note', 'execution_status',
    ], 'VIDEO_IMPORT_RETRY_QUEUE_INVALID');
    if (queue.sequence !== queueIndex + 1 || queue.execution_status !== 'draft_not_executed'
        || queue.media_id !== source.media_id || queue.kind !== source.kind || queue.kind !== 'video'
        || queue.target_id !== source.target_id || queue.provider !== source.provider || queue.provider !== provider
        || queue.attempt !== source.attempt || queue.retry_of !== source.media_id
        || !Number.isSafeInteger(Number(source.attempt)) || Number(source.attempt) <= 0
        || !safeId(source.target_id, 'VIDEO_IMPORT_TARGET_ID_INVALID')) {
        throw failure('VIDEO_IMPORT_RETRY_QUEUE_INVALID');
    }
    if (reviewRecord.selected_for_retry !== true && reviewRecord.review_status !== 'retry_requested') {
        throw failure('VIDEO_IMPORT_RETRY_NOT_SELECTED');
    }
    return { rootInfo, ledgerPath, reviewPath, ledger, review, records, source, queue };
}

function targetSnapshot(rootInfo, relativePath, maximum) {
    const targetPath = path.join(rootInfo.path, ...relativePath.split('/'));
    const relative = path.relative(rootInfo.path, targetPath);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw failure('VIDEO_IMPORT_TARGET_UNSAFE');
    }
    let cursor = rootInfo.path;
    for (const component of relative.split(path.sep).slice(0, -1)) {
        cursor = path.join(cursor, component);
        try {
            const stats = fs.lstatSync(cursor);
            if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure('VIDEO_IMPORT_TARGET_PARENT_UNSAFE');
            const real = fs.realpathSync.native(cursor);
            if (real !== rootInfo.realPath && !real.startsWith(`${rootInfo.realPath}${path.sep}`)) {
                throw failure('VIDEO_IMPORT_TARGET_ESCAPE');
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            break;
        }
    }
    try {
        return { path: targetPath, snapshot: hashStableFile(targetPath, maximum, 'VIDEO_IMPORT_TARGET_UNSAFE') };
    } catch (error) {
        if (error.code === 'VIDEO_IMPORT_TARGET_UNSAFE_MISSING') {
            return { path: targetPath, snapshot: { exists: false, sha256: '', size: 0, identity: null } };
        }
        throw error;
    }
}

function recordMatches(existing, desired) {
    const keys = [
        'media_id', 'kind', 'target_id', 'provider', 'operation_id', 'attempt', 'relative_path',
        'generation_status', 'prompt', 'aspect_ratio', 'duration', 'quality', 'review_status', 'retry_of',
        'source_provider', 'source_result_id', 'source_video_sha256', 'source_duration_seconds',
        'source_width', 'source_height', 'source_provenance',
    ];
    return keys.every((key) => existing[key] === desired[key])
        && (existing.target_label === desired.target_label
            || (desired.retry_of && !existing.target_label))
        && JSON.stringify(existing.reference_ids || []) === JSON.stringify(desired.reference_ids || []);
}

function operationIso(context = {}) {
    const value = (context.now || (() => new Date().toISOString()))();
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw failure('VIDEO_IMPORT_CLOCK_INVALID');
    return value;
}

function buildInputs(context, candidate, retryMediaId, importedAt) {
    const retry = retryContext(context, retryMediaId, candidate.provider);
    const deterministic = sha256(`${retryMediaId}\0${candidate.provider}\0${candidate.source.sha256}`);
    const mediaId = `video_${deterministic.slice(0, 32)}`;
    const targetRelativePath = `${IMPORT_RELATIVE_ROOT}/${candidate.provider}/${candidate.source.sha256}.mp4`;
    const existing = retry.records.find((record) => record.media_id === mediaId);
    const attempts = retry.records
        .filter((record) => record.kind === 'video' && record.target_id === retry.source.target_id
            && record.provider === candidate.provider)
        .map((record) => Number(record.attempt)).filter((value) => Number.isSafeInteger(value) && value > 0);
    const attempt = existing ? Number(existing.attempt) : Math.max(0, ...attempts) + 1;
    if (!Number.isSafeInteger(attempt) || attempt <= 0 || attempt > 10000) throw failure('VIDEO_IMPORT_ATTEMPT_INVALID');
    const referenceIds = Array.isArray(retry.source.reference_ids)
        ? retry.source.reference_ids.map((value) => safeId(value, 'VIDEO_IMPORT_REFERENCE_ID_INVALID')) : [];
    if (referenceIds.length > 8) throw failure('VIDEO_IMPORT_REFERENCE_ID_INVALID');
    const sourceDuration = Number(retry.source.duration);
    const desired = {
        media_id: mediaId,
        kind: 'video',
        target_id: safeId(retry.source.target_id, 'VIDEO_IMPORT_TARGET_ID_INVALID'),
        target_label: boundedTargetLabel(retry.source.target_label || retry.source.target_id),
        provider: candidate.provider,
        operation_id: `video_import_${deterministic.slice(0, 24)}`,
        attempt,
        reference_ids: referenceIds,
        relative_path: targetRelativePath,
        generation_status: 'imported',
        prompt: safeOptionalText(retry.source.prompt, 12000, 'VIDEO_IMPORT_PROMPT_INVALID'),
        aspect_ratio: safeOptionalText(retry.source.aspect_ratio, 16, 'VIDEO_IMPORT_ASPECT_INVALID'),
        duration: Number.isSafeInteger(sourceDuration) && sourceDuration > 0 && sourceDuration <= 30 ? sourceDuration : 0,
        quality: safeOptionalText(retry.source.quality, 16, 'VIDEO_IMPORT_QUALITY_INVALID'),
        review_status: 'unreviewed',
        retry_of: retryMediaId,
        source_provider: candidate.provider,
        source_result_id: candidate.resultId,
        source_video_sha256: candidate.source.sha256,
        source_duration_seconds: candidate.probe.durationSeconds,
        source_width: candidate.probe.width,
        source_height: candidate.probe.height,
        imported_at: importedAt,
    };
    if (candidate.provenanceKind) desired.source_provenance = candidate.provenanceKind;
    if (existing && !recordMatches(existing, desired)) throw failure('VIDEO_IMPORT_MEDIA_ID_CONFLICT');
    const target = targetSnapshot(retry.rootInfo, targetRelativePath, context.maxVideoBytes || MAX_VIDEO_BYTES);
    if (target.snapshot.exists && target.snapshot.sha256 !== candidate.source.sha256) {
        throw failure('VIDEO_IMPORT_TARGET_COLLISION');
    }
    const ledgerAppendNeeded = !existing;
    const targetReady = target.snapshot.exists && target.snapshot.sha256 === candidate.source.sha256;
    return {
        retry,
        candidate,
        desired,
        target,
        importMode: 'retry',
        storyboard: null,
        initialTarget: null,
        ledgerAppendNeeded,
        alreadyCurrent: !ledgerAppendNeeded && targetReady,
    };
}

function buildInitialInputs(context, candidate, initialTargetTokenValue, importedAt) {
    if (typeof initialTargetTokenValue !== 'string' || !TOKEN_PATTERN.test(initialTargetTokenValue)) {
        throw failure('VIDEO_IMPORT_INITIAL_TARGET_TOKEN_INVALID');
    }
    const authority = initialTargetContext(context);
    const initialTarget = authority.targets.find((target) => target.targetToken === initialTargetTokenValue);
    if (!initialTarget) throw failure('VIDEO_IMPORT_INITIAL_TARGET_UNKNOWN');
    const deterministic = sha256([
        'initial',
        initialTarget.targetId,
        candidate.provider,
        candidate.resultId,
        candidate.source.sha256,
    ].join('\0'));
    const mediaId = `video_${deterministic.slice(0, 32)}`;
    const targetRelativePath = `${IMPORT_RELATIVE_ROOT}/${candidate.provider}/${candidate.source.sha256}.mp4`;
    const desired = {
        media_id: mediaId,
        kind: 'video',
        target_id: initialTarget.targetId,
        target_label: initialTarget.targetLabel,
        provider: candidate.provider,
        operation_id: `video_import_${deterministic.slice(0, 24)}`,
        attempt: 1,
        reference_ids: [],
        relative_path: targetRelativePath,
        generation_status: 'imported',
        prompt: '',
        aspect_ratio: '9:16',
        duration: candidate.probe.durationSeconds,
        quality: '',
        review_status: 'unreviewed',
        retry_of: '',
        source_provider: candidate.provider,
        source_result_id: candidate.resultId,
        source_video_sha256: candidate.source.sha256,
        source_duration_seconds: candidate.probe.durationSeconds,
        source_width: candidate.probe.width,
        source_height: candidate.probe.height,
        imported_at: importedAt,
    };
    if (candidate.provenanceKind) desired.source_provenance = candidate.provenanceKind;
    const sameTarget = authority.records.filter((record) => (
        record.kind === 'video' && record.target_id === initialTarget.targetId
    ));
    if (sameTarget.length > 1 || (sameTarget.length === 1 && !recordMatches(sameTarget[0], desired))) {
        throw failure('VIDEO_IMPORT_INITIAL_TARGET_EXISTS');
    }
    const existing = authority.records.find((record) => record.media_id === mediaId);
    if (existing && !recordMatches(existing, desired)) throw failure('VIDEO_IMPORT_MEDIA_ID_CONFLICT');
    if (sameTarget.length === 1 && sameTarget[0].media_id !== mediaId) {
        throw failure('VIDEO_IMPORT_INITIAL_TARGET_EXISTS');
    }
    const target = targetSnapshot(authority.rootInfo, targetRelativePath, context.maxVideoBytes || MAX_VIDEO_BYTES);
    if (target.snapshot.exists && target.snapshot.sha256 !== candidate.source.sha256) {
        throw failure('VIDEO_IMPORT_TARGET_COLLISION');
    }
    const ledgerAppendNeeded = !existing;
    const targetReady = target.snapshot.exists && target.snapshot.sha256 === candidate.source.sha256;
    return {
        retry: authority,
        candidate,
        desired,
        target,
        importMode: 'initial',
        storyboard: authority.storyboard,
        initialTarget: publicInitialTarget(initialTarget),
        ledgerAppendNeeded,
        alreadyCurrent: !ledgerAppendNeeded && targetReady,
    };
}

function evidence(inputs) {
    return {
        productionRootFingerprint: inputs.retry.rootInfo.fingerprint,
        productionRootIdentity: inputs.retry.rootInfo.identity,
        ledger: inputs.retry.ledger,
        review: inputs.retry.review || null,
        queue: inputs.retry.queue || null,
        storyboard: inputs.storyboard || null,
        initialTarget: inputs.initialTarget || null,
        importMode: inputs.importMode,
        candidateToken: inputs.candidate.token,
        candidateRootIdentity: inputs.candidate.rootIdentity,
        candidateSource: inputs.candidate.source,
        candidateProbe: inputs.candidate.probe,
        candidateProvenance: inputs.candidate.provenance,
        target: inputs.target.snapshot,
        desired: inputs.desired,
        ledgerAppendNeeded: inputs.ledgerAppendNeeded,
        alreadyCurrent: inputs.alreadyCurrent,
    };
}

function sameOptionalSnapshot(left, right) {
    if (!left || !right) return left === right;
    return sameSnapshot(left, right);
}

function stableEvidence(left, right) {
    return left.productionRootFingerprint === right.productionRootFingerprint
        && sameDirectoryIdentity(left.productionRootIdentity, right.productionRootIdentity)
        && sameSnapshot(left.ledger, right.ledger) && sameOptionalSnapshot(left.review, right.review)
        && JSON.stringify(left.queue) === JSON.stringify(right.queue)
        && sameOptionalSnapshot(left.storyboard, right.storyboard)
        && JSON.stringify(left.initialTarget) === JSON.stringify(right.initialTarget)
        && left.importMode === right.importMode
        && left.candidateToken === right.candidateToken
        && sameDirectoryIdentity(left.candidateRootIdentity, right.candidateRootIdentity)
        && sameSnapshot(left.candidateSource, right.candidateSource)
        && JSON.stringify(left.candidateProbe) === JSON.stringify(right.candidateProbe)
        && ((!left.candidateProvenance && !right.candidateProvenance)
            || (left.candidateProvenance && right.candidateProvenance
                && sameSnapshot(left.candidateProvenance, right.candidateProvenance)))
        && sameSnapshot(left.target, right.target)
        && JSON.stringify(left.desired) === JSON.stringify(right.desired)
        && left.ledgerAppendNeeded === right.ledgerAppendNeeded
        && left.alreadyCurrent === right.alreadyCurrent;
}

function clockMs(context = {}) {
    const value = context.nowMs ? context.nowMs() : Date.now();
    if (!Number.isFinite(value) || value < 0) throw failure('VIDEO_IMPORT_CLOCK_INVALID');
    return Math.trunc(value);
}

function planTtl(context = {}) {
    const value = context.planTtlMs ?? DEFAULT_PLAN_TTL_MS;
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_PLAN_TTL_MS) throw failure('VIDEO_IMPORT_TTL_INVALID');
    return value;
}

function planStore(context = {}) {
    return context.planStore || SESSION_PLAN_STORE;
}

function blockedPlan(code) {
    return {
        schema_version: PLAN_SCHEMA,
        status: 'blocked',
        ready: false,
        already_current: false,
        import_mode: '',
        plan_token: '',
        expires_at: '',
        retry_media_id: '',
        target_id: '',
        target_label: '',
        new_media_id: '',
        source_provider: '',
        source_result_id: '',
        size_bytes: 0,
        duration_seconds: 0,
        width: 0,
        height: 0,
        blockers: [code],
        executed: false,
        generation_executed: false,
    };
}

function planVideoResultImport(payload, context = {}) {
    try {
        const hasRetryMediaId = Boolean(payload && Object.prototype.hasOwnProperty.call(payload, 'retryMediaId'));
        const hasInitialTargetToken = Boolean(payload && Object.prototype.hasOwnProperty.call(payload, 'initialTargetToken'));
        if (hasRetryMediaId === hasInitialTargetToken) throw failure('VIDEO_IMPORT_PLAN_REQUEST_INVALID');
        exactKeys(
            payload,
            hasInitialTargetToken
                ? ['candidateToken', 'initialTargetToken']
                : ['candidateToken', 'retryMediaId'],
            'VIDEO_IMPORT_PLAN_REQUEST_INVALID',
        );
        const candidateTokenValue = safeOptionalText(payload.candidateToken, 256, 'VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
        if (!TOKEN_PATTERN.test(candidateTokenValue)) throw failure('VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
        const retryMediaId = hasRetryMediaId ? safeId(payload.retryMediaId, 'VIDEO_IMPORT_RETRY_ID_INVALID') : '';
        const initialTargetTokenValue = hasInitialTargetToken
            ? safeOptionalText(payload.initialTargetToken, 256, 'VIDEO_IMPORT_INITIAL_TARGET_TOKEN_INVALID') : '';
        if (hasInitialTargetToken && !TOKEN_PATTERN.test(initialTargetTokenValue)) {
            throw failure('VIDEO_IMPORT_INITIAL_TARGET_TOKEN_INVALID');
        }
        const inventory = scanInventory(context);
        const candidate = inventory.candidates.find((entry) => entry.token === candidateTokenValue);
        if (!candidate) throw failure('VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
        const importedAt = operationIso(context);
        const inputs = hasInitialTargetToken
            ? buildInitialInputs(context, candidate, initialTargetTokenValue, importedAt)
            : buildInputs(context, candidate, retryMediaId, importedAt);
        const now = clockMs(context);
        const expiresAtMs = now + planTtl(context);
        const store = planStore(context);
        for (const [token, record] of store.entries()) {
            if (!record || record.expiresAtMs <= now) store.delete(token);
        }
        const randomBytes = context.randomBytes || crypto.randomBytes;
        let token = '';
        for (let attempt = 0; attempt < 4 && !token; attempt += 1) {
            const proposed = randomBytes(32).toString('base64url');
            if (TOKEN_PATTERN.test(proposed) && !store.has(proposed)) token = proposed;
        }
        if (!token) throw failure('VIDEO_IMPORT_PLAN_TOKEN_UNAVAILABLE');
        store.set(token, {
            expiresAtMs,
            candidateToken: candidate.token,
            retryMediaId,
            initialTargetToken: initialTargetTokenValue,
            importMode: inputs.importMode,
            importedAt,
            evidence: evidence(inputs),
        });
        return {
            schema_version: PLAN_SCHEMA,
            status: inputs.alreadyCurrent ? 'already_current' : 'ready',
            ready: !inputs.alreadyCurrent,
            already_current: inputs.alreadyCurrent,
            import_mode: inputs.importMode,
            plan_token: token,
            expires_at: new Date(expiresAtMs).toISOString(),
            retry_media_id: retryMediaId,
            target_id: inputs.desired.target_id,
            target_label: inputs.desired.target_label,
            new_media_id: inputs.desired.media_id,
            source_provider: candidate.provider,
            source_result_id: candidate.resultId,
            size_bytes: candidate.source.size,
            duration_seconds: candidate.probe.durationSeconds,
            width: candidate.probe.width,
            height: candidate.probe.height,
            blockers: [],
            executed: false,
            generation_executed: false,
        };
    } catch (error) {
        return blockedPlan(error.code || 'VIDEO_IMPORT_PLAN_BLOCKED');
    }
}

function consumePlan(payload, context = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure('VIDEO_IMPORT_CONFIRM_REQUEST_INVALID');
    const token = payload.planToken;
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw failure('VIDEO_IMPORT_PLAN_TOKEN_INVALID');
    const store = planStore(context);
    const record = store.get(token);
    store.delete(token);
    if (!record) throw failure('VIDEO_IMPORT_PLAN_TOKEN_INVALID');
    exactKeys(payload, ['planToken', 'confirmed'], 'VIDEO_IMPORT_CONFIRM_REQUEST_INVALID');
    if (payload.confirmed !== true) throw failure('VIDEO_IMPORT_CONFIRMATION_REQUIRED');
    if (record.expiresAtMs <= clockMs(context)) throw failure('VIDEO_IMPORT_PLAN_TOKEN_EXPIRED');
    return { token, record };
}

function ensureDirectoryTree(rootInfo, relativeDirectory) {
    let current = rootInfo.path;
    for (const component of relativeDirectory.split('/')) {
        current = path.join(current, component);
        try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        const stats = fs.lstatSync(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure('VIDEO_IMPORT_TARGET_PARENT_UNSAFE');
        const real = fs.realpathSync.native(current);
        if (real !== rootInfo.realPath && !real.startsWith(`${rootInfo.realPath}${path.sep}`)) {
            throw failure('VIDEO_IMPORT_TARGET_ESCAPE');
        }
    }
    return current;
}

function fsyncDirectory(directoryPath) {
    let descriptor;
    try {
        descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
        fs.fsyncSync(descriptor);
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function writeExclusive(filePath, buffer) {
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('VIDEO_IMPORT_NOFOLLOW_UNAVAILABLE');
    let descriptor;
    let created = false;
    try {
        descriptor = fs.openSync(
            filePath,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
            0o600,
        );
        created = true;
        fs.fchmodSync(descriptor, 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        const stats = fs.fstatSync(descriptor);
        if (!stats.isFile() || stats.size !== buffer.byteLength || (stats.mode & 0o777) !== 0o600) {
            throw failure('VIDEO_IMPORT_TEMP_UNSAFE');
        }
    } catch (error) {
        if (created) {
            if (descriptor !== undefined) {
                try { fs.closeSync(descriptor); } catch { /* cleanup continues */ }
                descriptor = undefined;
            }
            try { fs.unlinkSync(filePath); } catch { /* task-owned temp */ }
        }
        throw error;
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function publishVideo(inputs, context = {}) {
    if (inputs.target.snapshot.exists) return { created: false };
    const relativeDirectory = `${IMPORT_RELATIVE_ROOT}/${inputs.candidate.provider}`;
    const directory = ensureDirectoryTree(inputs.retry.rootInfo, relativeDirectory);
    const randomBytes = context.randomBytes || crypto.randomBytes;
    const tempPath = path.join(directory, `.video-import-${process.pid}-${randomBytes(12).toString('hex')}`);
    const sourcePath = inputs.candidate.filePath;
    const sourceBefore = fs.lstatSync(sourcePath);
    if (!sameIdentity(identity(sourceBefore), inputs.candidate.source.identity) || sourceBefore.isSymbolicLink()) {
        throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
    }
    let sourceDescriptor;
    let tempDescriptor;
    let tempCreated = false;
    let targetCreated = false;
    try {
        sourceDescriptor = fs.openSync(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(sourceDescriptor);
        if (!sameIdentity(identity(opened), inputs.candidate.source.identity)) throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
        tempDescriptor = fs.openSync(
            tempPath,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
            0o600,
        );
        tempCreated = true;
        fs.fchmodSync(tempDescriptor, 0o600);
        const digest = crypto.createHash('sha256');
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (position < opened.size) {
            const count = fs.readSync(sourceDescriptor, chunk, 0, Math.min(chunk.length, opened.size - position), position);
            if (count <= 0) throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
            let written = 0;
            while (written < count) {
                written += fs.writeSync(tempDescriptor, chunk, written, count - written, null);
            }
            digest.update(chunk.subarray(0, count));
            position += count;
        }
        fs.fsyncSync(tempDescriptor);
        const tempStats = fs.fstatSync(tempDescriptor);
        const sourceAfter = fs.fstatSync(sourceDescriptor);
        const sourcePathAfter = fs.lstatSync(sourcePath);
        if (position !== opened.size || tempStats.size !== opened.size || (tempStats.mode & 0o777) !== 0o600
            || !sameIdentity(identity(opened), identity(sourceAfter))
            || !sameIdentity(identity(opened), identity(sourcePathAfter))
            || digest.digest('hex') !== inputs.candidate.source.sha256) {
            throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
        }
        fs.closeSync(tempDescriptor);
        tempDescriptor = undefined;
        fs.closeSync(sourceDescriptor);
        sourceDescriptor = undefined;
        const link = context.copyLinkSync || fs.linkSync;
        try {
            link(tempPath, inputs.target.path);
            targetCreated = true;
            fsyncDirectory(directory);
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
        const verified = hashStableFile(inputs.target.path, context.maxVideoBytes || MAX_VIDEO_BYTES, 'VIDEO_IMPORT_TARGET_UNSAFE');
        if (verified.sha256 !== inputs.candidate.source.sha256 || verified.size !== inputs.candidate.source.size) {
            throw failure('VIDEO_IMPORT_TARGET_COLLISION');
        }
        return { created: targetCreated };
    } catch (error) {
        if (targetCreated) {
            try { fs.unlinkSync(inputs.target.path); } catch { /* task-owned failed publish */ }
        }
        throw error;
    } finally {
        if (tempDescriptor !== undefined) {
            try { fs.closeSync(tempDescriptor); } catch { /* cleanup continues */ }
        }
        if (sourceDescriptor !== undefined) {
            try { fs.closeSync(sourceDescriptor); } catch { /* cleanup continues */ }
        }
        if (tempCreated) {
            try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            fsyncDirectory(directory);
        }
    }
}

function appendLedger(inputs, context = {}) {
    if (!inputs.ledgerAppendNeeded) return false;
    const recordBuffer = Buffer.from(`${JSON.stringify(inputs.desired)}\n`, 'utf8');
    const separator = inputs.retry.ledger.buffer.length && !inputs.retry.ledger.buffer.toString('utf8').endsWith('\n')
        ? Buffer.from('\n') : Buffer.alloc(0);
    const nextBuffer = Buffer.concat([inputs.retry.ledger.buffer, separator, recordBuffer]);
    if (nextBuffer.byteLength > MAX_LEDGER_BYTES) throw failure('VIDEO_IMPORT_LEDGER_TOO_LARGE');
    const parent = inputs.retry.rootInfo.path;
    const randomBytes = context.randomBytes || crypto.randomBytes;
    const tempPath = path.join(parent, `.video-media-attempts-${process.pid}-${randomBytes(12).toString('hex')}`);
    let renamed = false;
    try {
        writeExclusive(tempPath, nextBuffer);
        const current = smallFile(inputs.retry.ledgerPath, MAX_LEDGER_BYTES, 'VIDEO_IMPORT_LEDGER_UNSAFE', { allowEmpty: true });
        if (!sameSnapshot(current, inputs.retry.ledger)) throw failure('VIDEO_IMPORT_LEDGER_STALE');
        const rename = context.ledgerRenameFile || fs.renameSync;
        rename(tempPath, inputs.retry.ledgerPath);
        renamed = true;
        fsyncDirectory(parent);
        const written = smallFile(inputs.retry.ledgerPath, MAX_LEDGER_BYTES, 'VIDEO_IMPORT_LEDGER_UNSAFE', { allowEmpty: true });
        if (written.sha256 !== sha256(nextBuffer) || written.size !== nextBuffer.byteLength) {
            throw failure('VIDEO_IMPORT_LEDGER_POST_WRITE_MISMATCH');
        }
        return true;
    } finally {
        if (!renamed) {
            try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
}

function acquireLock(rootInfo, token, context = {}) {
    const directory = ensureDirectoryTree(rootInfo, '.film-pipeline-locks');
    const lockPath = path.join(directory, 'media-attempts.lock');
    const buffer = Buffer.from(`${JSON.stringify({
        schema_version: 'film_pipeline.media_attempts_lock.v1',
        pid: process.pid,
        created_at_ms: clockMs(context),
        production_root_fingerprint: rootInfo.fingerprint,
        token_sha256: sha256(token),
    })}\n`);
    try { writeExclusive(lockPath, buffer); } catch (error) {
        if (error.code === 'EEXIST') throw failure('VIDEO_IMPORT_LOCKED');
        throw error;
    }
    fsyncDirectory(directory);
    const owned = smallFile(lockPath, 4096, 'VIDEO_IMPORT_LOCK_UNSAFE');
    return () => {
        const current = smallFile(lockPath, 4096, 'VIDEO_IMPORT_LOCK_UNSAFE');
        if (!sameSnapshot(current, owned)) throw failure('VIDEO_IMPORT_LOCK_CHANGED');
        fs.unlinkSync(lockPath);
        fsyncDirectory(directory);
    };
}

function confirmVideoResultImport(payload, context = {}) {
    const { token, record } = consumePlan(payload, context);
    const root = assertProductionRoot(context);
    const release = acquireLock(root, token, context);
    try {
        const inventory = scanInventory(context);
        const candidate = inventory.candidates.find((entry) => entry.token === record.candidateToken);
        if (!candidate) throw failure('VIDEO_IMPORT_SOURCE_CHANGED');
        const inputs = record.importMode === 'initial'
            ? buildInitialInputs(context, candidate, record.initialTargetToken, record.importedAt)
            : buildInputs(context, candidate, record.retryMediaId, record.importedAt);
        if (!stableEvidence(record.evidence, evidence(inputs))) throw failure('VIDEO_IMPORT_PLAN_STALE');
        if (inputs.alreadyCurrent) {
            return {
                ok: true,
                imported: false,
                already_current: true,
                executed: false,
                generation_executed: false,
                media_id: inputs.desired.media_id,
                target_id: inputs.desired.target_id,
                target_label: inputs.desired.target_label,
                import_mode: inputs.importMode,
                provider: inputs.candidate.provider,
                copied: false,
                ledger_appended: false,
            };
        }
        const copied = publishVideo(inputs, context);
        const ledgerAppended = appendLedger(inputs, context);
        return {
            ok: true,
            imported: copied.created || ledgerAppended,
            already_current: false,
            executed: copied.created || ledgerAppended,
            generation_executed: false,
            media_id: inputs.desired.media_id,
            target_id: inputs.desired.target_id,
            target_label: inputs.desired.target_label,
            import_mode: inputs.importMode,
            provider: inputs.candidate.provider,
            copied: copied.created,
            ledger_appended: ledgerAppended,
        };
    } finally {
        release();
    }
}

module.exports = {
    WORKSPACE_SCHEMA,
    PLAN_SCHEMA,
    EXTERNAL_RESULT_SCHEMA,
    EXTERNAL_RESULT_SCHEMA_V2,
    DEFAULT_FLOW_RESULTS_ROOT,
    DEFAULT_GROK_RESULTS_ROOT,
    DEFAULT_REPLICATE_RESULTS_ROOT,
    DEFAULT_REPLICATE_RECEIPT_RESULTS_ROOT,
    DEFAULT_BYTEDANCE_RECEIPT_RESULTS_ROOT,
    DEFAULT_REPLICATE_SHA_ALLOWLIST,
    DEFAULT_FFPROBE_PATH,
    MAX_CANDIDATES,
    MAX_SCAN_ENTRIES,
    MAX_VIDEO_BYTES,
    MAX_PREVIEW_BYTES,
    DEFAULT_PLAN_TTL_MS,
    getVideoResultImportWorkspace,
    resolveVideoExecutionResultLocator,
    resolveVideoExecutionResultLocatorForExecution,
    getVideoResultImportPreview,
    copyVideoResultCandidateToPrivateFile,
    planVideoResultImport,
    confirmVideoResultImport,
};
