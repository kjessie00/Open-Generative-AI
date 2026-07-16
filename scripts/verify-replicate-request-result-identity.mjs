import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';
import executionProvider from '../electron/lib/newProjectExecutionProvider.js';
import videoResultProvider from '../electron/lib/videoResultImportProvider.js';
import filmPipelineProvider from '../electron/lib/filmPipelineProvider.js';

const evidenceRoot = path.resolve(process.argv[2] || 'tmp/replicate-request-result-identity');
const sourceVideoPath = fs.realpathSync.native(path.resolve(process.argv[3]
    || '/Users/jessiek/StudioProjects/happyVideoFactory/docs/xhs_ad_tests/20260515_smart_doorbell_ai_reversal/replicate_seedance_clips/seedance_1.mp4'));
const ffprobePath = fs.realpathSync.native(path.resolve(process.argv[4] || [
    '/opt/homebrew/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/usr/local/anaconda3/bin/ffprobe',
].find((candidate) => fs.existsSync(candidate)) || '/opt/homebrew/bin/ffprobe'));
const userDataPath = path.join(evidenceRoot, 'user-data');
const flowResultsRoot = path.join(evidenceRoot, 'provider-results', 'flow');
const grokResultsRoot = path.join(evidenceRoot, 'provider-results', 'grok');
const replicateRunRoot = path.join(evidenceRoot, 'provider-results', 'replicate-history');
const replicateResultsRoot = path.join(replicateRunRoot, 'replicate_seedance_clips');
const replicateReceiptResultsRoot = path.join(evidenceRoot, 'provider-results', 'replicate-receipts');
const bytedanceReceiptResultsRoot = path.join(evidenceRoot, 'provider-results', 'bytedance-receipts');
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

function fail(code, receipt = null) {
    throw new Error(receipt ? `${code}:${JSON.stringify(receipt)}` : code);
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function writeExternalResult(resultId, schemaVersion, binding, videoBytes) {
    const resultRoot = path.join(replicateReceiptResultsRoot, resultId);
    fs.mkdirSync(resultRoot, { mode: 0o700 });
    fs.writeFileSync(path.join(resultRoot, 'result.mp4'), videoBytes, { mode: 0o600, flag: 'wx' });
    const receipt = {
        schema_version: schemaVersion,
        provider: 'replicate',
        result_id: resultId,
        status: 'succeeded',
        output_file: 'result.mp4',
        output_sha256: sha256(videoBytes),
        output_size_bytes: videoBytes.byteLength,
        completed_at: '2026-07-16T03:00:00.000Z',
        ...(schemaVersion === videoResultProvider.EXTERNAL_RESULT_SCHEMA_V2 ? binding : {}),
    };
    fs.writeFileSync(path.join(resultRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
    });
    return `replicate:${resultId}:${receipt.output_sha256}`;
}

for (const required of [sourceVideoPath, ffprobePath]) {
    const stats = fs.lstatSync(required);
    if (!stats.isFile() || stats.isSymbolicLink()) fail('REPLICATE_RESULT_IDENTITY_LOCAL_INPUT_UNSAFE');
}

fs.rmSync(evidenceRoot, { recursive: true, force: true });
for (const directory of [userDataPath, flowResultsRoot, grokResultsRoot, replicateResultsRoot,
    replicateReceiptResultsRoot, bytedanceReceiptResultsRoot]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
}
fs.writeFileSync(path.join(replicateRunRoot, 'run_status.md'), 'Local identity verifier fixture\n', {
    mode: 0o600,
    flag: 'wx',
});

const context = {
    userDataPath: fs.realpathSync.native(userDataPath),
    flowResultsRoot: fs.realpathSync.native(flowResultsRoot),
    grokResultsRoot: fs.realpathSync.native(grokResultsRoot),
    replicateResultsRoot: fs.realpathSync.native(replicateResultsRoot),
    replicateReceiptResultsRoot: fs.realpathSync.native(replicateReceiptResultsRoot),
    bytedanceReceiptResultsRoot: fs.realpathSync.native(bytedanceReceiptResultsRoot),
    ffprobePath: fs.realpathSync.native(ffprobePath),
    tokenSecret: Buffer.alloc(32, 31),
};

draftProvider.saveNewProjectDraft({
    production_id: 'replicate-request-result-identity-proof',
    brief: '비 오는 작업 현장에서 안전을 선택하는 한 장면을 만든다.',
    script: '붉은 장갑을 낀 주인공이 사다리차를 붙들고 위험을 막는다.',
    route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 1,
}, context);
const emptyDesign = designProvider.getNewProjectDesignState(context);
designProvider.saveNewProjectDesignBoard({
    board: {
        characters: [{
            id: 'hero', name: '주인공', role: '현장 책임자', appearance: '짧은 검은 머리',
            wardrobe: '남색 작업복', continuity: '붉은 장갑',
        }],
        locations: [{
            id: 'site', name: '비 오는 현장', space: '좁은 골목', lighting: '차가운 새벽빛',
            props: '사다리차', continuity: '젖은 난간',
        }],
        scenes: [{
            id: 'scene_01', title: '안전의 기준', dramatic_beat: '위험을 본다.', characters: ['hero'],
            location_id: 'site', duration: 5, first_frame: '빗속 사다리차 앞의 주인공',
            action: '주인공이 사다리차를 붙든다.', camera: '낮은 앵글',
            lighting: '청회색 역광', audio_sfx_dialogue: '거센 빗소리',
        }],
    },
    expected_planning_revision_sha256: emptyDesign.planning_revision_sha256,
    expected_design_revision_sha256: emptyDesign.revision_sha256,
}, context);

const imageContext = {
    ...context,
    getDstBundleImportPreview: () => ({
        ready: true,
        preview: { mime_type: 'image/png', byte_length: png.byteLength, base64: png.toString('base64') },
        blockers: [],
    }),
};
let imageState = imagePlanProvider.getNewProjectImagePlan(imageContext);
imageState = imagePlanProvider.saveNewProjectImagePlan({
    tasks: imageState.tasks,
    expected_design_revision_sha256: imageState.design_revision_sha256,
    expected_image_plan_revision_sha256: imageState.revision_sha256,
}, imageContext);
imagePlanProvider.prepareNewProjectImagePlan({
    expected_design_revision_sha256: imageState.design_revision_sha256,
    expected_image_plan_revision_sha256: imageState.revision_sha256,
}, imageContext);
let imageExecution = executionProvider.getNewProjectExecutionState(context);
executionProvider.prepareNewProjectExecution({
    expected_revision_sha256: imageExecution.revision_sha256,
    new_attempt: false,
}, context);
const sceneImage = imageState.tasks.find((task) => task.kind === 'scene_image');
imageState = imagePlanProvider.connectNewProjectImageResult({
    task_token: sceneImage.task_token,
    candidate_token: 'replicate-result-identity-png',
    image_index: 1,
    expected_design_revision_sha256: imageState.design_revision_sha256,
    expected_image_plan_revision_sha256: imageState.revision_sha256,
}, imageContext).state;

let videoState = videoPlanProvider.getNewProjectVideoPlan(context);
videoState = videoPlanProvider.saveNewProjectVideoPlan({
    tasks: videoState.tasks.map((task) => ({ ...task, provider: 'replicate', provider_label: 'Replicate' })),
    expected_design_revision_sha256: videoState.design_revision_sha256,
    expected_image_plan_revision_sha256: videoState.image_plan_revision_sha256,
    expected_video_plan_revision_sha256: videoState.revision_sha256,
}, context);
videoPlanProvider.prepareNewProjectVideoPlan({
    expected_design_revision_sha256: videoState.design_revision_sha256,
    expected_image_plan_revision_sha256: videoState.image_plan_revision_sha256,
    expected_video_plan_revision_sha256: videoState.revision_sha256,
}, context);
let executionState = executionProvider.getNewProjectExecutionState(context);
executionState = executionProvider.prepareNewProjectExecution({
    expected_revision_sha256: executionState.revision_sha256,
    new_attempt: false,
}, context);
if (!executionState.prepared) fail('REPLICATE_RESULT_IDENTITY_NOT_PREPARED');

const handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
const task = handoff.tasks.find((item) => item.provider === 'replicate');
if (!task) fail('REPLICATE_RESULT_IDENTITY_TASK_MISSING');
const requestRevision = task.provider_execution_preview.request_spec.request_revision_sha256;
const claimBytes = fs.readFileSync(task.output_claim_path);
const binding = {
    run_revision_sha256: task.run_revision_sha256,
    task_token: task.task_token,
    request_revision_sha256: requestRevision,
    output_claim_sha256: sha256(claimBytes),
};
const videoBytes = fs.readFileSync(sourceVideoPath);
const manualLocator = writeExternalResult(
    'mock_prediction_manual_v1',
    videoResultProvider.EXTERNAL_RESULT_SCHEMA,
    binding,
    videoBytes,
);
const exactLocator = writeExternalResult(
    'mock_prediction_exact_v2',
    videoResultProvider.EXTERNAL_RESULT_SCHEMA_V2,
    binding,
    videoBytes,
);

const running = {
    schema_version: executionProvider.RECEIPT_SCHEMA,
    run_revision_sha256: task.run_revision_sha256,
    task_token: task.task_token,
    status: 'running', progress: 50, failure_code: '', result_received: false,
    result_locator: '', external_call_performed: false, model_called: false,
    generation_executed: false, reported_at: '2026-07-16T03:01:00.000Z',
};
executionProvider.publishExecutionReceipt(running, context);
const succeeded = (locator) => ({
    ...running,
    status: 'succeeded', progress: 100, result_received: true, result_locator: locator,
    reported_at: '2026-07-16T03:02:00.000Z',
});
let v1AutomaticBlocker = '';
try {
    executionProvider.publishExecutionReceipt(succeeded(manualLocator), context);
} catch (error) {
    v1AutomaticBlocker = error.code || error.message;
}
const published = executionProvider.publishExecutionReceipt(succeeded(exactLocator), context).state;
const publishedTask = published.tasks.find((item) => item.lane === 'video');
const relaunchedContext = { ...context, tokenSecret: Buffer.alloc(32, 32) };
const relaunched = executionProvider.getNewProjectExecutionState(relaunchedContext);
const relaunchedTask = relaunched.tasks.find((item) => item.lane === 'video');
fs.unlinkSync(task.output_claim_path);
const missingClaimState = executionProvider.getNewProjectExecutionState({
    ...context,
    tokenSecret: Buffer.alloc(32, 33),
});
const missingClaimTask = missingClaimState.tasks.find((item) => item.lane === 'video');
fs.writeFileSync(task.output_claim_path, claimBytes, { mode: 0o600, flag: 'wx' });
const restoredClaimTask = executionProvider.getNewProjectExecutionState({
    ...context,
    tokenSecret: Buffer.alloc(32, 34),
}).tasks.find((item) => item.lane === 'video');
const renderer = filmPipelineProvider.getNewProjectExecutionState(relaunchedContext);
const rendererJson = JSON.stringify(renderer);
const publicPrivateValuesAbsent = [
    binding.run_revision_sha256,
    binding.task_token,
    binding.request_revision_sha256,
    binding.output_claim_sha256,
    'mock_prediction_exact_v2',
].every((value) => !rendererJson.includes(value));
const manualResolution = videoResultProvider.resolveVideoExecutionResultLocator(manualLocator, context);

const receipt = {
    schema_version: videoResultProvider.EXTERNAL_RESULT_SCHEMA_V2,
    actual_local_video_bytes: videoBytes.byteLength,
    actual_local_video_sha256: sha256(videoBytes),
    actual_ffprobe_path: context.ffprobePath,
    v1_manual_resolution_ready: Boolean(manualResolution?.candidate_token),
    v1_automatic_blocker: v1AutomaticBlocker,
    v2_execution_result_ready: publishedTask?.result_match_status === 'ready',
    relaunch_result_ready: relaunchedTask?.result_match_status === 'ready',
    relaunch_candidate_token_rotated: publishedTask?.result_candidate_token
        !== relaunchedTask?.result_candidate_token,
    missing_claim_success_preserved_waiting: missingClaimTask?.status === 'succeeded'
        && missingClaimTask?.result_match_status === 'waiting'
        && !missingClaimTask?.result_candidate_token,
    restored_claim_result_ready: restoredClaimTask?.status === 'succeeded'
        && restoredClaimTask?.result_match_status === 'ready'
        && Boolean(restoredClaimTask?.result_candidate_token),
    public_private_values_absent: publicPrivateValuesAbsent,
    external_call_performed: false,
    model_called: false,
    generation_executed: false,
    provider_generation_calls: 0,
};

if (receipt.actual_local_video_bytes <= 0
    || !/^[a-f0-9]{64}$/.test(receipt.actual_local_video_sha256)
    || !receipt.v1_manual_resolution_ready
    || receipt.v1_automatic_blocker !== 'EXECUTION_REPLICATE_RESULT_BINDING_REQUIRED'
    || !receipt.v2_execution_result_ready
    || !receipt.relaunch_result_ready
    || !receipt.relaunch_candidate_token_rotated
    || !receipt.missing_claim_success_preserved_waiting
    || !receipt.restored_claim_result_ready
    || !receipt.public_private_values_absent
    || receipt.external_call_performed || receipt.model_called || receipt.generation_executed) {
    fail('REPLICATE_REQUEST_RESULT_IDENTITY_VERIFICATION_FAILED', receipt);
}

fs.writeFileSync(path.join(evidenceRoot, 'result.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
});
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
