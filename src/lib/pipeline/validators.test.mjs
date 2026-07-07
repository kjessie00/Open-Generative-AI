import test from 'node:test';
import assert from 'node:assert/strict';

import { BLOCKERS } from './blockers.js';
import {
    FIXTURE_NOW,
    acceptedSecondsMissingState,
    completePlanningNoGenerationState,
    creditConfirmationRequiredState,
    dashboardMissingState,
    dashboardStaleState,
    finalReadyState,
    heartbeatDueState,
    imageUnreviewedState,
    promptMediaReviewBlockedState,
    submittedWaitingHeartbeatState,
} from '../../fixtures/pipeline/states/index.js';
import {
    validateFinalReady,
    validateHeartbeatAllowed,
    validateSubmitAllowed,
} from './validators.js';

function seedanceClipState(projectState, overrides = {}) {
    const promptPack = projectState.promptPacks.find((pack) => String(pack.generator).includes('seedance'));
    const motionBoardShot = projectState.motionBoard.find((shot) => shot.clip_id === promptPack.clip_id);
    return {
        ...projectState,
        promptPack,
        motionBoardShot,
        reviewGates: projectState.reviewGates,
        live_attempt_count: 0,
        ...overrides,
    };
}

function assertHasBlocker(validation, blocker) {
    assert.equal(validation.ok, false);
    assert.ok(
        validation.blockers.includes(blocker),
        `Expected ${blocker}, received ${validation.blockers.join(', ')}`,
    );
}

test('submit is blocked without image dashboard', () => {
    const validation = validateSubmitAllowed(seedanceClipState(dashboardMissingState()));

    assertHasBlocker(validation, BLOCKERS.MISSING_IMAGE_DASHBOARD);
});

test('submit is blocked with stale image dashboard', () => {
    const validation = validateSubmitAllowed(seedanceClipState(dashboardStaleState()));

    assertHasBlocker(validation, BLOCKERS.IMAGE_DASHBOARD_STALE);
});

test('submit is blocked with unreviewed attached image', () => {
    const validation = validateSubmitAllowed(seedanceClipState(imageUnreviewedState()));

    assertHasBlocker(validation, BLOCKERS.IMAGE_GEMINI_REVIEW_REQUIRED);
});

test('submit is blocked without Gemini prompt/media review PASS', () => {
    const validation = validateSubmitAllowed(seedanceClipState(promptMediaReviewBlockedState()));

    assertHasBlocker(validation, BLOCKERS.GEMINI_REVIEW_BLOCKED);
    assert.equal(validation.details.promptMediaReview, 'BLOCK');
});

test('submit is blocked without explicit credit confirmation', () => {
    const validation = validateSubmitAllowed(seedanceClipState(creditConfirmationRequiredState()));

    assertHasBlocker(validation, BLOCKERS.CREDIT_CONFIRMATION_REQUIRED);
});

test('retry is blocked by default after one live attempt', () => {
    const validation = validateSubmitAllowed(seedanceClipState(completePlanningNoGenerationState(), {
        live_attempt_count: 1,
        retry_requested: true,
    }));

    assertHasBlocker(validation, BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
    assert.equal(validation.details.retryPolicy, 'retry_blocked_after_one_live_attempt');
    assert.equal(validation.details.liveAttemptPolicy, 'one_live_generation_attempt_per_planned_clip');
});

test('heartbeat is blocked before 20 minutes and reports exact next check time', () => {
    const state = submittedWaitingHeartbeatState();
    const validation = validateHeartbeatAllowed(state.heartbeatRecords[0], new Date(FIXTURE_NOW));

    assertHasBlocker(validation, BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
    assert.equal(validation.details.reason, 'heartbeat_not_due');
    assert.equal(validation.details.nextHeartbeatAt, '2026-07-05T12:10:00.000Z');
});

test('heartbeat is allowed after the 20 minute interval', () => {
    const state = heartbeatDueState();
    const validation = validateHeartbeatAllowed(state.heartbeatRecords[0], new Date(FIXTURE_NOW));

    assert.equal(validation.ok, true);
    assert.equal(validation.blockers.length, 0);
});

test('final is blocked without accepted seconds', () => {
    const validation = validateFinalReady(acceptedSecondsMissingState());

    assertHasBlocker(validation, BLOCKERS.MISSING_ACCEPTED_SECONDS);
});

test('final is blocked without final.mp4 evidence', () => {
    const state = finalReadyState();
    state.fileEvidence[state.finalReport.final_video_path] = false;

    const validation = validateFinalReady(state);

    assertHasBlocker(validation, BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
    assert.equal(validation.details.finalVideo, 'missing_final_mp4_evidence');
});

test('final is ready only when all strict evidence exists', () => {
    const validation = validateFinalReady(finalReadyState());

    assert.equal(validation.ok, true);
    assert.deepEqual(validation.blockers, []);
});
