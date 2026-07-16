import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';
import executionProvider from '../electron/lib/newProjectExecutionProvider.js';
import filmPipelineProvider from '../electron/lib/filmPipelineProvider.js';

const evidenceRoot = path.resolve(process.argv[2] || 'tmp/replicate-request-preview');
let userDataPath = path.join(evidenceRoot, 'user-data');
const context = { userDataPath };
const cliPath = path.resolve('scripts/new-project-execution-handoff.cjs');
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

function revisions(state) {
    return {
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: state.revision_sha256,
    };
}

function inspect() {
    const result = spawnSync(process.execPath, [cliPath, 'inspect', '--user-data', userDataPath], {
        cwd: path.resolve('.'), encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    if (result.status !== 0) fail(`REPLICATE_REQUEST_PREVIEW_CLI_FAILED:${result.stderr.trim()}`);
    return JSON.parse(result.stdout).handoff;
}

fs.rmSync(evidenceRoot, { recursive: true, force: true });
fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
fs.chmodSync(evidenceRoot, 0o700);
fs.chmodSync(userDataPath, 0o700);
userDataPath = fs.realpathSync.native(userDataPath);
context.userDataPath = userDataPath;

draftProvider.saveNewProjectDraft({
    production_id: 'replicate-request-preview-proof',
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
imageExecution = executionProvider.prepareNewProjectExecution({
    expected_revision_sha256: imageExecution.revision_sha256, new_attempt: false,
}, context);
const sceneImage = imageState.tasks.find((task) => task.kind === 'scene_image');
imageState = imagePlanProvider.connectNewProjectImageResult({
    task_token: sceneImage.task_token, candidate_token: 'replicate-preview-png', image_index: 1,
    expected_design_revision_sha256: imageState.design_revision_sha256,
    expected_image_plan_revision_sha256: imageState.revision_sha256,
}, imageContext).state;

let videoState = videoPlanProvider.getNewProjectVideoPlan(context);
videoState = videoPlanProvider.saveNewProjectVideoPlan({
    tasks: videoState.tasks.map((task) => ({ ...task, provider: 'replicate', provider_label: 'Replicate' })),
    ...revisions(videoState),
}, context);
videoPlanProvider.prepareNewProjectVideoPlan(revisions(videoState), context);
let executionState = executionProvider.getNewProjectExecutionState(context);
executionState = executionProvider.prepareNewProjectExecution({
    expected_revision_sha256: executionState.revision_sha256, new_attempt: false,
}, context);
if (!executionState.prepared) fail('REPLICATE_REQUEST_PREVIEW_NOT_PREPARED');

const firstHandoff = inspect();
const task = firstHandoff.tasks.find((item) => item.provider === 'replicate');
if (!task) fail('REPLICATE_REQUEST_PREVIEW_TASK_MISSING');
const preview = task.provider_execution_preview;
const request = preview.request_spec;
const paths = executionProvider.exactPaths(userDataPath, `run_${task.run_revision_sha256}`);
const outputPath = path.join(paths.outputsRoot, `${task.task_token}.mp4`);
const claimPath = task.output_claim_path;
const expectedImage = `data:image/png;base64,${png.toString('base64')}`;
const expectedBase = {
    model_slug: 'bytedance/seedance-1-pro', method: 'POST',
    url: 'https://api.replicate.com/v1/models/bytedance/seedance-1-pro/predictions',
    header_names: ['Authorization', 'Content-Type', 'Prefer'],
    headers: { 'Content-Type': 'application/json', Prefer: 'wait' },
    authorization_env: 'REPLICATE_API_TOKEN',
    body: { input: {
        prompt: task.prompt, image: expectedImage, duration: 5,
        resolution: '1080p', fps: 24, camera_fixed: false,
    } },
    preview_only: true, live_submit_allowed: false, external_call_performed: false,
};
const expectedRequest = { ...expectedBase, request_revision_sha256: sha256(JSON.stringify(expectedBase)) };
const claimText = fs.readFileSync(claimPath, 'utf8');
const claim = JSON.parse(claimText);
const claimStats = fs.lstatSync(claimPath);
let exclusiveRecreateBlocked = false;
try {
    const descriptor = fs.openSync(claimPath, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.closeSync(descriptor);
} catch (error) {
    exclusiveRecreateBlocked = error.code === 'EEXIST';
}
const secondHandoff = inspect();
const secondTask = secondHandoff.tasks.find((item) => item.provider === 'replicate');
const publicState = filmPipelineProvider.getNewProjectExecutionState(context);
const publicTask = publicState.tasks.find((item) => item.lane === 'video');
const publicJson = JSON.stringify(publicState);
const privateValuesAbsent = [task.task_token, request.request_revision_sha256, claimPath, outputPath, expectedImage]
    .every((value) => !publicJson.includes(value));
const receipt = {
    prepared: executionState.prepared,
    task_count: firstHandoff.tasks.length,
    provider: task.provider,
    reference_count: task.reference_files.length,
    duration_seconds: task.duration_seconds,
    preview_readiness: preview.readiness,
    blockers: preview.blockers,
    request_exact: JSON.stringify(request) === JSON.stringify(expectedRequest),
    request_revision_matches: request.request_revision_sha256 === sha256(JSON.stringify(expectedBase)),
    data_uri_bytes: Buffer.byteLength(expectedImage, 'utf8'),
    aspect_ratio_absent: !Object.hasOwn(request.body.input, 'aspect_ratio'),
    command_empty: preview.command_spec.command === '' && preview.command_spec.args.length === 0,
    copy_allowed: preview.command_spec.copy_allowed,
    live_submit_allowed: request.live_submit_allowed,
    claim_schema: claim.schema_version,
    claim_mode: claimStats.mode & 0o777,
    claim_is_file: claimStats.isFile() && !claimStats.isSymbolicLink(),
    claim_exact: claim.run_revision_sha256 === task.run_revision_sha256
        && claim.task_token === task.task_token
        && claim.request_revision_sha256 === request.request_revision_sha256
        && claim.output_basename === `${task.task_token}.mp4`,
    claim_exclusive_recreate_blocked: exclusiveRecreateBlocked,
    output_target_absent: !fs.existsSync(outputPath),
    stable_request: JSON.stringify(request) === JSON.stringify(secondTask.provider_execution_preview.request_spec),
    stable_claim: fs.readFileSync(claimPath, 'utf8') === claimText,
    stable_claim_inode: fs.lstatSync(claimPath).ino === claimStats.ino,
    public_mode: publicTask.execution_preview.mode,
    public_status_label: publicTask.execution_preview.status_label,
    public_user_status: publicTask.execution_preview.user_status,
    public_next_action: publicTask.execution_preview.next_action,
    public_private_values_absent: privateValuesAbsent,
    external_call_performed: firstHandoff.external_call_performed,
    model_called: firstHandoff.model_called,
    generation_executed: firstHandoff.generation_executed,
    provider_generation_calls: 0,
    user_data_path: userDataPath,
};
if (receipt.provider !== 'replicate' || receipt.reference_count !== 1 || receipt.duration_seconds !== 5
    || receipt.preview_readiness !== 'preview_ready' || receipt.blockers.length !== 0
    || !receipt.request_exact || !receipt.request_revision_matches || receipt.data_uri_bytes > 1024 * 1024
    || !receipt.aspect_ratio_absent || !receipt.command_empty || receipt.copy_allowed
    || receipt.live_submit_allowed || receipt.claim_schema !== executionProvider.REPLICATE_CLAIM_SCHEMA
    || receipt.claim_mode !== 0o600 || !receipt.claim_is_file || !receipt.claim_exact
    || !receipt.claim_exclusive_recreate_blocked || !receipt.output_target_absent
    || !receipt.stable_request || !receipt.stable_claim || !receipt.stable_claim_inode
    || receipt.public_mode !== 'preview_ready' || receipt.public_status_label !== '요청 내용 확인 가능'
    || receipt.public_user_status !== 'Replicate에 보낼 영상 요청이 준비되었습니다. 아직 전송되지 않았습니다.'
    || receipt.public_next_action !== '영상 작업에서 프롬프트·길이·첫 화면을 확인하세요.'
    || !receipt.public_private_values_absent || receipt.external_call_performed
    || receipt.model_called || receipt.generation_executed) {
    fail('REPLICATE_REQUEST_PREVIEW_VERIFICATION_FAILED', receipt);
}

fs.writeFileSync(path.join(evidenceRoot, 'result.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600, flag: 'wx',
});
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
