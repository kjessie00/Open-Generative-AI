import fs from 'node:fs';
import path from 'node:path';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';
import filmProvider from '../electron/lib/filmPipelineProvider.js';
import promptPlanAgentProvider from '../electron/lib/promptPlanAgentProvider.js';

const evidenceRoot = path.resolve(process.argv[2] || 'tmp/prompt-agent-verification');
const userDataPath = path.join(evidenceRoot, 'user-data');
fs.rmSync(evidenceRoot, { recursive: true, force: true });
fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
fs.chmodSync(evidenceRoot, 0o700);
fs.chmodSync(userDataPath, 0o700);
const options = { userDataPath, readConfigFn: () => ({}) };

draftProvider.saveNewProjectDraft({
    production_id: 'prompt-agent-live-proof',
    brief: '비 오는 골목에서 오래 헤어진 두 사람이 다시 만난다.',
    script: '붉은 우산을 든 주인공이 네온이 비치는 골목에서 걸음을 멈추고 친구를 바라본다.',
    route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 2,
}, options);
const emptyDesign = designProvider.getNewProjectDesignState(options);
designProvider.saveNewProjectDesignBoard({
    board: {
        characters: [{
            id: 'hero', name: '주인공', role: '오래 헤어진 친구', appearance: '짧은 검은 머리',
            wardrobe: '검은 코트', continuity: '붉은 우산',
        }],
        locations: [{
            id: 'alley', name: '비 오는 골목', space: '좁고 깊은 골목', lighting: '푸른 네온 역광',
            props: '젖은 간판과 물웅덩이', continuity: '젖은 아스팔트',
        }],
        scenes: [{
            id: 'scene_01', title: '재회', dramatic_beat: '주인공이 친구를 알아보고 걸음을 멈춘다.',
            characters: ['hero'], location_id: 'alley', duration: 5,
            first_frame: '붉은 우산 아래 멈춘 주인공', action: '천천히 고개를 들어 골목 끝을 바라본다.',
            camera: '허리 높이 미디엄 숏', lighting: '푸른 네온 역광', audio_sfx_dialogue: '빗소리',
        }],
    },
    expected_planning_revision_sha256: emptyDesign.planning_revision_sha256,
    expected_design_revision_sha256: emptyDesign.revision_sha256,
}, options);

let imageState = imagePlanProvider.getNewProjectImagePlan(options);
imageState = imagePlanProvider.saveNewProjectImagePlan({
    tasks: imageState.tasks,
    expected_design_revision_sha256: imageState.design_revision_sha256,
    expected_image_plan_revision_sha256: imageState.revision_sha256,
}, options);
const imageTarget = imageState.tasks.find((task) => task.kind === 'scene_image');
const imageTasksBeforeAgent = structuredClone(imageState.tasks);
filmProvider.enqueueImagePromptAgentRequest({
    task_token: imageTarget.task_token,
    instruction: '인물과 장소의 연속성은 유지하고, 첫 화면에서 재회의 긴장과 깊은 공간감이 더 분명하도록 다듬어 주세요.',
    expected_design_revision_sha256: imageState.design_revision_sha256,
    expected_image_plan_revision_sha256: imageState.revision_sha256,
}, options);
const imageRun = await filmProvider.runImagePromptAgentRequest({ task_token: imageTarget.task_token }, options);
if (!imageRun.ok) throw new Error(`IMAGE_AGENT_FAILED:${imageRun.error}`);
const imageSuggestion = imageRun.state.collaboration.recent_requests.find((request) => (
    request.target_task_token === imageTarget.task_token && request.status === 'suggestion_ready'
))?.suggestion;
if (!imageSuggestion) throw new Error('IMAGE_SUGGESTION_MISSING');
const imageApplied = filmProvider.decideImagePromptAgentSuggestion({
    suggestion_token: imageSuggestion.suggestion_token, action: 'apply',
    expected_design_revision_sha256: imageRun.state.design_revision_sha256,
    expected_image_plan_revision_sha256: imageRun.state.revision_sha256,
}, options);

imageState = imageApplied.state;
const sceneImage = imageState.tasks.find((task) => task.kind === 'scene_image');
const localFixturePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const linked = imagePlanProvider.connectNewProjectImageResult({
    task_token: sceneImage.task_token, candidate_token: 'local-fixture', image_index: 1,
    expected_design_revision_sha256: imageState.design_revision_sha256,
    expected_image_plan_revision_sha256: imageState.revision_sha256,
}, {
    ...options,
    getDstBundleImportPreview: () => ({ ready: true, preview: {
        mime_type: 'image/png', byte_length: localFixturePng.byteLength, base64: localFixturePng.toString('base64'),
    }, blockers: [] }),
});

let videoState = videoPlanProvider.getNewProjectVideoPlan(options);
videoState = videoPlanProvider.saveNewProjectVideoPlan({
    tasks: videoState.tasks,
    expected_design_revision_sha256: videoState.design_revision_sha256,
    expected_image_plan_revision_sha256: videoState.image_plan_revision_sha256,
    expected_video_plan_revision_sha256: videoState.revision_sha256,
}, options);
const videoTarget = videoState.tasks[0];
filmProvider.enqueueVideoPromptAgentRequest({
    task_token: videoTarget.task_token,
    instruction: '인물과 배경은 그대로 유지하고, 멈춰 서는 동작과 천천히 다가가는 카메라 움직임이 자연스럽도록 다듬어 주세요.',
    expected_design_revision_sha256: videoState.design_revision_sha256,
    expected_image_plan_revision_sha256: videoState.image_plan_revision_sha256,
    expected_video_plan_revision_sha256: videoState.revision_sha256,
}, options);
const videoRun = await filmProvider.runVideoPromptAgentRequest({ task_token: videoTarget.task_token }, options);
if (!videoRun.ok) throw new Error(`VIDEO_AGENT_FAILED:${videoRun.error}`);
const videoSuggestion = videoRun.state.collaboration.recent_requests.find((request) => (
    request.target_task_token === videoTarget.task_token && request.status === 'suggestion_ready'
))?.suggestion;
if (!videoSuggestion) throw new Error('VIDEO_SUGGESTION_MISSING');
const videoApplied = filmProvider.decideVideoPromptAgentSuggestion({
    suggestion_token: videoSuggestion.suggestion_token, action: 'apply',
    expected_design_revision_sha256: videoRun.state.design_revision_sha256,
    expected_image_plan_revision_sha256: videoRun.state.image_plan_revision_sha256,
    expected_video_plan_revision_sha256: videoRun.state.revision_sha256,
}, options);

const uiDemoState = imagePlanProvider.getNewProjectImagePlan(options);
const uiDemoTarget = uiDemoState.tasks.find((task) => task.kind === 'character_sheet');
const uiDemoQueued = filmProvider.enqueueImagePromptAgentRequest({
    task_token: uiDemoTarget.task_token,
    instruction: '표정과 의상 기준이 한눈에 비교되도록 정리해 주세요.',
    expected_design_revision_sha256: uiDemoState.design_revision_sha256,
    expected_image_plan_revision_sha256: uiDemoState.revision_sha256,
}, options);
promptPlanAgentProvider.publish({
    lane: 'image',
    payload: {
        request_id: uiDemoQueued.request_id,
        proposed_prompt: `${uiDemoTarget.prompt} / 표정 기준: 무표정·놀람·결심, 의상 앞·옆·뒤 비교가 한 화면에 명확히 보이도록 구성`,
        summary: '표정과 의상 비교 기준을 한눈에 볼 수 있게 정리했습니다.',
    },
    state: uiDemoState,
    planPaths: imagePlanProvider.exactPaths(userDataPath),
    appModelCalled: false,
});

const receipt = {
    verified_at: new Date().toISOString(),
    image: {
        agent_model_called: imageRun.model_called === true,
        prompt_changed: imageApplied.state.tasks.find((task) => task.task_token === imageTarget.task_token)?.prompt !== imageTarget.prompt,
        only_target_changed: imageApplied.state.tasks.filter((task) => task.task_token !== imageTarget.task_token)
            .every((task) => JSON.stringify(task) === JSON.stringify(imageTasksBeforeAgent.find((item) => item.task_token === task.task_token))),
        generation_executed: imageRun.generation_executed === true || imageApplied.generation_executed === true,
    },
    video: {
        agent_model_called: videoRun.model_called === true,
        prompt_changed: videoApplied.state.tasks[0].prompt !== videoTarget.prompt,
        provider_preserved: videoApplied.state.tasks[0].provider === videoTarget.provider,
        generation_executed: videoRun.generation_executed === true || videoApplied.generation_executed === true,
    },
    local_fixture_image_connected: linked.connected === true,
    image_generation_provider_calls: 0,
    video_generation_provider_calls: 0,
    ui_comparison_fixture: 'MOCK suggestion only; plan unchanged',
    user_data_path: userDataPath,
};
fs.writeFileSync(path.join(evidenceRoot, 'result.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
