import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';
import filmProvider from '../electron/lib/filmPipelineProvider.js';
import runnerModule from '../electron/lib/localAgentSuggestionRunner.js';
import promptPlanAgentProvider from '../electron/lib/promptPlanAgentProvider.js';
import { pipelineClient } from '../src/lib/pipeline/client.js';

const { createLocalAgentSuggestionRunner } = runnerModule;

test('renderer client exports every prompt-agent IPC method', () => {
    for (const method of [
        'enqueueImagePromptAgentRequest', 'runImagePromptAgentRequest', 'decideImagePromptAgentSuggestion',
        'enqueueVideoPromptAgentRequest', 'runVideoPromptAgentRequest', 'decideVideoPromptAgentSuggestion',
    ]) assert.equal(typeof pipelineClient[method], 'function', method);
});

function setup(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-prompt-agent-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const context = { userDataPath, config: {} };
    draftProvider.saveNewProjectDraft({
        production_id: 'prompt-agent-01', brief: '비 오는 골목의 재회',
        script: '주인공이 골목에서 멈춰 서서 오래된 친구를 바라본다.', route: 'both',
        aspect_ratio: '9:16', scene_duration: 5, max_scenes: 2,
    }, context);
    const empty = designProvider.getNewProjectDesignState(context);
    designProvider.saveNewProjectDesignBoard({
        board: {
            characters: [{ id: 'hero', name: '주인공', role: '친구', appearance: '짧은 머리', wardrobe: '검은 코트', continuity: '붉은 우산' }],
            locations: [{ id: 'alley', name: '비 오는 골목', space: '좁은 길', lighting: '푸른 밤빛', props: '네온 간판', continuity: '젖은 노면' }],
            scenes: [{
                id: 'scene_01', title: '재회', dramatic_beat: '두 사람이 마주친다.', characters: ['hero'],
                location_id: 'alley', duration: 5, first_frame: '우산 아래 멈춘 주인공',
                action: '천천히 고개를 든다.', camera: '허리 높이', lighting: '푸른 역광', audio_sfx_dialogue: '빗소리',
            }],
        },
        expected_planning_revision_sha256: empty.planning_revision_sha256,
        expected_design_revision_sha256: empty.revision_sha256,
    }, context);
    const derived = imagePlanProvider.getNewProjectImagePlan(context);
    const image = imagePlanProvider.saveNewProjectImagePlan({
        tasks: derived.tasks,
        expected_design_revision_sha256: derived.design_revision_sha256,
        expected_image_plan_revision_sha256: derived.revision_sha256,
    }, context);
    return { base, userDataPath, context, image };
}

function queueImage(parts, task, instruction = '빛과 구도를 더 영화적으로 다듬어 주세요.') {
    const state = filmProvider.getNewProjectImagePlan(parts.context);
    return filmProvider.enqueueImagePromptAgentRequest({
        task_token: task.task_token, instruction,
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.revision_sha256,
    }, parts.context);
}

test('MOCK image prompt agent keeps a private sidecar and applies only the selected prompt', async (t) => {
    const parts = setup(t);
    const before = filmProvider.getNewProjectImagePlan(parts.context);
    const target = before.tasks.find((task) => task.kind === 'scene_image');
    const queued = queueImage(parts, target);
    assert.equal(queued.ok, true);
    assert.equal(queued.generation_executed, false);
    const paths = imagePlanProvider.exactPaths(parts.userDataPath);
    const collaboration = path.join(paths.root, 'collaboration');
    assert.equal(fs.lstatSync(collaboration).mode & 0o777, 0o700);
    for (const directory of ['requests', 'snapshots', 'suggestions', 'receipts']) {
        assert.equal(fs.lstatSync(path.join(collaboration, directory)).mode & 0o777, 0o700);
    }
    assert.equal(fs.lstatSync(path.join(collaboration, 'requests', `${queued.request_id}.json`)).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(queued.state).includes(parts.base), false);

    const proposed = `${target.prompt} / 빗방울 역광과 깊은 원근감`;
    const runner = createLocalAgentSuggestionRunner({
        executeStructured: async ({ kind, prompt }) => {
            assert.equal(kind, 'image_prompt');
            assert.match(prompt, /빛과 구도를 더 영화적으로/);
            assert.doesNotMatch(prompt, /request_[a-f0-9]{64}/);
            return { proposed_prompt: proposed, summary: '빛과 원근감을 선명하게 했습니다.' };
        },
    });
    const run = await filmProvider.runImagePromptAgentRequest({ task_token: target.task_token }, {
        ...parts.context, localAgentSuggestionRunner: runner,
    });
    assert.equal(run.ok, true);
    assert.equal(run.model_called, true);
    assert.equal(run.generation_executed, false);
    const unchanged = imagePlanProvider.getNewProjectImagePlan(parts.context);
    assert.equal(unchanged.tasks.find((task) => task.task_token === target.task_token).prompt, target.prompt,
        'suggestion review never writes the plan');
    const ready = run.state.collaboration.recent_requests[0];
    assert.equal(ready.status, 'suggestion_ready');
    assert.equal(ready.suggestion.proposed_prompt, proposed);

    const applied = filmProvider.decideImagePromptAgentSuggestion({
        suggestion_token: ready.suggestion.suggestion_token, action: 'apply',
        expected_design_revision_sha256: run.state.design_revision_sha256,
        expected_image_plan_revision_sha256: run.state.revision_sha256,
    }, parts.context);
    assert.equal(applied.applied, true);
    assert.equal(applied.generation_executed, false);
    const changed = applied.state.tasks.find((task) => task.task_token === target.task_token);
    assert.equal(changed.prompt, proposed);
    for (const key of ['task_token', 'kind', 'source_id', 'sequence', 'label', 'status', 'result_token']) {
        assert.deepEqual(changed[key], target[key]);
    }
    assert.deepEqual(applied.state.tasks.filter((task) => task.task_token !== target.task_token),
        before.tasks.filter((task) => task.task_token !== target.task_token));
    assert.equal(applied.state.collaboration.recent_requests[0].status, 'applied');
});

test('MOCK prompt agent rejects an echoed JSON handoff instead of replacing the prompt', async (t) => {
    const parts = setup(t);
    const state = filmProvider.getNewProjectImagePlan(parts.context);
    const target = state.tasks[0];
    const queued = queueImage(parts, target, '표정을 더 분명하게 다듬어 주세요.');
    const runner = createLocalAgentSuggestionRunner({
        executeStructured: async () => ({
            proposed_prompt: JSON.stringify({ request_instruction: '표정을 더 분명하게', target: { prompt: target.prompt } }),
            summary: '요청을 반영했습니다.',
        }),
    });
    await assert.rejects(
        runner.runPrompt({ lane: 'image', requestId: queued.request_id, context: parts.context }),
        (error) => error.code === 'AGENT_OUTPUT_INVALID' && error.modelCalled === true,
    );
    assert.equal(imagePlanProvider.getNewProjectImagePlan(parts.context).tasks[0].prompt, target.prompt);
    assert.equal(filmProvider.getNewProjectImagePlan(parts.context).collaboration.recent_requests[0].suggestion, null);
});

test('MOCK video prompt agent preserves provider and accepted tasks require retry', async (t) => {
    const parts = setup(t);
    const sceneImage = parts.image.tasks.find((task) => task.kind === 'scene_image');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const linked = imagePlanProvider.connectNewProjectImageResult({
        task_token: sceneImage.task_token, candidate_token: 'candidate', image_index: 1,
        expected_design_revision_sha256: parts.image.design_revision_sha256,
        expected_image_plan_revision_sha256: parts.image.revision_sha256,
    }, {
        ...parts.context,
        getDstBundleImportPreview: () => ({ ready: true, preview: {
            mime_type: 'image/png', byte_length: png.byteLength, base64: png.toString('base64'),
        }, blockers: [] }),
    });
    const derived = videoPlanProvider.getNewProjectVideoPlan(parts.context);
    const saved = videoPlanProvider.saveNewProjectVideoPlan({
        tasks: derived.tasks,
        expected_design_revision_sha256: derived.design_revision_sha256,
        expected_image_plan_revision_sha256: derived.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: derived.revision_sha256,
    }, parts.context);
    const target = saved.tasks[0];
    const videoOptions = { ...parts.context, readConfigFn: () => ({}) };
    const queued = filmProvider.enqueueVideoPromptAgentRequest({
        task_token: target.task_token, instruction: '카메라 이동을 더 자연스럽게 다듬어 주세요.',
        expected_design_revision_sha256: saved.design_revision_sha256,
        expected_image_plan_revision_sha256: saved.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: saved.revision_sha256,
    }, videoOptions);
    const proposed = `${target.prompt} / 카메라는 천천히 인물에게 다가간다`;
    const runner = createLocalAgentSuggestionRunner({
        executeStructured: async ({ kind }) => {
            assert.equal(kind, 'video_prompt');
            return { proposed_prompt: proposed, summary: '카메라 동선을 자연스럽게 했습니다.' };
        },
    });
    const run = await filmProvider.runVideoPromptAgentRequest({ task_token: target.task_token }, {
        ...videoOptions, localAgentSuggestionRunner: runner,
    });
    const suggestion = run.state.collaboration.recent_requests[0].suggestion;
    const applied = filmProvider.decideVideoPromptAgentSuggestion({
        suggestion_token: suggestion.suggestion_token, action: 'apply',
        expected_design_revision_sha256: run.state.design_revision_sha256,
        expected_image_plan_revision_sha256: run.state.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: run.state.revision_sha256,
    }, videoOptions);
    assert.equal(applied.state.tasks[0].prompt, proposed);
    assert.equal(applied.state.tasks[0].provider, target.provider);
    assert.equal(applied.generation_executed, false);

    const acceptedState = { ...applied.state, tasks: applied.state.tasks.map((task) => ({
        ...task, status: '결과연결', result_token: `result_${'a'.repeat(64)}`,
    })) };
    assert.throws(() => promptPlanAgentProvider.enqueue({
        lane: 'video', state: acceptedState, planPaths: videoPlanProvider.exactPaths(parts.userDataPath),
        payload: {
            task_token: acceptedState.tasks[0].task_token, instruction: '다시 수정',
            expected_design_revision_sha256: acceptedState.design_revision_sha256,
            expected_image_plan_revision_sha256: acceptedState.image_plan_revision_sha256,
            expected_video_plan_revision_sha256: acceptedState.revision_sha256,
        },
    }), { code: 'VIDEO_PROMPT_AGENT_ACCEPTED_TASK_REQUIRES_RETRY' });
    assert.equal(linked.connected, true);
    assert.equal(queued.generation_executed, false);
});
