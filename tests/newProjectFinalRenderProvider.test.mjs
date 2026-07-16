import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import finalStitchProvider from '../electron/lib/newProjectFinalStitchProvider.js';
import finalRenderProvider from '../electron/lib/newProjectFinalRenderProvider.js';

function fixture(t, hooks = {}) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-final-render-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    draftProvider.saveNewProjectDraft({
        production_id: 'final-render-01', brief: '검토 영상', script: '장면 하나를 검토한다.',
        route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 2,
    }, { userDataPath });
    const sourcePath = path.join(base, 'source.mp4');
    fs.writeFileSync(sourcePath, 'private-video', { mode: 0o600 });
    const input = {
        project_id: 'final-render-01',
        design_revision_sha256: 'a'.repeat(64), image_plan_revision_sha256: 'b'.repeat(64),
        video_plan_revision_sha256: 'c'.repeat(64), clip_selection_revision_sha256: 'd'.repeat(64),
        clips: [{
            task_token: `task_${'1'.repeat(64)}`, result_token: `result_${'2'.repeat(64)}`,
            result_sha256: '3'.repeat(64), source_path: sourcePath, provider: 'grok',
            width: 360, height: 640, duration_seconds: 1, sequence: 1,
            source_id: 'scene_01', label: '첫 장면', in_seconds: 0.2, out_seconds: 0.8,
            reason: '표정이 자연스러운 구간', reviewer_confidence: 'high',
        }],
    };
    const stitchContext = { userDataPath, getCompleteNewProjectClipSelectionInput: () => structuredClone(input) };
    const ready = finalStitchProvider.getNewProjectFinalStitch(stitchContext);
    finalStitchProvider.stageNewProjectFinalStitch({ expected_revision: ready.revision }, stitchContext);
    let nowMs = 1_000;
    const runtime = {
        async inspect() { return { fingerprint: 'fixed-runtime', runtime: {}, harness: {} }; },
        async render(request) {
            fs.writeFileSync(request.outputPath, hooks.output || Buffer.from('mock-review-video'), { mode: 0o600 });
            if (hooks.afterRender) hooks.afterRender({ input, sourcePath });
            return {
                success: true, total_duration_seconds: 0.6, shot_ids: ['scene_01'],
                beat_ids: ['scene_01'], ranges: [[0.2, 0.8]], silent_audio_source_count: 1,
            };
        },
        async probe() {
            return { has_video: true, has_audio: true, duration_seconds: 0.6, video_codec: 'h264', audio_codec: 'aac', width: 360, height: 640, fps: 24 };
        },
    };
    const makeProvider = (extra = {}) => finalRenderProvider.createNewProjectFinalRenderProvider({
        userDataPath,
        getStagedInput: () => finalStitchProvider.getStagedNewProjectFinalStitchInput(stitchContext),
        runtime,
        planStore: extra.planStore || new Map(),
        nowMs: extra.nowMs || (() => nowMs),
        now: () => new Date(nowMs),
        randomBytes: (size) => Buffer.alloc(size, 7),
        ...extra,
    });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath, sourcePath, input, stitchContext, makeProvider, advance: (ms) => { nowMs += ms; } };
}

async function publishReviewVideo(fx) {
    const provider = fx.makeProvider();
    const plan = await provider.plan();
    assert.equal(plan.ready, true);
    await provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: 'final-render-01' });
    const paths = finalRenderProvider.pathsFor(fx.userDataPath);
    const pointer = JSON.parse(fs.readFileSync(paths.currentPath, 'utf8'));
    return { paths, runRoot: path.join(paths.runsRoot, pointer.run_id) };
}

test('MOCK: private final render uses one-shot plan, publishes exact artifacts, and exposes pathless review data', async (t) => {
    const fx = fixture(t);
    const provider = fx.makeProvider();
    const initial = await provider.get();
    assert.equal(initial.status, 'ready');
    assert.equal(initial.selected_count, 1);
    assert.equal(initial.selected_duration_seconds, 0.6);
    const plan = await provider.plan();
    assert.equal(plan.ready, true);
    assert.match(plan.plan_token, /^[a-f0-9]{64}$/);
    const rendered = await provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: 'final-render-01' });
    assert.equal(rendered.rendered, true);
    assert.equal(rendered.fresh_probe_verified, true);
    assert.equal(rendered.has_video, true);
    assert.equal(rendered.has_audio, true);
    assert.equal(rendered.output_quality_approved, false);
    assert.equal(rendered.generation_executed, false);
    assert.equal(rendered.legacy_production_modified, false);
    assert.equal(rendered.canonical_delivery_modified, false);
    const publicText = JSON.stringify(rendered);
    assert.equal(publicText.includes(fx.base), false);
    assert.doesNotMatch(publicText, /sha256|source_path|task_|result_|revision|run_id|payload|argv|ffmpeg|python/i);

    const paths = finalRenderProvider.pathsFor(fx.userDataPath);
    assert.equal(fs.lstatSync(paths.runsRoot).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(paths.currentPath).mode & 0o777, 0o600);
    const pointer = JSON.parse(fs.readFileSync(paths.currentPath, 'utf8'));
    assert.match(pointer.run_id, /^[a-f0-9]{24}$/);
    const runRoot = path.join(paths.runsRoot, pointer.run_id);
    assert.equal(fs.lstatSync(runRoot).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(runRoot).sort(), ['fresh_probe.json', 'receipt.json', 'roughcut.mp4']);
    for (const name of fs.readdirSync(runRoot)) assert.equal(fs.lstatSync(path.join(runRoot, name)).mode & 0o777, 0o600);
    const receipt = JSON.parse(fs.readFileSync(path.join(runRoot, 'receipt.json'), 'utf8'));
    assert.equal(receipt.rendered, true);
    assert.equal(receipt.fresh_probe_verified, true);
    assert.equal(receipt.output_quality_approved, false);
    assert.equal(receipt.generation_executed, false);
    assert.equal(receipt.legacy_production_modified, false);
    assert.equal(receipt.canonical_delivery_modified, false);
    const preview = await provider.preview();
    assert.deepEqual(Buffer.from(preview.base64, 'base64'), Buffer.from('mock-review-video'));
    assert.equal(JSON.stringify(preview).includes(fx.base), false);
    await assert.rejects(provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: 'final-render-01' }),
        { code: 'FINAL_RENDER_PLAN_INVALID' });
});

test('MOCK: relaunch restores an already-current private review video', async (t) => {
    const fx = fixture(t);
    const planStore = new Map();
    const first = fx.makeProvider({ planStore });
    const plan = await first.plan();
    await first.execute({ planToken: plan.plan_token, confirmed: true, projectId: 'final-render-01' });
    const relaunched = fx.makeProvider({ planStore: new Map() });
    const restored = await relaunched.get();
    assert.equal(restored.status, 'already_current');
    assert.equal(restored.rendered, true);
    const noOp = await relaunched.plan();
    assert.equal(noOp.ready, false);
    assert.equal(noOp.plan_token, '');
});

test('MOCK: a valid orphan run atomically restores current for get, plan, execute, and preview', async (t) => {
    const fx = fixture(t);
    const { paths, runRoot } = await publishReviewVideo(fx);

    fs.unlinkSync(paths.currentPath);
    const restoredByGet = await fx.makeProvider().get();
    assert.equal(restoredByGet.status, 'already_current');
    assert.equal(restoredByGet.rendered, true);
    assert.equal(fs.lstatSync(paths.currentPath).mode & 0o777, 0o600);

    fs.unlinkSync(paths.currentPath);
    const restoredByPlan = await fx.makeProvider().plan();
    assert.equal(restoredByPlan.status, 'already_current');
    assert.equal(restoredByPlan.ready, false);
    assert.equal(restoredByPlan.plan_token, '');

    fs.unlinkSync(paths.currentPath);
    const heldRun = path.join(fx.base, 'held-valid-run');
    fs.renameSync(runRoot, heldRun);
    const planStore = new Map();
    const executeProvider = fx.makeProvider({ planStore });
    const issued = await executeProvider.plan();
    assert.equal(issued.ready, true);
    fs.renameSync(heldRun, runRoot);
    const recoveredByExecute = await executeProvider.execute({
        planToken: issued.plan_token, confirmed: true, projectId: 'final-render-01',
    });
    assert.equal(recoveredByExecute.status, 'already_current');
    assert.equal(recoveredByExecute.rendered, true);
    assert.equal(recoveredByExecute.executed, false);
    const preview = await fx.makeProvider().preview();
    assert.equal(preview.ready, true);
    assert.deepEqual(Buffer.from(preview.base64, 'base64'), Buffer.from('mock-review-video'));
    assert.deepEqual(fs.readdirSync(paths.runsRoot).filter((name) => name.startsWith('.recover-')), []);
});

test('MOCK: stale snapshot A pointer atomically advances to valid snapshot B orphan under the render lock', async (t) => {
    const fx = fixture(t);
    const publishedA = await publishReviewVideo(fx);
    const pointerA = fs.readFileSync(publishedA.paths.currentPath);
    const runIdA = path.basename(publishedA.runRoot);

    fx.input.clips[0].reason = '새 검토 근거';
    const changed = finalStitchProvider.getNewProjectFinalStitch(fx.stitchContext);
    assert.equal(changed.status, 'upstream_changed');
    finalStitchProvider.stageNewProjectFinalStitch({ expected_revision: changed.revision }, fx.stitchContext);
    const publishedB = await publishReviewVideo(fx);
    const runIdB = path.basename(publishedB.runRoot);
    assert.notEqual(runIdB, runIdA);

    fs.writeFileSync(publishedB.paths.currentPath, pointerA, { mode: 0o600 });
    fs.writeFileSync(publishedB.paths.lockPath, 'busy\n', { mode: 0o600, flag: 'wx' });
    assert.equal((await fx.makeProvider().get()).status, 'blocked');
    assert.equal(JSON.parse(fs.readFileSync(publishedB.paths.currentPath, 'utf8')).run_id, runIdA,
        'a live render lock prevents recovery from replacing the current pointer');
    fs.unlinkSync(publishedB.paths.lockPath);
    const restoredByGet = await fx.makeProvider().get();
    assert.equal(restoredByGet.status, 'already_current');
    assert.equal(JSON.parse(fs.readFileSync(publishedB.paths.currentPath, 'utf8')).run_id, runIdB);

    fs.writeFileSync(publishedB.paths.currentPath, pointerA, { mode: 0o600 });
    const restoredByPlan = await fx.makeProvider().plan();
    assert.equal(restoredByPlan.status, 'already_current');
    assert.equal(restoredByPlan.ready, false);
    assert.equal(restoredByPlan.plan_token, '');

    fs.writeFileSync(publishedB.paths.currentPath, pointerA, { mode: 0o600 });
    const heldRunB = path.join(fx.base, 'held-run-b');
    fs.renameSync(publishedB.runRoot, heldRunB);
    const planStore = new Map();
    const executeProvider = fx.makeProvider({ planStore });
    const issued = await executeProvider.plan();
    assert.equal(issued.ready, true);
    fs.renameSync(heldRunB, publishedB.runRoot);
    const restoredByExecute = await executeProvider.execute({
        planToken: issued.plan_token, confirmed: true, projectId: 'final-render-01',
    });
    assert.equal(restoredByExecute.status, 'already_current');
    assert.equal(restoredByExecute.executed, false);
    assert.equal((await fx.makeProvider().preview()).ready, true);
    assert.deepEqual(fs.readdirSync(publishedB.paths.runsRoot)
        .filter((name) => /^[a-f0-9]{24}$/.test(name)).sort(), [runIdA, runIdB].sort());
    assert.equal(fs.existsSync(publishedB.paths.lockPath), false);
});

test('MOCK: tampered, stale, and symlink orphan runs remain untouched and fail closed', async (t) => {
    const tampered = fixture(t);
    let published = await publishReviewVideo(tampered);
    fs.unlinkSync(published.paths.currentPath);
    fs.appendFileSync(path.join(published.runRoot, 'roughcut.mp4'), 'tampered');
    assert.equal((await tampered.makeProvider().get()).status, 'blocked');
    assert.equal((await tampered.makeProvider().plan()).ready, false);
    assert.equal(fs.existsSync(published.paths.currentPath), false);
    assert.equal(fs.existsSync(published.runRoot), true);

    const stale = fixture(t);
    published = await publishReviewVideo(stale);
    fs.unlinkSync(published.paths.currentPath);
    const receiptPath = path.join(published.runRoot, 'receipt.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.snapshot_id = '0'.repeat(64);
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    assert.equal((await stale.makeProvider().get()).status, 'blocked');
    assert.equal((await stale.makeProvider().plan()).ready, false);
    assert.equal(fs.existsSync(published.paths.currentPath), false);
    assert.equal(fs.existsSync(published.runRoot), true);

    const symlink = fixture(t);
    published = await publishReviewVideo(symlink);
    fs.unlinkSync(published.paths.currentPath);
    const outsideRun = path.join(symlink.base, 'outside-run');
    fs.renameSync(published.runRoot, outsideRun);
    fs.symlinkSync(outsideRun, published.runRoot);
    assert.equal((await symlink.makeProvider().get()).status, 'blocked');
    assert.equal((await symlink.makeProvider().plan()).ready, false);
    assert.equal(fs.existsSync(published.paths.currentPath), false);
    assert.equal(fs.lstatSync(published.runRoot).isSymbolicLink(), true);
});

test('MOCK: exact envelope, expiration, and pre-render drift fail closed with consumed tokens', async (t) => {
    const fx = fixture(t);
    let provider = fx.makeProvider();
    let plan = await provider.plan();
    await assert.rejects(provider.execute({
        planToken: plan.plan_token, confirmed: true, projectId: 'final-render-01', path: '/tmp/injected',
    }), { code: 'FINAL_RENDER_EXECUTION_ENVELOPE_INVALID' });
    await assert.rejects(provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: 'final-render-01' }),
        { code: 'FINAL_RENDER_PLAN_INVALID' });

    provider = fx.makeProvider({ planTtlMs: 10 });
    plan = await provider.plan();
    fx.advance(11);
    await assert.rejects(provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: 'final-render-01' }),
        { code: 'FINAL_RENDER_PLAN_EXPIRED' });

    provider = fx.makeProvider();
    plan = await provider.plan();
    fs.appendFileSync(fx.sourcePath, 'changed');
    await assert.rejects(provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: 'final-render-01' }));
    const paths = finalRenderProvider.pathsFor(fx.userDataPath);
    assert.equal(fs.existsSync(paths.currentPath), false);
});

test('MOCK: post-render source drift removes staging and never publishes', async (t) => {
    const fx = fixture(t, { afterRender: ({ sourcePath }) => fs.appendFileSync(sourcePath, 'changed-during-render') });
    const provider = fx.makeProvider();
    const plan = await provider.plan();
    await assert.rejects(provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: 'final-render-01' }));
    const paths = finalRenderProvider.pathsFor(fx.userDataPath);
    assert.equal(fs.existsSync(paths.currentPath), false);
    assert.deepEqual(fs.readdirSync(paths.runsRoot).filter((name) => name.startsWith('.staging-')), []);
});
