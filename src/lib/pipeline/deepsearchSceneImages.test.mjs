import test from 'node:test';
import assert from 'node:assert/strict';

import { BLOCKERS } from './blockers.js';
import {
    DEEPSEARCH_PROFILE,
    buildDeepSearchSceneImageCommandSpec,
    buildDeepSearchSceneImagePrompt,
    buildStoryboardSceneImagePayloads,
} from './deepsearchSceneImages.js';
import { classifySideEffect, SIDE_EFFECT_TYPES } from './sideEffects.js';
import { completePlanningNoGenerationState } from '../../fixtures/pipeline/states/index.js';

test('storyboard clips become DeepSearchTeam scene image payloads', () => {
    const state = completePlanningNoGenerationState();
    const payloads = buildStoryboardSceneImagePayloads(state);

    assert.equal(payloads.length, state.storyboard.length);
    assert.equal(payloads[0].clip_id, 'clip_001');
    assert.equal(payloads[0].aspect_ratio, state.project.aspect_ratio);
    assert.ok(payloads[0].negative_constraints.includes('no storyboard grid'));
    assert.ok(payloads[0].references.some((reference) => reference.asset_id === 'asset_clip_001_first_frame'));
});

test('DeepSearchTeam image prompt encodes one-image and operator gates', () => {
    const state = completePlanningNoGenerationState();
    const payload = buildStoryboardSceneImagePayloads(state)[0];
    const prompt = buildDeepSearchSceneImagePrompt(payload, state);

    assert.match(prompt, /Generate exactly one finished cinematic scene image/);
    assert.match(prompt, /Profile goldpure369 only/);
    assert.match(prompt, /Use Thinking mode/);
    assert.match(prompt, /no collage/);
    assert.match(prompt, /no watermark/);
    assert.match(prompt, /Reference image roles/);
});

test('DeepSearchTeam image command is preview-only and blocked as credit-consuming generation', () => {
    const state = completePlanningNoGenerationState();
    const payload = buildStoryboardSceneImagePayloads(state)[0];
    const spec = buildDeepSearchSceneImageCommandSpec(state, payload);
    const classification = classifySideEffect(spec);

    assert.equal(spec.command, 'python');
    assert.deepEqual(spec.args.slice(0, 3), ['-m', 'dst', 'image']);
    assert.equal(spec.args.at(-2), '-p');
    assert.equal(spec.args.at(-1), DEEPSEARCH_PROFILE);
    assert.equal(spec.side_effect_type, SIDE_EFFECT_TYPES.CREDIT_CONSUMING_GENERATION);
    assert.equal(spec.preview_only, true);
    assert.equal(spec.disabled_reason, BLOCKERS.CREDIT_CONFIRMATION_REQUIRED);
    assert.equal(classification.mode, 'blocked');
    assert.equal(classification.executable, false);
    assert.ok(classification.blockers.includes('SIDE_EFFECT_BLOCKED'));
    assert.ok(classification.blockers.includes(BLOCKERS.CREDIT_CONFIRMATION_REQUIRED));
});
