import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-video-plan-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath };
}

function board() {
    return {
        characters: [
            { id: 'hero', name: '주인공', role: '사장', appearance: '짧은 머리', wardrobe: '남색 작업복', continuity: '붉은 장갑' },
        ],
        locations: [
            { id: 'site', name: '비 오는 현장', space: '좁은 골목', lighting: '차가운 새벽빛', props: '사다리차', continuity: '젖은 난간' },
        ],
        scenes: [
            {
                id: 'scene_01', title: '위험한 할인', dramatic_beat: '위험을 뒤늦게 본다.',
                characters: ['hero'], location_id: 'site', duration: 5,
                first_frame: '빗속 사다리차', action: '주인공이 흔들리는 냉장고를 붙든다.',
                camera: '낮은 앵글', lighting: '청회색 역광', audio_sfx_dialogue: '거센 빗소리',
            },
            {
                id: 'scene_02', title: '남는 기준', dramatic_beat: '가격 대신 안전을 택한다.',
                characters: ['hero'], location_id: 'site', duration: 5,
                first_frame: '젖은 견적표', action: '주인공이 할인 문구를 지운다.',
                camera: '손을 따라가는 클로즈업', lighting: '따뜻한 실내광', audio_sfx_dialogue: '펜 소리',
            },
        ],
    };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function mp4() {
    const value = Buffer.alloc(24);
    value.writeUInt32BE(24, 0);
    value.write('ftyp', 4, 'ascii');
    value.write('isom', 8, 'ascii');
    return value;
}

function copyMock(bytes, provider = 'flow') {
    return ({ destinationPath }) => {
        fs.writeFileSync(destinationPath, bytes, { mode: 0o600, flag: 'wx' });
        return {
            provider,
            source_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            byte_length: bytes.byteLength,
            duration_seconds: 5,
            width: 1080,
            height: 1920,
            provenance_kind: 'mock_receipt',
        };
    };
}

function imageContext(parts) {
    return {
        ...parts,
        getDstBundleImportWorkspace: () => ({
            status: 'ready', candidates: [{
                candidate_token: 'image-candidate', created_at: '2026-07-16T00:00:00.000Z', image_count: 1,
            }], blockers: [],
        }),
        getDstBundleImportPreview: () => ({
            ready: true,
            preview: { mime_type: 'image/png', byte_length: PNG.byteLength, base64: PNG.toString('base64') },
            blockers: [],
        }),
    };
}

function saveAndConnectSceneImages(parts) {
    const context = imageContext(parts);
    let image = imagePlanProvider.getNewProjectImagePlan(context);
    image = imagePlanProvider.saveNewProjectImagePlan({
        tasks: image.tasks,
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, context);
    for (const task of image.tasks) {
        image = imagePlanProvider.connectNewProjectImageResult({
            task_token: task.task_token,
            candidate_token: 'image-candidate',
            image_index: 1,
            expected_design_revision_sha256: image.design_revision_sha256,
            expected_image_plan_revision_sha256: image.revision_sha256,
        }, context).state;
        image = imagePlanProvider.saveNewProjectImageReviewDecision({
            task_token: task.task_token,
            decision: 'use',
            expected_design_revision_sha256: image.design_revision_sha256,
            expected_image_plan_revision_sha256: image.revision_sha256,
        }, context);
    }
    return image;
}

function setup(t, aspectRatio = '9:16') {
    const parts = fixture(t);
    draftProvider.saveNewProjectDraft({
        production_id: 'video-plan-01', brief: '할인 경쟁을 멈추는 사장의 이야기.',
        script: '비 오는 현장의 위험을 본 뒤 안전 기준을 다시 세운다.', route: 'both',
        aspect_ratio: aspectRatio, scene_duration: 5, max_scenes: 4,
    }, parts);
    const empty = designProvider.getNewProjectDesignState(parts);
    const design = designProvider.saveNewProjectDesignBoard({
        board: board(), expected_planning_revision_sha256: empty.planning_revision_sha256,
        expected_design_revision_sha256: empty.revision_sha256,
    }, parts);
    const image = saveAndConnectSceneImages(parts);
    return { ...parts, design, image };
}

function revisions(state) {
    return {
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: state.revision_sha256,
    };
}

function saveVideo(parts, state = videoPlanProvider.getNewProjectVideoPlan(parts)) {
    return videoPlanProvider.saveNewProjectVideoPlan({ tasks: state.tasks, ...revisions(state) }, parts);
}

test('video plan follows scene order, carries accepted image dependencies, and saves provider and prompt edits', (t) => {
    const parts = setup(t);
    const derived = videoPlanProvider.getNewProjectVideoPlan(parts);
    assert.equal(derived.status, 'derived');
    assert.deepEqual(derived.tasks.map((task) => task.source_id), ['scene_01', 'scene_02']);
    assert.deepEqual(derived.tasks.map((task) => task.sequence), [1, 2]);
    assert.deepEqual(derived.tasks.map((task) => task.kind), ['scene_video', 'scene_video']);
    assert.deepEqual(derived.providers, {
        flow: '플로우', grok: '그록', replicate: '리플리케이트', bytedance: '바이트댄스',
    });
    assert.equal(derived.tasks[0].provider_label, '플로우');
    assert.equal(derived.tasks[0].reference_image_result_token, parts.image.tasks.find(
        (task) => task.kind === 'scene_image' && task.source_id === 'scene_01',
    ).result_token);
    assert.match(derived.tasks[0].prompt, /동작: 주인공이 흔들리는 냉장고를 붙든다/);
    assert.match(derived.tasks[0].prompt, /소리와 대사: 거센 빗소리/);

    const edited = structuredClone(derived.tasks);
    edited[0].provider = 'grok';
    edited[0].provider_label = '그록';
    edited[0].prompt += ' / 빗방울 움직임을 또렷하게';
    const saved = videoPlanProvider.saveNewProjectVideoPlan({ tasks: edited, ...revisions(derived) }, parts);
    assert.equal(saved.status, 'saved');
    assert.equal(saved.tasks[0].provider, 'grok');
    assert.equal(saved.tasks[0].prompt, edited[0].prompt);
    const paths = videoPlanProvider.exactPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(paths.root).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(paths.planPath).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(saved).includes(parts.base), false, 'normal renderer state stays pathless');
});

test('video plan canonicalizes renderer provider labels for all supported provider switches', (t) => {
    const parts = setup(t);
    let state = videoPlanProvider.getNewProjectVideoPlan(parts);
    const providers = [
        ['flow', '플로우'],
        ['grok', '그록'],
        ['replicate', '리플리케이트'],
        ['bytedance', '바이트댄스'],
    ];

    for (const [provider, providerLabel] of providers) {
        const edited = structuredClone(state.tasks);
        edited[0].provider = provider;
        edited[0].provider_label = '렌더러에 남은 이전 라벨';
        state = videoPlanProvider.saveNewProjectVideoPlan({
            tasks: edited, ...revisions(state),
        }, parts);
        assert.equal(state.tasks[0].provider, provider);
        assert.equal(state.tasks[0].provider_label, providerLabel);
    }

    const invalidProvider = structuredClone(state.tasks);
    invalidProvider[0].provider = 'unknown';
    assert.throws(() => videoPlanProvider.saveNewProjectVideoPlan({
        tasks: invalidProvider, ...revisions(state),
    }, parts), { code: 'VIDEO_PLAN_TASK_INVALID' });

    const extraShape = structuredClone(state.tasks);
    extraShape[0].unexpected = true;
    assert.throws(() => videoPlanProvider.saveNewProjectVideoPlan({
        tasks: extraShape, ...revisions(state),
    }, parts), { code: 'VIDEO_PLAN_TASK_SHAPE_INVALID' });
});

test('video prompts follow the saved 16:9 planning format instead of a fixed vertical default', (t) => {
    const parts = setup(t, '16:9');
    const derived = videoPlanProvider.getNewProjectVideoPlan(parts);
    assert.equal(derived.tasks.every((task) => task.prompt.includes('16:9 가로형')), true);
    assert.equal(derived.tasks.some((task) => task.prompt.includes('9:16 세로형')), false);
});

test('video plan rejects identity/result injection and queues dry-run work only', (t) => {
    const parts = setup(t);
    const saved = saveVideo(parts);
    const injected = structuredClone(saved.tasks);
    injected[0].reference_image_result_token = `result_${'a'.repeat(64)}`;
    assert.throws(() => videoPlanProvider.saveNewProjectVideoPlan({ tasks: injected, ...revisions(saved) }, parts), {
        code: 'VIDEO_PLAN_TASK_SET_MISMATCH',
    });
    const spoofed = structuredClone(saved.tasks);
    spoofed[0].status = '결과연결';
    spoofed[0].result_token = `result_${'b'.repeat(64)}`;
    assert.throws(() => videoPlanProvider.saveNewProjectVideoPlan({ tasks: spoofed, ...revisions(saved) }, parts), {
        code: 'VIDEO_PLAN_RESULT_STATE_IMMUTABLE',
    });

    const prepared = videoPlanProvider.prepareNewProjectVideoPlan(revisions(saved), parts);
    assert.equal(prepared.task_count, 2);
    assert.deepEqual(prepared.tasks.map((task) => task.sequence), [1, 2]);
    assert.equal(prepared.executed, false);
    assert.equal(prepared.model_called, false);
    assert.equal(prepared.generation_executed, false);
    const paths = videoPlanProvider.exactPaths(parts.userDataPath);
    const queuePath = path.join(paths.queueRoot, `${prepared.preparation_token}.json`);
    assert.equal(fs.lstatSync(paths.queueRoot).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(queuePath).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(queuePath, 'utf8'))).includes(parts.base), false);
});

test('pathless candidate preview connects private MP4, enforces provider, and drives retry-only preparation', (t) => {
    const parts = setup(t);
    let state = saveVideo(parts);
    const bytes = mp4();
    const context = {
        ...parts,
        getVideoResultImportWorkspace: () => ({
            status: 'ready', blockers: [], candidates: [
                { candidate_token: 'flow-video', provider: 'flow', duration_seconds: 5, width: 1080, height: 1920,
                    result_id: 'hidden', size_bytes: bytes.byteLength },
                { candidate_token: 'grok-video', provider: 'grok', duration_seconds: 5, width: 1080, height: 1920 },
            ],
        }),
        copyVideoResultCandidateToPrivateFile: copyMock(bytes),
    };
    const workspace = videoPlanProvider.getNewProjectVideoResultWorkspace(context);
    assert.deepEqual(workspace.candidates[0], {
        candidate_token: 'flow-video', provider: 'flow', provider_label: '플로우',
        duration_seconds: 5, width: 1080, height: 1920,
    });
    assert.equal(JSON.stringify(workspace).includes('hidden'), false);
    assert.equal(JSON.stringify(workspace).includes('size_bytes'), false);
    assert.throws(() => videoPlanProvider.connectNewProjectVideoResult({
        task_token: state.tasks[0].task_token, candidate_token: 'grok-video', ...revisions(state),
    }, context), { code: 'VIDEO_PLAN_PROVIDER_RESULT_MISMATCH' });

    const connected = videoPlanProvider.connectNewProjectVideoResult({
        task_token: state.tasks[0].task_token, candidate_token: 'flow-video', ...revisions(state),
    }, context);
    state = connected.state;
    assert.equal(state.tasks[0].status, '결과연결');
    const paths = videoPlanProvider.exactPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(path.join(paths.resultsRoot, `${connected.result_token}.mp4`)).mode & 0o777, 0o600);
    const preview = videoPlanProvider.getNewProjectVideoResultPreview({ result_token: connected.result_token }, context);
    assert.equal(preview.mime_type, 'video/mp4');
    assert.equal(Buffer.from(preview.base64, 'base64').equals(bytes), true);
    assert.equal(JSON.stringify(state).includes(preview.base64), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(paths.resultsRoot, `${connected.result_token}.json`), 'utf8'));
    assert.equal(Object.hasOwn(manifest, 'candidate_token'), false, 'opaque session tokens are not durability keys');
    assert.equal(manifest.source_provenance, 'mock_receipt');
    const acceptedEdit = structuredClone(state.tasks);
    acceptedEdit[0].provider = 'grok';
    acceptedEdit[0].provider_label = '그록';
    assert.throws(() => videoPlanProvider.saveNewProjectVideoPlan({
        tasks: acceptedEdit, ...revisions(state),
    }, context), { code: 'VIDEO_PLAN_ACCEPTED_TASK_EDIT_REQUIRES_RETRY' });
    assert.throws(() => videoPlanProvider.connectNewProjectVideoResult({
        task_token: state.tasks[0].task_token, candidate_token: 'flow-video', ...revisions(state),
    }, context), { code: 'VIDEO_PLAN_RETRY_SELECTION_REQUIRED' });

    const retry = videoPlanProvider.saveNewProjectVideoRetrySelection({
        task_tokens: [state.tasks[0].task_token], ...revisions(state),
    }, context);
    const prepared = videoPlanProvider.prepareNewProjectVideoPlan(revisions(retry), context);
    assert.deepEqual(prepared.tasks.map((task) => task.task_token), retry.tasks.map((task) => task.task_token));
    const cleared = videoPlanProvider.saveNewProjectVideoRetrySelection({ task_tokens: [], ...revisions(retry) }, context);
    const missingOnly = videoPlanProvider.prepareNewProjectVideoPlan(revisions(cleared), context);
    assert.deepEqual(missingOnly.tasks.map((task) => task.task_token), [cleared.tasks[1].task_token]);
    assert.equal(missingOnly.state.status, 'restored', 'a non-first retry or missing task remains a valid ordered subset');
    assert.deepEqual(missingOnly.state.preparation.task_tokens, [cleared.tasks[1].task_token]);
});

test('MOCK connected video quality decisions preserve siblings and fail closed on replacement and unsafe files', (t) => {
    const parts = setup(t);
    let state = saveVideo(parts);
    let bytes = mp4();
    const context = {
        ...parts,
        getVideoResultImportWorkspace: () => ({
            status: 'ready', blockers: [], candidates: [
                { candidate_token: 'MOCK-flow-video', provider: 'flow', duration_seconds: 5, width: 1080, height: 1920 },
            ],
        }),
        copyVideoResultCandidateToPrivateFile: (payload) => copyMock(bytes)(payload),
    };
    for (const task of state.tasks) {
        state = videoPlanProvider.connectNewProjectVideoResult({
            task_token: task.task_token, candidate_token: 'MOCK-flow-video', ...revisions(state),
        }, context).state;
    }
    assert.deepEqual(state.review_decisions.map((item) => item.decision), ['pending', 'pending']);
    const first = state.tasks[0];
    const second = state.tasks[1];
    for (const task of [first, second]) {
        state = videoPlanProvider.saveNewProjectVideoReviewDecision({
            task_token: task.task_token, decision: 'use', ...revisions(state),
        }, context);
    }
    assert.deepEqual(state.review_decisions.map((item) => item.decision), ['use', 'use']);
    const selectionSources = videoPlanProvider.getValidatedVideoSelectionSources(context);
    assert.deepEqual(selectionSources.sources.map((item) => item.sequence), [1, 2]);
    assert.deepEqual(selectionSources.sources.map((item) => item.duration_seconds), [5, 5]);
    assert.equal(selectionSources.sources.every((item) => /^[a-f0-9]{64}$/.test(item.result_sha256)), true);
    const paths = videoPlanProvider.exactPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(paths.reviewPath).mode & 0o777, 0o600);
    const duplicate = fs.readFileSync(paths.reviewPath, 'utf8');
    videoPlanProvider.saveNewProjectVideoReviewDecision({
        task_token: second.task_token, decision: 'use', ...revisions(state),
    }, context);
    assert.equal(fs.readFileSync(paths.reviewPath, 'utf8'), duplicate);

    state = videoPlanProvider.saveNewProjectVideoReviewDecision({
        task_token: first.task_token, decision: 'retry', ...revisions(state),
    }, context);
    assert.deepEqual(state.review_decisions.map((item) => item.decision), ['retry', 'use']);
    state = videoPlanProvider.saveNewProjectVideoReviewDecision({
        task_token: first.task_token, decision: 'use', ...revisions(state),
    }, context);
    assert.deepEqual(state.review_decisions.map((item) => item.decision), ['use', 'use']);

    state = videoPlanProvider.saveNewProjectVideoReviewDecision({
        task_token: first.task_token, decision: 'retry', ...revisions(state),
    }, context);
    bytes = Buffer.concat([mp4(), Buffer.from([9])]);
    state = videoPlanProvider.connectNewProjectVideoResult({
        task_token: first.task_token, candidate_token: 'MOCK-flow-video', ...revisions(state),
    }, context).state;
    assert.equal(state.review_decisions.find((item) => item.task_token === first.task_token).decision, 'pending');
    assert.equal(state.review_decisions.find((item) => item.task_token === second.task_token).decision, 'use');

    fs.chmodSync(paths.reviewPath, 0o644);
    const unsafe = videoPlanProvider.getNewProjectVideoPlan(context);
    assert.equal(unsafe.review_decisions.every((item) => item.decision !== 'use'), true);
    assert.deepEqual(unsafe.review_blockers, ['VIDEO_PLAN_FILE_UNSAFE']);
    assert.throws(() => videoPlanProvider.saveNewProjectVideoReviewDecision({
        task_token: first.task_token, decision: 'use', ...revisions(unsafe),
    }, context), { code: 'VIDEO_PLAN_FILE_UNSAFE' });
});

test('image-plan drift fails closed and explicit save rebases without carrying stale video results', (t) => {
    const parts = setup(t);
    let video = saveVideo(parts);
    const bytes = mp4();
    const context = {
        ...parts,
        getVideoResultImportWorkspace: () => ({
            status: 'ready', blockers: [], candidates: [
                { candidate_token: 'flow-video', provider: 'flow', duration_seconds: 5, width: 1080, height: 1920 },
            ],
        }),
        copyVideoResultCandidateToPrivateFile: copyMock(bytes),
    };
    video = videoPlanProvider.connectNewProjectVideoResult({
        task_token: video.tasks[0].task_token, candidate_token: 'flow-video', ...revisions(video),
    }, context).state;
    assert.ok(video.tasks[0].result_token);

    let image = imagePlanProvider.getNewProjectImagePlan(parts);
    const edited = structuredClone(image.tasks);
    edited[0].prompt += ' / 정면 표정 추가';
    image = imagePlanProvider.saveNewProjectImagePlan({
        tasks: edited,
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, parts);
    const stale = videoPlanProvider.getNewProjectVideoPlan(parts);
    assert.equal(stale.status, 'upstream_changed');
    assert.deepEqual(stale.blockers, ['VIDEO_PLAN_UPSTREAM_STALE']);
    assert.equal(stale.tasks[0].result_token, '', 'upstream re-derivation never carries stale video results');
    assert.throws(() => videoPlanProvider.prepareNewProjectVideoPlan(revisions(stale), parts), {
        code: 'VIDEO_PLAN_UPSTREAM_STALE',
    });
    const rebased = saveVideo(parts, stale);
    assert.equal(rebased.status, 'saved');
    assert.equal(rebased.blockers.length, 0);
    assert.equal(rebased.tasks[0].result_token, '');
});

test('unaccepted or retry-selected scene image blocks video planning', (t) => {
    const parts = setup(t);
    const retry = imagePlanProvider.saveNewProjectImageRetrySelection({
        task_tokens: [parts.image.tasks.find((task) => task.kind === 'scene_image').task_token],
        expected_design_revision_sha256: parts.image.design_revision_sha256,
        expected_image_plan_revision_sha256: parts.image.revision_sha256,
    }, parts);
    assert.equal(retry.status, 'saved');
    const blocked = videoPlanProvider.getNewProjectVideoPlan(parts);
    assert.equal(blocked.status, 'blocked');
    assert.deepEqual(blocked.blockers, ['VIDEO_PLAN_IMAGE_REVIEW_REQUIRED']);
});

test('private plan rejects symlinks and atomic writes leave no temporary files', (t) => {
    const parts = setup(t);
    const saved = saveVideo(parts);
    assert.equal(saved.status, 'saved');
    const paths = videoPlanProvider.exactPaths(parts.userDataPath);
    assert.deepEqual(fs.readdirSync(paths.root).filter((name) => name.startsWith('.video-plan-')), []);
    const external = path.join(parts.base, 'external.json');
    fs.writeFileSync(external, '{"untouched":true}\n', { mode: 0o600 });
    fs.unlinkSync(paths.planPath);
    fs.symlinkSync(external, paths.planPath);
    const blocked = videoPlanProvider.getNewProjectVideoPlan(parts);
    assert.equal(blocked.status, 'blocked');
    assert.deepEqual(blocked.blockers, ['VIDEO_PLAN_FILE_UNSAFE']);
    assert.equal(fs.readFileSync(external, 'utf8'), '{"untouched":true}\n');
});

test('deterministic queue replay validates the existing private record before reuse', (t) => {
    const parts = setup(t);
    const saved = saveVideo(parts);
    const prepared = videoPlanProvider.prepareNewProjectVideoPlan(revisions(saved), parts);
    const paths = videoPlanProvider.exactPaths(parts.userDataPath);
    const queuePath = path.join(paths.queueRoot, `${prepared.preparation_token}.json`);
    const record = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    record.tasks[0].provider = 'grok';
    fs.writeFileSync(queuePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    assert.throws(() => videoPlanProvider.prepareNewProjectVideoPlan(revisions(saved), parts), {
        code: 'VIDEO_PLAN_QUEUE_INVALID',
    });
    assert.deepEqual(fs.readdirSync(paths.queueRoot).filter((name) => name.startsWith('.video-plan-')), []);
});
