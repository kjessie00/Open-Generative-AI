import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';

const evidenceRoot = path.resolve(process.argv[2] || 'tmp/new-project-review-board');
const mode = process.argv[3] || 'seed';
const userDataPath = path.join(evidenceRoot, 'user-data');
const context = { userDataPath };
const ffmpeg = '/usr/local/anaconda3/bin/ffmpeg';
let png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function writeReceipt(name, value) {
    fs.writeFileSync(path.join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function imageContext() {
    return {
        ...context,
        getDstBundleImportPreview: () => ({
            ready: true,
            preview: { mime_type: 'image/png', byte_length: png.byteLength, base64: png.toString('base64') },
            blockers: [],
        }),
    };
}

function videoRevisions(state) {
    return {
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: state.revision_sha256,
    };
}

if (mode === 'seed') {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
    fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    fs.chmodSync(evidenceRoot, 0o700);
    fs.chmodSync(userDataPath, 0o700);

    const sourceImage = path.join(evidenceRoot, 'synthetic-result.png');
    const generatedImage = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=0x8f3f5f:s=360x640', '-frames:v', '1', sourceImage,
    ], { encoding: 'utf8' });
    if (generatedImage.status !== 0) throw new Error(`REVIEW_BOARD_IMAGE_FAILED:${generatedImage.stderr.trim()}`);
    fs.chmodSync(sourceImage, 0o600);
    png = fs.readFileSync(sourceImage);

    draftProvider.saveNewProjectDraft({
        production_id: 'storyboard-review-proof',
        brief: '비 오는 네온 골목에서 오래 헤어진 두 사람이 다시 만난다.',
        script: '붉은 우산을 든 주인공이 걸음을 멈추고 골목 끝의 친구를 바라본다.',
        route: 'both', aspect_ratio: '9:16', scene_duration: 6, max_scenes: 1,
    }, context);
    const emptyDesign = designProvider.getNewProjectDesignState(context);
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
                id: 'scene_01', title: '재회', dramatic_beat: '두 사람이 마주친다.',
                characters: ['hero'], location_id: 'alley', duration: 6,
                first_frame: '붉은 우산 아래 멈춘 주인공', action: '천천히 고개를 들어 골목 끝을 바라본다.',
                camera: '허리 높이 미디엄 숏', lighting: '푸른 네온 역광', audio_sfx_dialogue: '빗소리',
            }],
        },
        expected_planning_revision_sha256: emptyDesign.planning_revision_sha256,
        expected_design_revision_sha256: emptyDesign.revision_sha256,
    }, context);

    const connectedContext = imageContext();
    let imageState = imagePlanProvider.getNewProjectImagePlan(connectedContext);
    imageState = imagePlanProvider.saveNewProjectImagePlan({
        tasks: imageState.tasks,
        expected_design_revision_sha256: imageState.design_revision_sha256,
        expected_image_plan_revision_sha256: imageState.revision_sha256,
    }, connectedContext);
    for (let index = 0; index < imageState.tasks.length; index += 1) {
        const task = imageState.tasks[index];
        imageState = imagePlanProvider.connectNewProjectImageResult({
            task_token: task.task_token,
            candidate_token: `review-board-image-${index + 1}`,
            image_index: index + 1,
            expected_design_revision_sha256: imageState.design_revision_sha256,
            expected_image_plan_revision_sha256: imageState.revision_sha256,
        }, connectedContext).state;
    }

    let videoState = videoPlanProvider.getNewProjectVideoPlan(context);
    const tasks = structuredClone(videoState.tasks);
    tasks[0].provider = 'grok';
    tasks[0].provider_label = '플로우';
    videoState = videoPlanProvider.saveNewProjectVideoPlan({ tasks, ...videoRevisions(videoState) }, context);

    const sourceVideo = path.join(evidenceRoot, 'synthetic-result.mp4');
    const generated = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=0x183042:s=360x640:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourceVideo,
    ], { encoding: 'utf8' });
    if (generated.status !== 0) throw new Error(`REVIEW_BOARD_FFMPEG_FAILED:${generated.stderr.trim()}`);
    fs.chmodSync(sourceVideo, 0o600);
    const videoBytes = fs.readFileSync(sourceVideo);
    const candidateToken = 'review-board-video';
    const videoContext = {
        ...context,
        getVideoResultImportWorkspace: () => ({
            status: 'ready', blockers: [], candidates: [{
                candidate_token: candidateToken, provider: 'grok', duration_seconds: 1,
                width: 360, height: 640,
            }],
        }),
        copyVideoResultCandidateToPrivateFile: ({ candidateToken: selected, destinationPath }) => {
            if (selected !== candidateToken) throw new Error('REVIEW_BOARD_VIDEO_CANDIDATE_INVALID');
            fs.copyFileSync(sourceVideo, destinationPath, fs.constants.COPYFILE_EXCL);
            fs.chmodSync(destinationPath, 0o600);
            return {
                provider: 'grok', source_sha256: sha256(videoBytes), byte_length: videoBytes.byteLength,
                duration_seconds: 1, width: 360, height: 640, provenance_kind: 'synthetic_local_fixture',
            };
        },
    };
    videoState = videoPlanProvider.connectNewProjectVideoResult({
        task_token: videoState.tasks[0].task_token,
        candidate_token: candidateToken,
        ...videoRevisions(videoState),
    }, videoContext).state;
    const receipt = {
        mode, user_data_path: userDataPath,
        image_count: imageState.tasks.length,
        image_result_count: imageState.tasks.filter((task) => task.result_token).length,
        video_count: videoState.tasks.length,
        video_result_count: videoState.tasks.filter((task) => task.result_token).length,
        external_call_performed: false, model_called: false, generation_executed: false,
        provider_generation_calls: 0, synthetic_local_ffmpeg: true,
    };
    if (receipt.image_count !== 3 || receipt.image_result_count !== 3
        || receipt.video_count !== 1 || receipt.video_result_count !== 1) {
        throw new Error('REVIEW_BOARD_SEED_INVALID');
    }
    writeReceipt('seed.json', receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} else if (mode === 'verify-image') {
    const imageState = imagePlanProvider.getNewProjectImagePlan(context);
    const videoState = videoPlanProvider.getNewProjectVideoPlan(context);
    const imageRetry = imageState.tasks.filter((task) => task.status === '재제작');
    const receipt = {
        mode,
        image_count: imageState.tasks.length,
        image_result_count: imageState.tasks.filter((task) => task.result_token).length,
        image_retry_count: imageRetry.length,
        selected_image_label: imageRetry[0]?.label || '',
        video_status: videoState.status,
        video_blockers: videoState.blockers,
        external_call_performed: false, model_called: false, generation_executed: false,
        provider_generation_calls: 0,
    };
    if (receipt.image_count !== 3 || receipt.image_result_count !== 3 || receipt.image_retry_count !== 1
        || receipt.selected_image_label !== '장면 이미지 · 재회' || receipt.video_status !== 'blocked'
        || !receipt.video_blockers.includes('VIDEO_PLAN_REFERENCE_IMAGE_REQUIRED')) {
        throw new Error(`REVIEW_BOARD_IMAGE_VERIFICATION_FAILED:${JSON.stringify(receipt)}`);
    }
    writeReceipt('result.json', receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} else if (mode === 'verify') {
    const imageState = imagePlanProvider.getNewProjectImagePlan(context);
    const videoState = videoPlanProvider.getNewProjectVideoPlan(context);
    const imageRetry = imageState.tasks.filter((task) => task.status === '재제작');
    const videoRetry = videoState.tasks.filter((task) => task.status === '재제작');
    const receipt = {
        mode,
        image_count: imageState.tasks.length,
        image_result_count: imageState.tasks.filter((task) => task.result_token).length,
        image_retry_count: imageRetry.length,
        video_count: videoState.tasks.length,
        video_result_count: videoState.tasks.filter((task) => task.result_token).length,
        video_retry_count: videoRetry.length,
        selected_video_label: videoRetry[0]?.label || '',
        external_call_performed: false, model_called: false, generation_executed: false,
        provider_generation_calls: 0,
    };
    if (receipt.image_count !== 3 || receipt.image_result_count !== 3 || receipt.image_retry_count !== 0
        || receipt.video_count !== 1 || receipt.video_result_count !== 1 || receipt.video_retry_count !== 1
        || receipt.selected_video_label !== '장면 영상 · 재회') {
        throw new Error(`REVIEW_BOARD_VERIFICATION_FAILED:${JSON.stringify(receipt)}`);
    }
    writeReceipt('result.json', receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} else {
    throw new Error('REVIEW_BOARD_MODE_INVALID');
}
