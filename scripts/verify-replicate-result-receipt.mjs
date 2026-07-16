import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';
import executionProvider from '../electron/lib/newProjectExecutionProvider.js';

const evidenceRoot = path.resolve(process.argv[2] || 'tmp/replicate-result-receipt');
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

function fail(code, details = null) {
    throw new Error(details ? `${code}:${JSON.stringify(details)}` : code);
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

for (const required of [sourceVideoPath, ffprobePath]) {
    const stats = fs.lstatSync(required);
    if (!stats.isFile() || stats.isSymbolicLink()) fail('REPLICATE_RESULT_RECEIPT_LOCAL_INPUT_UNSAFE');
}

fs.rmSync(evidenceRoot, { recursive: true, force: true });
for (const directory of [userDataPath, flowResultsRoot, grokResultsRoot, replicateResultsRoot,
    replicateReceiptResultsRoot, bytedanceReceiptResultsRoot]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
}
fs.writeFileSync(path.join(replicateRunRoot, 'run_status.md'), 'Local receipt producer fixture\n', {
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
    ffprobePath,
    tokenSecret: Buffer.alloc(32, 41),
};

draftProvider.saveNewProjectDraft({
    production_id: 'replicate-result-receipt-proof',
    brief: '비 오는 현장에서 안전을 선택하는 장면을 만든다.',
    script: '붉은 장갑의 주인공이 사다리차를 붙들어 위험을 막는다.',
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
const initialImageExecution = executionProvider.getNewProjectExecutionState(context);
executionProvider.prepareNewProjectExecution({
    expected_revision_sha256: initialImageExecution.revision_sha256,
    new_attempt: false,
}, context);
const sceneImage = imageState.tasks.find((task) => task.kind === 'scene_image');
imageState = imagePlanProvider.connectNewProjectImageResult({
    task_token: sceneImage.task_token,
    candidate_token: 'replicate-result-receipt-png',
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
const initialExecution = executionProvider.getNewProjectExecutionState(context);
executionProvider.prepareNewProjectExecution({
    expected_revision_sha256: initialExecution.revision_sha256,
    new_attempt: false,
}, context);
const handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
const task = handoff.tasks.find((item) => item.provider === 'replicate');
if (!task) fail('REPLICATE_RESULT_RECEIPT_TASK_MISSING');

fs.copyFileSync(sourceVideoPath, task.output_path, fs.constants.COPYFILE_EXCL);
fs.chmodSync(task.output_path, 0o600);
const sourceBytes = fs.readFileSync(sourceVideoPath);
const metadata = {
    schema_version: executionProvider.REPLICATE_DOWNLOAD_RESULT_SCHEMA,
    run_revision_sha256: task.run_revision_sha256,
    task_token: task.task_token,
    prediction_id: 'prediction_actual_local_001',
    status: 'succeeded',
    completed_at: '2026-07-16T05:00:00.000Z',
};
const published = executionProvider.publishReplicateResultReceipt(metadata, context);
const repeated = executionProvider.publishReplicateResultReceipt(metadata, context);
const resultRoot = path.join(replicateReceiptResultsRoot, metadata.prediction_id);
const resultPath = path.join(resultRoot, 'result.mp4');
const receiptPath = path.join(resultRoot, 'receipt.json');
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const locator = `replicate:${metadata.prediction_id}:${sha256(sourceBytes)}`;
const resolved = executionProvider.publishExecutionReceipt({
    schema_version: executionProvider.RECEIPT_SCHEMA,
    run_revision_sha256: task.run_revision_sha256,
    task_token: task.task_token,
    status: 'running', progress: 50, failure_code: '', result_received: false,
    result_locator: '', external_call_performed: false, model_called: false,
    generation_executed: false, reported_at: '2026-07-16T05:01:00.000Z',
}, context);
if (!resolved.ok) fail('REPLICATE_RESULT_RECEIPT_RUNNING_PUBLISH_FAILED');
const completed = executionProvider.publishExecutionReceipt({
    schema_version: executionProvider.RECEIPT_SCHEMA,
    run_revision_sha256: task.run_revision_sha256,
    task_token: task.task_token,
    status: 'succeeded', progress: 100, failure_code: '', result_received: true,
    result_locator: locator, external_call_performed: false, model_called: false,
    generation_executed: false, reported_at: '2026-07-16T05:02:00.000Z',
}, context).state;
const completedTask = completed.tasks.find((item) => item.lane === 'video');
const relaunchedTask = executionProvider.getNewProjectExecutionState({
    ...context,
    tokenSecret: Buffer.alloc(32, 42),
}).tasks.find((item) => item.lane === 'video');
const receiptKeys = Object.keys(receipt).sort();
const expectedReceiptKeys = [
    'completed_at', 'output_claim_sha256', 'output_file', 'output_sha256', 'output_size_bytes',
    'provider', 'request_revision_sha256', 'result_id', 'run_revision_sha256', 'schema_version',
    'status', 'task_token',
].sort();
const result = {
    schema_version: executionProvider.REPLICATE_DOWNLOAD_RESULT_SCHEMA,
    actual_local_video_bytes: sourceBytes.byteLength,
    actual_local_video_sha256: sha256(sourceBytes),
    actual_ffprobe_path: ffprobePath,
    producer_created: published.ok && published.already_published === false,
    producer_idempotent: repeated.ok && repeated.already_published === true,
    deterministic_source_only: !Object.hasOwn(metadata, 'source_path')
        && !Object.hasOwn(metadata, 'url') && !Object.hasOwn(metadata, 'token'),
    exact_v2_receipt: JSON.stringify(receiptKeys) === JSON.stringify(expectedReceiptKeys)
        && receipt.schema_version === 'film_pipeline.external_video_result.v2',
    exact_bytes_preserved: fs.readFileSync(resultPath).equals(sourceBytes)
        && receipt.output_sha256 === sha256(sourceBytes)
        && receipt.output_size_bytes === sourceBytes.byteLength,
    private_modes: (fs.lstatSync(resultRoot).mode & 0o777) === 0o700
        && (fs.lstatSync(resultPath).mode & 0o777) === 0o600
        && (fs.lstatSync(receiptPath).mode & 0o777) === 0o600,
    result_ready: completedTask?.result_match_status === 'ready' && Boolean(completedTask.result_candidate_token),
    relaunch_ready: relaunchedTask?.result_match_status === 'ready' && Boolean(relaunchedTask.result_candidate_token),
    candidate_token_rotated: completedTask?.result_candidate_token !== relaunchedTask?.result_candidate_token,
    external_call_performed: false,
    model_called: false,
    generation_executed: false,
};
if (Object.entries(result).some(([key, value]) => key.endsWith('_path') ? false
    : ['actual_local_video_bytes', 'actual_local_video_sha256', 'schema_version'].includes(key) ? false
        : value !== true && value !== false)
    || !result.producer_created || !result.producer_idempotent || !result.deterministic_source_only
    || !result.exact_v2_receipt || !result.exact_bytes_preserved || !result.private_modes
    || !result.result_ready || !result.relaunch_ready || !result.candidate_token_rotated
    || result.external_call_performed || result.model_called || result.generation_executed) {
    fail('REPLICATE_RESULT_RECEIPT_VERIFICATION_FAILED', result);
}
fs.writeFileSync(path.join(evidenceRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
