import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MEDIA_REVIEW_FILTERS,
    buildMediaReviewDraft,
    buildRetryQueue,
    deriveMediaAttempts,
    filterMediaAttempts,
    groupMediaAttempts,
    setMediaReview,
    toggleRetrySelection,
} from '../src/lib/pipeline/mediaReviewBoard.js';

const attempts = [
    { media_id: 'char-1', kind: 'character_sheet', target_id: 'hero', provider: 'dst', attempt: 1, review_status: 'accepted' },
    { media_id: 'loc-1', kind: 'location_sheet', target_id: 'room', provider: 'dst', attempt: 1, review_status: 'unreviewed' },
    { media_id: 'scene-2', kind: 'scene_image', target_id: 'clip_001', provider: 'dst', attempt: 2, review_status: 'needs_changes' },
    { media_id: 'scene-1', kind: 'scene_image', target_id: 'clip_001', provider: 'dst', attempt: 1, review_status: 'unreviewed' },
    { media_id: 'video-1', kind: 'video', target_id: 'clip_001', provider: 'flow', attempt: 1, review_status: 'unreviewed' },
];

test('media review grouping keeps reference rails separate and orders scene attempts', () => {
    const grouped = groupMediaAttempts(attempts);
    assert.deepEqual(grouped.characterSheets.map((item) => item.media_id), ['char-1']);
    assert.deepEqual(grouped.locationSheets.map((item) => item.media_id), ['loc-1']);
    assert.deepEqual(grouped.scenes.map((item) => item.target_id), ['clip_001']);
    assert.deepEqual(grouped.scenes[0].images.map((item) => item.media_id), ['scene-1', 'scene-2']);
    assert.deepEqual(grouped.scenes[0].videos.map((item) => item.media_id), ['video-1']);
});

test('media review filters and review actions expose only actionable attempts', () => {
    assert.deepEqual(
        filterMediaAttempts(attempts, MEDIA_REVIEW_FILTERS.NEEDS_REVIEW).map((item) => item.media_id),
        ['loc-1', 'scene-2', 'scene-1', 'video-1'],
    );
    const accepted = setMediaReview(attempts, 'scene-2', 'accepted');
    assert.equal(accepted.find((item) => item.media_id === 'scene-2').review_status, 'accepted');
    assert.equal(accepted.find((item) => item.media_id === 'scene-2').selected_for_retry, false);
});

test('retry selection produces a sequential non-executing queue and exact draft records', () => {
    const selected = toggleRetrySelection(toggleRetrySelection(attempts, 'scene-2'), 'video-1');
    const queue = buildRetryQueue(selected);
    assert.deepEqual(queue.map((item) => [item.sequence, item.media_id, item.execution_status]), [
        [1, 'video-1', 'draft_not_executed'],
        [2, 'scene-2', 'draft_not_executed'],
    ]);
    assert.deepEqual(
        filterMediaAttempts(selected, MEDIA_REVIEW_FILTERS.RETRY_SELECTED).map((item) => item.media_id),
        ['scene-2', 'video-1'],
    );
    const draft = buildMediaReviewDraft(selected);
    assert.equal(draft.schema, 'film_pipeline.media_review_draft.v1');
    assert.equal(draft.execution, 'not_run');
    assert.deepEqual(draft.retry_queue, queue);
    assert.deepEqual(Object.keys(draft.reviews[0]), ['media_id', 'review_status', 'review_note', 'selected_for_retry']);
});

test('legacy assets and downloaded heartbeat files become review attempts only when the explicit ledger is empty', () => {
    const legacyState = {
        project: { route: 'flow_omni' },
        assets: [{
            asset_id: 'legacy-frame',
            type: 'first_frame',
            target_clip_id: 'clip_001',
            path: '/tmp/frame.png',
            review_verdict: 'PASS',
            continuity_notes: '기존 이미지',
        }],
        heartbeatRecords: [{
            clip_id: 'clip_001',
            submit_id: 'flow-job-1',
            gen_status: 'downloaded',
            downloaded_files: ['/tmp/clip.mp4'],
        }],
    };
    const derived = deriveMediaAttempts(legacyState);
    assert.deepEqual(derived.map((item) => [item.media_id, item.kind, item.provider, item.review_status]), [
        ['legacy-frame', 'scene_image', 'dst', 'accepted'],
        ['clip_001_download_1', 'video', 'flow', 'unreviewed'],
    ]);
    assert.equal(derived[0].review_note, '기존 이미지');
    assert.equal(derived[1].operation_id, 'flow-job-1');

    const explicit = [{ media_id: 'explicit-only', kind: 'scene_image' }];
    assert.deepEqual(deriveMediaAttempts({ ...legacyState, mediaAttempts: explicit }), explicit);
});
