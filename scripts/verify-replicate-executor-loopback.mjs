import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';
import executionProvider from '../electron/lib/newProjectExecutionProvider.js';
import filmProvider from '../electron/lib/filmPipelineProvider.js';

const FFMPEG_PATH = '/usr/local/anaconda3/bin/ffmpeg';
const FFPROBE_PATH = '/usr/local/anaconda3/bin/ffprobe';
const MOCK_API_TOKEN = 'loopback-token-never-persist';
const MOCK_PREDICTION_ID = 'loopback_prediction_001';
const COMPLETED_AT = '2026-07-17T04:00:00.000Z';
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function privateDirectory(directory) {
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    return fs.realpathSync.native(directory);
}

function assertPrivateMode(filePath, expected) {
    assert.equal(fs.lstatSync(filePath).mode & 0o777, expected, `${filePath} mode`);
}

function run(command, args, code) {
    const result = spawnSync(command, args, {
        encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000, shell: false,
    });
    assert.equal(result.error, undefined, `${code}: ${result.error?.message || ''}`);
    assert.equal(result.signal, null, `${code}: signal ${result.signal || ''}`);
    assert.equal(result.status, 0, `${code}: ${result.stderr || ''}`);
    return result.stdout;
}

function probeMedia(filePath) {
    const stdout = run(FFPROBE_PATH, [
        '-v', 'error',
        '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height',
        '-of', 'json', filePath,
    ], 'FFPROBE_FAILED');
    const value = JSON.parse(stdout);
    const video = value.streams?.find((stream) => stream.codec_type === 'video');
    const audio = value.streams?.find((stream) => stream.codec_type === 'audio');
    assert.equal(video?.codec_name, 'h264');
    assert.equal(audio?.codec_name, 'aac');
    assert.ok(Number(value.format?.duration) > 0);
    return {
        format_name: value.format.format_name,
        duration_seconds: Number(value.format.duration),
        video_codec: video.codec_name,
        audio_codec: audio.codec_name,
        width: video.width,
        height: video.height,
    };
}

function designBoard() {
    return {
        characters: [{
            id: 'hero', name: '주인공', role: '사장', appearance: '짧은 머리',
            wardrobe: '남색 작업복', continuity: '붉은 장갑',
        }],
        locations: [{
            id: 'site', name: '비 오는 현장', space: '좁은 골목', lighting: '차가운 새벽빛',
            props: '사다리차', continuity: '젖은 난간',
        }],
        scenes: [{
            id: 'scene_01', title: '안전의 기준', dramatic_beat: '위험을 본다.', characters: ['hero'],
            location_id: 'site', duration: 5, first_frame: '빗속 사다리차',
            action: '주인공이 사다리차를 붙든다.', camera: '낮은 앵글',
            lighting: '청회색 역광', audio_sfx_dialogue: '거센 빗소리',
        }],
    };
}

function setupActualPlans(context) {
    draftProvider.saveNewProjectDraft({
        production_id: 'replicate-loopback-proof',
        brief: '비 오는 현장에서 안전을 선택하는 장면을 만든다.',
        script: '위험을 발견한 사장이 할인 대신 안전을 택한다.',
        route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 1,
    }, context);
    const emptyDesign = designProvider.getNewProjectDesignState(context);
    designProvider.saveNewProjectDesignBoard({
        board: designBoard(),
        expected_planning_revision_sha256: emptyDesign.planning_revision_sha256,
        expected_design_revision_sha256: emptyDesign.revision_sha256,
    }, context);

    const imageContext = {
        ...context,
        getDstBundleImportPreview: () => ({
            ready: true,
            preview: { mime_type: 'image/png', byte_length: PNG.byteLength, base64: PNG.toString('base64') },
            blockers: [],
        }),
    };
    let image = imagePlanProvider.getNewProjectImagePlan(imageContext);
    image = imagePlanProvider.saveNewProjectImagePlan({
        tasks: image.tasks,
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, imageContext);
    const accepted = [];
    const imageTasks = [
        ...image.tasks.filter((task) => task.kind.endsWith('_sheet')),
        image.tasks.find((task) => task.kind === 'scene_image'),
    ];
    for (const [index, task] of imageTasks.entries()) {
        image = imagePlanProvider.connectNewProjectImageResult({
            task_token: task.task_token,
            candidate_token: `loopback-image-${index + 1}`,
            image_index: index + 1,
            expected_design_revision_sha256: image.design_revision_sha256,
            expected_image_plan_revision_sha256: image.revision_sha256,
        }, imageContext).state;
        image = imagePlanProvider.saveNewProjectImageReviewDecision({
            task_token: task.task_token,
            decision: 'use',
            expected_design_revision_sha256: image.design_revision_sha256,
            expected_image_plan_revision_sha256: image.revision_sha256,
        }, imageContext);
        accepted.push(task.kind);
    }

    let video = videoPlanProvider.getNewProjectVideoPlan(context);
    video = videoPlanProvider.saveNewProjectVideoPlan({
        tasks: video.tasks.map((task) => ({
            ...task, provider: 'replicate', provider_label: 'Replicate',
        })),
        expected_design_revision_sha256: video.design_revision_sha256,
        expected_image_plan_revision_sha256: video.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: video.revision_sha256,
    }, context);
    video = videoPlanProvider.prepareNewProjectVideoPlan({
        expected_design_revision_sha256: video.design_revision_sha256,
        expected_image_plan_revision_sha256: video.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: video.revision_sha256,
    }, context);
    const execution = executionProvider.getNewProjectExecutionState(context);
    assert.equal(execution.tasks.filter((task) => task.lane === 'image').length, 0);
    assert.equal(execution.tasks.filter((task) => task.lane === 'video').length, 1);
    return { accepted, image, video, execution };
}

function assertPathlessPublicState(state, forbidden) {
    const serialized = JSON.stringify(state);
    for (const value of forbidden) {
        assert.equal(serialized.includes(value), false, `public state exposed ${value}`);
    }
    assert.doesNotMatch(serialized, /https?:\/\/|api\.replicate\.com|replicate-submission|request_spec|authorization/i);
    const visit = (value) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            assert.doesNotMatch(key, /(?:^|_)(?:path|url|prediction_id|api_token|authorization|result_locator)(?:$|_)/i);
            visit(child);
        }
    };
    visit(state);
}

async function closeServer(server) {
    if (!server.listening) return;
    await new Promise((resolve) => {
        server.close(resolve);
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
}

async function main() {
    assert.ok(process.argv[2], 'Usage: node scripts/verify-replicate-executor-loopback.mjs <evidence-root>');
    for (const binary of [FFMPEG_PATH, FFPROBE_PATH]) {
        const stats = fs.lstatSync(binary);
        assert.equal(stats.isFile(), true);
        assert.equal(stats.isSymbolicLink(), false);
    }

    const evidenceRoot = path.resolve(process.argv[2]);
    fs.mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
    const realEvidenceRoot = fs.realpathSync.native(evidenceRoot);
    const userDataPath = privateDirectory(path.join(realEvidenceRoot, 'user-data'));
    const providerResultsRoot = privateDirectory(path.join(realEvidenceRoot, 'provider-results'));
    const roots = Object.fromEntries([
        'dst-images', 'flow', 'grok', 'replicate-history', 'replicate-receipts', 'bytedance-receipts',
    ].map((name) => [name, privateDirectory(path.join(providerResultsRoot, name))]));
    const sourceMp4 = path.join(realEvidenceRoot, 'source.mp4');
    run(FFMPEG_PATH, [
        '-hide_banner', '-loglevel', 'error', '-n',
        '-f', 'lavfi', '-i', 'color=c=0x18324a:s=360x640:r=24:d=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', sourceMp4,
    ], 'FFMPEG_FAILED');
    fs.chmodSync(sourceMp4, 0o600);
    const sourceProbe = probeMedia(sourceMp4);
    const sourceBytes = fs.readFileSync(sourceMp4);

    const counters = { post: 0, poll: 0, download: 0 };
    let baseUrl = '';
    const server = http.createServer((request, response) => {
        const json = (value) => {
            const body = Buffer.from(JSON.stringify(value));
            response.writeHead(200, {
                'content-type': 'application/json', 'content-length': body.byteLength,
                connection: 'close',
            });
            response.end(body);
        };
        if (request.method === 'POST' && request.url === '/predictions') {
            counters.post += 1;
            assert.equal(request.headers.authorization, `Bearer ${MOCK_API_TOKEN}`);
            let body = '';
            request.setEncoding('utf8');
            request.on('data', (chunk) => { body += chunk; });
            request.on('end', () => {
                const parsed = JSON.parse(body);
                assert.match(parsed.input.prompt, /사다리차/);
                assert.match(parsed.input.image, /^data:image\/png;base64,/);
                json({
                    id: MOCK_PREDICTION_ID, status: 'starting',
                    urls: { get: `${baseUrl}/predictions/${MOCK_PREDICTION_ID}` },
                });
            });
            return;
        }
        if (request.method === 'GET' && request.url === `/predictions/${MOCK_PREDICTION_ID}`) {
            counters.poll += 1;
            assert.equal(request.headers.authorization, `Bearer ${MOCK_API_TOKEN}`);
            if (counters.poll === 1) {
                json({
                    id: MOCK_PREDICTION_ID, status: 'processing',
                    urls: { get: `${baseUrl}/predictions/${MOCK_PREDICTION_ID}` },
                });
            } else {
                json({
                    id: MOCK_PREDICTION_ID, status: 'succeeded',
                    urls: { get: `${baseUrl}/predictions/${MOCK_PREDICTION_ID}` },
                    output: `${baseUrl}/delivery/result.mp4`, completed_at: COMPLETED_AT,
                });
            }
            return;
        }
        if (request.method === 'GET' && request.url === '/delivery/result.mp4') {
            counters.download += 1;
            response.writeHead(200, {
                'content-type': 'video/mp4', 'content-length': sourceBytes.byteLength,
                connection: 'close',
            });
            response.end(sourceBytes);
            return;
        }
        response.writeHead(404, { connection: 'close' });
        response.end();
    });

    let verification;
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        const context = {
            userDataPath,
            dstImagesRoot: roots['dst-images'],
            flowResultsRoot: roots.flow,
            grokResultsRoot: roots.grok,
            replicateResultsRoot: roots['replicate-history'],
            replicateReceiptResultsRoot: roots['replicate-receipts'],
            bytedanceReceiptResultsRoot: roots['bytedance-receipts'],
            ffprobePath: FFPROBE_PATH,
            replicateApiToken: MOCK_API_TOKEN,
            replicateLoopbackTestOnly: true,
            replicateTestSubmitUrl: `${baseUrl}/predictions`,
            replicateTestPollAttempts: 5,
            replicateTestPollIntervalMs: 0,
            replicateTestRequestTimeoutMs: 3000,
            tokenSecret: Buffer.alloc(32, 71),
        };
        const plans = setupActualPlans(context);
        let state = executionProvider.prepareNewProjectExecution({
            expected_revision_sha256: plans.execution.revision_sha256, new_attempt: false,
        }, context);
        assert.equal(state.tasks[0].execution_preview.reason, 'private_replicate_request_ready');
        const handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
        const task = handoff.tasks.find((item) => item.provider === 'replicate');
        assert.ok(task);
        const result = await executionProvider.executeNextReplicateTask({
            expected_revision_sha256: state.revision_sha256, confirm_live: true,
        }, context);
        assert.equal(result.status, 'succeeded');
        assert.deepEqual(counters, { post: 1, poll: 2, download: 1 });

        const sidecarPath = path.join(
            path.dirname(task.output_path), `${task.task_token}.replicate-submission.json`,
        );
        const receiptDirectory = path.join(roots['replicate-receipts'], MOCK_PREDICTION_ID);
        const receiptPath = path.join(receiptDirectory, 'receipt.json');
        const publishedMp4 = path.join(receiptDirectory, 'result.mp4');
        assertPrivateMode(task.output_path, 0o600);
        assertPrivateMode(sidecarPath, 0o600);
        assertPrivateMode(receiptDirectory, 0o700);
        assertPrivateMode(receiptPath, 0o600);
        assertPrivateMode(publishedMp4, 0o600);
        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        assert.equal(receipt.schema_version, 'film_pipeline.external_video_result.v2');
        assert.equal(receipt.provider, 'replicate');
        assert.equal(receipt.result_id, MOCK_PREDICTION_ID);
        assert.equal(receipt.run_revision_sha256, task.run_revision_sha256);
        assert.equal(receipt.task_token, task.task_token);
        assert.equal(receipt.output_sha256, sha256(sourceBytes));
        assert.equal(fs.readFileSync(task.output_path).equals(sourceBytes), true);
        assert.equal(fs.readFileSync(publishedMp4).equals(sourceBytes), true);
        const outputProbe = probeMedia(task.output_path);
        const publishedProbe = probeMedia(publishedMp4);

        const mainPublic = executionProvider.getNewProjectExecutionState(context);
        const rendererPublic = filmProvider.getNewProjectExecutionState(context);
        for (const publicState of [mainPublic, rendererPublic]) {
            assert.equal(publicState.status, 'succeeded');
            assert.equal(publicState.tasks[0].status, 'succeeded');
            assert.equal(publicState.tasks[0].status_label, '결과 도착');
            assert.equal(publicState.tasks[0].result_received, true);
            assertPathlessPublicState(publicState, [
                MOCK_API_TOKEN, MOCK_PREDICTION_ID, baseUrl, realEvidenceRoot,
                task.output_path, sidecarPath,
            ]);
        }
        assertPrivateMode(userDataPath, 0o700);
        assertPrivateMode(providerResultsRoot, 0o700);

        verification = {
            schema_version: 'film_pipeline.replicate_executor_loopback_verification.v1',
            mock_provider: true,
            external_network_used: false,
            real_local_http_used: true,
            real_ffmpeg_used: true,
            real_ffprobe_used: true,
            accepted_image_kinds: plans.accepted,
            provider: 'replicate',
            execution_status: result.status,
            request_counts: counters,
            private_modes: {
                user_data: '0700', provider_results: '0700', output: '0600', sidecar: '0600',
                published_directory: '0700', published_video: '0600', published_receipt: '0600',
            },
            published_receipt_schema: receipt.schema_version,
            main_public_state: { status: mainPublic.status, pathless: true, sensitive_values_exposed: false },
            renderer_public_state: {
                status: rendererPublic.status, pathless: true, sensitive_values_exposed: false,
            },
            source_sha256: sha256(sourceBytes),
            source_probe: sourceProbe,
            output_probe: outputProbe,
            published_probe: publishedProbe,
            evidence_root: realEvidenceRoot,
            user_data_path: userDataPath,
            provider_results_root: providerResultsRoot,
            source_mp4: sourceMp4,
            private_output_mp4: task.output_path,
            private_submission_sidecar: sidecarPath,
            published_receipt: receiptPath,
            published_mp4: publishedMp4,
        };
        fs.writeFileSync(
            path.join(realEvidenceRoot, 'verification.json'),
            `${JSON.stringify(verification, null, 2)}\n`,
            { mode: 0o600, flag: 'wx' },
        );
    } finally {
        await closeServer(server);
    }

    process.stdout.write(`${JSON.stringify({
        ok: true,
        schema_version: verification.schema_version,
        mock_provider: true,
        execution_status: verification.execution_status,
        request_counts: verification.request_counts,
        evidence_root: verification.evidence_root,
    })}\n`);
}

await main();
