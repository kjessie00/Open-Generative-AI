import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

import { BLOCKERS } from '../src/lib/pipeline/blockers.js';
import { SIDE_EFFECT_TYPES } from '../src/lib/pipeline/sideEffects.js';
import { buildDreaminaQueueCommands } from '../src/lib/pipeline/commandBuilders.js';
import { classifySideEffect } from '../src/lib/pipeline/sideEffects.js';
import {
    buildFinalClipRows,
    deriveFinalCondition,
    knownCreditEvidence,
} from '../src/components/pipeline/FinalReportPanel.js';
import {
    QUEUE_PHASES,
    classifyQueueClip,
    validateImageDashboard,
    validateFinalReady,
    validateSeedanceQueuePolicy,
    validateSubmitAllowed,
} from '../src/lib/pipeline/validators.js';
import {
    QUEUE_RULE_NOW,
    downloadedQaMissingState,
    failedAfterRealQueueState,
    finalNotReadyStitchState,
    finalReadyState,
    finalMissingMp4State,
    noSubmitIdState,
    queuedHeartbeatDueState,
    queuedHeartbeatNotDueState,
} from '../src/fixtures/pipeline/queueRuleStates.js';

const now = new Date(QUEUE_RULE_NOW);
const require = createRequire(import.meta.url);
const { readProductionFolder } = require('../electron/lib/productionReader');

function clipState(projectState) {
    return classifyQueueClip(projectState, 'clip_001', now);
}

test('no submit_id and no backend evidence is classified as pre_queue_failure, not a live attempt', () => {
    const item = clipState(noSubmitIdState());

    assert.equal(item.phase, QUEUE_PHASES.PRE_QUEUE_FAILURE);
    assert.equal(item.liveAttemptCount, 0);
});

test('queued clip with future next_heartbeat_at blocks heartbeat until the exact next check time', () => {
    const state = queuedHeartbeatNotDueState();
    const item = clipState(state);
    const policy = validateSeedanceQueuePolicy(state, now);
    const commands = buildDreaminaQueueCommands(state, now);

    assert.equal(item.phase, QUEUE_PHASES.HEARTBEAT_NOT_DUE);
    assert.equal(item.heartbeat.details.nextHeartbeatAt, '2026-07-05T12:10:00.000Z');
    assert.deepEqual(policy.details.nextHeartbeatBlocked, [{
        clip_id: 'clip_001',
        next_heartbeat_at: '2026-07-05T12:10:00.000Z',
        waitMs: 600000,
    }]);
    assert.ok(commands.every((command) => command.disabled_reason === BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED));
});

test('queued clip with due heartbeat exposes only non-consuming list_task and query_result previews', () => {
    const state = queuedHeartbeatDueState();
    const item = clipState(state);
    const commands = buildDreaminaQueueCommands(state, now);

    assert.equal(item.phase, QUEUE_PHASES.HEARTBEAT_DUE);
    assert.equal(commands.length, 2);
    assert.ok(commands.every((command) => command.command === 'dreamina'));
    assert.deepEqual(commands.map((command) => command.args[0]), ['list_task', 'query_result']);
    assert.ok(commands.every((command) => command.side_effect_type === SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS));
    assert.ok(commands.every((command) => !command.disabled_reason));
});

test('a second live generation submit is blocked by default after one recorded attempt', () => {
    const state = queuedHeartbeatDueState();
    const validation = validateSubmitAllowed({
        ...state,
        promptPack: state.promptPacks[0],
        reviewGates: state.reviewGates,
        credit_confirmed: true,
        live_attempt_count: 1,
    });

    assert.equal(validation.ok, false);
    assert.ok(validation.blockers.includes(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED));
    assert.equal(validation.details.liveAttemptPolicy, 'one_live_generation_attempt_per_planned_clip');
});

test('downloaded clip is not final-ready when QA is missing', () => {
    const validation = validateFinalReady(downloadedQaMissingState());

    assert.equal(validation.ok, false);
    assert.ok(validation.blockers.includes(BLOCKERS.GEMINI_VIDEO_REVIEW_BLOCKED));
});

test('failed after a real queue remains one live attempt and does not enable retry by default', () => {
    const item = clipState(failedAfterRealQueueState());

    assert.equal(item.phase, QUEUE_PHASES.FAILED_AFTER_REAL_QUEUE);
    assert.equal(item.liveAttemptCount, 1);
    assert.equal(item.isRetryAllowedByDefault, false);
});

test('final ready is false when final.mp4 evidence is missing', () => {
    const validation = validateFinalReady(finalMissingMp4State());

    assert.equal(validation.ok, false);
    assert.ok(validation.blockers.includes(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN));
    assert.equal(validation.details.finalVideo, 'missing_final_mp4_evidence');
});

test('image dashboard is stale when asset or review files are newer than dashboard timestamp', () => {
    const state = queuedHeartbeatDueState();
    state.imageDashboard.updated_at = '2026-07-05T10:00:00.000Z';
    state.imageDashboard.assets[0].review_updated_at = '2026-07-05T10:05:00.000Z';

    const validation = validateImageDashboard(state);

    assert.equal(validation.ok, false);
    assert.ok(validation.blockers.includes(BLOCKERS.IMAGE_DASHBOARD_STALE));
});

test('attached image RETRY BLOCK or UNREVIEWED blocks submit unless explicit exception exists', () => {
    const state = queuedHeartbeatDueState();
    state.imageDashboard.assets[0].review_verdict = 'UNREVIEWED';
    state.assets = state.imageDashboard.assets;

    const blocked = validateSubmitAllowed({
        ...state,
        promptPack: state.promptPacks[0],
        reviewGates: state.reviewGates,
        credit_confirmed: true,
        live_attempt_count: 0,
    });
    assert.ok(blocked.blockers.includes(BLOCKERS.IMAGE_GEMINI_REVIEW_REQUIRED));

    state.imageDashboard.assets[0].explicit_exception = true;
    const excepted = validateSubmitAllowed({
        ...state,
        promptPack: state.promptPacks[0],
        reviewGates: state.reviewGates,
        credit_confirmed: true,
        live_attempt_count: 0,
    });
    assert.ok(!excepted.blockers.includes(BLOCKERS.IMAGE_GEMINI_REVIEW_REQUIRED));
});

test('final ready is false when ffprobe verification evidence is missing', () => {
    const state = finalMissingMp4State();
    state.fileEvidence['production/dryrun_gangnam_001/final/final.mp4'] = true;
    state.fileEvidence['production/dryrun_gangnam_001/final/concat_list.txt'] = true;
    state.fileEvidence['production/dryrun_gangnam_001/final/report.md'] = true;
    state.finalReport.ffprobe_verified = false;
    state.finalReport.ffprobe_path = 'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json';
    state.finalReport.blockers = [];

    const validation = validateFinalReady(state);

    assert.equal(validation.ok, false);
    assert.equal(validation.details.ffprobe, 'missing_ffprobe_verification_evidence');
});

test('production reader prefers edit/accepted_seconds.md when present', () => {
    const root = path.resolve('src/fixtures/pipeline/sampleProductionFolder');
    const state = readProductionFolder(root);

    assert.equal(state.parsed.acceptedSeconds.relative_path, 'edit/accepted_seconds.md');
    assert.equal(state.parsed.acceptedSeconds.records[0].clip_id, 'clip_001');
});

test('final ready fixture passes strict readiness and exposes clip evidence rows', () => {
    const state = finalReadyState();
    const validation = validateFinalReady(state);
    const rows = buildFinalClipRows(state);
    const credits = knownCreditEvidence(state);

    assert.equal(validation.ok, true);
    assert.equal(deriveFinalCondition(state, validation), 'final.mp4 exists');
    assert.equal(rows[0].clip_id, 'clip_001');
    assert.equal(rows[0].submit_id, 'task_clip_001');
    assert.equal(rows[0].qa_verdict, 'PASS');
    assert.match(rows[0].accepted_seconds, /0-4.8s/);
    assert.equal(credits.total, 4);
});

test('not-ready final fixture reports missing final stitch', () => {
    const state = finalNotReadyStitchState();
    const validation = validateFinalReady(state);

    assert.equal(validation.ok, false);
    assert.equal(deriveFinalCondition(state, validation), 'missing final stitch');
});

test('final stitch preview commands remain non-executing previews', async () => {
    const { buildFfmpegConcatPreviewCommand, buildFfprobeValidationCommands } = await import('../src/lib/pipeline/commandBuilders.js');
    const state = finalReadyState();
    const ffprobe = buildFfprobeValidationCommands(state)[0];
    const concat = buildFfmpegConcatPreviewCommand(state);

    assert.equal(classifySideEffect(ffprobe).mode, 'preview_only');
    assert.equal(classifySideEffect(ffprobe).type, SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS);
    assert.equal(classifySideEffect(concat).mode, 'blocked');
    assert.equal(concat.disabled_reason, 'PREVIEW_ONLY_REQUIRED');
});
