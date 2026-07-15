export const MEDIA_REVIEW_FILTERS = Object.freeze({
    ALL: 'all',
    NEEDS_REVIEW: 'needs_review',
    RETRY_SELECTED: 'retry_selected',
});

const REVIEW_STATUSES = new Set(['unreviewed', 'accepted', 'needs_changes', 'retry_requested']);
const MEDIA_PROVIDERS = new Set(['dst', 'flow', 'grok', 'replicate', 'bytedance', 'seedance']);

function fallbackProvider(value, fallback) {
    if (value === 'flow_omni') return 'flow';
    return MEDIA_PROVIDERS.has(value) ? value : fallback;
}

function fallbackReviewStatus(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'pass' || normalized === 'accepted') return 'accepted';
    if (normalized === 'retry' || normalized === 'needs_changes' || normalized === 'fail') return 'needs_changes';
    return 'unreviewed';
}

export function deriveMediaAttempts(state = {}) {
    if (Array.isArray(state.mediaAttempts) && state.mediaAttempts.length) return [...state.mediaAttempts];

    const assetAttempts = (state.assets || []).map((asset, index) => ({
        media_id: asset.asset_id || `asset_${index + 1}`,
        kind: ['character_sheet', 'location_sheet'].includes(asset.type) ? asset.type : 'scene_image',
        target_id: asset.target_clip_id || asset.target_id || asset.asset_id || '',
        provider: fallbackProvider(asset.provider, 'dst'),
        operation_id: asset.operation_id || '',
        attempt: Number.isSafeInteger(Number(asset.attempt)) && Number(asset.attempt) > 0 ? Number(asset.attempt) : 1,
        reference_ids: Array.isArray(asset.reference_ids) ? [...asset.reference_ids] : [],
        path: asset.path || '',
        generation_status: asset.video_use_status || 'legacy_asset',
        review_status: fallbackReviewStatus(asset.review_status || asset.review_verdict),
        retry_of: asset.retry_of || '',
        review_note: asset.retry_notes || asset.continuity_notes || '',
        selected_for_retry: false,
    }));

    const videoAttempts = (state.heartbeatRecords || []).flatMap((record, recordIndex) => (
        (record.downloaded_files || []).map((path, fileIndex) => ({
            media_id: `${record.clip_id || `clip_${recordIndex + 1}`}_download_${fileIndex + 1}`,
            kind: 'video',
            target_id: record.clip_id || '',
            provider: fallbackProvider(record.provider || state.project?.route, 'seedance'),
            operation_id: record.submit_id || record.operation_id || '',
            attempt: fileIndex + 1,
            reference_ids: [],
            path,
            generation_status: record.gen_status || record.queue_status || 'downloaded',
            review_status: 'unreviewed',
            retry_of: '',
            review_note: '',
            selected_for_retry: false,
        }))
    ));

    return [...assetAttempts, ...videoAttempts];
}

export function normalizeReviewStatus(value) {
    return REVIEW_STATUSES.has(value) ? value : 'unreviewed';
}

export function withMediaReview(attempt, changes = {}) {
    return {
        ...attempt,
        ...changes,
        review_status: normalizeReviewStatus(changes.review_status ?? attempt.review_status),
        review_note: String(changes.review_note ?? attempt.review_note ?? ''),
        selected_for_retry: changes.selected_for_retry ?? attempt.selected_for_retry === true,
    };
}

export function setMediaReview(attempts = [], mediaId, reviewStatus) {
    return attempts.map((attempt) => attempt.media_id === mediaId
        ? withMediaReview(attempt, {
            review_status: reviewStatus,
            selected_for_retry: reviewStatus === 'retry_requested',
        })
        : attempt);
}

export function setMediaReviewNote(attempts = [], mediaId, reviewNote) {
    return attempts.map((attempt) => attempt.media_id === mediaId
        ? withMediaReview(attempt, { review_note: reviewNote })
        : attempt);
}

export function toggleRetrySelection(attempts = [], mediaId) {
    return attempts.map((attempt) => {
        if (attempt.media_id !== mediaId) return attempt;
        const selected = attempt.selected_for_retry !== true;
        return withMediaReview(attempt, {
            selected_for_retry: selected,
            review_status: selected ? 'retry_requested' : 'needs_changes',
        });
    });
}

export function filterMediaAttempts(attempts = [], filter = MEDIA_REVIEW_FILTERS.ALL) {
    if (filter === MEDIA_REVIEW_FILTERS.NEEDS_REVIEW) {
        return attempts.filter((attempt) => ['unreviewed', 'needs_changes'].includes(attempt.review_status));
    }
    if (filter === MEDIA_REVIEW_FILTERS.RETRY_SELECTED) {
        return attempts.filter((attempt) => attempt.selected_for_retry === true || attempt.review_status === 'retry_requested');
    }
    return [...attempts];
}

export function groupMediaAttempts(attempts = []) {
    const characterSheets = [];
    const locationSheets = [];
    const scenes = new Map();

    attempts.forEach((attempt) => {
        if (attempt.kind === 'character_sheet') {
            characterSheets.push(attempt);
            return;
        }
        if (attempt.kind === 'location_sheet') {
            locationSheets.push(attempt);
            return;
        }
        const targetId = attempt.target_id || 'unassigned';
        const group = scenes.get(targetId) || { target_id: targetId, images: [], videos: [] };
        if (attempt.kind === 'video') group.videos.push(attempt);
        else group.images.push(attempt);
        scenes.set(targetId, group);
    });

    const byAttempt = (left, right) => (left.attempt || 0) - (right.attempt || 0)
        || String(left.media_id).localeCompare(String(right.media_id));
    characterSheets.sort(byAttempt);
    locationSheets.sort(byAttempt);
    const sceneGroups = [...scenes.values()]
        .map((group) => ({ ...group, images: group.images.sort(byAttempt), videos: group.videos.sort(byAttempt) }))
        .sort((left, right) => left.target_id.localeCompare(right.target_id));

    return { characterSheets, locationSheets, scenes: sceneGroups };
}

export function buildRetryQueue(attempts = []) {
    return attempts
        .filter((attempt) => attempt.selected_for_retry === true || attempt.review_status === 'retry_requested')
        .sort((left, right) => String(left.target_id).localeCompare(String(right.target_id))
            || (left.attempt || 0) - (right.attempt || 0))
        .map((attempt, index) => ({
            sequence: index + 1,
            media_id: attempt.media_id,
            kind: attempt.kind,
            target_id: attempt.target_id,
            provider: attempt.provider,
            retry_of: attempt.media_id,
            review_note: attempt.review_note || '',
            execution_status: 'draft_not_executed',
        }));
}

export function buildMediaReviewDraft(attempts = []) {
    return {
        schema: 'film_pipeline.media_review_draft.v1',
        execution: 'not_run',
        reviews: attempts.map((attempt) => ({
            media_id: attempt.media_id,
            review_status: normalizeReviewStatus(attempt.review_status),
            review_note: attempt.review_note || '',
            selected_for_retry: attempt.selected_for_retry === true,
        })),
        retry_queue: buildRetryQueue(attempts),
    };
}
