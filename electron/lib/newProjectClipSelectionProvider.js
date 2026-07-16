const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const newProjectDesignProvider = require('./newProjectDesignProvider');
const newProjectDraftProvider = require('./newProjectDraftProvider');
const newProjectVideoPlanProvider = require('./newProjectVideoPlanProvider');

const SCHEMA = 'film_pipeline.new_project_clip_selection.v1';
const ROOT_DIRECTORY = 'clip_selection';
const SELECTION_FILE = 'selections.json';
const MAX_SELECTION_BYTES = 256 * 1024;
const MAX_SELECTIONS = 20;
const MAX_REASON_BYTES = 2048;
const SHA256 = /^[a-f0-9]{64}$/;
const TASK_TOKEN = /^task_[a-f0-9]{64}$/;
const RESULT_TOKEN = /^result_[a-f0-9]{64}$/;
const CONFIDENCE = new Set(['high', 'medium', 'low']);

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

function exactPaths(userDataPath) {
    const design = newProjectDesignProvider.exactPaths(userDataPath);
    const root = path.join(design.draftRoot, ROOT_DIRECTORY);
    return { draftRoot: design.draftRoot, root, selectionPath: path.join(root, SELECTION_FILE) };
}

function assertPrivateDirectory(directoryPath, code) {
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw failure(code); }
    if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700
        || fs.realpathSync.native(directoryPath) !== directoryPath) throw failure(code);
    return stats;
}

function ensureRoot(paths) {
    const parent = assertPrivateDirectory(paths.draftRoot, 'CLIP_SELECTION_DRAFT_ROOT_UNSAFE');
    try { fs.mkdirSync(paths.root, { mode: 0o700 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const root = assertPrivateDirectory(paths.root, 'CLIP_SELECTION_DIRECTORY_UNSAFE');
    if (root.dev !== parent.dev || path.dirname(fs.realpathSync.native(paths.root)) !== paths.draftRoot) {
        throw failure('CLIP_SELECTION_DIRECTORY_UNSAFE');
    }
}

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function readPrivate(filePath) {
    let before;
    try { before = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') throw failure('CLIP_SELECTION_FILE_MISSING');
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > MAX_SELECTION_BYTES || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure('CLIP_SELECTION_FILE_UNSAFE');
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw failure('CLIP_SELECTION_FILE_CHANGED');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(filePath);
        if (buffer.byteLength !== before.size || !sameFile(opened, after) || !sameFile(opened, final)) {
            throw failure('CLIP_SELECTION_FILE_CHANGED');
        }
        return buffer;
    } finally { fs.closeSync(descriptor); }
}

function fsyncDirectory(directoryPath) {
    const descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function privateWrite(filePath, buffer) {
    const parent = path.dirname(filePath);
    assertPrivateDirectory(parent, 'CLIP_SELECTION_DIRECTORY_UNSAFE');
    const temp = path.join(parent, `.clip-selection-${crypto.randomBytes(12).toString('hex')}.tmp`);
    const descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    try {
        let current;
        try { current = fs.lstatSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current && (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o777) !== 0o600)) {
            throw failure('CLIP_SELECTION_FILE_UNSAFE');
        }
        fs.renameSync(temp, filePath);
        fsyncDirectory(parent);
    } finally { try { fs.unlinkSync(temp); } catch { /* renamed */ } }
}

function validateSelection(value, source, code = 'CLIP_SELECTION_INVALID') {
    exactKeys(value, [
        'task_token', 'result_token', 'result_sha256', 'duration_seconds',
        'in_seconds', 'out_seconds', 'reason', 'reviewer_confidence',
    ], code);
    if (!TASK_TOKEN.test(value.task_token || '') || !RESULT_TOKEN.test(value.result_token || '')
        || !SHA256.test(value.result_sha256 || '') || !Number.isFinite(value.duration_seconds)
        || value.duration_seconds <= 0 || !CONFIDENCE.has(value.reviewer_confidence)) throw failure(code);
    if (source && (value.task_token !== source.task_token || value.result_token !== source.result_token
        || value.result_sha256 !== source.result_sha256 || value.duration_seconds !== source.duration_seconds)) {
        throw failure('CLIP_SELECTION_RESULT_STALE');
    }
    const empty = value.in_seconds === null && value.out_seconds === null;
    const ranged = Number.isFinite(value.in_seconds) && Number.isFinite(value.out_seconds)
        && value.in_seconds >= 0 && value.in_seconds < value.out_seconds
        && value.out_seconds <= value.duration_seconds;
    if (!empty && !ranged) throw failure('CLIP_SELECTION_RANGE_INVALID');
    if (typeof value.reason !== 'string' || value.reason.includes('\0')
        || Buffer.byteLength(value.reason.trim(), 'utf8') > MAX_REASON_BYTES
        || (ranged && !value.reason.trim())) throw failure('CLIP_SELECTION_REASON_REQUIRED');
    return { ...value, reason: value.reason.trim() };
}

function sourceRevision(upstream) {
    return sha256(JSON.stringify({
        design_revision_sha256: upstream.design_revision_sha256,
        image_plan_revision_sha256: upstream.image_plan_revision_sha256,
        video_plan_revision_sha256: upstream.video_plan_revision_sha256,
        sources: upstream.sources.map(({ task_token, result_token, result_sha256, duration_seconds }) => ({
            task_token, result_token, result_sha256, duration_seconds,
        })),
    }));
}

function selectionRevision(upstream, selections) {
    return sha256(JSON.stringify({ source_revision_sha256: sourceRevision(upstream), selections }));
}

function validateRecord(value, upstream) {
    exactKeys(value, [
        'schema_version', 'design_revision_sha256', 'image_plan_revision_sha256',
        'video_plan_revision_sha256', 'source_revision_sha256', 'selections', 'saved_at',
    ], 'CLIP_SELECTION_FILE_INVALID');
    if (value.schema_version !== SCHEMA || !SHA256.test(value.design_revision_sha256 || '')
        || !SHA256.test(value.image_plan_revision_sha256 || '')
        || !SHA256.test(value.video_plan_revision_sha256 || '')
        || !SHA256.test(value.source_revision_sha256 || '') || !Number.isFinite(Date.parse(value.saved_at))
        || !Array.isArray(value.selections) || value.selections.length > MAX_SELECTIONS) {
        throw failure('CLIP_SELECTION_FILE_INVALID');
    }
    if (value.design_revision_sha256 !== upstream.design_revision_sha256
        || value.image_plan_revision_sha256 !== upstream.image_plan_revision_sha256
        || value.video_plan_revision_sha256 !== upstream.video_plan_revision_sha256
        || value.source_revision_sha256 !== sourceRevision(upstream)) throw failure('CLIP_SELECTION_UPSTREAM_STALE');
    const sources = new Map(upstream.sources.map((source) => [source.task_token, source]));
    const selections = value.selections.map((item) => validateSelection(item, sources.get(item.task_token)));
    if (selections.some((item) => !sources.has(item.task_token))
        || new Set(selections.map((item) => item.task_token)).size !== selections.length) {
        throw failure('CLIP_SELECTION_TASK_SET_INVALID');
    }
    return selections;
}

function emptySelections(upstream) {
    return upstream.sources.map((source) => ({
        task_token: source.task_token,
        result_token: source.result_token,
        result_sha256: source.result_sha256,
        duration_seconds: source.duration_seconds,
        in_seconds: null,
        out_seconds: null,
        reason: '',
        reviewer_confidence: 'medium',
    }));
}

function publicState(upstream, selections, status = 'ready', blockers = []) {
    const byTask = new Map(selections.map((item) => [item.task_token, item]));
    const clips = upstream.sources.map((source) => {
        const selection = byTask.get(source.task_token) || emptySelections({ sources: [source] })[0];
        return {
            task_token: source.task_token,
            result_token: source.result_token,
            sequence: source.sequence,
            source_id: source.source_id,
            label: source.label,
            duration_seconds: source.duration_seconds,
            in_seconds: selection.in_seconds,
            out_seconds: selection.out_seconds,
            reason: selection.reason,
            reviewer_confidence: selection.reviewer_confidence,
        };
    });
    return {
        ok: blockers.length === 0,
        status,
        design_revision_sha256: upstream.design_revision_sha256,
        image_plan_revision_sha256: upstream.image_plan_revision_sha256,
        video_plan_revision_sha256: upstream.video_plan_revision_sha256,
        revision_sha256: selectionRevision(upstream, selections),
        clips,
        accepted_count: clips.filter((clip) => clip.in_seconds !== null && clip.out_seconds !== null).length,
        total_count: clips.length,
        blockers,
        executed: false,
        generation_executed: false,
    };
}

function blockedState(code) {
    return {
        ok: false, status: 'blocked', design_revision_sha256: '', image_plan_revision_sha256: '',
        video_plan_revision_sha256: '', revision_sha256: '', clips: [], accepted_count: 0,
        total_count: 0, blockers: [code], executed: false, generation_executed: false,
    };
}

function getNewProjectClipSelection(context = {}) {
    try {
        const upstream = (context.getValidatedVideoSelectionSources
            || newProjectVideoPlanProvider.getValidatedVideoSelectionSources)(context);
        const paths = exactPaths(context.userDataPath);
        let selections = emptySelections(upstream);
        let status = 'empty';
        if (fs.existsSync(paths.selectionPath)) {
            let record;
            try { record = JSON.parse(readPrivate(paths.selectionPath).toString('utf8')); }
            catch (error) { if (error.code) throw error; throw failure('CLIP_SELECTION_FILE_INVALID'); }
            try {
                const stored = validateRecord(record, upstream);
                const map = new Map(stored.map((item) => [item.task_token, item]));
                selections = selections.map((item) => map.get(item.task_token) || item);
                status = 'restored';
            } catch (error) {
                if (['CLIP_SELECTION_UPSTREAM_STALE', 'CLIP_SELECTION_RESULT_STALE'].includes(error.code)) {
                    status = 'upstream_changed';
                } else throw error;
            }
        }
        return publicState(upstream, selections, status);
    } catch (error) { return blockedState(error.code || 'CLIP_SELECTION_READ_FAILED'); }
}

function saveNewProjectClipSelection(payload, context = {}) {
    exactKeys(payload, [
        'selections', 'expected_design_revision_sha256', 'expected_image_plan_revision_sha256',
        'expected_video_plan_revision_sha256', 'expected_clip_selection_revision_sha256',
    ], 'CLIP_SELECTION_SAVE_SHAPE_INVALID');
    const current = getNewProjectClipSelection(context);
    if (!current.ok) throw failure(current.blockers[0] || 'CLIP_SELECTION_BLOCKED');
    for (const key of ['design', 'image_plan', 'video_plan']) {
        if (payload[`expected_${key}_revision_sha256`] !== current[`${key}_revision_sha256`]) {
            throw failure(`CLIP_SELECTION_${key.toUpperCase()}_STALE`);
        }
    }
    if (payload.expected_clip_selection_revision_sha256 !== current.revision_sha256) {
        throw failure('CLIP_SELECTION_REVISION_STALE');
    }
    if (!Array.isArray(payload.selections) || payload.selections.length > MAX_SELECTIONS) {
        throw failure('CLIP_SELECTION_SAVE_INVALID');
    }
    const upstream = (context.getValidatedVideoSelectionSources
        || newProjectVideoPlanProvider.getValidatedVideoSelectionSources)(context);
    const sources = new Map(upstream.sources.map((source) => [source.task_token, source]));
    const incoming = payload.selections.map((item) => {
        exactKeys(item, ['task_token', 'in_seconds', 'out_seconds', 'reason', 'reviewer_confidence'], 'CLIP_SELECTION_INPUT_INVALID');
        const source = sources.get(item.task_token);
        if (!source) throw failure('CLIP_SELECTION_TASK_SET_INVALID');
        return validateSelection({
            ...item,
            result_token: source.result_token,
            result_sha256: source.result_sha256,
            duration_seconds: source.duration_seconds,
        }, source, 'CLIP_SELECTION_INPUT_INVALID');
    });
    if (new Set(incoming.map((item) => item.task_token)).size !== incoming.length) {
        throw failure('CLIP_SELECTION_TASK_SET_INVALID');
    }
    const incomingMap = new Map(incoming.map((item) => [item.task_token, item]));
    const currentMap = new Map(current.clips.map((item) => [item.task_token, item]));
    const selections = upstream.sources.map((source) => {
        const input = incomingMap.get(source.task_token) || currentMap.get(source.task_token);
        return validateSelection({
            task_token: source.task_token,
            result_token: source.result_token,
            result_sha256: source.result_sha256,
            duration_seconds: source.duration_seconds,
            in_seconds: input?.in_seconds ?? null,
            out_seconds: input?.out_seconds ?? null,
            reason: input?.reason || '',
            reviewer_confidence: input?.reviewer_confidence || 'medium',
        }, source);
    });
    const record = {
        schema_version: SCHEMA,
        design_revision_sha256: upstream.design_revision_sha256,
        image_plan_revision_sha256: upstream.image_plan_revision_sha256,
        video_plan_revision_sha256: upstream.video_plan_revision_sha256,
        source_revision_sha256: sourceRevision(upstream),
        selections,
        saved_at: new Date().toISOString(),
    };
    const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    if (buffer.byteLength > MAX_SELECTION_BYTES) throw failure('CLIP_SELECTION_TOO_LARGE');
    const paths = exactPaths(context.userDataPath);
    ensureRoot(paths);
    privateWrite(paths.selectionPath, buffer);
    return { ...publicState(upstream, selections, 'saved'), saved: true };
}

// Main-process-only adapter for stage 5. It revalidates the private selection
// and the complete source evidence instead of trusting renderer state.
function getCompleteNewProjectClipSelectionInput(context = {}) {
    const upstream = (context.getValidatedVideoSelectionSources
        || newProjectVideoPlanProvider.getValidatedVideoSelectionSources)(context);
    const paths = exactPaths(context.userDataPath);
    let record;
    try { record = JSON.parse(readPrivate(paths.selectionPath).toString('utf8')); }
    catch (error) { if (error.code) throw error; throw failure('CLIP_SELECTION_FILE_INVALID'); }
    const selections = validateRecord(record, upstream);
    if (selections.length !== upstream.sources.length
        || selections.some((item) => item.in_seconds === null || item.out_seconds === null)) {
        throw failure('FINAL_STITCH_COMPLETE_SELECTION_REQUIRED');
    }
    const draft = newProjectDraftProvider.getNewProjectDraftState(context);
    const projectId = draft?.status === 'restored' ? draft.draft?.production_id : '';
    if (typeof projectId !== 'string'
        || !/^[a-z0-9](?:[a-z0-9_-]{1,62}[a-z0-9])$/.test(projectId) || projectId.includes('..')) {
        throw failure('FINAL_STITCH_PROJECT_ID_REQUIRED');
    }
    const byTask = new Map(selections.map((item) => [item.task_token, item]));
    return {
        project_id: projectId,
        design_revision_sha256: upstream.design_revision_sha256,
        image_plan_revision_sha256: upstream.image_plan_revision_sha256,
        video_plan_revision_sha256: upstream.video_plan_revision_sha256,
        clip_selection_revision_sha256: selectionRevision(upstream, selections),
        clips: upstream.sources.map((source) => {
            const selection = byTask.get(source.task_token);
            if (!selection || !path.isAbsolute(source.source_path || '')
                || !['flow', 'grok', 'replicate', 'bytedance'].includes(source.provider)
                || !Number.isSafeInteger(source.width) || source.width <= 0
                || !Number.isSafeInteger(source.height) || source.height <= 0) {
                throw failure('FINAL_STITCH_SOURCE_INVALID');
            }
            return {
                task_token: source.task_token,
                result_token: source.result_token,
                result_sha256: source.result_sha256,
                source_path: source.source_path,
                provider: source.provider,
                width: source.width,
                height: source.height,
                duration_seconds: source.duration_seconds,
                sequence: source.sequence,
                source_id: source.source_id,
                label: source.label,
                in_seconds: selection.in_seconds,
                out_seconds: selection.out_seconds,
                reason: selection.reason,
                reviewer_confidence: selection.reviewer_confidence,
            };
        }),
    };
}

module.exports = {
    SCHEMA,
    exactPaths,
    getNewProjectClipSelection,
    saveNewProjectClipSelection,
    getCompleteNewProjectClipSelectionInput,
};
