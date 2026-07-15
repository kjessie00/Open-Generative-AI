import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';
import executionProvider from '../electron/lib/newProjectExecutionProvider.js';

const CLI = path.resolve('scripts/new-project-execution-handoff.cjs');

function fixture(t, prefix = 'open-ga-execution-') {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    draftProvider.saveNewProjectDraft({
        production_id: 'execution-fixture', brief: '현장의 안전 기준을 세운다.',
        script: '위험을 발견한 사장이 할인 대신 안전을 택한다.', route: 'both',
        aspect_ratio: '9:16', scene_duration: 5, max_scenes: 4,
    }, { userDataPath });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath };
}

function fakeStates() {
    const imageTask = {
        task_token: `task_${'1'.repeat(64)}`, kind: 'scene_image', sequence: 1,
        label: '장면 이미지 · 첫 장면', prompt: '비 오는 현장의 첫 프레임',
    };
    const videoTask = {
        task_token: `task_${'2'.repeat(64)}`, kind: 'scene_video', sequence: 1,
        label: '장면 영상 · 첫 장면', provider: 'flow', provider_label: '플로우',
        prompt: '주인공이 사다리차를 붙든다.',
    };
    return {
        image: {
            ok: true, status: 'restored', design_revision_sha256: 'a'.repeat(64),
            revision_sha256: 'b'.repeat(64), tasks: [imageTask], blockers: [],
            preparation: {
                status: 'queued', preparation_token: `preparation_${'3'.repeat(64)}`,
                task_count: 1, task_tokens: [imageTask.task_token],
            },
        },
        video: {
            ok: true, status: 'restored', design_revision_sha256: 'a'.repeat(64),
            image_plan_revision_sha256: 'b'.repeat(64), revision_sha256: 'c'.repeat(64),
            tasks: [videoTask], blockers: [],
            preparation: {
                status: 'queued', preparation_token: `preparation_${'4'.repeat(64)}`,
                task_count: 1, task_tokens: [videoTask.task_token],
            },
        },
    };
}

function fakeContext(parts, states = fakeStates()) {
    return {
        ...parts,
        getNewProjectImagePlan: () => structuredClone(states.image),
        getNewProjectVideoPlan: () => structuredClone(states.video),
    };
}

function receipt(state, task, values = {}) {
    return {
        schema_version: executionProvider.RECEIPT_SCHEMA,
        run_revision_sha256: state.revision_sha256,
        task_token: task.task_token,
        status: 'running', progress: 35, failure_code: '', result_received: false,
        result_locator: '', external_call_performed: false, model_called: false,
        generation_executed: false, reported_at: '2026-07-16T01:00:00.000Z',
        ...values,
    };
}

test('MOCK: current image and video preparations become lane-private revision-bound runs with a short pathless public state', (t) => {
    const parts = fixture(t);
    const context = fakeContext(parts);
    const initial = executionProvider.getNewProjectExecutionState(context);
    assert.equal(initial.prepared, false);
    assert.deepEqual(initial.tasks.map((task) => task.lane), ['image', 'video']);
    assert.deepEqual(initial.tasks.map((task) => task.sequence), [1, 1]);
    assert.deepEqual(initial.tasks.map((task) => task.provider_label), ['DST 이미지', '플로우']);
    assert.deepEqual(initial.tasks.map((task) => task.status_label), ['대기', '대기']);
    assert.equal(initial.tasks.every((task) => task.result_received === false), true);

    const prepared = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: initial.revision_sha256, new_attempt: false,
    }, context);
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.already_prepared, false);
    const repeated = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: initial.revision_sha256, new_attempt: false,
    }, context);
    assert.equal(repeated.already_prepared, true);

    const history = executionProvider.getNewProjectExecutionHistory(context);
    assert.equal(history.runs.length, 2);
    for (const run of history.runs) {
        const paths = executionProvider.exactPaths(parts.userDataPath, `run_${run.tasks.length
            ? executionProvider.inspectExecutionHandoff(context, { new_attempt: false }).tasks.find(
                (task) => task.lane === run.lane,
            ).run_revision_sha256 : ''}`);
        for (const directory of [paths.root, paths.runsRoot, paths.runRoot, paths.receiptsRoot]) {
            assert.equal(fs.lstatSync(directory).mode & 0o777, 0o700);
        }
        assert.equal(fs.lstatSync(paths.manifestPath).mode & 0o777, 0o600);
    }
    const publicJson = JSON.stringify(prepared);
    assert.doesNotMatch(publicJson, /first frame|flow|preparation_|result_locator|result_received":true|\/private\//i);
    assert.throws(() => executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: 'f'.repeat(64), new_attempt: false,
    }, context), { code: 'EXECUTION_REVISION_STALE' });
});

test('MOCK: receipts restore progress, expose only safe result arrival, enforce transitions, and reject symlinked private storage', (t) => {
    const parts = fixture(t);
    const context = fakeContext(parts);
    let state = executionProvider.getNewProjectExecutionState(context);
    state = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: state.revision_sha256, new_attempt: false,
    }, context);
    const task = state.tasks[0];
    const imageRun = executionProvider.inspectExecutionHandoff(context, { new_attempt: false }).tasks.find(
        (item) => item.task_token === task.task_token,
    ).run_revision_sha256;
    const running = receipt({ revision_sha256: imageRun }, task);
    assert.equal(executionProvider.publishExecutionReceipt(running, context).already_published, false);
    const repeat = executionProvider.publishExecutionReceipt({
        ...running, reported_at: '2026-07-16T01:01:00.000Z',
    }, context);
    assert.equal(repeat.already_published, true);

    const restored = executionProvider.getNewProjectExecutionState(context);
    assert.equal(restored.tasks[0].status_label, '진행 중');
    assert.equal(restored.tasks[0].progress, 35);
    assert.equal(JSON.stringify(restored).includes('result_locator'), false);
    assert.throws(() => executionProvider.publishExecutionReceipt({
        ...running, progress: 20, reported_at: '2026-07-16T01:02:00.000Z',
    }, context), {
        code: 'EXECUTION_RECEIPT_TRANSITION_INVALID',
    });

    const succeeded = receipt({ revision_sha256: imageRun }, task, {
        status: 'succeeded', progress: 100, result_received: true,
        result_locator: `dst:fixture-bundle:1:${'9'.repeat(64)}`, reported_at: '2026-07-16T01:02:00.000Z',
    });
    context.resolveDstExecutionResultLocator = (locator) => locator === succeeded.result_locator
        ? { candidate_token: 'candidate-session-token', image_index: 1 } : null;
    const completed = executionProvider.publishExecutionReceipt(succeeded, context).state;
    assert.equal(completed.tasks[0].status_label, '결과 도착');
    assert.equal(completed.tasks[0].result_received, true);
    assert.equal(completed.tasks[0].result_match_status, 'ready');
    assert.equal(completed.tasks[0].result_candidate_token, 'candidate-session-token');
    assert.equal(completed.tasks[0].result_image_index, 1);
    assert.equal(JSON.stringify(completed).includes('fixture-bundle'), false);
    assert.throws(() => executionProvider.publishExecutionReceipt({
        ...succeeded, status: 'failed', result_received: false, result_locator: '',
        failure_code: 'GENERATION_FAILED', reported_at: '2026-07-16T01:03:00.000Z',
    }, context), { code: 'EXECUTION_RECEIPT_TRANSITION_INVALID' });

    const second = state.tasks[1];
    const videoRun = executionProvider.inspectExecutionHandoff(context, { new_attempt: false }).tasks.find(
        (item) => item.task_token === second.task_token,
    ).run_revision_sha256;
    const paths = executionProvider.exactPaths(parts.userDataPath, `run_${videoRun}`);
    fs.rmSync(paths.receiptsRoot, { recursive: true });
    const outside = path.join(parts.base, 'outside');
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.symlinkSync(outside, paths.receiptsRoot);
    assert.throws(() => executionProvider.publishExecutionReceipt(receipt({ revision_sha256: videoRun }, second), context), {
        code: 'EXECUTION_DIRECTORY_UNSAFE',
    });
    assert.deepEqual(fs.readdirSync(outside), []);
});

test('MOCK: one lane executes strictly in sequence and partial success remains visibly in progress', (t) => {
    const parts = fixture(t);
    const states = fakeStates();
    const second = {
        ...states.image.tasks[0], task_token: `task_${'5'.repeat(64)}`, sequence: 2,
        label: '장면 이미지 · 두 번째 장면', prompt: '두 번째 장면',
    };
    states.image.tasks.push(second);
    states.image.preparation.task_count = 2;
    states.image.preparation.task_tokens.push(second.task_token);
    states.video = { ok: false, status: 'blocked', tasks: [], blockers: ['VIDEO_NOT_READY'], preparation: { status: 'empty' } };
    const context = fakeContext(parts, states);
    let state = executionProvider.getNewProjectExecutionState(context);
    state = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: state.revision_sha256, new_attempt: false,
    }, context);
    const handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
    const runRevision = handoff.tasks[0].run_revision_sha256;
    const firstTask = state.tasks[0];
    const secondTask = state.tasks[1];

    assert.throws(() => executionProvider.publishExecutionReceipt(receipt(
        { revision_sha256: runRevision }, secondTask,
    ), context), { code: 'EXECUTION_RECEIPT_SEQUENCE_INVALID' });
    assert.throws(() => executionProvider.publishExecutionReceipt(receipt(
        { revision_sha256: runRevision }, firstTask,
        { status: 'succeeded', progress: 100, result_received: true, result_locator: 'result:first' },
    ), context), { code: 'EXECUTION_RECEIPT_SEQUENCE_INVALID' });

    const firstRunning = receipt({ revision_sha256: runRevision }, firstTask);
    executionProvider.publishExecutionReceipt(firstRunning, context);
    assert.throws(() => executionProvider.publishExecutionReceipt(receipt(
        { revision_sha256: runRevision }, secondTask,
    ), context), { code: 'EXECUTION_RECEIPT_SEQUENCE_INVALID' });
    assert.throws(() => executionProvider.publishExecutionReceipt({
        ...firstRunning, progress: 50, reported_at: '2026-07-16T00:59:00.000Z',
    }, context), { code: 'EXECUTION_RECEIPT_TIMESTAMP_STALE' });

    executionProvider.publishExecutionReceipt(receipt({ revision_sha256: runRevision }, firstTask, {
        status: 'succeeded', progress: 100, result_received: true, result_locator: 'result:first',
        reported_at: '2026-07-16T01:01:00.000Z',
    }), context);
    const partial = executionProvider.getNewProjectExecutionState(context);
    assert.equal(partial.status, 'running');
    assert.deepEqual(partial.summary, { queued: 1, running: 0, succeeded: 1, failed: 0 });
    assert.equal(partial.tasks[0].status_label, '결과 도착');
    assert.equal(partial.tasks[1].status_label, '대기');
    executionProvider.publishExecutionReceipt(receipt({ revision_sha256: runRevision }, secondTask, {
        reported_at: '2026-07-16T01:02:00.000Z',
    }), context);
    assert.equal(executionProvider.getNewProjectExecutionState(context).summary.running, 1);
    executionProvider.publishExecutionReceipt(receipt({ revision_sha256: runRevision }, secondTask, {
        status: 'failed', progress: 35, failure_code: 'RESULT_INVALID',
        reported_at: '2026-07-16T01:03:00.000Z',
    }), context);
    const mixed = executionProvider.getNewProjectExecutionState(context);
    assert.equal(mixed.status, 'failed');
    assert.deepEqual(mixed.summary, { queued: 0, running: 0, succeeded: 1, failed: 1 });
    assert.throws(() => executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: mixed.revision_sha256, new_attempt: true,
    }, context), { code: 'EXECUTION_RETRY_PREPARATION_REQUIRED' });
    assert.equal(executionProvider.getNewProjectExecutionHistory(context).runs.length, 1,
        'a successful task is never copied into a same-preparation retry');
});

test('MOCK: lock conflicts preserve receipts and a failed-only lane starts a fresh explicit attempt', (t) => {
    const parts = fixture(t);
    const states = fakeStates();
    states.video = { ok: false, status: 'blocked', tasks: [], blockers: ['VIDEO_NOT_READY'], preparation: { status: 'empty' } };
    const context = fakeContext(parts, states);
    let state = executionProvider.getNewProjectExecutionState(context);
    state = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: state.revision_sha256, new_attempt: false,
    }, context);
    const handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
    const runRevision = handoff.tasks[0].run_revision_sha256;
    const task = state.tasks[0];
    const running = receipt({ revision_sha256: runRevision }, task, {
        external_call_performed: true, model_called: true, generation_executed: true,
    });
    executionProvider.publishExecutionReceipt(running, context);
    const paths = executionProvider.exactPaths(parts.userDataPath, `run_${runRevision}`);
    const lockPath = path.join(paths.runRoot, '.publish.lock');
    const failed = receipt({ revision_sha256: runRevision }, task, {
        status: 'failed', progress: 35, failure_code: 'GENERATION_FAILED',
        external_call_performed: true, model_called: true, generation_executed: true,
        reported_at: '2026-07-16T01:01:00.000Z',
    });

    fs.writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`, { mode: 0o600 });
    assert.throws(() => executionProvider.publishExecutionReceipt(failed, context), {
        code: 'EXECUTION_RECEIPT_LOCKED',
    });
    fs.unlinkSync(lockPath);
    fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 999999, created_at: '2000-01-01T00:00:00.000Z' })}\n`, { mode: 0o600 });
    assert.throws(() => executionProvider.publishExecutionReceipt(failed, context), {
        code: 'EXECUTION_RECEIPT_LOCKED',
    });
    fs.unlinkSync(lockPath);
    assert.equal(executionProvider.getNewProjectExecutionState(context).tasks[0].status, 'running');

    const failedState = executionProvider.publishExecutionReceipt(failed, context).state;
    assert.equal(failedState.tasks[0].failure_label, '생성 실패');
    assert.equal(JSON.stringify(failedState).includes('GENERATION_FAILED'), false);
    assert.equal(failedState.external_call_performed, true);
    assert.equal(failedState.model_called, true);
    assert.equal(failedState.generation_executed, true);
    assert.throws(() => executionProvider.publishExecutionReceipt({
        ...failed, status: 'succeeded', progress: 100, failure_code: '', result_received: true,
        result_locator: 'result:late', reported_at: '2026-07-16T01:02:00.000Z',
    }, context), { code: 'EXECUTION_RECEIPT_TRANSITION_INVALID' });

    const retry = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: failedState.revision_sha256, new_attempt: true,
    }, context);
    assert.equal(retry.status, 'queued');
    assert.equal(retry.task_count, 1);
    assert.equal(retry.tasks[0].result_received, false);
    const retryHandoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
    assert.equal(retryHandoff.tasks[0].attempt, 2);
    assert.equal(executionProvider.getNewProjectExecutionHistory(context).runs.length, 2);
    assert.throws(() => executionProvider.publishExecutionReceipt(failed, context), {
        code: 'EXECUTION_REVISION_STALE',
    });
});

function board() {
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

function setupActualPlans(t) {
    const parts = fixture(t, 'open-ga-execution-cli-');
    const empty = designProvider.getNewProjectDesignState(parts);
    designProvider.saveNewProjectDesignBoard({
        board: board(), expected_planning_revision_sha256: empty.planning_revision_sha256,
        expected_design_revision_sha256: empty.revision_sha256,
    }, parts);
    const preview = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const imageContext = {
        ...parts,
        getDstBundleImportPreview: () => ({
            ready: true, preview: {
                mime_type: 'image/png', byte_length: preview.byteLength, base64: preview.toString('base64'),
            }, blockers: [],
        }),
    };
    let image = imagePlanProvider.getNewProjectImagePlan(imageContext);
    image = imagePlanProvider.saveNewProjectImagePlan({
        tasks: image.tasks, expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, imageContext);
    imagePlanProvider.prepareNewProjectImagePlan({
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, imageContext);
    let imageExecution = executionProvider.getNewProjectExecutionState(parts);
    imageExecution = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: imageExecution.revision_sha256, new_attempt: false,
    }, parts);
    const scene = image.tasks.find((task) => task.kind === 'scene_image');
    image = imagePlanProvider.connectNewProjectImageResult({
        task_token: scene.task_token, candidate_token: 'local-fixture', image_index: 1,
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, imageContext).state;
    let video = videoPlanProvider.getNewProjectVideoPlan(parts);
    video = videoPlanProvider.saveNewProjectVideoPlan({
        tasks: video.tasks, expected_design_revision_sha256: video.design_revision_sha256,
        expected_image_plan_revision_sha256: video.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: video.revision_sha256,
    }, parts);
    videoPlanProvider.prepareNewProjectVideoPlan({
        expected_design_revision_sha256: video.design_revision_sha256,
        expected_image_plan_revision_sha256: video.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: video.revision_sha256,
    }, parts);
    const execution = executionProvider.getNewProjectExecutionState(parts);
    assert.equal(execution.prepared, false, 'new video lane awaits materialization');
    assert.equal(execution.tasks.filter((task) => task.lane === 'image').length, imageExecution.task_count);
    assert.equal(execution.tasks.filter((task) => task.lane === 'video').length, 1);
    return { ...parts, execution };
}

test('actual local CLI inspects a private handoff and publishes a 0600 receipt using file IO only', (t) => {
    const parts = setupActualPlans(t);
    const inspected = spawnSync(process.execPath, [CLI, 'inspect', '--user-data', parts.userDataPath], {
        encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    assert.equal(inspected.status, 0, inspected.stderr);
    const handoff = JSON.parse(inspected.stdout);
    assert.equal(handoff.ok, true);
    assert.equal(handoff.handoff.tasks.length, 4);
    const videoTask = handoff.handoff.tasks.find((task) => task.lane === 'video');
    assert.equal(videoTask.provider, 'flow');
    assert.match(videoTask.prompt, /주인공이 사다리차를 붙든다/);
    assert.equal(executionProvider.getNewProjectExecutionHistory(parts).runs.length, 2,
        'image run remains after image revision drift and video preparation');

    const inputPath = path.join(parts.base, 'receipt.json');
    const task = parts.execution.tasks[0];
    const runRevision = handoff.handoff.tasks.find((item) => item.task_token === task.task_token).run_revision_sha256;
    const input = receipt({ revision_sha256: runRevision }, task, { progress: 41 });
    fs.writeFileSync(inputPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
    const published = spawnSync(process.execPath, [
        CLI, 'publish', '--user-data', parts.userDataPath, '--input', inputPath,
    ], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(published.status, 0, published.stderr);
    assert.deepEqual(JSON.parse(published.stdout), {
        ok: true, task_token: task.task_token, status: 'running', progress: 41, already_published: false,
    });
    const restored = executionProvider.getNewProjectExecutionState(parts);
    assert.equal(restored.tasks[0].progress, 41);
    assert.equal(restored.tasks[0].status_label, '진행 중');

    const unsafePath = path.join(parts.base, 'unsafe.json');
    fs.writeFileSync(unsafePath, `${JSON.stringify(input)}\n`, { mode: 0o644 });
    const rejected = spawnSync(process.execPath, [
        CLI, 'publish', '--user-data', parts.userDataPath, '--input', unsafePath,
    ], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(rejected.status, 1);
    assert.equal(JSON.parse(rejected.stderr).error, 'EXECUTION_CLI_INPUT_UNSAFE');
});
