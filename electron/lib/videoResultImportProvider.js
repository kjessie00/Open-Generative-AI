const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKSPACE_SCHEMA = 'film_pipeline.video_result_import_workspace.v1';
const PLAN_SCHEMA = 'film_pipeline.video_result_import_plan.v1';
const DEFAULT_FLOW_RESULTS_ROOT = '/Users/jessiek/StudioProjects/google_labs_flow_auto/outputs/generated';
const DEFAULT_GROK_RESULTS_ROOT = '/Users/jessiek/StudioProjects/grok-auto/grok-browser/outputs';
const DEFAULT_FFPROBE_PATH = '/opt/homebrew/bin/ffprobe';
const IMPORT_RELATIVE_ROOT = 'media/imports';
const MAX_CANDIDATES = 24;
const MAX_SCAN_ENTRIES = 240;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
const DEFAULT_PLAN_TTL_MS = 2 * 60 * 1000;
const MAX_PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_FFPROBE_OUTPUT_BYTES = 1024 * 1024;
const SESSION_TOKEN_SECRET = crypto.randomBytes(32);
const SESSION_PLAN_STORE = new Map();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDERS = Object.freeze(['flow', 'grok']);

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
    ].join('\0')).digest('base64url');
}

function inspectCandidate(provider, resultId, filePath, rootInfo, context = {}) {
    safeId(resultId, 'VIDEO_IMPORT_RESULT_ID_INVALID');
    if (path.extname(filePath).toLowerCase() !== '.mp4') throw failure('VIDEO_IMPORT_EXTENSION_INVALID');
    assertAncestors(rootInfo, filePath, 'VIDEO_IMPORT_SOURCE_UNSAFE');
    const before = hashStableFile(filePath, context.maxVideoBytes || MAX_VIDEO_BYTES);
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

function scanInventory(context = {}) {
    const candidates = [];
    const blockers = [];
    let rejectedCount = 0;
    for (const [provider, scan] of [['flow', scanFlow], ['grok', scanGrok]]) {
        try {
            const result = scan(context);
            candidates.push(...result.candidates);
            rejectedCount += result.rejected;
        } catch (error) {
            blockers.push(error.code || `VIDEO_IMPORT_${provider.toUpperCase()}_SCAN_BLOCKED`);
        }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs
        || left.provider.localeCompare(right.provider) || left.resultId.localeCompare(right.resultId));
    const selected = [];
    let totalBytes = 0;
    for (const candidate of candidates) {
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
        rejected_count: 0,
        blockers: [code],
        executed: false,
        generation_executed: false,
    };
}

function getVideoResultImportWorkspace(context = {}) {
    try {
        const inventory = scanInventory(context);
        return {
            schema_version: WORKSPACE_SCHEMA,
            status: inventory.candidates.length ? 'ready' : 'empty',
            ready: inventory.candidates.length > 0,
            candidates: inventory.candidates.map(publicCandidate),
            rejected_count: inventory.rejectedCount,
            blockers: inventory.blockers,
            executed: false,
            generation_executed: false,
        };
    } catch (error) {
        return blockedWorkspace(error.code || 'VIDEO_IMPORT_WORKSPACE_BLOCKED');
    }
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
        'source_width', 'source_height',
    ];
    return keys.every((key) => existing[key] === desired[key])
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
        ledgerAppendNeeded,
        alreadyCurrent: !ledgerAppendNeeded && targetReady,
    };
}

function evidence(inputs) {
    return {
        productionRootFingerprint: inputs.retry.rootInfo.fingerprint,
        productionRootIdentity: inputs.retry.rootInfo.identity,
        ledger: inputs.retry.ledger,
        review: inputs.retry.review,
        queue: inputs.retry.queue,
        candidateToken: inputs.candidate.token,
        candidateRootIdentity: inputs.candidate.rootIdentity,
        candidateSource: inputs.candidate.source,
        candidateProbe: inputs.candidate.probe,
        target: inputs.target.snapshot,
        desired: inputs.desired,
        ledgerAppendNeeded: inputs.ledgerAppendNeeded,
        alreadyCurrent: inputs.alreadyCurrent,
    };
}

function stableEvidence(left, right) {
    return left.productionRootFingerprint === right.productionRootFingerprint
        && sameDirectoryIdentity(left.productionRootIdentity, right.productionRootIdentity)
        && sameSnapshot(left.ledger, right.ledger) && sameSnapshot(left.review, right.review)
        && JSON.stringify(left.queue) === JSON.stringify(right.queue)
        && left.candidateToken === right.candidateToken
        && sameDirectoryIdentity(left.candidateRootIdentity, right.candidateRootIdentity)
        && sameSnapshot(left.candidateSource, right.candidateSource)
        && JSON.stringify(left.candidateProbe) === JSON.stringify(right.candidateProbe)
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
        plan_token: '',
        expires_at: '',
        retry_media_id: '',
        target_id: '',
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
        exactKeys(payload, ['candidateToken', 'retryMediaId'], 'VIDEO_IMPORT_PLAN_REQUEST_INVALID');
        const candidateTokenValue = safeOptionalText(payload.candidateToken, 256, 'VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
        if (!TOKEN_PATTERN.test(candidateTokenValue)) throw failure('VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
        const retryMediaId = safeId(payload.retryMediaId, 'VIDEO_IMPORT_RETRY_ID_INVALID');
        const inventory = scanInventory(context);
        const candidate = inventory.candidates.find((entry) => entry.token === candidateTokenValue);
        if (!candidate) throw failure('VIDEO_IMPORT_CANDIDATE_TOKEN_INVALID');
        const importedAt = operationIso(context);
        const inputs = buildInputs(context, candidate, retryMediaId, importedAt);
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
            importedAt,
            evidence: evidence(inputs),
        });
        return {
            schema_version: PLAN_SCHEMA,
            status: inputs.alreadyCurrent ? 'already_current' : 'ready',
            ready: !inputs.alreadyCurrent,
            already_current: inputs.alreadyCurrent,
            plan_token: token,
            expires_at: new Date(expiresAtMs).toISOString(),
            retry_media_id: retryMediaId,
            target_id: inputs.desired.target_id,
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
        const inputs = buildInputs(context, candidate, record.retryMediaId, record.importedAt);
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
    DEFAULT_FLOW_RESULTS_ROOT,
    DEFAULT_GROK_RESULTS_ROOT,
    DEFAULT_FFPROBE_PATH,
    MAX_CANDIDATES,
    MAX_SCAN_ENTRIES,
    MAX_VIDEO_BYTES,
    MAX_PREVIEW_BYTES,
    DEFAULT_PLAN_TTL_MS,
    getVideoResultImportWorkspace,
    getVideoResultImportPreview,
    planVideoResultImport,
    confirmVideoResultImport,
};
