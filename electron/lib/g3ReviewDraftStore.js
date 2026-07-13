const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
    DIALOGUE_SOURCES,
    G3_DRAFT_SCHEMA,
    MAX_ID_LENGTH,
    MAX_JSON_BYTES,
    MAX_NOTES_BYTES,
    MAX_REASON_BYTES,
    MAX_TAKE_ID_LENGTH,
    PROVIDERS,
    boundedText,
    exactKeys,
    g3Error,
    safeId,
    validateTransition,
} = require('./g3ReviewContract');
const { assertRelativeCandidate, readStableFile } = require('./g3ReviewCandidateStore');

const DRAFT_DIRECTORY = 'g3-review-v1';
const DRAFT_FILE = 'draft.json';
const SELECTED_TAKES_FILE = 'selected_takes.json';
const EXPORT_FILE = 'g3_review_export.json';
const TEMP_PREFIX = '.g3-review-';

function exactDraftPaths(userDataPath, rootFingerprint) {
    if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath) || path.normalize(userDataPath) !== userDataPath
        || userDataPath.includes('\0') || !/^[a-f0-9]{64}$/.test(rootFingerprint)) {
        throw g3Error('G3_USER_DATA_INVALID', 'Electron userData path is invalid');
    }
    const namespace = rootFingerprint.slice(0, 24);
    const draftRoot = path.join(userDataPath, 'film-pipeline', 'drafts', DRAFT_DIRECTORY, namespace);
    return {
        draftRoot,
        draftPath: path.join(draftRoot, DRAFT_FILE),
        selectedTakesPath: path.join(draftRoot, SELECTED_TAKES_FILE),
        exportPath: path.join(draftRoot, EXPORT_FILE),
    };
}

function assertDirectory(directoryPath, code, exactMode = null) {
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw g3Error(code, 'Directory is missing'); }
    if (stats.isSymbolicLink() || !stats.isDirectory() || (exactMode !== null && (stats.mode & 0o777) !== exactMode)) {
        throw g3Error(code, 'Directory is unsafe');
    }
    if (fs.realpathSync.native(directoryPath) !== directoryPath) throw g3Error(code, 'Directory contains symlinks');
    return stats;
}

function draftComponents(paths) {
    return ['film-pipeline', 'drafts', DRAFT_DIRECTORY, path.basename(paths.draftRoot)];
}

function validateDraftRoot(userDataPath, paths) {
    assertDirectory(userDataPath, 'G3_USER_DATA_INVALID');
    let current = userDataPath;
    for (const [index, component] of draftComponents(paths).entries()) {
        current = path.join(current, component);
        assertDirectory(current, 'G3_DRAFT_DIRECTORY_UNSAFE', index === 0 ? null : 0o700);
    }
    if (current !== paths.draftRoot) throw g3Error('G3_DRAFT_DIRECTORY_UNSAFE', 'Draft namespace mismatch');
}

function ensureDraftRoot(userDataPath, paths) {
    assertDirectory(userDataPath, 'G3_USER_DATA_INVALID');
    let current = userDataPath;
    for (const [index, component] of draftComponents(paths).entries()) {
        current = path.join(current, component);
        try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        assertDirectory(current, 'G3_DRAFT_DIRECTORY_UNSAFE', index === 0 ? null : 0o700);
    }
    if (current !== paths.draftRoot) throw g3Error('G3_DRAFT_DIRECTORY_UNSAFE', 'Draft namespace mismatch');
}

function atomicWrite(filePath, buffer, context = {}) {
    const parent = path.dirname(filePath);
    const before = assertDirectory(parent, 'G3_DRAFT_DIRECTORY_UNSAFE', 0o700);
    try {
        const target = fs.lstatSync(filePath);
        if (target.isSymbolicLink() || !target.isFile() || (target.mode & 0o777) !== 0o600) {
            throw g3Error('G3_DRAFT_TARGET_UNSAFE', 'Draft target is unsafe');
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw g3Error('G3_NOFOLLOW_UNAVAILABLE', 'No-follow writes are unavailable');
    const randomBytes = context.randomBytes || crypto.randomBytes;
    const tempPath = path.join(parent, `${TEMP_PREFIX}${process.pid}-${randomBytes(12).toString('hex')}`);
    let descriptor;
    let renamed = false;
    try {
        descriptor = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        fs.fchmodSync(descriptor, 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        const after = assertDirectory(parent, 'G3_DRAFT_DIRECTORY_UNSAFE', 0o700);
        if (before.dev !== after.dev || before.ino !== after.ino) throw g3Error('G3_DRAFT_PARENT_CHANGED', 'Draft parent changed');
        const renameFile = context.renameFile || fs.renameSync;
        renameFile(tempPath, filePath);
        renamed = true;
        const written = fs.lstatSync(filePath);
        if (!written.isFile() || written.isSymbolicLink() || (written.mode & 0o777) !== 0o600) {
            throw g3Error('G3_DRAFT_TARGET_UNSAFE', 'Written draft is unsafe');
        }
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
        if (!renamed) {
            try { fs.unlinkSync(tempPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
}

function storedSelection(selection, candidate = null) {
    return {
        shot_id: selection.shot_id,
        candidate_relative_path: candidate?.relativePath || '',
        candidate_sha256: candidate?.sha256 || '',
        chosen_provider: selection.chosen_provider,
        dialogue_source: selection.dialogue_source,
        beat_id: selection.beat_id,
        take_id: selection.take_id,
        source_in_sec: selection.source_in_sec,
        source_out_sec: selection.source_out_sec,
        transition_in: selection.transition_in,
        selection_reason: selection.selection_reason,
        notes: selection.notes,
    };
}

function draftDocument(source, normalized, candidateByToken, now, exportHashes = {}) {
    return {
        schema_version: G3_DRAFT_SCHEMA,
        draft_id: normalized.draftId,
        project_id: source.projectId,
        episode_id: source.episodeId,
        source_snapshot: source.sourceSnapshot,
        selections: normalized.selections.map((selection) => storedSelection(selection, candidateByToken.get(selection.candidate_token))),
        overall_notes: normalized.overallNotes,
        saved_at: now,
        exported_at: exportHashes.exportedAt || '',
        selected_takes_sha256: exportHashes.selectedTakesSha256 || '',
        g3_review_export_sha256: exportHashes.exportSha256 || '',
        promotion_ready: false,
    };
}

function validateStoredSelection(selection, source, seen) {
    exactKeys(selection, [
        'shot_id', 'candidate_relative_path', 'candidate_sha256', 'chosen_provider', 'dialogue_source', 'beat_id',
        'take_id', 'source_in_sec', 'source_out_sec', 'transition_in', 'selection_reason', 'notes',
    ], 'G3_DRAFT_METADATA_INVALID');
    const shotId = safeId(selection.shot_id, 'G3_DRAFT_METADATA_INVALID');
    if (!source.shotIds.includes(shotId) || seen.has(shotId)) throw g3Error('G3_DRAFT_METADATA_INVALID', 'Stored shot coverage is invalid');
    seen.add(shotId);
    const relativePath = boundedText(selection.candidate_relative_path, 'G3_DRAFT_METADATA_INVALID', 1024, { allowEmpty: true });
    const candidateHash = boundedText(selection.candidate_sha256, 'G3_DRAFT_METADATA_INVALID', 64, { allowEmpty: true });
    if (relativePath) assertRelativeCandidate(relativePath);
    if (Boolean(relativePath) !== Boolean(candidateHash) || (candidateHash && !/^[a-f0-9]{64}$/.test(candidateHash))) {
        throw g3Error('G3_DRAFT_METADATA_INVALID', 'Stored candidate evidence is invalid');
    }
    const provider = boundedText(selection.chosen_provider, 'G3_DRAFT_METADATA_INVALID', 32, { allowEmpty: true });
    const dialogue = boundedText(selection.dialogue_source, 'G3_DRAFT_METADATA_INVALID', 64, { allowEmpty: true });
    if ((provider && !PROVIDERS.has(provider)) || (dialogue && !DIALOGUE_SOURCES.has(dialogue))) {
        throw g3Error('G3_DRAFT_METADATA_INVALID', 'Stored enum is invalid');
    }
    safeId(selection.beat_id, 'G3_DRAFT_METADATA_INVALID', MAX_ID_LENGTH, { allowEmpty: true });
    safeId(selection.take_id, 'G3_DRAFT_METADATA_INVALID', MAX_TAKE_ID_LENGTH, { allowEmpty: true });
    if (typeof selection.source_in_sec !== 'number' || !Number.isFinite(selection.source_in_sec) || selection.source_in_sec < 0
        || (selection.source_out_sec !== null && (typeof selection.source_out_sec !== 'number'
            || !Number.isFinite(selection.source_out_sec) || selection.source_out_sec <= selection.source_in_sec))) {
        throw g3Error('G3_DRAFT_METADATA_INVALID', 'Stored range is invalid');
    }
    validateTransition(selection.transition_in, { partial: true });
    boundedText(selection.selection_reason, 'G3_DRAFT_METADATA_INVALID', MAX_REASON_BYTES, { allowEmpty: true });
    boundedText(selection.notes, 'G3_DRAFT_METADATA_INVALID', MAX_NOTES_BYTES, { allowEmpty: true });
}

function validateStoredDraft(value, source) {
    exactKeys(value, [
        'schema_version', 'draft_id', 'project_id', 'episode_id', 'source_snapshot', 'selections',
        'overall_notes', 'saved_at', 'exported_at', 'selected_takes_sha256', 'g3_review_export_sha256', 'promotion_ready',
    ], 'G3_DRAFT_METADATA_INVALID');
    if (value.schema_version !== G3_DRAFT_SCHEMA || value.project_id !== source.projectId || value.episode_id !== source.episodeId
        || value.promotion_ready !== false || !Array.isArray(value.selections) || value.selections.length !== source.shotIds.length
        || !Number.isFinite(Date.parse(value.saved_at))) {
        throw g3Error('G3_DRAFT_METADATA_INVALID', 'Draft metadata is invalid');
    }
    safeId(value.draft_id, 'G3_DRAFT_METADATA_INVALID');
    boundedText(value.overall_notes, 'G3_DRAFT_METADATA_INVALID', MAX_NOTES_BYTES, { allowEmpty: true });
    if (value.exported_at && !Number.isFinite(Date.parse(value.exported_at))) throw g3Error('G3_DRAFT_METADATA_INVALID', 'Export date is invalid');
    for (const field of ['selected_takes_sha256', 'g3_review_export_sha256']) {
        if (value[field] && !/^[a-f0-9]{64}$/.test(value[field])) throw g3Error('G3_DRAFT_METADATA_INVALID', 'Stored export hash is invalid');
    }
    exactKeys(value.source_snapshot, [
        'root_fingerprint', 'shot_manifest_sha256', 'beats_sha256', 'qc_report_sha256', 'candidate_inventory_sha256',
    ], 'G3_DRAFT_METADATA_INVALID');
    if (value.source_snapshot.root_fingerprint !== source.sourceSnapshot.root_fingerprint) {
        throw g3Error('G3_DRAFT_SOURCE_CHANGED', 'Draft production root changed');
    }
    const seen = new Set();
    value.selections.forEach((selection) => validateStoredSelection(selection, source, seen));
    return value;
}

function loadDraft(userDataPath, paths, source) {
    try {
        validateDraftRoot(userDataPath, paths);
    } catch (error) {
        if (error.code === 'G3_DRAFT_DIRECTORY_UNSAFE') {
            try { fs.lstatSync(paths.draftRoot); } catch (missing) {
                if (missing.code === 'ENOENT') return { status: 'empty', value: null, blocker: '' };
            }
        }
        return { status: 'error', value: null, blocker: error.code || 'G3_DRAFT_DIRECTORY_UNSAFE' };
    }
    try {
        const read = readStableFile(paths.draftPath, MAX_JSON_BYTES, { privateFile: true });
        const value = validateStoredDraft(JSON.parse(read.buffer.toString('utf8')), source);
        return { status: 'restored', value, blocker: '' };
    } catch (error) {
        if (error.code === 'ENOENT') return { status: 'empty', value: null, blocker: '' };
        return { status: 'error', value: null, blocker: error.code || 'G3_DRAFT_METADATA_INVALID' };
    }
}

module.exports = {
    exactDraftPaths,
    ensureDraftRoot,
    atomicWrite,
    draftDocument,
    loadDraft,
};
