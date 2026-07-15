const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { buildMediaRetryPlan } = require('./mediaRetryPlanProvider');
const { readProductionFolder } = require('./productionReader');

const WORKSPACE_SCHEMA = 'film_pipeline.dst_bundle_import_workspace.v1';
const PLAN_SCHEMA = 'film_pipeline.dst_bundle_import_plan.v1';
const DEFAULT_DST_IMAGES_ROOT = '/Users/jessiek/StudioProjects/deepSearchTeam/output/images';
const MAX_CANDIDATES = 12;
const MAX_IMAGES_PER_BUNDLE = 12;
const MAX_SCAN_DIRECTORIES = 240;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_LEDGER_BYTES = 2 * 1024 * 1024;
const MAX_TARGET_LABEL_BYTES = 512;
const MAX_TARGET_LABEL_CHARACTERS = 160;
const DEFAULT_PLAN_TTL_MS = 2 * 60 * 1000;
const MAX_PLAN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_STALE_LOCK_MS = 30 * 1000;
const MAX_STALE_LOCK_MS = 10 * 60 * 1000;
const SESSION_TOKEN_SECRET = crypto.randomBytes(32);
const SESSION_PLAN_STORE = new Map();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const INITIAL_TARGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IMPORT_RELATIVE_ROOT = 'media/imports/dst';

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

function safeId(value, code = 'DST_IMPORT_ID_INVALID') {
    if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) throw failure(code);
    return value;
}

function boundedText(value, maximum, code) {
    if (typeof value !== 'string' || value.includes('\0')) throw failure(code);
    const text = value.trim();
    if (!text || Buffer.byteLength(text, 'utf8') > maximum) throw failure(code);
    return text;
}

function boundedTargetLabel(value) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
        throw failure('DST_IMPORT_INITIAL_TARGET_LABEL_INVALID');
    }
    const label = value.trim().normalize('NFC');
    if (!label || [...label].length > MAX_TARGET_LABEL_CHARACTERS
        || Buffer.byteLength(label, 'utf8') > MAX_TARGET_LABEL_BYTES) {
        throw failure('DST_IMPORT_INITIAL_TARGET_LABEL_INVALID');
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

function assertRealDirectory(directoryPath, code, { parentRoot = '' } = {}) {
    if (typeof directoryPath !== 'string' || !directoryPath || directoryPath.includes('\0')
        || !path.isAbsolute(directoryPath) || path.normalize(directoryPath) !== directoryPath) throw failure(code);
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw failure(code); }
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure(code);
    const realPath = fs.realpathSync.native(directoryPath);
    if (realPath !== directoryPath) throw failure(code);
    if (parentRoot && path.dirname(realPath) !== parentRoot) throw failure(code);
    return { path: directoryPath, realPath, stats, identity: identity(stats) };
}

function stableFile(filePath, maximum, code, { allowEmpty = false } = {}) {
    let before;
    try { before = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') return { exists: false, buffer: Buffer.alloc(0), sha256: '', size: 0, identity: null };
        throw failure(code);
    }
    if (before.isSymbolicLink() || !before.isFile() || (!allowEmpty && before.size <= 0) || before.size > maximum) {
        throw failure(before.size > maximum ? `${code}_TOO_LARGE` : code);
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('DST_IMPORT_NOFOLLOW_UNAVAILABLE');
    let descriptor;
    try {
        descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || !sameIdentity(identity(before), identity(opened))) throw failure(`${code}_CHANGED`);
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(filePath);
        if (buffer.byteLength !== opened.size || !sameIdentity(identity(opened), identity(after))
            || !sameIdentity(identity(opened), identity(pathAfter))) throw failure(`${code}_CHANGED`);
        return {
            exists: true,
            buffer,
            sha256: sha256(buffer),
            size: buffer.byteLength,
            identity: identity(opened),
        };
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

function imageType(fileName, buffer) {
    const extension = path.extname(fileName).toLowerCase();
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        if (extension !== '.png') throw failure('DST_IMPORT_IMAGE_EXTENSION_MISMATCH');
        return { mimeType: 'image/png', extension: '.png' };
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        if (!['.jpg', '.jpeg'].includes(extension)) throw failure('DST_IMPORT_IMAGE_EXTENSION_MISMATCH');
        return { mimeType: 'image/jpeg', extension: '.jpg' };
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        if (extension !== '.webp') throw failure('DST_IMPORT_IMAGE_EXTENSION_MISMATCH');
        return { mimeType: 'image/webp', extension: '.webp' };
    }
    throw failure('DST_IMPORT_IMAGE_TYPE_UNSUPPORTED');
}

function tokenSecret(context = {}) {
    const secret = context.tokenSecret || SESSION_TOKEN_SECRET;
    if (!Buffer.isBuffer(secret) || secret.byteLength < 32) throw failure('DST_IMPORT_TOKEN_SECRET_INVALID');
    return secret;
}

function candidateToken(candidate, context = {}) {
    return crypto.createHmac('sha256', tokenSecret(context)).update([
        candidate.inventoryRootFingerprint,
        candidate.bundleId,
        candidate.manifest.sha256,
        candidate.metadata.sha256,
        ...candidate.images.flatMap((image) => [image.imageName, image.image.sha256]),
    ].join('\0')).digest('base64url');
}

function inspectBundle(imagesRoot, inventoryRootFingerprint, bundleName, context = {}) {
    const bundleRoot = path.join(imagesRoot.path, bundleName);
    const bundle = assertRealDirectory(bundleRoot, 'DST_IMPORT_BUNDLE_UNSAFE', { parentRoot: imagesRoot.realPath });
    const images = assertRealDirectory(path.join(bundle.path, 'images'), 'DST_IMPORT_IMAGES_DIRECTORY_UNSAFE');
    if (path.dirname(images.realPath) !== bundle.realPath) throw failure('DST_IMPORT_IMAGES_DIRECTORY_UNSAFE');

    const manifestRead = stableFile(path.join(bundle.path, 'manifest.json'), MAX_JSON_BYTES, 'DST_IMPORT_MANIFEST_UNSAFE');
    const metadataRead = stableFile(path.join(bundle.path, 'metadata.json'), MAX_JSON_BYTES, 'DST_IMPORT_METADATA_UNSAFE');
    const manifest = parseJson(manifestRead, 'DST_IMPORT_MANIFEST_INVALID');
    const metadata = parseJson(metadataRead, 'DST_IMPORT_METADATA_INVALID');
    const bundleId = safeId(manifest.id, 'DST_IMPORT_BUNDLE_ID_INVALID');
    const query = boundedText(manifest.query, 12000, 'DST_IMPORT_PROMPT_INVALID');
    if (manifest.type !== 'image_generation' || manifest.status !== 'complete'
        || manifest.profile !== 'goldpure369' || manifest.files?.images !== 'images/'
        || metadata.status !== 'complete' || metadata.profile !== 'goldpure369'
        || !Number.isSafeInteger(metadata.image_count) || metadata.image_count < 1
        || metadata.image_count > MAX_IMAGES_PER_BUNDLE || metadata.query !== query) {
        throw failure('DST_IMPORT_BUNDLE_CONTRACT_INVALID');
    }

    const entries = fs.readdirSync(images.path, { withFileTypes: true });
    const imageLimit = context.maxImageBytes || MAX_IMAGE_BYTES;
    if (entries.length !== metadata.image_count) throw failure('DST_IMPORT_IMAGE_COUNT_MISMATCH');
    const orderedEntries = entries.slice().sort((left, right) => left.name.localeCompare(right.name));
    const bundleImages = orderedEntries.map((entry, index) => {
        if (!entry.isFile() || entry.isSymbolicLink()) throw failure('DST_IMPORT_IMAGE_ENTRY_UNSAFE');
        const imageName = safeId(entry.name, 'DST_IMPORT_IMAGE_NAME_INVALID');
        const expectedPrefix = `image_${String(index + 1).padStart(2, '0')}.`;
        if (imageName !== path.basename(imageName) || !imageName.startsWith(expectedPrefix)
            || !/^image_\d{2}\.(?:png|jpe?g|webp)$/.test(imageName)) {
            throw failure('DST_IMPORT_IMAGE_NAME_INVALID');
        }
        const imagePath = path.join(images.path, imageName);
        const imageRead = stableFile(imagePath, imageLimit, 'DST_IMPORT_IMAGE_UNSAFE');
        const type = imageType(imageName, imageRead.buffer);
        return {
            imageName,
            imagePath,
            image: imageRead,
            mimeType: type.mimeType,
            extension: type.extension,
        };
    });
    const representative = bundleImages[0];
    const candidate = {
        inventoryRootFingerprint,
        bundleName,
        bundleId,
        bundleIdentity: bundle.identity,
        manifest: manifestRead,
        metadata: metadataRead,
        manifestValue: manifest,
        metadataValue: metadata,
        query,
        images: bundleImages,
        imageCount: bundleImages.length,
        totalSizeBytes: bundleImages.reduce((total, image) => total + image.image.size, 0),
        imageName: representative.imageName,
        imagePath: representative.imagePath,
        image: representative.image,
        mimeType: representative.mimeType,
        extension: representative.extension,
        createdAt: typeof manifest.created_at === 'string' && Number.isFinite(Date.parse(manifest.created_at))
            ? manifest.created_at : '',
    };
    candidate.token = candidateToken(candidate, context);
    return candidate;
}

function scanInventory(context = {}) {
    const env = context.env || process.env;
    const rootPath = context.dstImagesRoot || env.OPEN_GENERATIVE_AI_DST_IMAGES_ROOT || DEFAULT_DST_IMAGES_ROOT;
    const imagesRoot = assertRealDirectory(rootPath, 'DST_IMPORT_ROOT_UNSAFE');
    const inventoryRootFingerprint = sha256(`${imagesRoot.realPath}\0${imagesRoot.stats.dev}\0${imagesRoot.stats.ino}`);
    const directories = fs.readdirSync(imagesRoot.path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
        .map((entry) => {
            const fullPath = path.join(imagesRoot.path, entry.name);
            try { return { name: entry.name, mtimeMs: fs.lstatSync(fullPath).mtimeMs }; } catch { return null; }
        })
        .filter(Boolean)
        .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name))
        .slice(0, context.maxScanDirectories || MAX_SCAN_DIRECTORIES);
    const candidates = [];
    let rejectedCount = 0;
    const candidateLimit = Math.min(MAX_CANDIDATES, context.maxCandidates || MAX_CANDIDATES);
    for (const directory of directories) {
        if (candidates.length >= candidateLimit) break;
        try { candidates.push(inspectBundle(imagesRoot, inventoryRootFingerprint, directory.name, context)); } catch { rejectedCount += 1; }
    }
    return { imagesRoot, inventoryRootFingerprint, candidates, rejectedCount };
}

function publicCandidate(candidate) {
    return {
        candidate_token: candidate.token,
        bundle_id: candidate.bundleId,
        created_at: candidate.createdAt,
        prompt_excerpt: candidate.query.slice(0, 160),
        mime_type: candidate.mimeType,
        size_bytes: candidate.image.size,
        image_count: candidate.imageCount,
        total_size_bytes: candidate.totalSizeBytes,
    };
}

function blockedPreview(code) {
    return {
        status: 'blocked',
        ready: false,
        candidate_token: '',
        image_index: 0,
        preview: null,
        blockers: [code],
        executed: false,
        generation_executed: false,
    };
}

function getDstBundleImportPreview(payload, context = {}) {
    try {
        const hasImageIndex = Boolean(payload && Object.prototype.hasOwnProperty.call(payload, 'imageIndex'));
        exactKeys(payload, hasImageIndex ? ['candidateToken', 'imageIndex'] : ['candidateToken'], 'DST_IMPORT_PREVIEW_REQUEST_INVALID');
        const token = boundedText(payload.candidateToken, 256, 'DST_IMPORT_CANDIDATE_TOKEN_INVALID');
        if (!TOKEN_PATTERN.test(token)) throw failure('DST_IMPORT_CANDIDATE_TOKEN_INVALID');
        const imageIndex = hasImageIndex ? payload.imageIndex : 1;
        if (!Number.isSafeInteger(imageIndex) || imageIndex < 1) throw failure('DST_IMPORT_PREVIEW_IMAGE_INDEX_INVALID');
        const inventory = scanInventory(context);
        const candidate = inventory.candidates.find((entry) => entry.token === token);
        if (!candidate) throw failure('DST_IMPORT_CANDIDATE_TOKEN_INVALID');
        const selected = candidate.images[imageIndex - 1];
        if (!selected) throw failure('DST_IMPORT_PREVIEW_IMAGE_INDEX_INVALID');
        if (selected.image.size > MAX_PREVIEW_BYTES) throw failure('DST_IMPORT_PREVIEW_TOO_LARGE');
        return {
            status: 'ready',
            ready: true,
            candidate_token: candidate.token,
            image_index: imageIndex,
            preview: {
                mime_type: selected.mimeType,
                byte_length: selected.image.size,
                base64: selected.image.buffer.toString('base64'),
            },
            blockers: [],
            executed: false,
            generation_executed: false,
        };
    } catch (error) {
        return blockedPreview(error.code || 'DST_IMPORT_PREVIEW_BLOCKED');
    }
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

function getDstBundleImportWorkspace(context = {}) {
    try {
        const inventory = scanInventory(context);
        let initialTargets = [];
        try {
            const authority = initialTargetContext(context);
            initialTargets = authority.targets
                .filter((target) => !authority.records.some((record) => (
                    record.kind === target.kind && record.target_id === target.targetId
                )))
                .map(publicInitialTarget);
        } catch {
            // Retry imports remain available when a production has no authoritative storyboard JSON.
        }
        return {
            schema_version: WORKSPACE_SCHEMA,
            status: inventory.candidates.length ? 'ready' : 'empty',
            ready: inventory.candidates.length > 0,
            candidates: inventory.candidates.map(publicCandidate),
            initial_targets: initialTargets,
            rejected_count: inventory.rejectedCount,
            blockers: inventory.candidates.length ? [] : ['DST_IMPORT_CANDIDATE_EMPTY'],
            executed: false,
            generation_executed: false,
        };
    } catch (error) {
        return blockedWorkspace(error.code || 'DST_IMPORT_WORKSPACE_BLOCKED');
    }
}

// Main-process-only durable execution receipt resolver. The receipt keeps a
// stable bundle/image/hash identity; the short-lived candidate token is
// regenerated only after the current inventory bytes are revalidated.
function resolveDstExecutionResultLocator(locator, context = {}) {
    const match = /^dst:([A-Za-z0-9][A-Za-z0-9._-]{0,159}):(\d{1,2}):([a-f0-9]{64})$/.exec(locator || '');
    if (!match) return null;
    const imageIndex = Number(match[2]);
    const inventory = scanInventory(context);
    const candidate = inventory.candidates.find((entry) => entry.bundleId === match[1]);
    const image = candidate?.images?.[imageIndex - 1];
    if (!candidate || !image || image.image.sha256 !== match[3]) return null;
    return { candidate_token: candidate.token, image_index: imageIndex };
}

function assertProductionRoot(context = {}) {
    const root = context.config?.productionRoot;
    const info = assertRealDirectory(root, 'DST_IMPORT_PRODUCTION_ROOT_UNSAFE');
    return {
        ...info,
        fingerprint: sha256(`${info.realPath}\0${info.stats.dev}\0${info.stats.ino}`),
    };
}

function storyboardClips(value) {
    if (Array.isArray(value)) return value;
    for (const key of ['clips', 'storyboard', 'shots', 'scenes']) {
        if (Array.isArray(value?.[key])) return value[key];
    }
    throw failure('DST_IMPORT_INITIAL_STORYBOARD_CONTRACT_INVALID');
}

function isStructuralPlaceholder(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return true;
    return /^(?:tbd|n\/?a|none|null|unknown|unresolved|requires\b|structural\b|미정|미확정|없음)/i.test(normalized);
}

function initialTargetId(kind, label) {
    if (INITIAL_TARGET_ID_PATTERN.test(label)) return label;
    return `${kind}_${sha256(`${kind}\0${label}`).slice(0, 20)}`;
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
    const byIdentity = new Map();
    const sequenceByKind = new Map();
    const add = (kind, rawLabel) => {
        if (isStructuralPlaceholder(rawLabel)) return;
        let targetLabel;
        try { targetLabel = boundedTargetLabel(rawLabel); } catch { return; }
        const targetId = initialTargetId(kind, targetLabel);
        const identityKey = `${kind}\0${targetId}`;
        const existing = byIdentity.get(identityKey);
        if (existing) {
            if (existing.targetLabel !== targetLabel) throw failure('DST_IMPORT_INITIAL_TARGET_ID_COLLISION');
            return;
        }
        const target = {
            kind,
            targetId,
            targetLabel,
            sequence: (sequenceByKind.get(kind) || 0) + 1,
        };
        sequenceByKind.set(kind, target.sequence);
        target.targetToken = initialTargetToken(rootInfo, storyboard, target, context);
        byIdentity.set(identityKey, target);
        targets.push(target);
    };
    for (const clip of storyboardClips(value)) {
        if (!clip || typeof clip !== 'object' || Array.isArray(clip) || clip.structural_only === true) continue;
        for (const character of Array.isArray(clip.characters) ? clip.characters : []) add('character_sheet', character);
        add('location_sheet', clip.location);
        add('scene_image', clip.clip_id);
    }
    return targets;
}

function publicInitialTarget(target) {
    return {
        target_token: target.targetToken,
        kind: target.kind,
        target_id: target.targetId,
        target_label: target.targetLabel,
        sequence: target.sequence,
    };
}

function initialTargetContext(context = {}, { includeLedger = true } = {}) {
    const rootInfo = assertProductionRoot(context);
    const read = context.readProductionFolderFn || readProductionFolder;
    const raw = read(rootInfo.path);
    const record = raw?.parsed?.storyboardJson;
    if (!record?.exists || record.parsed !== true || typeof record.path !== 'string') {
        throw failure('DST_IMPORT_INITIAL_STORYBOARD_REQUIRED');
    }
    const relative = path.relative(rootInfo.path, record.path);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
        || !['storyboard/storyboard.json', 'storyboard/clips.json', 'storyboard.json'].includes(relative.split(path.sep).join('/'))) {
        throw failure('DST_IMPORT_INITIAL_STORYBOARD_UNSAFE');
    }
    const storyboard = stableFile(record.path, MAX_JSON_BYTES, 'DST_IMPORT_INITIAL_STORYBOARD_UNSAFE');
    const value = parseJson(storyboard, 'DST_IMPORT_INITIAL_STORYBOARD_CONTRACT_INVALID');
    const targets = deriveInitialTargets(rootInfo, storyboard, value, context);
    const storyboardAfter = stableFile(record.path, MAX_JSON_BYTES, 'DST_IMPORT_INITIAL_STORYBOARD_UNSAFE');
    if (!sameSnapshot(storyboard, storyboardAfter)) throw failure('DST_IMPORT_INITIAL_STORYBOARD_CHANGED');
    const result = { rootInfo, storyboardPath: record.path, storyboard: storyboardAfter, targets };
    if (!includeLedger) return result;
    const ledgerPath = path.join(rootInfo.path, 'media_attempts.jsonl');
    const ledger = stableFile(ledgerPath, MAX_LEDGER_BYTES, 'DST_IMPORT_LEDGER_UNSAFE', { allowEmpty: true });
    return { ...result, ledgerPath, ledger, records: parsedLedger(ledger) };
}

function snapshotStablePair(filePath, maximum, code, operation) {
    const before = stableFile(filePath, maximum, code, { allowEmpty: true });
    const value = operation();
    const after = stableFile(filePath, maximum, code, { allowEmpty: true });
    if (!sameSnapshot(before, after)) throw failure(`${code}_CHANGED`);
    return { snapshot: after, value };
}

function parsedLedger(snapshot) {
    const records = [];
    const ids = new Set();
    for (const line of snapshot.buffer.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        let record;
        try { record = JSON.parse(line); } catch { throw failure('DST_IMPORT_LEDGER_INVALID'); }
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw failure('DST_IMPORT_LEDGER_INVALID');
        const mediaId = safeId(record.media_id, 'DST_IMPORT_LEDGER_INVALID');
        if (ids.has(mediaId)) throw failure('DST_IMPORT_LEDGER_DUPLICATE_ID');
        ids.add(mediaId);
        records.push(record);
    }
    return records;
}

function retryContext(context, retryMediaId) {
    const rootInfo = assertProductionRoot(context);
    const ledgerPath = path.join(rootInfo.path, 'media_attempts.jsonl');
    const reviewPath = path.join(rootInfo.path, 'reviews', 'media_review_draft.json');
    const ledgerBefore = stableFile(ledgerPath, MAX_LEDGER_BYTES, 'DST_IMPORT_LEDGER_UNSAFE', { allowEmpty: true });
    const reviewBefore = stableFile(reviewPath, MAX_JSON_BYTES, 'DST_IMPORT_REVIEW_UNSAFE');
    if (!ledgerBefore.exists || !reviewBefore.exists) throw failure('DST_IMPORT_RETRY_SOURCES_REQUIRED');
    const read = context.readProductionFolderFn || readProductionFolder;
    const raw = read(rootInfo.path);
    const ledgerAfter = stableFile(ledgerPath, MAX_LEDGER_BYTES, 'DST_IMPORT_LEDGER_UNSAFE', { allowEmpty: true });
    const reviewAfter = stableFile(reviewPath, MAX_JSON_BYTES, 'DST_IMPORT_REVIEW_UNSAFE');
    if (!sameSnapshot(ledgerBefore, ledgerAfter) || !sameSnapshot(reviewBefore, reviewAfter)) {
        throw failure('DST_IMPORT_RETRY_SOURCES_CHANGED');
    }
    const build = context.buildMediaRetryPlanFn || buildMediaRetryPlan;
    const retryPlan = build(rootInfo.path, { readProductionFolderFn: () => raw });
    const item = retryPlan.items?.find((entry) => entry.media_id === retryMediaId);
    const planBlockers = Array.isArray(retryPlan.blockers) ? retryPlan.blockers : [];
    const itemBlockers = Array.isArray(item?.blockers) ? item.blockers : [];
    if (!item || retryPlan.status !== 'preview_ready' || planBlockers.length
        || item.readiness !== 'preview_ready' || item.preview_ready !== true || itemBlockers.length) {
        throw failure('DST_IMPORT_RETRY_PLAN_BLOCKED');
    }
    if (item.provider !== 'dst' || item.kind === 'video') throw failure('DST_IMPORT_DST_RETRY_REQUIRED');
    const records = parsedLedger(ledgerAfter);
    const source = records.find((record) => record.media_id === retryMediaId);
    if (!source) throw failure('DST_IMPORT_RETRY_SOURCE_MISSING');
    return { rootInfo, ledgerPath, reviewPath, ledger: ledgerAfter, review: reviewAfter, records, item, source };
}

function destinationSnapshot(rootInfo, relativePath, maximum) {
    const target = path.join(rootInfo.path, ...relativePath.split('/'));
    const relative = path.relative(rootInfo.path, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw failure('DST_IMPORT_TARGET_UNSAFE');
    let cursor = rootInfo.path;
    for (const component of relative.split(path.sep).slice(0, -1)) {
        cursor = path.join(cursor, component);
        try {
            const stats = fs.lstatSync(cursor);
            if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure('DST_IMPORT_TARGET_PARENT_UNSAFE');
            const real = fs.realpathSync.native(cursor);
            if (real !== rootInfo.realPath && !real.startsWith(rootInfo.realPath + path.sep)) throw failure('DST_IMPORT_TARGET_ESCAPE');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            break;
        }
    }
    return { path: target, snapshot: stableFile(target, maximum, 'DST_IMPORT_TARGET_UNSAFE') };
}

function recordMatches(existing, desired) {
    const keys = [
        'media_id', 'kind', 'target_id', 'target_label', 'provider', 'operation_id', 'attempt', 'relative_path',
        'generation_status', 'prompt', 'aspect_ratio', 'review_status', 'retry_of', 'source_bundle_id',
        'source_image_name', 'source_manifest_sha256', 'source_metadata_sha256', 'source_image_sha256',
    ];
    return keys.every((key) => existing[key] === desired[key])
        && JSON.stringify(existing.reference_ids || []) === JSON.stringify(desired.reference_ids || []);
}

function operationIso(context = {}) {
    const value = (context.now || (() => new Date().toISOString()))();
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw failure('DST_IMPORT_CLOCK_INVALID');
    return value;
}

function buildEntry(context, candidate, bundleImage, retry, retryMediaId, importedAt, attempt) {
    const imageCandidate = { ...candidate, ...bundleImage };
    const deterministic = sha256(candidate.imageCount === 1
        ? `${retryMediaId}\0${candidate.bundleId}\0${bundleImage.image.sha256}`
        : `${retryMediaId}\0${candidate.bundleId}\0${bundleImage.imageName}\0${bundleImage.image.sha256}`);
    const mediaId = `dst_${deterministic.slice(0, 32)}`;
    const targetRelativePath = `${IMPORT_RELATIVE_ROOT}/${bundleImage.image.sha256}${bundleImage.extension}`;
    const existing = retry.records.find((record) => record.media_id === mediaId);
    const resolvedAttempt = existing ? Number(existing.attempt) : attempt;
    if (!Number.isSafeInteger(resolvedAttempt) || resolvedAttempt <= 0 || resolvedAttempt > 10000) {
        throw failure('DST_IMPORT_ATTEMPT_INVALID');
    }
    const manifestId = safeId(candidate.manifestValue.id, 'DST_IMPORT_OPERATION_ID_INVALID');
    const referenceIds = Array.isArray(retry.source.reference_ids)
        ? retry.source.reference_ids.map((value) => safeId(value, 'DST_IMPORT_REFERENCE_ID_INVALID')).slice(0, 8) : [];
    const targetLabel = typeof retry.source.target_label === 'string'
        ? boundedTargetLabel(retry.source.target_label) : undefined;
    const desired = {
        media_id: mediaId,
        kind: retry.item.kind,
        target_id: retry.item.target_id,
        target_label: targetLabel,
        provider: 'dst',
        operation_id: manifestId,
        attempt: resolvedAttempt,
        reference_ids: referenceIds,
        relative_path: targetRelativePath,
        generation_status: 'imported',
        prompt: candidate.query,
        aspect_ratio: typeof retry.source.aspect_ratio === 'string' ? retry.source.aspect_ratio : '',
        review_status: 'unreviewed',
        retry_of: retryMediaId,
        source_bundle_id: candidate.bundleId,
        source_image_name: bundleImage.imageName,
        source_manifest_sha256: candidate.manifest.sha256,
        source_metadata_sha256: candidate.metadata.sha256,
        source_image_sha256: bundleImage.image.sha256,
        imported_at: importedAt,
    };
    if (existing && !recordMatches(existing, desired)) throw failure('DST_IMPORT_MEDIA_ID_CONFLICT');
    const target = destinationSnapshot(retry.rootInfo, targetRelativePath, context.maxImageBytes || MAX_IMAGE_BYTES);
    if (target.snapshot.exists && target.snapshot.sha256 !== bundleImage.image.sha256) {
        throw failure('DST_IMPORT_TARGET_COLLISION');
    }
    const ledgerAppendNeeded = !existing;
    const targetReady = target.snapshot.exists && target.snapshot.sha256 === bundleImage.image.sha256;
    return {
        retry,
        candidate: imageCandidate,
        desired,
        target,
        ledgerAppendNeeded,
        alreadyCurrent: !ledgerAppendNeeded && targetReady,
    };
}

function assembleInputs(candidate, entries, mappingMode, extra = {}) {
    const first = entries[0];
    return {
        retry: first.retry,
        retries: entries.map((entry) => entry.retry),
        candidate,
        entries,
        desired: first.desired,
        target: first.target,
        ledgerAppendNeeded: first.ledgerAppendNeeded,
        alreadyCurrent: entries.every((entry) => entry.alreadyCurrent),
        mappingMode,
        ...extra,
    };
}

function buildInputs(context, candidate, retryMediaId, importedAt) {
    const retry = retryContext(context, retryMediaId);
    if (candidate.imageCount > 1 && ['character_sheet', 'location_sheet'].includes(retry.item.kind)) {
        throw failure('DST_IMPORT_MAPPING_REQUIRED');
    }
    const attempts = retry.records
        .filter((record) => record.kind === retry.item.kind && record.target_id === retry.item.target_id && record.provider === 'dst')
        .map((record) => Number(record.attempt)).filter((value) => Number.isSafeInteger(value) && value > 0);
    let nextAttempt = Math.max(0, ...attempts) + 1;
    const entries = candidate.images.map((bundleImage) => {
        const deterministic = sha256(candidate.imageCount === 1
            ? `${retryMediaId}\0${candidate.bundleId}\0${bundleImage.image.sha256}`
            : `${retryMediaId}\0${candidate.bundleId}\0${bundleImage.imageName}\0${bundleImage.image.sha256}`);
        const mediaId = `dst_${deterministic.slice(0, 32)}`;
        const existing = retry.records.find((record) => record.media_id === mediaId);
        const attempt = existing ? Number(existing.attempt) : nextAttempt++;
        return buildEntry(context, candidate, bundleImage, retry, retryMediaId, importedAt, attempt);
    });
    return assembleInputs(candidate, entries, 'single_retry_target');
}

function buildMappedInputs(context, candidate, mappings, importedAt) {
    if (!Array.isArray(mappings) || mappings.length !== candidate.imageCount) {
        throw failure('DST_IMPORT_MAPPING_COUNT_INVALID');
    }
    const retryIds = new Set();
    const normalized = mappings.map((mapping, index) => {
        exactKeys(mapping, ['imageIndex', 'retryMediaId'], 'DST_IMPORT_MAPPING_INVALID');
        if (!Number.isSafeInteger(mapping.imageIndex) || mapping.imageIndex !== index + 1) {
            throw failure('DST_IMPORT_MAPPING_SEQUENCE_INVALID');
        }
        const retryMediaId = safeId(mapping.retryMediaId, 'DST_IMPORT_RETRY_ID_INVALID');
        if (retryIds.has(retryMediaId)) throw failure('DST_IMPORT_MAPPING_RETRY_DUPLICATE');
        retryIds.add(retryMediaId);
        return { imageIndex: mapping.imageIndex, retryMediaId };
    });
    const retries = normalized.map((mapping) => retryContext(context, mapping.retryMediaId));
    const first = retries[0];
    for (const retry of retries) {
        if (!sameSnapshot(first.ledger, retry.ledger) || !sameSnapshot(first.review, retry.review)
            || retry.rootInfo.fingerprint !== first.rootInfo.fingerprint) {
            throw failure('DST_IMPORT_MAPPING_SOURCES_CHANGED');
        }
        if (!['character_sheet', 'location_sheet'].includes(retry.item.kind)
            || retry.item.provider !== 'dst' || retry.source.provider !== 'dst'
            || retry.source.media_id !== retry.item.media_id
            || retry.source.kind !== retry.item.kind || retry.source.target_id !== retry.item.target_id) {
            throw failure('DST_IMPORT_MAPPING_RETRY_INVALID');
        }
    }
    if (new Set(retries.map((retry) => retry.item.kind)).size !== 1) {
        throw failure('DST_IMPORT_MAPPING_KIND_MISMATCH');
    }
    const entries = normalized.map((mapping, index) => {
        const retry = retries[index];
        const attempts = retry.records
            .filter((record) => record.kind === retry.item.kind
                && record.target_id === retry.item.target_id && record.provider === 'dst')
            .map((record) => Number(record.attempt))
            .filter((value) => Number.isSafeInteger(value) && value > 0);
        const attempt = Math.max(0, ...attempts) + 1;
        return buildEntry(
            context,
            candidate,
            candidate.images[mapping.imageIndex - 1],
            retry,
            mapping.retryMediaId,
            importedAt,
            attempt,
        );
    });
    return assembleInputs(candidate, entries, 'explicit_retry_items');
}

function buildInitialEntry(context, candidate, bundleImage, authority, target, importedAt) {
    const imageCandidate = { ...candidate, ...bundleImage };
    const deterministic = sha256([
        'initial',
        target.kind,
        target.targetId,
        candidate.bundleId,
        bundleImage.imageName,
        bundleImage.image.sha256,
    ].join('\0'));
    const mediaId = `dst_${deterministic.slice(0, 32)}`;
    const targetRelativePath = `${IMPORT_RELATIVE_ROOT}/${bundleImage.image.sha256}${bundleImage.extension}`;
    const manifestId = safeId(candidate.manifestValue.id, 'DST_IMPORT_OPERATION_ID_INVALID');
    const desired = {
        media_id: mediaId,
        kind: target.kind,
        target_id: target.targetId,
        target_label: target.targetLabel,
        provider: 'dst',
        operation_id: manifestId,
        attempt: 1,
        reference_ids: [],
        relative_path: targetRelativePath,
        generation_status: 'imported',
        prompt: candidate.query,
        aspect_ratio: '',
        review_status: 'unreviewed',
        retry_of: '',
        source_bundle_id: candidate.bundleId,
        source_image_name: bundleImage.imageName,
        source_manifest_sha256: candidate.manifest.sha256,
        source_metadata_sha256: candidate.metadata.sha256,
        source_image_sha256: bundleImage.image.sha256,
        imported_at: importedAt,
    };
    const sameTarget = authority.records.filter((record) => (
        record.kind === target.kind && record.target_id === target.targetId
    ));
    if (sameTarget.length > 1 || (sameTarget.length === 1 && !recordMatches(sameTarget[0], desired))) {
        throw failure('DST_IMPORT_INITIAL_TARGET_EXISTS');
    }
    const existing = authority.records.find((record) => record.media_id === mediaId);
    if (existing && !recordMatches(existing, desired)) throw failure('DST_IMPORT_MEDIA_ID_CONFLICT');
    if (sameTarget.length === 1 && sameTarget[0].media_id !== mediaId) {
        throw failure('DST_IMPORT_INITIAL_TARGET_EXISTS');
    }
    const targetFile = destinationSnapshot(authority.rootInfo, targetRelativePath, context.maxImageBytes || MAX_IMAGE_BYTES);
    if (targetFile.snapshot.exists && targetFile.snapshot.sha256 !== bundleImage.image.sha256) {
        throw failure('DST_IMPORT_TARGET_COLLISION');
    }
    const ledgerAppendNeeded = !existing;
    const targetReady = targetFile.snapshot.exists && targetFile.snapshot.sha256 === bundleImage.image.sha256;
    return {
        retry: { ...authority, item: publicInitialTarget(target) },
        candidate: imageCandidate,
        desired,
        target: targetFile,
        ledgerAppendNeeded,
        alreadyCurrent: !ledgerAppendNeeded && targetReady,
    };
}

function buildInitialInputs(context, candidate, mappings, importedAt) {
    if (!Array.isArray(mappings) || mappings.length !== candidate.imageCount) {
        throw failure('DST_IMPORT_INITIAL_MAPPING_COUNT_INVALID');
    }
    const authority = initialTargetContext(context);
    const tokens = new Set();
    const resolved = mappings.map((mapping, index) => {
        exactKeys(mapping, ['imageIndex', 'targetToken'], 'DST_IMPORT_INITIAL_MAPPING_INVALID');
        if (!Number.isSafeInteger(mapping.imageIndex) || mapping.imageIndex !== index + 1) {
            throw failure('DST_IMPORT_INITIAL_MAPPING_SEQUENCE_INVALID');
        }
        const targetTokenValue = boundedText(mapping.targetToken, 256, 'DST_IMPORT_INITIAL_TARGET_TOKEN_INVALID');
        if (!TOKEN_PATTERN.test(targetTokenValue)) throw failure('DST_IMPORT_INITIAL_TARGET_TOKEN_INVALID');
        if (tokens.has(targetTokenValue)) throw failure('DST_IMPORT_INITIAL_TARGET_DUPLICATE');
        tokens.add(targetTokenValue);
        const target = authority.targets.find((entry) => entry.targetToken === targetTokenValue);
        if (!target) throw failure('DST_IMPORT_INITIAL_TARGET_UNKNOWN');
        return { imageIndex: mapping.imageIndex, targetToken: targetTokenValue, target };
    });
    if (new Set(resolved.map((mapping) => mapping.target.kind)).size !== 1) {
        throw failure('DST_IMPORT_INITIAL_TARGET_KIND_MISMATCH');
    }
    const entries = resolved.map((mapping) => buildInitialEntry(
        context,
        candidate,
        candidate.images[mapping.imageIndex - 1],
        authority,
        mapping.target,
        importedAt,
    ));
    return assembleInputs(candidate, entries, 'initial_targets', {
        storyboard: authority.storyboard,
        initialTargets: resolved.map((mapping) => publicInitialTarget(mapping.target)),
    });
}

function evidence(inputs) {
    return {
        productionRootFingerprint: inputs.retry.rootInfo.fingerprint,
        productionRootIdentity: inputs.retry.rootInfo.identity,
        ledger: inputs.retry.ledger,
        review: inputs.retry.review || null,
        retryItems: inputs.retries.map((retry) => retry.item),
        storyboard: inputs.storyboard || null,
        initialTargets: inputs.initialTargets || [],
        mappingMode: inputs.mappingMode,
        candidateToken: inputs.candidate.token,
        bundleIdentity: inputs.candidate.bundleIdentity,
        manifestSha256: inputs.candidate.manifest.sha256,
        manifestIdentity: inputs.candidate.manifest.identity,
        metadataSha256: inputs.candidate.metadata.sha256,
        metadataIdentity: inputs.candidate.metadata.identity,
        images: inputs.entries.map((entry) => ({
            imageSha256: entry.candidate.image.sha256,
            imageIdentity: entry.candidate.image.identity,
            target: entry.target.snapshot,
            desired: entry.desired,
            ledgerAppendNeeded: entry.ledgerAppendNeeded,
            alreadyCurrent: entry.alreadyCurrent,
        })),
        alreadyCurrent: inputs.alreadyCurrent,
    };
}

function sameOptionalSnapshot(left, right) {
    if (!left || !right) return left === right;
    return sameSnapshot(left, right);
}

function stableEvidence(left, right) {
    return left.productionRootFingerprint === right.productionRootFingerprint
        // Lock-directory creation legitimately changes the production directory timestamps. Root
        // provenance is its device/inode/mode; mutable inputs are bound separately below.
        && sameDirectoryIdentity(left.productionRootIdentity, right.productionRootIdentity)
        && sameSnapshot(left.ledger, right.ledger) && sameOptionalSnapshot(left.review, right.review)
        && JSON.stringify(left.retryItems) === JSON.stringify(right.retryItems)
        && sameOptionalSnapshot(left.storyboard, right.storyboard)
        && JSON.stringify(left.initialTargets) === JSON.stringify(right.initialTargets)
        && left.mappingMode === right.mappingMode
        && left.candidateToken === right.candidateToken
        && sameIdentity(left.bundleIdentity, right.bundleIdentity)
        && left.manifestSha256 === right.manifestSha256 && left.metadataSha256 === right.metadataSha256
        && sameIdentity(left.manifestIdentity, right.manifestIdentity)
        && sameIdentity(left.metadataIdentity, right.metadataIdentity)
        && left.images.length === right.images.length
        && left.images.every((image, index) => {
            const current = right.images[index];
            return image.imageSha256 === current.imageSha256
                && sameIdentity(image.imageIdentity, current.imageIdentity)
                && sameSnapshot(image.target, current.target)
                && JSON.stringify(image.desired) === JSON.stringify(current.desired)
                && image.ledgerAppendNeeded === current.ledgerAppendNeeded
                && image.alreadyCurrent === current.alreadyCurrent;
        })
        && left.alreadyCurrent === right.alreadyCurrent;
}

function clockMs(context = {}) {
    const value = context.nowMs ? context.nowMs() : Date.now();
    if (!Number.isFinite(value) || value < 0) throw failure('DST_IMPORT_CLOCK_INVALID');
    return Math.trunc(value);
}

function planTtl(context = {}) {
    const value = context.planTtlMs ?? DEFAULT_PLAN_TTL_MS;
    if (!Number.isInteger(value) || value <= 0 || value > MAX_PLAN_TTL_MS) throw failure('DST_IMPORT_TTL_INVALID');
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
        mapping_mode: '',
        kind: '',
        plan_token: '',
        expires_at: '',
        retry_media_id: '',
        target_id: '',
        target_label: '',
        new_media_id: '',
        source_bundle_id: '',
        source_image_name: '',
        source_manifest_sha256: '',
        source_image_sha256: '',
        mime_type: '',
        size_bytes: 0,
        image_count: 0,
        new_image_count: 0,
        already_current_count: 0,
        total_size_bytes: 0,
        target_relative_path: '',
        preview: null,
        blockers: [code],
        executed: false,
        generation_executed: false,
    };
}

function planDstBundleImport(payload, context = {}) {
    try {
        const hasMappings = Boolean(payload && Object.prototype.hasOwnProperty.call(payload, 'mappings'));
        const hasInitialMappings = Boolean(payload && Object.prototype.hasOwnProperty.call(payload, 'initialMappings'));
        if (hasMappings && hasInitialMappings) throw failure('DST_IMPORT_PLAN_REQUEST_INVALID');
        exactKeys(
            payload,
            hasInitialMappings
                ? ['candidateToken', 'initialMappings']
                : hasMappings ? ['candidateToken', 'mappings'] : ['candidateToken', 'retryMediaId'],
            'DST_IMPORT_PLAN_REQUEST_INVALID',
        );
        const candidateTokenValue = boundedText(payload.candidateToken, 256, 'DST_IMPORT_CANDIDATE_TOKEN_INVALID');
        if (!TOKEN_PATTERN.test(candidateTokenValue)) throw failure('DST_IMPORT_CANDIDATE_TOKEN_INVALID');
        const retryMediaId = hasMappings || hasInitialMappings
            ? '' : safeId(payload.retryMediaId, 'DST_IMPORT_RETRY_ID_INVALID');
        const inventory = scanInventory(context);
        const candidate = inventory.candidates.find((entry) => entry.token === candidateTokenValue);
        if (!candidate) throw failure('DST_IMPORT_CANDIDATE_TOKEN_INVALID');
        const importedAt = operationIso(context);
        const inputs = hasInitialMappings
            ? buildInitialInputs(context, candidate, payload.initialMappings, importedAt)
            : hasMappings ? buildMappedInputs(context, candidate, payload.mappings, importedAt)
                : buildInputs(context, candidate, retryMediaId, importedAt);
        const storedMappings = hasMappings
            ? payload.mappings.map((mapping) => ({ imageIndex: mapping.imageIndex, retryMediaId: mapping.retryMediaId }))
            : null;
        const storedInitialMappings = hasInitialMappings
            ? payload.initialMappings.map((mapping) => ({ imageIndex: mapping.imageIndex, targetToken: mapping.targetToken }))
            : null;
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
        if (!token) throw failure('DST_IMPORT_PLAN_TOKEN_UNAVAILABLE');
        store.set(token, {
            expiresAtMs,
            candidateToken: candidate.token,
            retryMediaId,
            mappings: storedMappings,
            initialMappings: storedInitialMappings,
            importedAt,
            evidence: evidence(inputs),
        });
        return {
            schema_version: PLAN_SCHEMA,
            status: inputs.alreadyCurrent ? 'already_current' : 'ready',
            ready: !inputs.alreadyCurrent,
            already_current: inputs.alreadyCurrent,
            mapping_mode: inputs.mappingMode,
            kind: inputs.desired.kind,
            plan_token: token,
            expires_at: new Date(expiresAtMs).toISOString(),
            retry_media_id: inputs.desired.retry_of,
            target_id: inputs.desired.target_id,
            target_label: inputs.desired.target_label || inputs.desired.target_id,
            new_media_id: inputs.desired.media_id,
            source_bundle_id: candidate.bundleId,
            source_image_name: candidate.imageName,
            source_manifest_sha256: candidate.manifest.sha256,
            source_image_sha256: candidate.image.sha256,
            mime_type: candidate.mimeType,
            size_bytes: candidate.image.size,
            image_count: candidate.imageCount,
            new_image_count: inputs.entries.filter((entry) => !entry.alreadyCurrent).length,
            already_current_count: inputs.entries.filter((entry) => entry.alreadyCurrent).length,
            total_size_bytes: candidate.totalSizeBytes,
            target_relative_path: inputs.desired.relative_path,
            preview: null,
            blockers: [],
            executed: false,
            generation_executed: false,
        };
    } catch (error) {
        return blockedPlan(error.code || 'DST_IMPORT_PLAN_BLOCKED');
    }
}

function consumePlan(payload, context = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure('DST_IMPORT_CONFIRM_REQUEST_INVALID');
    const token = payload.planToken;
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw failure('DST_IMPORT_PLAN_TOKEN_INVALID');
    const store = planStore(context);
    const record = store.get(token);
    store.delete(token);
    if (!record) throw failure('DST_IMPORT_PLAN_TOKEN_INVALID');
    exactKeys(payload, ['planToken', 'confirmed'], 'DST_IMPORT_CONFIRM_REQUEST_INVALID');
    if (payload.confirmed !== true) throw failure('DST_IMPORT_CONFIRMATION_REQUIRED');
    if (record.expiresAtMs <= clockMs(context)) throw failure('DST_IMPORT_PLAN_TOKEN_EXPIRED');
    return { token, record };
}

function ensureDirectoryTree(rootInfo, relativeDirectory) {
    let current = rootInfo.path;
    for (const component of relativeDirectory.split('/')) {
        current = path.join(current, component);
        try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        const stats = fs.lstatSync(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw failure('DST_IMPORT_TARGET_PARENT_UNSAFE');
        const real = fs.realpathSync.native(current);
        if (real !== rootInfo.realPath && !real.startsWith(rootInfo.realPath + path.sep)) throw failure('DST_IMPORT_TARGET_ESCAPE');
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
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('DST_IMPORT_NOFOLLOW_UNAVAILABLE');
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
            throw failure('DST_IMPORT_TEMP_UNSAFE');
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

function publishImage(inputs, context = {}) {
    if (inputs.target.snapshot.exists) return { created: false };
    const directory = ensureDirectoryTree(inputs.retry.rootInfo, IMPORT_RELATIVE_ROOT);
    const randomBytes = context.randomBytes || crypto.randomBytes;
    const tempPath = path.join(directory, `.dst-import-${process.pid}-${randomBytes(12).toString('hex')}`);
    writeExclusive(tempPath, inputs.candidate.image.buffer);
    let created = false;
    try {
        const linkSync = context.copyLinkSync || fs.linkSync;
        try {
            linkSync(tempPath, inputs.target.path);
            created = true;
            fsyncDirectory(directory);
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
        const verified = stableFile(inputs.target.path, context.maxImageBytes || MAX_IMAGE_BYTES, 'DST_IMPORT_TARGET_UNSAFE');
        if (!verified.exists || verified.sha256 !== inputs.candidate.image.sha256) throw failure('DST_IMPORT_TARGET_COLLISION');
        return { created };
    } finally {
        try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        fsyncDirectory(directory);
    }
}

function appendLedger(inputs, context = {}) {
    const pending = inputs.entries.filter((entry) => entry.ledgerAppendNeeded);
    if (!pending.length) return 0;
    const recordBuffer = Buffer.from(pending.map((entry) => JSON.stringify(entry.desired)).join('\n') + '\n', 'utf8');
    const separator = inputs.retry.ledger.buffer.length && !inputs.retry.ledger.buffer.toString('utf8').endsWith('\n') ? Buffer.from('\n') : Buffer.alloc(0);
    const nextBuffer = Buffer.concat([inputs.retry.ledger.buffer, separator, recordBuffer]);
    if (nextBuffer.byteLength > MAX_LEDGER_BYTES) throw failure('DST_IMPORT_LEDGER_TOO_LARGE');
    const parent = inputs.retry.rootInfo.path;
    const randomBytes = context.randomBytes || crypto.randomBytes;
    const tempPath = path.join(parent, `.dst-media-attempts-${process.pid}-${randomBytes(12).toString('hex')}`);
    let renamed = false;
    try {
        writeExclusive(tempPath, nextBuffer);
        // The production-root media-attempts lock serializes participating writers. Node/fs has no
        // portable compare-and-swap rename, so a non-cooperating external writer can still race this
        // final snapshot check; such writers are outside this cooperative ledger contract.
        const current = stableFile(inputs.retry.ledgerPath, MAX_LEDGER_BYTES, 'DST_IMPORT_LEDGER_UNSAFE', { allowEmpty: true });
        if (!sameSnapshot(current, inputs.retry.ledger)) throw failure('DST_IMPORT_LEDGER_STALE');
        const renameFile = context.ledgerRenameFile || fs.renameSync;
        renameFile(tempPath, inputs.retry.ledgerPath);
        renamed = true;
        fsyncDirectory(parent);
        const written = stableFile(inputs.retry.ledgerPath, MAX_LEDGER_BYTES, 'DST_IMPORT_LEDGER_UNSAFE', { allowEmpty: true });
        if (written.sha256 !== sha256(nextBuffer) || written.size !== nextBuffer.byteLength) {
            throw failure('DST_IMPORT_LEDGER_POST_WRITE_MISMATCH');
        }
        return pending.length;
    } finally {
        if (!renamed) {
            try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
}

function staleLockMs(context = {}) {
    const value = context.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
    if (!Number.isInteger(value) || value <= 0 || value > MAX_STALE_LOCK_MS) {
        throw failure('DST_IMPORT_STALE_LOCK_WINDOW_INVALID');
    }
    return value;
}

function processAlive(pid, context = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw failure('DST_IMPORT_LOCK_INVALID');
    if (typeof context.isProcessAliveFn === 'function') return context.isProcessAliveFn(pid) === true;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error?.code === 'ESRCH') return false;
        if (error?.code === 'EPERM') return true;
        throw failure('DST_IMPORT_LOCK_PROCESS_CHECK_FAILED');
    }
}

function lockBuffer(token, rootFingerprint, context = {}) {
    return Buffer.from(`${JSON.stringify({
        schema_version: 'film_pipeline.media_attempts_lock.v1',
        pid: process.pid,
        created_at_ms: clockMs(context),
        production_root_fingerprint: rootFingerprint,
        token_sha256: sha256(token),
    })}\n`);
}

function releaseOwnedFile(filePath, owned, directory, code) {
    const current = stableFile(filePath, 4096, code);
    if (!sameSnapshot(owned, current)) throw failure(`${code}_CHANGED`);
    fs.unlinkSync(filePath);
    fsyncDirectory(directory);
}

function parseExistingLock(snapshot, expectedFingerprint) {
    const value = parseJson(snapshot, 'DST_IMPORT_LOCK_INVALID');
    if (value.schema_version !== 'film_pipeline.media_attempts_lock.v1'
        || !Number.isSafeInteger(value.pid) || value.pid <= 0
        || !Number.isFinite(value.created_at_ms) || value.created_at_ms < 0
        || value.production_root_fingerprint !== expectedFingerprint
        || typeof value.token_sha256 !== 'string' || !SHA256_PATTERN.test(value.token_sha256)) {
        throw failure('DST_IMPORT_LOCK_INVALID');
    }
    return value;
}

function parseRecoveryLock(snapshot, expectedFingerprint) {
    const value = parseJson(snapshot, 'DST_IMPORT_LOCK_RECOVERY_INVALID');
    if (value.schema_version !== 'film_pipeline.media_attempts_lock_recovery.v1'
        || !Number.isSafeInteger(value.pid) || value.pid <= 0
        || !Number.isFinite(value.created_at_ms) || value.created_at_ms < 0
        || value.production_root_fingerprint !== expectedFingerprint) {
        throw failure('DST_IMPORT_LOCK_RECOVERY_INVALID');
    }
    return value;
}

function recoverDeadStaleFile(filePath, snapshot, value, directory, context, lockedCode, changedCode) {
    const age = clockMs(context) - value.created_at_ms;
    if (age < staleLockMs(context) || processAlive(value.pid, context)) throw failure(lockedCode);
    const unchanged = stableFile(filePath, 4096, changedCode);
    if (!sameSnapshot(snapshot, unchanged)) throw failure(`${changedCode}_CHANGED`);
    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') throw failure(`${changedCode}_CHANGED`);
        throw error;
    }
    fsyncDirectory(directory);
}

function acquireLock(rootInfo, token, context = {}) {
    const directory = ensureDirectoryTree(rootInfo, '.film-pipeline-locks');
    const lockPath = path.join(directory, 'media-attempts.lock');
    const recoveryPath = path.join(directory, 'media-attempts.recovery.lock');
    const rootFingerprint = rootInfo.fingerprint;
    const ownBuffer = lockBuffer(token, rootFingerprint, context);

    const recovery = stableFile(recoveryPath, 4096, 'DST_IMPORT_LOCK_RECOVERY_UNSAFE');
    if (recovery.exists) {
        const value = parseRecoveryLock(recovery, rootFingerprint);
        recoverDeadStaleFile(
            recoveryPath,
            recovery,
            value,
            directory,
            context,
            'DST_IMPORT_LOCK_RECOVERY_BUSY',
            'DST_IMPORT_LOCK_RECOVERY_UNSAFE',
        );
    }
    try {
        writeExclusive(lockPath, ownBuffer);
        const owned = stableFile(lockPath, 4096, 'DST_IMPORT_LOCK_UNSAFE');
        return () => releaseOwnedFile(lockPath, owned, directory, 'DST_IMPORT_LOCK_UNSAFE');
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }

    const recoveryBuffer = Buffer.from(`${JSON.stringify({
        schema_version: 'film_pipeline.media_attempts_lock_recovery.v1',
        pid: process.pid,
        created_at_ms: clockMs(context),
        production_root_fingerprint: rootFingerprint,
    })}\n`);
    try { writeExclusive(recoveryPath, recoveryBuffer); } catch (error) {
        if (error.code === 'EEXIST') throw failure('DST_IMPORT_LOCK_RECOVERY_BUSY');
        throw error;
    }
    const recoveryOwned = stableFile(recoveryPath, 4096, 'DST_IMPORT_LOCK_RECOVERY_UNSAFE');
    try {
        const existing = stableFile(lockPath, 4096, 'DST_IMPORT_LOCK_UNSAFE');
        if (existing.exists) {
            const value = parseExistingLock(existing, rootFingerprint);
            recoverDeadStaleFile(
                lockPath,
                existing,
                value,
                directory,
                context,
                'DST_IMPORT_LOCKED',
                'DST_IMPORT_LOCK_UNSAFE',
            );
        }
        writeExclusive(lockPath, ownBuffer);
        const owned = stableFile(lockPath, 4096, 'DST_IMPORT_LOCK_UNSAFE');
        return () => releaseOwnedFile(lockPath, owned, directory, 'DST_IMPORT_LOCK_UNSAFE');
    } finally {
        releaseOwnedFile(
            recoveryPath,
            recoveryOwned,
            directory,
            'DST_IMPORT_LOCK_RECOVERY_UNSAFE',
        );
    }
}

function confirmDstBundleImport(payload, context = {}) {
    const { token, record } = consumePlan(payload, context);
    const lockRoot = assertProductionRoot(context);
    const release = acquireLock(lockRoot, token, context);
    try {
        const inventory = scanInventory(context);
        const candidate = inventory.candidates.find((entry) => entry.token === record.candidateToken);
        if (!candidate) throw failure('DST_IMPORT_SOURCE_CHANGED');
        const inputs = record.initialMappings
            ? buildInitialInputs(context, candidate, record.initialMappings, record.importedAt)
            : record.mappings ? buildMappedInputs(context, candidate, record.mappings, record.importedAt)
                : buildInputs(context, candidate, record.retryMediaId, record.importedAt);
        const currentEvidence = evidence(inputs);
        if (!stableEvidence(record.evidence, currentEvidence)) throw failure('DST_IMPORT_PLAN_STALE');
        if (inputs.alreadyCurrent) {
            return {
                ok: true,
                imported: false,
                already_current: true,
                executed: false,
                generation_executed: false,
                media_id: inputs.desired.media_id,
                target_relative_path: inputs.desired.relative_path,
                copied: false,
                ledger_appended: false,
                imported_count: 0,
                copy_count: 0,
                ledger_appended_count: 0,
                sha256: inputs.candidate.image.sha256,
            };
        }
        const copies = inputs.entries.map((entry) => publishImage(entry, context));
        const ledgerAppendedCount = appendLedger(inputs, context);
        const copyCount = copies.filter((copy) => copy.created).length;
        const importedCount = inputs.entries.filter((entry) => !entry.alreadyCurrent).length;
        const firstCopy = copies[0];
        const firstLedgerAppended = inputs.entries[0].ledgerAppendNeeded && ledgerAppendedCount > 0;
        return {
            ok: true,
            imported: importedCount > 0,
            already_current: false,
            executed: copyCount > 0 || ledgerAppendedCount > 0,
            generation_executed: false,
            media_id: inputs.desired.media_id,
            target_relative_path: inputs.desired.relative_path,
            copied: firstCopy.created,
            ledger_appended: firstLedgerAppended,
            imported_count: importedCount,
            copy_count: copyCount,
            ledger_appended_count: ledgerAppendedCount,
            sha256: inputs.candidate.image.sha256,
        };
    } finally {
        release();
    }
}

module.exports = {
    WORKSPACE_SCHEMA,
    PLAN_SCHEMA,
    DEFAULT_DST_IMAGES_ROOT,
    MAX_CANDIDATES,
    MAX_JSON_BYTES,
    MAX_IMAGE_BYTES,
    MAX_PREVIEW_BYTES,
    MAX_LEDGER_BYTES,
    DEFAULT_PLAN_TTL_MS,
    getDstBundleImportWorkspace,
    resolveDstExecutionResultLocator,
    getDstBundleImportPreview,
    planDstBundleImport,
    confirmDstBundleImport,
};
