import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-image-plan-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath };
}

function board() {
    return {
        characters: [
            { id: 'hero', name: '주인공', role: '사장', appearance: '짧은 머리', wardrobe: '남색 작업복', continuity: '붉은 장갑' },
            { id: 'mentor', name: '선배', role: '조언자', appearance: '은빛 단발', wardrobe: '회색 재킷', continuity: '검은 수첩' },
        ],
        locations: [
            { id: 'apartment', name: '비 오는 아파트', space: '좁은 베란다', lighting: '차가운 새벽빛', props: '사다리차', continuity: '젖은 난간' },
            { id: 'office', name: '작은 사무실', space: '책상 하나', lighting: '따뜻한 스탠드', props: '견적표', continuity: '벽시계' },
        ],
        scenes: [
            {
                id: 'scene_01', title: '위험한 할인', dramatic_beat: '위험을 뒤늦게 본다.',
                characters: ['mentor', 'hero'], location_id: 'apartment', duration: 5,
                first_frame: '빗속 사다리차', action: '주인공이 흔들리는 냉장고를 붙든다.',
                camera: '낮은 앵글', lighting: '청회색 역광', audio_sfx_dialogue: '빗소리',
            },
            {
                id: 'scene_02', title: '남는 숫자', dramatic_beat: '가격 대신 기준을 택한다.',
                characters: ['hero'], location_id: 'office', duration: 5,
                first_frame: '견적표 위 계산기', action: '주인공이 손익 숫자에 밑줄을 긋는다.',
                camera: '탑샷', lighting: '따뜻한 스탠드', audio_sfx_dialogue: '',
            },
        ],
    };
}

function setup(t, aspectRatio = '9:16') {
    const parts = fixture(t);
    draftProvider.saveNewProjectDraft({
        production_id: 'image-plan-01', brief: '할인 경쟁을 멈추는 사장의 이야기.',
        script: '비 오는 현장의 위험을 본 뒤 손익 기준을 다시 세운다.', route: 'both',
        aspect_ratio: aspectRatio, scene_duration: 5, max_scenes: 4,
    }, { userDataPath: parts.userDataPath });
    const empty = designProvider.getNewProjectDesignState({ userDataPath: parts.userDataPath });
    const saved = designProvider.saveNewProjectDesignBoard({
        board: board(), expected_planning_revision_sha256: empty.planning_revision_sha256,
        expected_design_revision_sha256: empty.revision_sha256,
    }, { userDataPath: parts.userDataPath });
    return { ...parts, design: saved };
}

function savePlan(parts, state = imagePlanProvider.getNewProjectImagePlan(parts)) {
    return imagePlanProvider.saveNewProjectImagePlan({
        tasks: state.tasks,
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.revision_sha256,
    }, parts);
}

test('image plan derives deterministic sheet-first sequence and saves an exact private editable plan', (t) => {
    const parts = setup(t);
    const derived = imagePlanProvider.getNewProjectImagePlan(parts);
    assert.equal(derived.status, 'derived');
    assert.deepEqual(derived.tasks.map((task) => task.kind), [
        'character_sheet', 'character_sheet', 'location_sheet', 'location_sheet', 'scene_image', 'scene_image',
    ]);
    assert.deepEqual(derived.tasks.map((task) => task.sequence), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(derived.tasks[4].reference_task_ids, [
        derived.tasks[0].task_token, derived.tasks[1].task_token, derived.tasks[2].task_token,
    ], 'scene references follow design character order, then its location');
    assert.match(derived.tasks[0].prompt, /인물 시트/);
    assert.match(derived.tasks[4].prompt, /첫 프레임: 빗속 사다리차/);
    assert.match(derived.tasks[4].prompt, /텍스트·로고·워터마크 없음/);
    assert.doesNotMatch(derived.tasks[4].prompt, /빗소리/, 'audio is not copied into the still-image core prompt');

    const edited = structuredClone(derived.tasks);
    edited[4].prompt += ' / 긴장감이 선명한 구도';
    const saved = imagePlanProvider.saveNewProjectImagePlan({
        tasks: edited, expected_design_revision_sha256: derived.design_revision_sha256,
        expected_image_plan_revision_sha256: derived.revision_sha256,
    }, parts);
    assert.equal(saved.status, 'saved');
    assert.equal(saved.tasks[4].prompt, edited[4].prompt);
    const paths = imagePlanProvider.exactPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(paths.root).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(paths.planPath).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(saved).includes(parts.base), false, 'renderer state is pathless');
});

test('image prompts follow the saved 16:9 planning format instead of a fixed vertical default', (t) => {
    const parts = setup(t, '16:9');
    const derived = imagePlanProvider.getNewProjectImagePlan(parts);
    assert.equal(derived.tasks.every((task) => task.prompt.includes('16:9 가로형')), true);
    assert.equal(derived.tasks.some((task) => task.prompt.includes('9:16 세로형')), false);
});

test('whole-plan save rejects identity/status injection and design drift blocks preparation', (t) => {
    const parts = setup(t);
    const saved = savePlan(parts);
    const injected = structuredClone(saved.tasks);
    injected[0].label = '다른 항목';
    assert.throws(() => imagePlanProvider.saveNewProjectImagePlan({
        tasks: injected, expected_design_revision_sha256: saved.design_revision_sha256,
        expected_image_plan_revision_sha256: saved.revision_sha256,
    }, parts), { code: 'IMAGE_PLAN_TASK_SET_MISMATCH' });
    const spoofed = structuredClone(saved.tasks);
    spoofed[0].status = '결과연결';
    spoofed[0].result_token = `result_${'a'.repeat(64)}`;
    assert.throws(() => imagePlanProvider.saveNewProjectImagePlan({
        tasks: spoofed, expected_design_revision_sha256: saved.design_revision_sha256,
        expected_image_plan_revision_sha256: saved.revision_sha256,
    }, parts), { code: 'IMAGE_PLAN_RESULT_STATE_IMMUTABLE' });

    const changedBoard = structuredClone(board());
    changedBoard.scenes[0].action = '주인공이 냉장고를 붙들고 선배에게 위험을 알린다.';
    designProvider.saveNewProjectDesignBoard({
        board: changedBoard, expected_planning_revision_sha256: parts.design.planning_revision_sha256,
        expected_design_revision_sha256: parts.design.revision_sha256,
    }, parts);
    const stale = imagePlanProvider.getNewProjectImagePlan(parts);
    assert.equal(stale.status, 'design_changed');
    assert.deepEqual(stale.blockers, ['IMAGE_PLAN_DESIGN_STALE']);
    assert.match(stale.tasks[4].prompt, /선배에게 위험을 알린다/);
    assert.throws(() => imagePlanProvider.prepareNewProjectImagePlan({
        expected_design_revision_sha256: stale.design_revision_sha256,
        expected_image_plan_revision_sha256: stale.revision_sha256,
    }, parts), { code: 'IMAGE_PLAN_DESIGN_STALE' });
    const rebased = savePlan(parts, stale);
    assert.equal(rebased.status, 'saved');
    assert.equal(rebased.blockers.length, 0);
});

test('preparation queues only missing or retry tasks in deterministic order without execution', (t) => {
    const parts = setup(t);
    const saved = savePlan(parts);
    const prepared = imagePlanProvider.prepareNewProjectImagePlan({
        expected_design_revision_sha256: saved.design_revision_sha256,
        expected_image_plan_revision_sha256: saved.revision_sha256,
    }, parts);
    assert.equal(prepared.queued, true);
    assert.equal(prepared.task_count, 4);
    assert.deepEqual(prepared.tasks.map((task) => task.sequence), [1, 2, 3, 4]);
    assert.equal(prepared.tasks.every((task) => task.kind.endsWith('_sheet')), true,
        'scene images wait until their character and location sheet results are connected');
    assert.equal(prepared.executed, false);
    assert.equal(prepared.model_called, false);
    assert.equal(prepared.generation_executed, false);
    assert.equal(prepared.state.preparation.status, 'queued');
    assert.deepEqual(prepared.state.preparation.task_tokens, prepared.tasks.map((task) => task.task_token));
    const paths = imagePlanProvider.exactPaths(parts.userDataPath);
    const queueFile = path.join(paths.queueRoot, `${prepared.preparation_token}.json`);
    assert.equal(fs.lstatSync(paths.queueRoot).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(queueFile).mode & 0o777, 0o600);
    const record = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
    assert.deepEqual(record.tasks.map((task) => task.kind), prepared.tasks.map((task) => task.kind));
    assert.equal(JSON.stringify(record).includes(parts.base), false);
});

test('scene image preparation opens only after every referenced character and location sheet result is connected', (t) => {
    const parts = setup(t);
    let state = savePlan(parts);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
    const context = {
        ...parts,
        getDstBundleImportPreview: () => ({
            ready: true,
            preview: { mime_type: 'image/png', byte_length: png.byteLength, base64: png.toString('base64') },
            blockers: [],
        }),
    };
    for (const task of state.tasks.filter((item) => item.kind.endsWith('_sheet'))) {
        state = imagePlanProvider.connectNewProjectImageResult({
            task_token: task.task_token, candidate_token: 'local-reference-fixture', image_index: 1,
            expected_design_revision_sha256: state.design_revision_sha256,
            expected_image_plan_revision_sha256: state.revision_sha256,
        }, context).state;
    }
    const prepared = imagePlanProvider.prepareNewProjectImagePlan({
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.revision_sha256,
    }, context);
    assert.deepEqual(prepared.tasks.map((task) => task.kind), ['scene_image', 'scene_image']);
    assert.deepEqual(prepared.tasks.map((task) => task.sequence), [5, 6]);
    assert.equal(prepared.tasks.every((task) => task.reference_task_ids.length > 0), true);
});

test('MOCK DST public preview connects a private result, previews it, selects retry, and excludes linked non-retry work', (t) => {
    const parts = setup(t);
    let state = savePlan(parts);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const context = {
        ...parts,
        getDstBundleImportWorkspace: () => ({
            status: 'ready', candidates: [{
                candidate_token: 'opaque-candidate', created_at: '2026-07-16T00:00:00.000Z', image_count: 2,
                prompt_excerpt: 'must not leak', mime_type: 'image/png', size_bytes: 11, total_size_bytes: 22,
            }], blockers: [],
        }),
        getDstBundleImportPreview: ({ candidateToken, imageIndex }) => ({
            ready: candidateToken === 'opaque-candidate' && imageIndex === 2,
            preview: { mime_type: 'image/png', byte_length: png.byteLength, base64: png.toString('base64') },
            blockers: [],
        }),
    };
    const workspace = imagePlanProvider.getNewProjectImageResultWorkspace(context);
    assert.deepEqual(workspace.candidates, [{
        candidate_token: 'opaque-candidate', created_at: '2026-07-16T00:00:00.000Z', image_count: 2,
    }]);
    const connected = imagePlanProvider.connectNewProjectImageResult({
        task_token: state.tasks[0].task_token, candidate_token: 'opaque-candidate', image_index: 2,
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.revision_sha256,
    }, context);
    state = connected.state;
    assert.equal(state.tasks[0].status, '결과연결');
    assert.match(state.tasks[0].result_token, /^result_[a-f0-9]{64}$/);
    const paths = imagePlanProvider.exactPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(path.join(paths.resultsRoot, `${connected.result_token}.bin`)).mode & 0o777, 0o600);
    const preview = imagePlanProvider.getNewProjectImageResultPreview({ result_token: connected.result_token }, context);
    assert.equal(Buffer.from(preview.preview.base64, 'base64').equals(png), true);
    assert.equal(JSON.stringify(state).includes(preview.preview.base64), false, 'base64 is absent from normal state');

    const retry = imagePlanProvider.saveNewProjectImageRetrySelection({
        task_tokens: [state.tasks[0].task_token],
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.revision_sha256,
    }, context);
    assert.equal(retry.tasks[0].status, '재제작');
    const prepared = imagePlanProvider.prepareNewProjectImagePlan({
        expected_design_revision_sha256: retry.design_revision_sha256,
        expected_image_plan_revision_sha256: retry.revision_sha256,
    }, context);
    assert.deepEqual(prepared.tasks.map((task) => task.task_token), retry.tasks.slice(0, 4).map((task) => task.task_token),
        'selected retry plus eligible missing sheets remain in sequence while scenes wait for references');

    const cleared = imagePlanProvider.saveNewProjectImageRetrySelection({
        task_tokens: [], expected_design_revision_sha256: retry.design_revision_sha256,
        expected_image_plan_revision_sha256: retry.revision_sha256,
    }, context);
    const preparedWithoutLinked = imagePlanProvider.prepareNewProjectImagePlan({
        expected_design_revision_sha256: cleared.design_revision_sha256,
        expected_image_plan_revision_sha256: cleared.revision_sha256,
    }, context);
    assert.equal(preparedWithoutLinked.tasks.some((task) => task.task_token === cleared.tasks[0].task_token), false);
});

test('MOCK main-only execution references bind current plan tasks to validated typed image bytes', (t) => {
    const parts = setup(t);
    let state = savePlan(parts);
    const images = [
        { mime: 'image/png', extension: '.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) },
        { mime: 'image/jpeg', extension: '.jpg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]) },
        { mime: 'image/webp', extension: '.webp', buffer: Buffer.from('RIFF0000WEBPdata') },
    ];
    const context = {
        ...parts,
        getDstBundleImportPreview: ({ imageIndex }) => {
            const image = images[imageIndex - 1];
            return {
                ready: Boolean(image),
                preview: image ? {
                    mime_type: image.mime,
                    byte_length: image.buffer.byteLength,
                    base64: image.buffer.toString('base64'),
                } : null,
                blockers: image ? [] : ['MISSING'],
            };
        },
    };
    const linked = [];
    for (let index = 0; index < images.length; index += 1) {
        const connected = imagePlanProvider.connectNewProjectImageResult({
            task_token: state.tasks[index].task_token,
            candidate_token: `typed-${index + 1}`,
            image_index: index + 1,
            expected_design_revision_sha256: state.design_revision_sha256,
            expected_image_plan_revision_sha256: state.revision_sha256,
        }, context);
        state = connected.state;
        linked.push({ task: state.tasks[index], image: images[index] });
    }
    for (const { task, image } of linked) {
        const reference = imagePlanProvider.readNewProjectImageExecutionReference({
            result_token: task.result_token,
            expected_task_token: task.task_token,
            expected_design_revision_sha256: state.design_revision_sha256,
            expected_image_plan_revision_sha256: state.revision_sha256,
        }, context);
        assert.equal(reference.extension, image.extension);
        assert.equal(reference.mime_type, image.mime);
        assert.equal(reference.buffer.equals(image.buffer), true);
        assert.match(reference.sha256, /^[a-f0-9]{64}$/);
    }
    assert.throws(() => imagePlanProvider.readNewProjectImageExecutionReference({
        result_token: linked[0].task.result_token,
        expected_task_token: linked[0].task.task_token,
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: 'f'.repeat(64),
    }, context), { code: 'IMAGE_PLAN_EXECUTION_REFERENCE_STALE' });

    const paths = imagePlanProvider.exactPaths(parts.userDataPath);
    const webpManifestPath = path.join(paths.resultsRoot, `${linked[2].task.result_token}.json`);
    const webpManifest = JSON.parse(fs.readFileSync(webpManifestPath, 'utf8'));
    fs.writeFileSync(webpManifestPath, `${JSON.stringify({ ...webpManifest, mime_type: 'image/png' })}\n`, { mode: 0o600 });
    assert.throws(() => imagePlanProvider.readNewProjectImageExecutionReference({
        result_token: linked[2].task.result_token,
        expected_task_token: linked[2].task.task_token,
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.revision_sha256,
    }, context), { code: 'IMAGE_PLAN_RESULT_INVALID' });
    fs.writeFileSync(webpManifestPath, `${JSON.stringify(webpManifest)}\n`, { mode: 0o600 });

    state = imagePlanProvider.saveNewProjectImageRetrySelection({
        task_tokens: [linked[0].task.task_token],
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.revision_sha256,
    }, context);
    assert.throws(() => imagePlanProvider.readNewProjectImageExecutionReference({
        result_token: linked[0].task.result_token,
        expected_task_token: linked[0].task.task_token,
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.revision_sha256,
    }, context), { code: 'IMAGE_PLAN_EXECUTION_REFERENCE_STALE' });
});
