import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';
import executionProvider from '../electron/lib/newProjectExecutionProvider.js';
import providerExecutionPreview from '../electron/lib/newProjectProviderExecutionPreview.js';
import filmProvider from '../electron/lib/filmPipelineProvider.js';

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
        source_id: 'scene_01', label: '장면 이미지 · 첫 장면', prompt: '9:16 비 오는 현장의 첫 프레임',
    };
    const videoTask = {
        task_token: `task_${'2'.repeat(64)}`, kind: 'scene_video', sequence: 1,
        source_id: 'scene_01',
        label: '장면 영상 · 첫 장면', provider: 'flow', provider_label: '플로우',
        prompt: '9:16 주인공이 사다리차를 붙든다.',
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
    const draft = draftProvider.getNewProjectDraftState(parts);
    const designRevision = states.image?.design_revision_sha256 || states.video?.design_revision_sha256;
    return {
        ...parts,
        getNewProjectDraftState: () => structuredClone(draft),
        getNewProjectDesignState: () => ({
            ok: true, status: 'restored', revision_sha256: designRevision,
            planning_revision_sha256: draft.revision_sha256,
            board: { scenes: [{ id: 'scene_01', duration: states.sceneDuration || 5 }] }, blockers: [],
        }),
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
    assert.equal(initial.tasks.every((task) => task.execution_preview?.mode === 'result_only'), true);
    assert.deepEqual(initial.tasks.map((task) => task.execution_preview?.output_kind), ['image', 'video']);
    assert.equal(initial.tasks.every((task) => task.execution_preview?.preview_only === true), true);
    assert.doesNotMatch(JSON.stringify(initial.tasks.map((task) => task.execution_preview)),
        /task_|run_|preparation_|dst|flow|grok|replicate|bytedance|\/Users\/|[a-f0-9]{64}/i);

    const prepared = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: initial.revision_sha256, new_attempt: false,
    }, context);
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.already_prepared, false);
    const repeated = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: initial.revision_sha256, new_attempt: false,
    }, context);
    assert.equal(repeated.already_prepared, true);
    const handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
    assert.equal(handoff.schema_version, 'film_pipeline.new_project_execution_handoff.v4');
    assert.deepEqual(handoff.tasks.map((task) => task.aspect_ratio), ['9:16', '9:16']);
    assert.deepEqual(handoff.tasks.map((task) => task.source_id), ['scene_01', 'scene_01']);
    assert.deepEqual(handoff.tasks.map((task) => task.duration_seconds), [null, 5]);
    assert.equal(handoff.tasks.every((task) => task.provider_execution_preview?.command_spec.preview_only === true), true);
    assert.equal(handoff.tasks.every((task) => task.provider_execution_preview?.command_spec.live_submit_allowed === false), true);
    assert.equal(handoff.tasks.every((task) => task.provider_execution_preview?.command_spec.copy_allowed === false), true);

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

test('MOCK: renderer staging accepts only the current revision and never exposes retry or execution controls', (t) => {
    const parts = fixture(t, 'open-ga-execution-stage-');
    const context = fakeContext(parts);
    const initial = filmProvider.getNewProjectExecutionState(context);

    assert.equal(initial.prepared, false);
    assert.equal(initial.tasks.every((task) => !Object.hasOwn(task, 'task_token')), true);
    assert.equal(initial.tasks.every((task) => !Object.hasOwn(task, 'provider_label')), true);
    assert.equal(initial.tasks.every((task) => !Object.hasOwn(task, 'provider_readiness')), true);
    assert.doesNotMatch(JSON.stringify(initial), /command_spec|contract_revision_sha256|\/Users\//);
    const staged = filmProvider.stageNewProjectExecutionHandoff({
        expected_revision_sha256: initial.revision_sha256,
    }, context);
    assert.equal(staged.prepared, true);
    assert.equal(staged.already_prepared, false);
    assert.equal(staged.external_call_performed, false);
    assert.equal(staged.model_called, false);
    assert.equal(staged.generation_executed, false);

    const repeated = filmProvider.stageNewProjectExecutionHandoff({
        expected_revision_sha256: initial.revision_sha256,
    }, context);
    assert.equal(repeated.already_prepared, true);
    assert.throws(() => filmProvider.stageNewProjectExecutionHandoff({
        expected_revision_sha256: initial.revision_sha256,
        new_attempt: true,
    }, context), { code: 'EXECUTION_STAGE_SHAPE_INVALID' });
    assert.throws(() => filmProvider.stageNewProjectExecutionHandoff({
        expected_revision_sha256: '0'.repeat(64),
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
    assert.throws(() => executionProvider.publishExecutionReceipt({
        ...succeeded, result_locator: `flow:wrong-provider:${'9'.repeat(64)}`,
    }, context), { code: 'EXECUTION_RESULT_PROVIDER_MISMATCH' });
    context.resolveDstExecutionResultLocator = (locator) => locator === succeeded.result_locator
        ? { candidate_token: 'candidate-session-token', image_index: 1 } : null;
    const completed = executionProvider.publishExecutionReceipt(succeeded, context).state;
    assert.equal(completed.tasks[0].status_label, '결과 도착');
    assert.equal(completed.tasks[0].result_received, true);
    assert.equal(completed.tasks[0].result_match_status, 'ready');
    assert.equal(completed.tasks[0].result_candidate_token, 'candidate-session-token');
    assert.equal(completed.tasks[0].result_image_index, 1);
    assert.equal(completed.tasks[0].execution_preview.reason, 'result_available');
    assert.equal(completed.tasks[0].execution_preview.user_status, '연결할 완료 결과가 있습니다.');
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
        { status: 'succeeded', progress: 100, result_received: true, result_locator: `dst:first:1:${'7'.repeat(64)}` },
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
        status: 'succeeded', progress: 100, result_received: true, result_locator: `dst:first:1:${'7'.repeat(64)}`,
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

test('legacy v1 manifests remain readable history but never become an active execution selection', (t) => {
    const parts = fixture(t, 'open-ga-execution-v1-');
    const task = {
        task_token: `task_${'7'.repeat(64)}`, lane: 'image', kind: 'scene_image', sequence: 1,
        label: '이전 장면', provider: 'dst_image', provider_label: 'DST 이미지', prompt: '이전 프롬프트',
        preparation_token: `preparation_${'8'.repeat(64)}`, reference_task_tokens: [], reference_result_tokens: [],
    };
    const base = {
        lane: 'image', design_revision_sha256: 'a'.repeat(64), image_plan_revision_sha256: 'b'.repeat(64),
        video_plan_revision_sha256: '', preparation_token: task.preparation_token, tasks: [task],
    };
    const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const preparationRevision = digest(base);
    const runRevision = digest({ preparation_revision_sha256: preparationRevision, attempt: 1 });
    const manifest = {
        schema_version: executionProvider.LEGACY_MANIFEST_SCHEMA,
        run_token: `run_${runRevision}`, run_revision_sha256: runRevision,
        preparation_revision_sha256: preparationRevision, attempt: 1, ...base,
        external_call_performed: false, model_called: false, generation_executed: false,
        created_at: '2026-07-15T00:00:00.000Z',
    };
    const paths = executionProvider.exactPaths(parts.userDataPath, manifest.run_token);
    fs.mkdirSync(paths.receiptsRoot, { recursive: true, mode: 0o700 });
    fs.chmodSync(paths.root, 0o700);
    fs.chmodSync(paths.runsRoot, 0o700);
    fs.chmodSync(paths.runRoot, 0o700);
    fs.writeFileSync(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const before = fs.readFileSync(paths.manifestPath);
    const beforeMtime = fs.statSync(paths.manifestPath).mtimeMs;

    const states = fakeStates();
    states.image.preparation = { status: 'empty', task_count: 0, task_tokens: [] };
    states.video.preparation = { status: 'empty', task_count: 0, task_tokens: [] };
    const context = fakeContext(parts, states);
    const history = executionProvider.getNewProjectExecutionHistory(context);
    assert.equal(history.ok, true);
    assert.equal(history.runs.length, 1);
    assert.equal(history.runs[0].lane, 'image');
    assert.equal(executionProvider.getNewProjectExecutionState(context).status, 'blocked');
    assert.equal(fs.readFileSync(paths.manifestPath).equals(before), true);
    assert.equal(fs.statSync(paths.manifestPath).mtimeMs, beforeMtime);
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

test('provider execution previews build exact private DST and Grok commands while live submission stays blocked', (t) => {
    const parts = fixture(t, 'open-ga-provider-preview-');
    const runtimeRoot = path.join(parts.base, 'runtime');
    const dstModule = path.join(runtimeRoot, 'dst');
    const dstPython = path.join(runtimeRoot, 'python');
    const grokRoot = path.join(runtimeRoot, 'grok-browser');
    const grokPythonTarget = path.join(runtimeRoot, 'python3.11');
    const grokPython = path.join(runtimeRoot, 'python3');
    const grokCli = path.join(grokRoot, 'grok_imagine_bot.py');
    const outputsRoot = path.join(parts.base, 'outputs');
    fs.mkdirSync(dstModule, { recursive: true, mode: 0o700 });
    fs.writeFileSync(dstPython, '#!/bin/sh\n', { mode: 0o700 });
    fs.mkdirSync(grokRoot, { mode: 0o700 });
    fs.mkdirSync(outputsRoot, { mode: 0o700 });
    fs.writeFileSync(grokPythonTarget, '#!/bin/sh\n', { mode: 0o700 });
    fs.symlinkSync(grokPythonTarget, grokPython);
    fs.writeFileSync(grokCli, '# grok fixture\n', { mode: 0o600 });
    const context = { runtimePaths: { dstPython, dstModule, grokPython, grokCli, grokRoot } };
    const task = {
        lane: 'image', kind: 'character_sheet', provider: 'dst_image',
        prompt: '9:16 영화 제작용 인물 시트', aspect_ratio: '9:16',
        reference_result_tokens: [], duration_seconds: null,
    };

    const sheet = providerExecutionPreview.buildProviderExecutionPreview(task, context);
    assert.equal(sheet.schema_version, 'film_pipeline.provider_execution_preview.v1');
    assert.equal(sheet.provider, 'dst');
    assert.equal(sheet.readiness, 'preview_ready');
    assert.deepEqual(sheet.blockers, []);
    assert.equal(sheet.command_spec.command, dstPython);
    assert.deepEqual(sheet.command_spec.args, [
        '-m', 'dst', 'image', task.prompt,
        '-p', 'goldpure369', '--count', '1', '--set-count', '1', '--aspect', '9:16',
    ]);
    assert.equal(sheet.command_spec.cwd, runtimeRoot);
    assert.equal(sheet.command_spec.shell, false);
    assert.equal(sheet.command_spec.preview_only, true);
    assert.equal(sheet.command_spec.live_submit_allowed, false);
    assert.equal(sheet.command_spec.copy_allowed, false);
    assert.match(sheet.contract_revision_sha256, /^[a-f0-9]{64}$/);

    const scene = providerExecutionPreview.buildProviderExecutionPreview({
        ...task, kind: 'scene_image', reference_result_tokens: [`result_${'1'.repeat(64)}`],
    }, context);
    assert.deepEqual(scene.blockers, ['DST_REFERENCE_STAGING_REQUIRED']);
    assert.equal(scene.command_spec.command, '');

    const flow = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'flow', prompt: '움직임',
        aspect_ratio: '9:16', reference_result_tokens: [`result_${'2'.repeat(64)}`], duration_seconds: 5,
    }, context);
    assert.deepEqual(flow.blockers, ['FLOW_REFERENCE_COUNT_MUST_BE_ZERO_OR_TWO']);
    assert.deepEqual(flow.command_spec.args, []);
    const flowTwoReferences = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'flow', prompt: '움직임',
        aspect_ratio: '9:16', reference_result_tokens: [
            `result_${'4'.repeat(64)}`, `result_${'5'.repeat(64)}`,
        ], duration_seconds: 5,
    }, context);
    assert.deepEqual(flowTwoReferences.blockers, ['FLOW_REFERENCE_STAGING_REQUIRED']);
    const stagedPaths = [1, 2].map((index) => {
        const filePath = path.join(parts.base, `reference-${index}.png`);
        fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, index]), { mode: 0o600 });
        return filePath;
    });
    const stagedReferences = stagedPaths.map((filePath, index) => ({
        result_token: `result_${String(index + 4).repeat(64)}`,
        task_token: `task_${String(index + 4).repeat(64)}`,
        mime_type: 'image/png', byte_length: 5, sha256: String(index + 4).repeat(64), path: filePath,
    }));
    const flowStaged = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'flow', prompt: '움직임',
        aspect_ratio: '9:16', reference_result_tokens: stagedReferences.map((item) => item.result_token),
        reference_files: stagedReferences, duration_seconds: 5,
    }, context);
    assert.deepEqual(flowStaged.blockers, ['FLOW_PRIVATE_RUNTIME_CONTEXT_REQUIRED']);

    const grokTaskToken = `task_${'8'.repeat(64)}`;
    const grokOutput = path.join(outputsRoot, `${grokTaskToken}.mp4`);
    const grok = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '움직임',
        task_token: grokTaskToken, output_path: grokOutput,
        aspect_ratio: '9:16', reference_result_tokens: [`result_${'3'.repeat(64)}`], duration_seconds: 5,
    }, context);
    assert.deepEqual(grok.blockers, ['GROK_DURATION_UNSUPPORTED']);
    assert.equal(grok.command_spec.command, '');
    const grokReference = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '움직임',
        task_token: grokTaskToken, output_path: grokOutput,
        aspect_ratio: '9:16', reference_result_tokens: [`result_${'3'.repeat(64)}`], duration_seconds: 6,
    }, context);
    assert.deepEqual(grokReference.blockers, ['GROK_REFERENCE_STAGING_REQUIRED']);
    assert.equal(grokReference.command_spec.command, '');
    const grokTooManyReferences = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '움직임',
        task_token: grokTaskToken, output_path: grokOutput,
        aspect_ratio: '9:16', reference_result_tokens: stagedReferences.map((item) => item.result_token),
        reference_files: stagedReferences, duration_seconds: 6,
    }, context);
    assert.deepEqual(grokTooManyReferences.blockers, ['GROK_REFERENCE_COUNT_MUST_BE_ZERO_OR_ONE']);
    assert.equal(grokTooManyReferences.command_spec.command, '');
    const grokRuntimeMissing = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '움직임',
        task_token: grokTaskToken, output_path: grokOutput,
        aspect_ratio: '9:16', reference_result_tokens: [stagedReferences[0].result_token],
        reference_files: [stagedReferences[0]], duration_seconds: 6,
    }, { runtimePaths: { ...context.runtimePaths, grokRoot: path.join(parts.base, 'missing') } });
    assert.deepEqual(grokRuntimeMissing.blockers, ['GROK_RUNTIME_MISSING']);
    assert.equal(grokRuntimeMissing.command_spec.command, '');
    const grokOutputMissing = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '움직임',
        task_token: grokTaskToken, aspect_ratio: '9:16',
        reference_result_tokens: [stagedReferences[0].result_token],
        reference_files: [stagedReferences[0]], duration_seconds: 6,
    }, context);
    assert.deepEqual(grokOutputMissing.blockers, ['GROK_OUTPUT_STAGING_REQUIRED']);
    assert.equal(grokOutputMissing.command_spec.command, '');
    const grokStaged = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '움직임',
        task_token: grokTaskToken, output_path: grokOutput,
        aspect_ratio: '9:16', reference_result_tokens: [stagedReferences[0].result_token],
        reference_files: [stagedReferences[0]], duration_seconds: 6,
    }, context);
    assert.equal(grokStaged.readiness, 'preview_ready_live_blocked');
    assert.deepEqual(grokStaged.blockers, [
        'GROK_NO_NONSUBMIT_MODE',
        'GROK_ACCOUNT_ROTATION_CANNOT_BE_DISABLED',
        'GROK_I2V_RATIO_NOT_CONFIGURABLE',
    ]);
    assert.equal(grokStaged.command_spec.command, grokPythonTarget);
    assert.equal(grokStaged.command_spec.cwd, grokRoot);
    assert.deepEqual(grokStaged.command_spec.args, [
        grokCli, 'i2v', '--image', stagedReferences[0].path,
        '--prompt', '움직임', '--duration', '6', '--output', grokOutput, '--timeout', '180',
    ]);
    assert.equal(grokStaged.command_spec.args.includes('--ratio'), false);
    assert.equal(grokStaged.command_spec.args.includes('--quality'), false);
    assert.equal(grokStaged.command_spec.preview_only, true);
    assert.equal(grokStaged.command_spec.live_submit_allowed, false);
    assert.equal(grokStaged.command_spec.copy_allowed, false);

    const grokText = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '텍스트 영상',
        task_token: grokTaskToken, output_path: grokOutput,
        aspect_ratio: '9:16', reference_result_tokens: [], duration_seconds: 10,
    }, context);
    assert.equal(grokText.readiness, 'preview_ready_live_blocked');
    assert.deepEqual(grokText.blockers, [
        'GROK_NO_NONSUBMIT_MODE', 'GROK_ACCOUNT_ROTATION_CANNOT_BE_DISABLED',
    ]);
    assert.deepEqual(grokText.command_spec.args, [
        grokCli, 'video', '--prompt', '텍스트 영상', '--ratio', '9:16',
        '--duration', '10', '--quality', '480p', '--output', grokOutput, '--timeout', '180',
    ]);

    fs.writeFileSync(grokOutput, 'existing output', { mode: 0o600 });
    const existingOutput = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '움직임',
        task_token: grokTaskToken, output_path: grokOutput,
        aspect_ratio: '9:16', reference_result_tokens: [], duration_seconds: 6,
    }, context);
    assert.deepEqual(existingOutput.blockers, ['GROK_OUTPUT_STAGING_REQUIRED']);
    assert.equal(existingOutput.command_spec.command, '');
    fs.unlinkSync(grokOutput);

    const replicateBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
    const replicatePath = path.join(parts.base, 'replicate-reference.png');
    fs.writeFileSync(replicatePath, replicateBytes, { mode: 0o600 });
    const replicateReference = {
        result_token: `result_${'9'.repeat(64)}`,
        task_token: `task_${'9'.repeat(64)}`,
        mime_type: 'image/png', byte_length: replicateBytes.byteLength,
        sha256: crypto.createHash('sha256').update(replicateBytes).digest('hex'), path: replicatePath,
    };
    const replicateTask = {
        lane: 'video', kind: 'scene_video', provider: 'replicate', prompt: '첫 화면에서 천천히 전진',
        task_token: `task_${'7'.repeat(64)}`, aspect_ratio: '9:16',
        reference_result_tokens: [replicateReference.result_token], reference_files: [replicateReference],
        duration_seconds: 5,
    };
    const replicate = providerExecutionPreview.buildProviderExecutionPreview(replicateTask, context);
    assert.equal(replicate.readiness, 'preview_ready');
    assert.deepEqual(replicate.blockers, []);
    assert.deepEqual(replicate.command_spec, {
        command: '', args: [], cwd: '', shell: false,
        preview_only: true, live_submit_allowed: false, copy_allowed: false,
    });
    assert.equal(replicate.request_spec.model_slug, 'bytedance/seedance-1-pro');
    assert.equal(replicate.request_spec.method, 'POST');
    assert.equal(replicate.request_spec.url,
        'https://api.replicate.com/v1/models/bytedance/seedance-1-pro/predictions');
    assert.deepEqual(replicate.request_spec.header_names, ['Authorization', 'Content-Type', 'Prefer']);
    assert.deepEqual(replicate.request_spec.headers, { 'Content-Type': 'application/json', Prefer: 'wait' });
    assert.equal(replicate.request_spec.authorization_env, 'REPLICATE_API_TOKEN');
    assert.deepEqual(Object.keys(replicate.request_spec.body.input), [
        'prompt', 'image', 'duration', 'resolution', 'fps', 'camera_fixed',
    ]);
    assert.equal(replicate.request_spec.body.input.prompt, replicateTask.prompt);
    assert.equal(replicate.request_spec.body.input.duration, 5);
    assert.equal(replicate.request_spec.body.input.resolution, '1080p');
    assert.equal(replicate.request_spec.body.input.fps, 24);
    assert.equal(replicate.request_spec.body.input.camera_fixed, false);
    assert.match(replicate.request_spec.body.input.image, /^data:image\/png;base64,/);
    assert.equal(Buffer.byteLength(replicate.request_spec.body.input.image) <= 1024 * 1024, true);
    assert.equal(Object.hasOwn(replicate.request_spec.body.input, 'aspect_ratio'), false);
    assert.equal(replicate.request_spec.preview_only, true);
    assert.equal(replicate.request_spec.live_submit_allowed, false);
    assert.equal(replicate.request_spec.external_call_performed, false);
    assert.match(replicate.request_spec.request_revision_sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(replicate.request_spec), /Bearer|actual-token|version[_-]?digest/i);

    const replicateInvalid = (changes) => providerExecutionPreview.buildProviderExecutionPreview({
        ...replicateTask, ...changes,
    }, context);
    assert.deepEqual(replicateInvalid({ reference_result_tokens: [], reference_files: [] }).blockers,
        ['REPLICATE_REFERENCE_COUNT_MUST_BE_ONE']);
    assert.deepEqual(replicateInvalid({ duration_seconds: 6 }).blockers, ['REPLICATE_DURATION_UNSUPPORTED']);
    assert.deepEqual(replicateInvalid({
        reference_files: [{ ...replicateReference, sha256: '0'.repeat(64) }],
    }).blockers, ['REPLICATE_REFERENCE_DRIFT']);
    const oversizedBytes = Buffer.alloc(786432, 7);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedBytes);
    const oversizedPath = path.join(parts.base, 'replicate-oversized.png');
    fs.writeFileSync(oversizedPath, oversizedBytes, { mode: 0o600 });
    const oversizedReference = {
        ...replicateReference, path: oversizedPath, byte_length: oversizedBytes.byteLength,
        sha256: crypto.createHash('sha256').update(oversizedBytes).digest('hex'),
    };
    assert.deepEqual(replicateInvalid({ reference_files: [oversizedReference] }).blockers,
        ['REPLICATE_REFERENCE_TOO_LARGE']);
    const replicateChanged = replicateInvalid({ prompt: `${replicateTask.prompt} 빠른 이동` });
    assert.notEqual(replicate.request_spec.request_revision_sha256,
        replicateChanged.request_spec.request_revision_sha256);

    const bytedance = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'bytedance', prompt: '움직임',
        aspect_ratio: '9:16', reference_result_tokens: [], duration_seconds: 6,
    }, context);
    assert.deepEqual(bytedance.blockers, ['MISSING_BYTEDANCE_GENERATION_ADAPTER']);
    assert.equal(bytedance.command_spec.command, '');
    assert.deepEqual(bytedance.command_spec.args, []);

    const changedPrompt = providerExecutionPreview.buildProviderExecutionPreview({
        ...task, prompt: `${task.prompt} 다른 지시`,
    }, context);
    const changedAspect = providerExecutionPreview.buildProviderExecutionPreview({
        ...task, aspect_ratio: '16:9',
    }, context);
    const fourSeconds = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '움직임',
        aspect_ratio: '9:16', reference_result_tokens: [], duration_seconds: 4,
    }, context);
    const fiveSeconds = providerExecutionPreview.buildProviderExecutionPreview({
        lane: 'video', kind: 'scene_video', provider: 'grok', prompt: '움직임',
        aspect_ratio: '9:16', reference_result_tokens: [], duration_seconds: 5,
    }, context);
    assert.notEqual(sheet.contract_revision_sha256, changedPrompt.contract_revision_sha256);
    assert.notEqual(sheet.contract_revision_sha256, changedAspect.contract_revision_sha256);
    assert.notEqual(fourSeconds.contract_revision_sha256, fiveSeconds.contract_revision_sha256);
});

test('MOCK: main stages a private absent Grok output target and renderer sees only Korean setup or review guidance', (t) => {
    const parts = fixture(t, 'open-ga-grok-output-');
    const states = fakeStates();
    states.image.preparation = { status: 'empty', task_count: 0, task_tokens: [] };
    states.video.tasks[0].provider = 'grok';
    states.video.tasks[0].provider_label = '그록';
    states.sceneDuration = 6;

    const runtimeRoot = path.join(parts.base, 'runtime');
    const grokRoot = path.join(runtimeRoot, 'grok-browser');
    const grokPython = path.join(runtimeRoot, 'python3.11');
    const grokCli = path.join(grokRoot, 'grok_imagine_bot.py');
    fs.mkdirSync(grokRoot, { recursive: true, mode: 0o700 });
    fs.writeFileSync(grokPython, '#!/bin/sh\n', { mode: 0o700 });
    fs.writeFileSync(grokCli, '# fixture\n', { mode: 0o600 });
    const context = {
        ...fakeContext(parts, states),
        runtimePaths: { grokPython, grokCli, grokRoot },
    };

    let state = executionProvider.getNewProjectExecutionState(context);
    assert.equal(state.prepared, false);
    state = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: state.revision_sha256, new_attempt: false,
    }, context);
    assert.equal(state.prepared, true);
    assert.deepEqual(state.tasks[0].execution_preview, {
        mode: 'review_required', status_label: '실행 전 확인', reason: 'private_review_required',
        user_status: '작업 내용은 준비되었지만 실행 전 확인이 필요합니다.',
        next_action: '영상 작업에서 프롬프트와 길이를 확인하세요.',
        output_kind: 'video', output_count: 1, preview_only: true,
    });
    assert.doesNotMatch(JSON.stringify(state.tasks),
        /output_path|command_spec|GROK_|grok_imagine_bot|\.mp4|\/Users\//);

    let handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
    const task = handoff.tasks[0];
    const paths = executionProvider.exactPaths(parts.userDataPath, `run_${task.run_revision_sha256}`);
    const expectedOutput = path.join(paths.outputsRoot, `${task.task_token}.mp4`);
    assert.equal(fs.lstatSync(paths.outputsRoot).mode & 0o777, 0o700);
    assert.equal(task.output_path, expectedOutput);
    assert.equal(fs.existsSync(expectedOutput), false);
    assert.equal(task.provider_execution_preview.readiness, 'preview_ready_live_blocked');
    assert.deepEqual(task.provider_execution_preview.command_spec.args, [
        grokCli, 'video', '--prompt', task.prompt, '--ratio', '9:16',
        '--duration', '6', '--quality', '480p', '--output', expectedOutput, '--timeout', '180',
    ]);
    assert.equal(task.provider_execution_preview.command_spec.preview_only, true);
    assert.equal(task.provider_execution_preview.command_spec.live_submit_allowed, false);

    const renderer = filmProvider.getNewProjectExecutionState(context);
    assert.equal(renderer.tasks[0].execution_preview.mode, 'review_required');
    assert.doesNotMatch(JSON.stringify(renderer),
        /"task_token"|output_path|command_spec|GROK_|grok_imagine_bot|\.mp4|\/Users\//);

    fs.rmSync(paths.outputsRoot, { recursive: true });
    const incomplete = executionProvider.getNewProjectExecutionState(context);
    assert.equal(incomplete.prepared, false);
    const recovered = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: incomplete.revision_sha256, new_attempt: false,
    }, context);
    assert.equal(recovered.prepared, true);
    assert.equal(fs.lstatSync(paths.outputsRoot).mode & 0o777, 0o700);
    handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
    assert.equal(handoff.tasks[0].output_path, expectedOutput);

    fs.writeFileSync(expectedOutput, 'existing output', { mode: 0o600 });
    assert.equal(executionProvider.getNewProjectExecutionState(context).prepared, false);
    assert.throws(() => executionProvider.inspectExecutionHandoff(context, { new_attempt: false }), {
        code: 'EXECUTION_OUTPUT_TARGET_EXISTS',
    });

    states.sceneDuration = 5;
    const unsupported = executionProvider.getNewProjectExecutionState(context);
    assert.deepEqual(unsupported.tasks[0].execution_preview, {
        mode: 'setup_required', status_label: '준비 필요', reason: 'video_duration_required',
        user_status: '영상 길이를 지원되는 값으로 바꿔야 합니다.',
        next_action: '설계에서 장면 길이를 6초, 10초 또는 15초로 바꾸세요.',
        output_kind: 'video', output_count: 1, preview_only: true,
    });
    assert.doesNotMatch(JSON.stringify(unsupported.tasks[0].execution_preview), /GROK_|grok|\/Users\//i);
});

test('MOCK: DST scene references stage as immutable typed run inputs and recover before becoming prepared', (t) => {
    const parts = fixture(t, 'open-ga-scene-references-');
    const empty = designProvider.getNewProjectDesignState(parts);
    designProvider.saveNewProjectDesignBoard({
        board: board(),
        expected_planning_revision_sha256: empty.planning_revision_sha256,
        expected_design_revision_sha256: empty.revision_sha256,
    }, parts);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8, 9]);
    const runtimeRoot = path.join(parts.base, 'runtime');
    const dstModule = path.join(runtimeRoot, 'dst');
    const dstPython = path.join(runtimeRoot, 'python');
    fs.mkdirSync(dstModule, { recursive: true, mode: 0o700 });
    fs.writeFileSync(dstPython, '#!/bin/sh\n', { mode: 0o700 });
    const context = {
        ...parts,
        runtimePaths: { dstPython, dstModule },
        getDstBundleImportPreview: () => ({
            ready: true,
            preview: { mime_type: 'image/png', byte_length: png.byteLength, base64: png.toString('base64') },
            blockers: [],
        }),
    };
    let image = imagePlanProvider.getNewProjectImagePlan(context);
    image = imagePlanProvider.saveNewProjectImagePlan({
        tasks: image.tasks,
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, context);
    const referenceTasks = image.tasks.filter((task) => task.kind.endsWith('_sheet'));
    for (let index = 0; index < referenceTasks.length; index += 1) {
        image = imagePlanProvider.connectNewProjectImageResult({
            task_token: referenceTasks[index].task_token,
            candidate_token: `scene-reference-${index + 1}`,
            image_index: index + 1,
            expected_design_revision_sha256: image.design_revision_sha256,
            expected_image_plan_revision_sha256: image.revision_sha256,
        }, context).state;
    }
    imagePlanProvider.prepareNewProjectImagePlan({
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, context);
    const initial = executionProvider.getNewProjectExecutionState(context);
    assert.equal(initial.prepared, false);
    assert.equal(initial.task_count, 1);
    assert.equal(initial.tasks[0].kind, 'scene_image');
    assert.deepEqual(initial.tasks[0].execution_preview, {
        mode: 'setup_required', status_label: '준비 필요', reason: 'reference_staging_required',
        user_status: '참조 이미지를 다시 연결해야 합니다.',
        next_action: '이미지 작업에서 인물·장소 결과를 확인하세요.',
        output_kind: 'image', output_count: 1, preview_only: true,
    });

    const prepared = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: initial.revision_sha256,
        new_attempt: false,
    }, context);
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.tasks[0].execution_preview.mode, 'preview_ready');
    assert.equal(prepared.tasks[0].execution_preview.user_status, '참조 이미지와 작업 내용이 준비되었습니다.');
    assert.equal(prepared.tasks[0].execution_preview.next_action, '이미지 작업에서 장면 프롬프트를 확인하세요.');
    assert.doesNotMatch(JSON.stringify(prepared.tasks), /reference_files|relative_path|references\//);

    let handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
    assert.equal(handoff.schema_version, 'film_pipeline.new_project_execution_handoff.v4');
    const scene = handoff.tasks[0];
    assert.equal(scene.reference_files.length, 2);
    assert.equal(scene.provider_execution_preview.readiness, 'preview_ready');
    assert.deepEqual(scene.provider_execution_preview.blockers, []);
    assert.deepEqual(scene.provider_execution_preview.command_spec.args.filter((item) => item === '--attach'), ['--attach', '--attach']);
    const attached = scene.provider_execution_preview.command_spec.args.flatMap((item, index, values) =>
        item === '--attach' ? [values[index + 1]] : []);
    assert.deepEqual(attached, scene.reference_files.map((reference) => reference.path));
    const paths = executionProvider.exactPaths(parts.userDataPath, `run_${scene.run_revision_sha256}`);
    assert.equal(fs.lstatSync(paths.referencesRoot).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(paths.referencesManifestPath).mode & 0o777, 0o600);
    const manifestText = fs.readFileSync(paths.referencesManifestPath, 'utf8');
    const referenceManifest = JSON.parse(manifestText);
    assert.equal(referenceManifest.schema_version, executionProvider.REFERENCES_SCHEMA);
    assert.match(referenceManifest.reference_revision_sha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(referenceManifest, 'staged_at'), false);
    for (const reference of scene.reference_files) {
        assert.equal(fs.lstatSync(reference.path).mode & 0o777, 0o600);
        assert.equal(fs.readFileSync(reference.path).equals(png), true);
    }

    const firstPath = scene.reference_files[0].path;
    const firstInode = fs.lstatSync(firstPath).ino;
    fs.unlinkSync(paths.referencesManifestPath);
    const incomplete = executionProvider.getNewProjectExecutionState(context);
    assert.equal(incomplete.prepared, false);
    assert.equal(incomplete.tasks[0].execution_preview.mode, 'setup_required');
    const recovered = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: incomplete.revision_sha256,
        new_attempt: false,
    }, context);
    assert.equal(recovered.prepared, true);
    assert.equal(fs.lstatSync(firstPath).ino, firstInode, 'partial recovery reuses the verified immutable input');
    assert.equal(fs.readFileSync(paths.referencesManifestPath, 'utf8'), manifestText,
        'deterministic commit marker is restored byte-for-byte');
    handoff = executionProvider.inspectExecutionHandoff(context, { new_attempt: false });
    assert.equal(handoff.tasks[0].reference_files[0].path, firstPath);

    const tamperedBytes = Buffer.concat([png.subarray(0, 8), Buffer.from([90, 91, 92])]);
    const tamperedManifest = structuredClone(referenceManifest);
    tamperedManifest.references[0].byte_length = tamperedBytes.byteLength;
    tamperedManifest.references[0].sha256 = crypto.createHash('sha256').update(tamperedBytes).digest('hex');
    const { reference_revision_sha256: ignoredRevision, ...tamperedBase } = tamperedManifest;
    tamperedManifest.reference_revision_sha256 = crypto.createHash('sha256')
        .update(JSON.stringify(tamperedBase)).digest('hex');
    fs.writeFileSync(firstPath, tamperedBytes, { mode: 0o600 });
    fs.writeFileSync(paths.referencesManifestPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`, { mode: 0o600 });
    assert.equal(executionProvider.getNewProjectExecutionState(context).prepared, false,
        'a self-consistent staged rewrite cannot replace the result-token-bound source bytes');
    assert.throws(() => executionProvider.inspectExecutionHandoff(context, { new_attempt: false }), {
        code: 'EXECUTION_REFERENCE_CONFLICT',
    });
    fs.writeFileSync(firstPath, png, { mode: 0o600 });
    fs.writeFileSync(paths.referencesManifestPath, manifestText, { mode: 0o600 });

    const rendererState = filmProvider.getNewProjectExecutionState(context);
    assert.doesNotMatch(JSON.stringify(rendererState), /reference_files|relative_path|references\/|\.png/);
    const outside = path.join(parts.base, 'outside.png');
    fs.writeFileSync(outside, png, { mode: 0o600 });
    fs.unlinkSync(firstPath);
    fs.symlinkSync(outside, firstPath);
    assert.throws(() => executionProvider.inspectExecutionHandoff(context, { new_attempt: false }), {
        code: 'EXECUTION_FILE_UNSAFE',
    });
    assert.equal(fs.readFileSync(outside).equals(png), true);
    fs.unlinkSync(firstPath);
    fs.writeFileSync(firstPath, png, { mode: 0o600 });
    image = imagePlanProvider.saveNewProjectImageRetrySelection({
        task_tokens: [referenceTasks[0].task_token],
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, context);
    const stale = executionProvider.getNewProjectExecutionState(context);
    assert.equal(stale.prepared, false);
    assert.equal(stale.tasks[0].execution_preview.mode, 'setup_required');
    assert.throws(() => executionProvider.inspectExecutionHandoff(context, { new_attempt: false }), {
        code: 'IMAGE_PLAN_EXECUTION_REFERENCE_STALE',
    });
});

function setupActualPlans(t, videoProvider = 'flow') {
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
    const videoTasks = video.tasks.map((task) => ({
        ...task,
        provider: videoProvider,
        provider_label: videoProvider === 'replicate' ? 'Replicate' : task.provider_label,
    }));
    video = videoPlanProvider.saveNewProjectVideoPlan({
        tasks: videoTasks, expected_design_revision_sha256: video.design_revision_sha256,
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

function spawnInspect(userDataPath) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI, 'inspect', '--user-data', userDataPath], {
            env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
}

test('actual local Replicate request preview claims one absent output without HTTP and stays stable under concurrent inspect', async (t) => {
    const parts = setupActualPlans(t, 'replicate');
    const initial = executionProvider.getNewProjectExecutionState(parts);
    const prepared = executionProvider.prepareNewProjectExecution({
        expected_revision_sha256: initial.revision_sha256, new_attempt: false,
    }, parts);
    assert.equal(prepared.prepared, true);
    const publicVideo = prepared.tasks.find((task) => task.lane === 'video');
    assert.deepEqual(publicVideo.execution_preview, {
        mode: 'preview_ready', status_label: '요청 내용 확인 가능', reason: 'private_replicate_request_ready',
        user_status: 'Replicate에 보낼 영상 요청이 준비되었습니다. 아직 전송되지 않았습니다.',
        next_action: '영상 작업에서 프롬프트·길이·첫 화면을 확인하세요.',
        output_kind: 'video', output_count: 1, preview_only: true,
    });

    let handoff = executionProvider.inspectExecutionHandoff(parts, { new_attempt: false });
    let video = handoff.tasks.find((task) => task.provider === 'replicate');
    const request = video.provider_execution_preview.request_spec;
    assert.equal(video.provider_execution_preview.readiness, 'preview_ready');
    assert.deepEqual(video.provider_execution_preview.blockers, []);
    assert.equal(request.model_slug, 'bytedance/seedance-1-pro');
    assert.equal(request.body.input.duration, 5);
    assert.equal(request.body.input.resolution, '1080p');
    assert.equal(request.body.input.fps, 24);
    assert.equal(request.body.input.camera_fixed, false);
    assert.equal(Object.hasOwn(request.body.input, 'aspect_ratio'), false);
    assert.equal(request.preview_only, true);
    assert.equal(request.live_submit_allowed, false);
    assert.equal(request.external_call_performed, false);
    assert.deepEqual(video.provider_execution_preview.command_spec, {
        command: '', args: [], cwd: '', shell: false,
        preview_only: true, live_submit_allowed: false, copy_allowed: false,
    });
    const paths = executionProvider.exactPaths(parts.userDataPath, `run_${video.run_revision_sha256}`);
    const claimPath = path.join(paths.outputsRoot, `${video.task_token}.claim.json`);
    const outputPath = path.join(paths.outputsRoot, `${video.task_token}.mp4`);
    assert.equal(video.output_claim_path, claimPath);
    assert.equal(video.output_path, outputPath);
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(fs.lstatSync(claimPath).mode & 0o777, 0o600);
    const claimText = fs.readFileSync(claimPath, 'utf8');
    const claim = JSON.parse(claimText);
    assert.deepEqual(claim, {
        schema_version: executionProvider.REPLICATE_CLAIM_SCHEMA,
        run_revision_sha256: video.run_revision_sha256,
        task_token: video.task_token,
        request_revision_sha256: request.request_revision_sha256,
        output_basename: `${video.task_token}.mp4`,
    });
    const claimInode = fs.lstatSync(claimPath).ino;
    handoff = executionProvider.inspectExecutionHandoff(parts, { new_attempt: false });
    video = handoff.tasks.find((task) => task.provider === 'replicate');
    assert.deepEqual(video.provider_execution_preview.request_spec, request);
    assert.equal(fs.readFileSync(claimPath, 'utf8'), claimText);
    assert.equal(fs.lstatSync(claimPath).ino, claimInode);

    fs.rmSync(paths.outputsRoot, { recursive: true });
    const concurrent = await Promise.all([spawnInspect(parts.userDataPath), spawnInspect(parts.userDataPath)]);
    assert.equal(concurrent.every((result) => result.status === 0), true,
        concurrent.map((result) => result.stderr).join('\n'));
    const concurrentRequests = concurrent.map((result) => JSON.parse(result.stdout).handoff.tasks
        .find((task) => task.provider === 'replicate').provider_execution_preview.request_spec);
    assert.deepEqual(concurrentRequests[0], concurrentRequests[1]);
    assert.equal(fs.lstatSync(claimPath).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(outputPath), false);

    const renderer = filmProvider.getNewProjectExecutionState(parts);
    assert.equal(renderer.external_call_performed, false);
    assert.equal(renderer.model_called, false);
    assert.equal(renderer.generation_executed, false);
    const rendererJson = JSON.stringify(renderer);
    assert.doesNotMatch(rendererJson,
        /request_spec|authorization_env|REPLICATE_API_TOKEN|claim|output_path|data:image|api\.replicate\.com/i);
    for (const privateValue of [video.task_token, request.request_revision_sha256, claimPath, outputPath]) {
        assert.equal(rendererJson.includes(privateValue), false);
    }

    const unexpected = path.join(paths.outputsRoot, 'unexpected.json');
    fs.writeFileSync(unexpected, '{}\n', { mode: 0o600 });
    assert.throws(() => executionProvider.inspectExecutionHandoff(parts, { new_attempt: false }), {
        code: 'EXECUTION_OUTPUT_DIRECTORY_UNSAFE',
    });
    fs.unlinkSync(unexpected);
    const conflicting = { ...claim, request_revision_sha256: '0'.repeat(64) };
    fs.writeFileSync(claimPath, `${JSON.stringify(conflicting, null, 2)}\n`, { mode: 0o600 });
    assert.equal(executionProvider.getNewProjectExecutionState(parts).prepared, false);
    assert.throws(() => executionProvider.inspectExecutionHandoff(parts, { new_attempt: false }), {
        code: 'EXECUTION_REPLICATE_CLAIM_CONFLICT',
    });
});

test('actual local CLI inspects a private handoff and publishes a 0600 receipt using file IO only', (t) => {
    const parts = setupActualPlans(t);
    const inspected = spawnSync(process.execPath, [CLI, 'inspect', '--user-data', parts.userDataPath], {
        encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    assert.equal(inspected.status, 0, inspected.stderr);
    const handoff = JSON.parse(inspected.stdout);
    assert.equal(handoff.ok, true);
    assert.equal(handoff.handoff.schema_version, 'film_pipeline.new_project_execution_handoff.v4');
    assert.equal(handoff.handoff.tasks.length, 3);
    const sheetPreviews = handoff.handoff.tasks
        .filter((task) => task.lane === 'image')
        .map((task) => task.provider_execution_preview);
    assert.equal(sheetPreviews.every((preview) => preview.readiness === 'preview_ready'), true);
    assert.equal(sheetPreviews.every((preview) => preview.command_spec.args.includes('goldpure369')), true);
    assert.equal(sheetPreviews.every((preview) => preview.command_spec.preview_only === true), true);
    assert.equal(sheetPreviews.every((preview) => preview.command_spec.live_submit_allowed === false), true);
    assert.equal(sheetPreviews.every((preview) => preview.command_spec.copy_allowed === false), true);
    const videoTask = handoff.handoff.tasks.find((task) => task.lane === 'video');
    assert.equal(videoTask.provider, 'flow');
    assert.equal(videoTask.aspect_ratio, '9:16');
    assert.equal(videoTask.duration_seconds, 5);
    assert.equal(videoTask.source_id, 'scene_01');
    assert.match(videoTask.prompt, /주인공이 사다리차를 붙든다/);
    const publicVideo = executionProvider.getNewProjectExecutionState(parts).tasks
        .find((task) => task.lane === 'video');
    assert.deepEqual(publicVideo.execution_preview, {
        mode: 'setup_required', status_label: '준비 필요', reason: 'video_reference_count_required',
        user_status: '영상 참조 이미지 구성을 다시 확인해야 합니다.',
        next_action: '영상 작업에서 참조 이미지를 0장 또는 2장으로 맞추세요.',
        output_kind: 'video', output_count: 1, preview_only: true,
    });
    assert.doesNotMatch(JSON.stringify(publicVideo.execution_preview), /FLOW_|flow|\/Users\//i);
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
