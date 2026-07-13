const crypto = require('crypto');

const G3_DRAFT_SCHEMA = 'film_pipeline.g3_review_draft.v1';
const G3_EXPORT_SCHEMA = 'film_pipeline.g3_review_export.v1';
const SELECTED_TAKES_SCHEMA = 'short-drama-room-selected-takes-v1';
const SHOT_MANIFEST_SCHEMA = 'short-drama-room-shot-manifest-v1';
const BEATS_SCHEMA = 'short-drama-room-beats-v1';
const ROOM_QC_SCHEMA = 'short-drama-room-qc-report-v1';
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_JSON_BYTES = 512 * 1024;
const MAX_SHOTS = 1000;
const MAX_ID_LENGTH = 160;
const MAX_TAKE_ID_LENGTH = 128;
const MAX_REASON_BYTES = 8 * 1024;
const MAX_NOTES_BYTES = 32 * 1024;
const APPROVED_CANDIDATE_PREFIXES = Object.freeze([
    'generated/downloads/',
    'generated/candidates/',
    'review_candidates/',
    'takes/',
]);
const MEDIA_MIME_TYPES = Object.freeze({
    '.m4v': 'video/x-m4v',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
});
const PROVIDERS = new Set(['seedance', 'flow']);
const DIALOGUE_SOURCES = new Set(['native_video_lipsync', 'tts_adr_overlay']);
const TRANSITIONS = new Set(['cut', 'crossfade', 'dip_black']);

function g3Error(code, message) {
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
        throw g3Error(code, 'Object shape is invalid');
    }
}

function wellFormedUnicode(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF) {
            if (index + 1 >= value.length) return false;
            const next = value.charCodeAt(index + 1);
            if (next < 0xDC00 || next > 0xDFFF) return false;
            index += 1;
        } else if (code >= 0xDC00 && code <= 0xDFFF) return false;
    }
    return true;
}

function boundedText(value, code, maxBytes, { allowEmpty = false } = {}) {
    if (typeof value !== 'string' || value.includes('\0') || !wellFormedUnicode(value)) {
        throw g3Error(code, 'Text is invalid');
    }
    const normalized = value.trim();
    if ((!allowEmpty && !normalized) || Buffer.byteLength(normalized, 'utf8') > maxBytes) {
        throw g3Error(code, 'Text is outside the allowed bounds');
    }
    return normalized;
}

function safeId(value, code, maxLength = MAX_ID_LENGTH, { allowEmpty = false } = {}) {
    const normalized = boundedText(value, code, maxLength, { allowEmpty });
    if (normalized && (normalized.length > maxLength || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(normalized))) {
        throw g3Error(code, 'Identifier is invalid');
    }
    return normalized;
}

function jsonBuffer(value) {
    const buffer = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    if (buffer.byteLength > MAX_JSON_BYTES) throw g3Error('G3_DRAFT_TOO_LARGE', 'Draft JSON is too large');
    return buffer;
}

function emptySelection(shotId) {
    return {
        shot_id: shotId,
        candidate_token: '',
        chosen_provider: '',
        dialogue_source: '',
        beat_id: '',
        take_id: '',
        source_in_sec: 0,
        source_out_sec: null,
        transition_in: null,
        selection_reason: '',
        notes: '',
    };
}

function validateTransition(value, { partial }) {
    if (value === null || (partial && value === '')) return null;
    exactKeys(value, ['type', 'dur'], 'G3_TRANSITION_INVALID');
    if (!TRANSITIONS.has(value.type) || typeof value.dur !== 'number' || !Number.isFinite(value.dur)
        || value.dur < 0 || value.dur > 10) {
        throw g3Error('G3_TRANSITION_INVALID', 'Transition is invalid');
    }
    return { type: value.type, dur: value.dur };
}

function validateSelectionPayload(payload, source, { partial }) {
    exactKeys(payload, ['draft_id', 'selections', 'overall_notes'], 'G3_DRAFT_SHAPE_INVALID');
    const draftId = safeId(payload.draft_id, 'G3_DRAFT_ID_INVALID');
    const overallNotes = boundedText(payload.overall_notes, 'G3_NOTES_INVALID', MAX_NOTES_BYTES, { allowEmpty: true });
    if (!Array.isArray(payload.selections) || payload.selections.length !== source.shotIds.length) {
        throw g3Error('G3_SHOT_COVERAGE_INVALID', 'Every manifest shot must be present exactly once');
    }
    const expected = new Set(source.shotIds);
    const seen = new Set();
    const selections = payload.selections.map((selection) => {
        exactKeys(selection, [
            'shot_id', 'candidate_token', 'chosen_provider', 'dialogue_source', 'beat_id', 'take_id',
            'source_in_sec', 'source_out_sec', 'transition_in', 'selection_reason', 'notes',
        ], 'G3_SELECTION_SHAPE_INVALID');
        const shotId = safeId(selection.shot_id, 'G3_SHOT_ID_INVALID');
        if (!expected.has(shotId) || seen.has(shotId)) throw g3Error('G3_SHOT_COVERAGE_INVALID', 'Shot is unknown or duplicated');
        seen.add(shotId);
        const candidateToken = boundedText(selection.candidate_token, 'G3_CANDIDATE_TOKEN_INVALID', 256, { allowEmpty: partial });
        const chosenProvider = boundedText(selection.chosen_provider, 'G3_PROVIDER_INVALID', 32, { allowEmpty: partial });
        if (chosenProvider && !PROVIDERS.has(chosenProvider)) throw g3Error('G3_PROVIDER_INVALID', 'Provider is invalid');
        const dialogueSource = boundedText(selection.dialogue_source, 'G3_DIALOGUE_SOURCE_INVALID', 64, { allowEmpty: partial });
        if (dialogueSource && !DIALOGUE_SOURCES.has(dialogueSource)) throw g3Error('G3_DIALOGUE_SOURCE_INVALID', 'Dialogue source is invalid');
        const beatId = safeId(selection.beat_id, 'G3_BEAT_ID_INVALID', MAX_ID_LENGTH, { allowEmpty: partial });
        if (beatId && source.beat.available && !source.beat.beatIds.includes(beatId)) {
            throw g3Error('G3_BEAT_ID_INVALID', 'Beat id is not in the canonical beat list');
        }
        const takeId = safeId(selection.take_id, 'G3_TAKE_ID_INVALID', MAX_TAKE_ID_LENGTH, { allowEmpty: partial });
        const sourceIn = selection.source_in_sec;
        const sourceOut = selection.source_out_sec;
        const rangeEmpty = partial && (sourceOut === null || sourceOut === '');
        if (typeof sourceIn !== 'number' || !Number.isFinite(sourceIn) || sourceIn < 0
            || (!rangeEmpty && (typeof sourceOut !== 'number' || !Number.isFinite(sourceOut) || sourceOut <= sourceIn))) {
            throw g3Error('G3_RANGE_INVALID', 'Source range is invalid');
        }
        const reason = boundedText(selection.selection_reason, 'G3_REASON_INVALID', MAX_REASON_BYTES, { allowEmpty: partial });
        const notes = boundedText(selection.notes, 'G3_NOTES_INVALID', MAX_NOTES_BYTES, { allowEmpty: true });
        return {
            shot_id: shotId,
            candidate_token: candidateToken,
            chosen_provider: chosenProvider,
            dialogue_source: dialogueSource,
            beat_id: beatId,
            take_id: takeId,
            source_in_sec: sourceIn,
            source_out_sec: rangeEmpty ? null : sourceOut,
            transition_in: validateTransition(selection.transition_in, { partial }),
            selection_reason: reason,
            notes,
        };
    });
    if (seen.size !== expected.size) throw g3Error('G3_SHOT_COVERAGE_INVALID', 'Shot coverage is incomplete');
    return { draftId, overallNotes, selections };
}

module.exports = {
    G3_DRAFT_SCHEMA,
    G3_EXPORT_SCHEMA,
    SELECTED_TAKES_SCHEMA,
    SHOT_MANIFEST_SCHEMA,
    BEATS_SCHEMA,
    ROOM_QC_SCHEMA,
    MAX_JSON_BYTES,
    MAX_SOURCE_JSON_BYTES,
    MAX_SHOTS,
    MAX_ID_LENGTH,
    MAX_TAKE_ID_LENGTH,
    MAX_REASON_BYTES,
    MAX_NOTES_BYTES,
    APPROVED_CANDIDATE_PREFIXES,
    MEDIA_MIME_TYPES,
    PROVIDERS,
    DIALOGUE_SOURCES,
    g3Error,
    sha256,
    exactKeys,
    boundedText,
    safeId,
    jsonBuffer,
    emptySelection,
    validateTransition,
    validateSelectionPayload,
};
