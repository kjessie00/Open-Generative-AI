const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const clipSelectionProvider = require('./newProjectClipSelectionProvider');

const SCHEMA = 'film_pipeline.new_project_final_stitch_handoff.v1';
const RENDER_SCHEMA = 'film_pipeline.finishing_render_payload.v1';
const ROOT_DIRECTORY = 'final_stitch';
const HANDOFF_FILE = 'handoff.json';
const MAX_HANDOFF_BYTES = 512 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024 * 1024;

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
    const selection = clipSelectionProvider.exactPaths(userDataPath);
    const root = path.join(selection.draftRoot, ROOT_DIRECTORY);
    return { draftRoot: selection.draftRoot, root, handoffPath: path.join(root, HANDOFF_FILE) };
}

function assertPrivateDirectory(directoryPath, code) {
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw failure(code); }
    if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700
        || fs.realpathSync.native(directoryPath) !== directoryPath) throw failure(code);
    return stats;
}

function ensureRoot(paths) {
    const parent = assertPrivateDirectory(paths.draftRoot, 'FINAL_STITCH_DRAFT_ROOT_UNSAFE');
    try { fs.mkdirSync(paths.root, { mode: 0o700 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const root = assertPrivateDirectory(paths.root, 'FINAL_STITCH_DIRECTORY_UNSAFE');
    if (root.dev !== parent.dev || path.dirname(fs.realpathSync.native(paths.root)) !== paths.draftRoot) {
        throw failure('FINAL_STITCH_DIRECTORY_UNSAFE');
    }
}

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function readPrivate(filePath) {
    let before;
    try { before = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') throw failure('FINAL_STITCH_FILE_MISSING');
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > MAX_HANDOFF_BYTES || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure('FINAL_STITCH_FILE_UNSAFE');
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw failure('FINAL_STITCH_FILE_CHANGED');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(filePath);
        if (buffer.byteLength !== before.size || !sameFile(opened, after) || !sameFile(opened, final)) {
            throw failure('FINAL_STITCH_FILE_CHANGED');
        }
        return buffer;
    } finally { fs.closeSync(descriptor); }
}

function fingerprintSource(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.normalize(filePath) !== filePath
        || typeof fs.constants.O_NOFOLLOW !== 'number') throw failure('FINAL_STITCH_SOURCE_INVALID');
    let before;
    try { before = fs.lstatSync(filePath); } catch { throw failure('FINAL_STITCH_SOURCE_MISSING'); }
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > MAX_SOURCE_BYTES) {
        throw failure('FINAL_STITCH_SOURCE_UNSAFE');
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw failure('FINAL_STITCH_SOURCE_CHANGED');
        const digest = crypto.createHash('sha256');
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let offset = 0;
        while (offset < opened.size) {
            const bytesRead = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, opened.size - offset), offset);
            if (bytesRead <= 0) throw failure('FINAL_STITCH_SOURCE_CHANGED');
            digest.update(chunk.subarray(0, bytesRead));
            offset += bytesRead;
        }
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(filePath);
        if (!sameFile(opened, after) || !sameFile(opened, final)) throw failure('FINAL_STITCH_SOURCE_CHANGED');
        return { source_path: filePath, source_sha256: digest.digest('hex'), size_bytes: opened.size };
    } finally { fs.closeSync(descriptor); }
}

function privateWrite(filePath, buffer) {
    const parent = path.dirname(filePath);
    assertPrivateDirectory(parent, 'FINAL_STITCH_DIRECTORY_UNSAFE');
    const temp = path.join(parent, `.final-stitch-${crypto.randomBytes(12).toString('hex')}.tmp`);
    const descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    try {
        let current;
        try { current = fs.lstatSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current && (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o777) !== 0o600)) {
            throw failure('FINAL_STITCH_FILE_UNSAFE');
        }
        fs.renameSync(temp, filePath);
        const parentDescriptor = fs.openSync(parent, fs.constants.O_RDONLY);
        try { fs.fsyncSync(parentDescriptor); } finally { fs.closeSync(parentDescriptor); }
    } finally { try { fs.unlinkSync(temp); } catch { /* renamed */ } }
}

function renderPayload(input, stagedAt) {
    const takes = input.clips.map((clip) => ({
        shot_id: clip.source_id,
        chosen_provider: clip.provider,
        video_path: clip.source_path,
        dialogue_source: 'native_video_lipsync',
        qc_report_ref: `human_selection_${clip.sequence}`,
        selected_at: stagedAt,
        beat_id: clip.source_id,
        take_id: `take_${clip.sequence}`,
        source_in_sec: clip.in_seconds,
        source_out_sec: clip.out_seconds,
        transition_in: { type: 'cut', dur: 0 },
    }));
    return {
        schema_version: RENDER_SCHEMA,
        selected_takes: {
            schema_version: 'short-drama-room-selected-takes-v1',
            project_id: input.project_id,
            episode_id: input.project_id,
            takes,
        },
        timeline_beats: {
            scenes: input.clips.map((clip) => ({
                scene_id: clip.source_id,
                beats: [{
                    beat_id: clip.source_id,
                    dialogue_lines: [],
                }],
            })),
        },
        expected_order: input.clips.map((clip) => ({
            shot_id: clip.source_id,
            beat_id: clip.source_id,
            source_in_sec: clip.in_seconds,
            source_out_sec: clip.out_seconds,
        })),
    };
}

function inputRevision(input) {
    return `handoff_${sha256(JSON.stringify(input))}`;
}

function buildRecord(input, stagedAt) {
    return {
        schema_version: SCHEMA,
        project_id: input.project_id,
        design_revision_sha256: input.design_revision_sha256,
        image_plan_revision_sha256: input.image_plan_revision_sha256,
        video_plan_revision_sha256: input.video_plan_revision_sha256,
        clip_selection_revision_sha256: input.clip_selection_revision_sha256,
        input_revision: inputRevision(input),
        sources: input.clips,
        source_evidence: input.clips.map((clip) => fingerprintSource(clip.source_path)),
        render_payload: renderPayload(input, stagedAt),
        staged_at: stagedAt,
        executed: false,
        rendered: false,
        generation_executed: false,
    };
}

function validateRecord(record, input) {
    exactKeys(record, [
        'schema_version', 'project_id', 'design_revision_sha256', 'image_plan_revision_sha256',
        'video_plan_revision_sha256', 'clip_selection_revision_sha256', 'input_revision',
        'sources', 'source_evidence', 'render_payload', 'staged_at', 'executed', 'rendered', 'generation_executed',
    ], 'FINAL_STITCH_FILE_INVALID');
    if (record.schema_version !== SCHEMA || !Number.isFinite(Date.parse(record.staged_at))
        || record.executed !== false || record.rendered !== false || record.generation_executed !== false
        || !Array.isArray(record.sources) || !Array.isArray(record.source_evidence)
        || record.render_payload?.schema_version !== RENDER_SCHEMA) {
        throw failure('FINAL_STITCH_FILE_INVALID');
    }
    const expected = buildRecord(input, record.staged_at);
    if (JSON.stringify(record) !== JSON.stringify(expected)) throw failure('FINAL_STITCH_INPUT_STALE');
    return record;
}

// Main-process only. Revalidates the complete selection, every selected source
// byte, and the staged handoff before exposing private render inputs internally.
function getStagedNewProjectFinalStitchInput(context = {}) {
    const input = (context.getCompleteNewProjectClipSelectionInput
        || clipSelectionProvider.getCompleteNewProjectClipSelectionInput)(context);
    const paths = exactPaths(context.userDataPath);
    let record;
    try { record = JSON.parse(readPrivate(paths.handoffPath).toString('utf8')); }
    catch (error) { if (error.code) throw error; throw failure('FINAL_STITCH_FILE_INVALID'); }
    validateRecord(record, input);
    return {
        project_id: record.project_id,
        input_revision: record.input_revision,
        render_payload: structuredClone(record.render_payload),
        sources: structuredClone(record.source_evidence),
    };
}

function publicState(input, status, staged = false, blockers = []) {
    const clips = input?.clips || [];
    return {
        ok: blockers.length === 0,
        status,
        revision: input ? inputRevision(input) : '',
        staged,
        selected_count: clips.length,
        total_duration_seconds: clips.reduce((sum, clip) => sum + clip.out_seconds - clip.in_seconds, 0),
        clips: clips.map((clip) => ({
            sequence: clip.sequence,
            label: clip.label,
            in_seconds: clip.in_seconds,
            out_seconds: clip.out_seconds,
        })),
        blockers,
        executed: false,
        rendered: false,
        generation_executed: false,
    };
}

function blockedState(code) {
    return publicState(null, 'blocked', false, [code]);
}

function getNewProjectFinalStitch(context = {}) {
    let input;
    try {
        input = (context.getCompleteNewProjectClipSelectionInput
            || clipSelectionProvider.getCompleteNewProjectClipSelectionInput)(context);
    } catch (error) { return blockedState(error.code || 'FINAL_STITCH_INPUT_BLOCKED'); }
    const paths = exactPaths(context.userDataPath);
    if (fs.existsSync(paths.root)) {
        try { assertPrivateDirectory(paths.root, 'FINAL_STITCH_DIRECTORY_UNSAFE'); }
        catch (error) { return blockedState(error.code || 'FINAL_STITCH_DIRECTORY_UNSAFE'); }
    }
    if (!fs.existsSync(paths.handoffPath)) return publicState(input, 'ready');
    let record;
    try {
        try { record = JSON.parse(readPrivate(paths.handoffPath).toString('utf8')); }
        catch (error) { if (error.code) throw error; throw failure('FINAL_STITCH_FILE_INVALID'); }
        validateRecord(record, input);
        return publicState(input, 'restored', true);
    } catch (error) {
        if (error.code === 'FINAL_STITCH_INPUT_STALE') return publicState(input, 'upstream_changed');
        return blockedState(error.code || 'FINAL_STITCH_READ_FAILED');
    }
}

function stageNewProjectFinalStitch(payload, context = {}) {
    exactKeys(payload, ['expected_revision'], 'FINAL_STITCH_STAGE_SHAPE_INVALID');
    const current = getNewProjectFinalStitch(context);
    if (!current.ok) throw failure(current.blockers[0] || 'FINAL_STITCH_BLOCKED');
    if (payload.expected_revision !== current.revision) throw failure('FINAL_STITCH_REVISION_STALE');
    const input = (context.getCompleteNewProjectClipSelectionInput
        || clipSelectionProvider.getCompleteNewProjectClipSelectionInput)(context);
    if (inputRevision(input) !== current.revision) throw failure('FINAL_STITCH_REVISION_STALE');
    const record = buildRecord(input, new Date().toISOString());
    const buffer = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    if (buffer.byteLength > MAX_HANDOFF_BYTES) throw failure('FINAL_STITCH_TOO_LARGE');
    const paths = exactPaths(context.userDataPath);
    ensureRoot(paths);
    privateWrite(paths.handoffPath, buffer);
    return { ...publicState(input, 'staged', true), saved: true };
}

module.exports = {
    SCHEMA,
    RENDER_SCHEMA,
    exactPaths,
    getNewProjectFinalStitch,
    stageNewProjectFinalStitch,
    getStagedNewProjectFinalStitchInput,
};
