import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    createFinishingWorkbenchProvider,
    FINISHING_OUTPUT_CONTRACT_VERSION,
    runBoundedProcess,
} = require('../electron/lib/finishingWorkbenchProvider.js');

const PROJECT_ID = 'synthetic_project';
const EPISODE_ID = 'episode_01';

function writeJson(target, value) {
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function fileSha256(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function rewriteCurrentEvidence(root, runId, mutateProbe, mutateReceipt = () => {}) {
    const runsRoot = path.join(root, 'final', 'workbench_runs');
    const runRoot = path.join(runsRoot, runId);
    const probePath = path.join(runRoot, 'fresh_probe.json');
    const receiptPath = path.join(runRoot, 'receipt.json');
    const pointerPath = path.join(runsRoot, 'current.json');
    const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
    mutateProbe(probe);
    writeJson(probePath, probe);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.probe_sha256 = fileSha256(probePath);
    mutateReceipt(receipt);
    writeJson(receiptPath, receipt);
    const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    pointer.receipt_sha256 = fileSha256(receiptPath);
    writeJson(pointerPath, pointer);
}

function makeFixture(t, overrides = {}) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-finishing-provider-'));
    const root = path.join(base, PROJECT_ID);
    const harnessRoot = path.join(base, 'happyVideoFactory');
    const adapterPath = path.join(base, 'finishing_adapter.py');
    fs.mkdirSync(path.join(root, 'takes'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(root, 'final'), { recursive: true, mode: 0o700 });
    for (const relativePath of [
        'video_core/short_drama/edit/timeline_builder.py',
        'video_core/short_drama/edit/roughcut_ffmpeg.py',
        'video_core/short_drama/edit/timeline_model.py',
        'video_core/ffmpeg/duration.py',
        'video_core/ffmpeg_runtime.py',
        'video_core/short_drama_room/contracts.py',
        'video_core/short_drama_room/validator.py',
    ]) {
        const target = path.join(harnessRoot, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, `# synthetic harness marker\n${relativePath}\n`, { mode: 0o600 });
    }
    fs.writeFileSync(adapterPath, '# synthetic fixed adapter\n', { mode: 0o600 });

    const sources = [
        path.join(root, 'takes', 'shot_b.mp4'),
        path.join(root, 'takes', 'shot_a.mp4'),
    ];
    sources.forEach((source, index) => fs.writeFileSync(source, `source-${index}`, { mode: 0o600 }));

    writeJson(path.join(root, 'beats.json'), {
        schema_version: 'short-drama-room-beats-v1',
        project_id: PROJECT_ID,
        episode_id: EPISODE_ID,
        runtime_target_sec: 5,
        beats: [
            { beat_id: 'beat_a', scene_id: 'scene_01', order: 1, title: 'A', summary: 'A', characters_present: [], emotional_beat: 'A', target_duration_sec: 2 },
            { beat_id: 'beat_b', scene_id: 'scene_01', order: 2, title: 'B', summary: 'B', characters_present: [], emotional_beat: 'B', target_duration_sec: 3 },
        ],
    });
    writeJson(path.join(root, 'shot_manifest.json'), {
        schema_version: 'short-drama-room-shot-manifest-v1',
        project_id: PROJECT_ID,
        episode_id: EPISODE_ID,
        runtime_target_sec: 5,
        aspect_ratio: '9:16',
        shots: [
            { shot_id: 'shot_a', scene_id: 'scene_01', dialogue: [] },
            { shot_id: 'shot_b', scene_id: 'scene_01', dialogue: [] },
        ],
    });
    // Deliberately reverse the selected_takes array. Canonical beat order must win.
    writeJson(path.join(root, 'selected_takes.json'), {
        schema_version: 'short-drama-room-selected-takes-v1',
        project_id: PROJECT_ID,
        episode_id: EPISODE_ID,
        takes: [
            {
                shot_id: 'shot_b', chosen_provider: 'flow', video_path: sources[0],
                dialogue_source: 'native_video_lipsync', qc_report_ref: 'shot_b',
                selected_at: '2026-07-14T00:00:00+09:00', beat_id: 'beat_b', take_id: 'take_b',
                source_in_sec: 0.25, source_out_sec: 3.25, transition_in: { type: 'cut', dur: 0 },
            },
            {
                shot_id: 'shot_a', chosen_provider: 'seedance', video_path: sources[1],
                dialogue_source: 'native_video_lipsync', qc_report_ref: 'shot_a',
                selected_at: '2026-07-14T00:00:00+09:00', beat_id: 'beat_a', take_id: 'take_a',
                source_in_sec: 1, source_out_sec: 3, transition_in: { type: 'cut', dur: 0 },
            },
        ],
    });
    writeJson(path.join(root, 'qc_report.json'), {
        schema_version: 'short-drama-room-qc-report-v1',
        project_id: PROJECT_ID,
        episode_id: EPISODE_ID,
        shot_qc: [
            { shot_id: 'shot_a', provider: 'seedance', deterministic_checks_passed: true, gemini_findings: [], dialogue_intelligibility_score: 0.95, pronunciation_risk_flag: false, decision: 'accept' },
            { shot_id: 'shot_b', provider: 'flow', deterministic_checks_passed: true, gemini_findings: [], dialogue_intelligibility_score: 0.92, pronunciation_risk_flag: false, decision: 'accept' },
        ],
        subtitle_audio_drift_s: 0.03,
    });
    const selectedTime = new Date('2026-07-14T00:00:00.000Z');
    const qcTime = new Date('2026-07-14T00:01:00.000Z');
    fs.utimesSync(path.join(root, 'selected_takes.json'), selectedTime, selectedTime);
    fs.utimesSync(path.join(root, 'qc_report.json'), qcTime, qcTime);

    const binaries = Object.freeze({
        python: { path: '/main-owned/python3', version: 'Python 3.11.7', identity: 'python-identity' },
        ffmpeg: { path: '/main-owned/ffmpeg', version: 'ffmpeg 4.3.2', identity: 'ffmpeg-identity' },
        ffprobe: { path: '/main-owned/ffprobe', version: 'ffprobe 4.3.2', identity: 'ffprobe-identity' },
    });
    const mediaProbe = async (sourcePath) => ({
        duration_seconds: sourcePath.endsWith('roughcut.mp4') ? 5 : 4,
        has_video: true,
        has_audio: true,
        video_codec: 'h264',
        audio_codec: 'aac',
        width: 360,
        height: 640,
        fps: 24,
    });
    const render = async ({ outputPath, renderPayload }) => {
        fs.writeFileSync(outputPath, 'synthetic-rendered-media', { mode: 0o600 });
        return {
            success: true,
            total_duration_seconds: 5,
            shot_ids: renderPayload.expected_order.map((entry) => entry.shot_id),
            beat_ids: renderPayload.expected_order.map((entry) => entry.beat_id),
            ranges: renderPayload.expected_order.map((entry) => [entry.source_in_sec, entry.source_out_sec]),
        };
    };
    const provider = createFinishingWorkbenchProvider({
        config: { productionRoot: root },
        harnessRoot,
        adapterPath,
        runtimeResolver: overrides.runtimeResolver || (async () => binaries),
        mediaProbe: overrides.mediaProbe || mediaProbe,
        render: overrides.render || render,
        now: overrides.now || (() => new Date('2026-07-14T04:00:00.000Z')),
        nowMs: overrides.nowMs || (() => Date.parse('2026-07-14T04:00:00.000Z')),
        randomBytes: (size) => Buffer.alloc(size, 7),
        planStore: new Map(),
    });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root, harnessRoot, adapterPath, sources, binaries, mediaProbe, render, provider };
}

test('pathless plan binds canonical beat order and exposes no privileged execution data', async (t) => {
    const { provider, root, harnessRoot } = makeFixture(t);
    const plan = await provider.plan();

    assert.equal(plan.ok, true);
    assert.equal(plan.status, 'ready');
    assert.equal(plan.ready, true);
    assert.equal(plan.project_id, PROJECT_ID);
    assert.equal(plan.selected_range_count, 2);
    assert.equal(plan.selected_duration_seconds, 5);
    assert.equal(plan.input_ready, true);
    assert.equal(plan.qc_ready, true);
    assert.equal(plan.harness_ready, true);
    assert.equal(plan.runtime_ready, true);
    assert.equal(plan.output_contract.version, FINISHING_OUTPUT_CONTRACT_VERSION);
    assert.match(plan.plan_token, /^[a-f0-9]{64}$/);
    assert.match(plan.expires_at, /^2026-07-14T04:02:00\.000Z$/);
    assert.deepEqual(plan.blockers, []);

    const publicText = JSON.stringify(plan);
    assert.equal(publicText.includes(root), false);
    assert.equal(publicText.includes(harnessRoot), false);
    assert.doesNotMatch(publicText, /main-owned|argv|command|cwd|video_path|source_path|binary_path/);
});

test('plan expiry, source drift, and harness drift reject without any publication', async (t) => {
    let clock = Date.parse('2026-07-14T04:00:00.000Z');
    const expired = makeFixture(t, { nowMs: () => clock });
    const expiredPlan = await expired.provider.plan();
    clock += 120_001;
    await assert.rejects(expired.provider.execute({
        planToken: expiredPlan.plan_token,
        confirmed: true,
        projectId: PROJECT_ID,
    }), /FINISHING_PLAN_EXPIRED/);

    const sourceDrift = makeFixture(t);
    const sourcePlan = await sourceDrift.provider.plan();
    fs.appendFileSync(sourceDrift.sources[0], 'drift');
    await assert.rejects(sourceDrift.provider.execute({
        planToken: sourcePlan.plan_token,
        confirmed: true,
        projectId: PROJECT_ID,
    }), /FINISHING_PLAN_DRIFT/);

    const harnessDrift = makeFixture(t);
    const harnessPlan = await harnessDrift.provider.plan();
    fs.appendFileSync(path.join(harnessDrift.harnessRoot, 'video_core/short_drama/edit/timeline_builder.py'), '# drift\n');
    await assert.rejects(harnessDrift.provider.execute({
        planToken: harnessPlan.plan_token,
        confirmed: true,
        projectId: PROJECT_ID,
    }), /FINISHING_PLAN_DRIFT/);
    for (const current of [expired, sourceDrift, harnessDrift]) {
        assert.equal(fs.existsSync(path.join(current.root, 'final', 'workbench_runs', 'current.json')), false);
    }
});

test('selected, QC, beats, shot, binary, and output-state drift all reject the bound plan', async (t) => {
    for (const name of ['selected_takes.json', 'qc_report.json', 'beats.json', 'shot_manifest.json']) {
        const current = makeFixture(t);
        const plan = await current.provider.plan();
        fs.appendFileSync(path.join(current.root, name), '\n');
        if (name === 'selected_takes.json') {
            const later = new Date('2026-07-14T00:02:00.000Z');
            fs.utimesSync(path.join(current.root, 'qc_report.json'), later, later);
        }
        await assert.rejects(current.provider.execute({
            planToken: plan.plan_token, confirmed: true, projectId: PROJECT_ID,
        }), /FINISHING_PLAN_DRIFT/, name);
    }

    let runtimeRevision = 'v1';
    const runtime = makeFixture(t, {
        runtimeResolver: async () => ({
            python: { path: '/main-owned/python3', version: 'Python 3.11.7', identity: `python-${runtimeRevision}` },
            ffmpeg: { path: '/main-owned/ffmpeg', version: 'ffmpeg 4.3.2', identity: `ffmpeg-${runtimeRevision}` },
            ffprobe: { path: '/main-owned/ffprobe', version: 'ffprobe 4.3.2', identity: `ffprobe-${runtimeRevision}` },
        }),
    });
    const runtimePlan = await runtime.provider.plan();
    runtimeRevision = 'v2';
    await assert.rejects(runtime.provider.execute({
        planToken: runtimePlan.plan_token, confirmed: true, projectId: PROJECT_ID,
    }), /FINISHING_PLAN_DRIFT/);

    const output = makeFixture(t);
    const outputPlan = await output.provider.plan();
    const runs = path.join(output.root, 'final', 'workbench_runs');
    fs.mkdirSync(runs, { mode: 0o700 });
    fs.mkdirSync(path.join(runs, 'b'.repeat(24)), { mode: 0o700 });
    await assert.rejects(output.provider.execute({
        planToken: outputPlan.plan_token, confirmed: true, projectId: PROJECT_ID,
    }), /FINISHING_PLAN_DRIFT/);
});

test('source-parent symlink, cooperative lock, malformed current pointer, and partial staging fail closed', async (t) => {
    const symlinked = makeFixture(t);
    const outside = path.join(symlinked.base, 'outside-takes');
    fs.mkdirSync(outside);
    fs.renameSync(symlinked.sources[0], path.join(outside, 'shot_b.mp4'));
    fs.renameSync(symlinked.sources[1], path.join(outside, 'shot_a.mp4'));
    fs.rmdirSync(path.join(symlinked.root, 'takes'));
    fs.symlinkSync(outside, path.join(symlinked.root, 'takes'));
    const symlinkPlan = await symlinked.provider.plan();
    assert.equal(symlinkPlan.ready, false);
    assert.equal(symlinkPlan.blockers.includes('FINISHING_SOURCE_SYMLINK_FORBIDDEN'), true);
    assert.equal(JSON.stringify(symlinkPlan).includes(outside), false);

    for (const [name, setup, expected] of [
        ['lock', (runs) => fs.writeFileSync(path.join(runs, '.workbench.lock'), 'other'), 'FINISHING_CONCURRENT_LOCKED'],
        ['partial', (runs) => fs.mkdirSync(path.join(runs, '.staging-orphan')), 'FINISHING_PARTIAL_PUBLICATION_PRESENT'],
        ['pointer', (runs) => fs.writeFileSync(path.join(runs, 'current.json'), '{bad'), 'FINISHING_CURRENT_POINTER'],
        ['pointer-symlink', (runs) => fs.symlinkSync('/dev/null', path.join(runs, 'current.json')), 'FINISHING_OUTPUT_SYMLINK_FORBIDDEN'],
    ]) {
        const current = makeFixture(t);
        const runs = path.join(current.root, 'final', 'workbench_runs');
        fs.mkdirSync(runs, { mode: 0o700 });
        setup(runs);
        const plan = await current.provider.plan();
        assert.equal(plan.ready, false, name);
        assert.equal(plan.blockers.some((blocker) => blocker.startsWith(expected)), true, `${name}:${plan.blockers}`);
    }
});

test('oversized canonical JSON, sparse media, render output, and subprocess output fail closed', async (t) => {
    const oversizedJson = makeFixture(t);
    fs.writeFileSync(path.join(oversizedJson.root, 'selected_takes.json'), Buffer.alloc(512 * 1024 + 1, 0x20));
    const jsonPlan = await oversizedJson.provider.plan();
    assert.equal(jsonPlan.ready, false);
    assert.equal(jsonPlan.blockers.some((blocker) => blocker.includes('SIZE_INVALID')), true);

    const oversizedSource = makeFixture(t);
    fs.truncateSync(oversizedSource.sources[0], 16 * 1024 * 1024 * 1024 + 1);
    const sourcePlan = await oversizedSource.provider.plan();
    assert.equal(sourcePlan.ready, false);
    assert.equal(sourcePlan.blockers.includes('FINISHING_SOURCE_SIZE_INVALID'), true);

    const oversizedOutput = makeFixture(t, {
        render: async ({ outputPath, renderPayload }) => {
            fs.writeFileSync(outputPath, 'x');
            fs.truncateSync(outputPath, 16 * 1024 * 1024 * 1024 + 1);
            return {
                success: true,
                total_duration_seconds: 5,
                shot_ids: renderPayload.expected_order.map((entry) => entry.shot_id),
                beat_ids: renderPayload.expected_order.map((entry) => entry.beat_id),
                ranges: renderPayload.expected_order.map((entry) => [entry.source_in_sec, entry.source_out_sec]),
            };
        },
    });
    const outputPlan = await oversizedOutput.provider.plan();
    await assert.rejects(oversizedOutput.provider.execute({
        planToken: outputPlan.plan_token, confirmed: true, projectId: PROJECT_ID,
    }), /FINISHING_RENDER_OUTPUT_INVALID/);

    for (const stream of ['stdout', 'stderr']) {
        const script = `process.${stream}.write('x'.repeat(4096))`;
        await assert.rejects(runBoundedProcess(process.execPath, ['-e', script], {
            cwd: '/', env: { PATH: '/usr/bin:/bin' }, timeoutMs: 5_000, maxOutputBytes: 1024,
        }), /FINISHING_PROCESS_OUTPUT_TOO_LARGE/);
    }
});

test('render failure cleans lock and staging while preserving canonical files', async (t) => {
    const current = makeFixture(t, {
        render: async ({ outputPath }) => {
            fs.writeFileSync(outputPath, 'partial');
            throw Object.assign(new Error('synthetic render failure'), { code: 'FINISHING_RENDER_FAILED' });
        },
    });
    const selectedBefore = fs.readFileSync(path.join(current.root, 'selected_takes.json'));
    const plan = await current.provider.plan();
    await assert.rejects(current.provider.execute({
        planToken: plan.plan_token,
        confirmed: true,
        projectId: PROJECT_ID,
    }), /FINISHING_RENDER_FAILED/);
    const runs = path.join(current.root, 'final', 'workbench_runs');
    assert.deepEqual(fs.readdirSync(runs), []);
    assert.deepEqual(fs.readFileSync(path.join(current.root, 'selected_takes.json')), selectedBefore);
});

test('tampered receipt and output are blockers after relaunch and never imply quality approval', async (t) => {
    for (const targetName of ['receipt.json', 'roughcut.mp4']) {
        const current = makeFixture(t);
        const plan = await current.provider.plan();
        const result = await current.provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: PROJECT_ID });
        fs.appendFileSync(path.join(current.root, 'final', 'workbench_runs', result.run_id, targetName), 'tamper');
        const restored = await current.provider.getWorkspace();
        assert.equal(restored.status, 'blocked');
        assert.equal(restored.current_run, null);
        assert.equal(restored.output_quality_approved, false);
        assert.equal(restored.blockers.some((blocker) => /HASH|RECEIPT|CURRENT/.test(blocker)), true, `${targetName}:${restored.blockers}`);
    }
});

test('malformed persisted numeric, hash, and size evidence never restores fresh-probe success', async (t) => {
    const cases = [
        {
            name: 'duration-string',
            mutateProbe: (probe) => { probe.duration_seconds = 'not-a-number'; },
        },
        {
            name: 'serialized-non-finite-duration',
            mutateProbe: (probe) => {
                probe.duration_seconds = null;
                probe.selected_duration_seconds = null;
            },
            mutateReceipt: (receipt) => { receipt.selected_duration_seconds = null; },
        },
        {
            name: 'negative-range-count',
            mutateProbe: () => {},
            mutateReceipt: (receipt) => { receipt.selected_range_count = -1; },
        },
        {
            name: 'fractional-output-size',
            mutateProbe: (probe) => { probe.output_size_bytes = 1.5; },
            mutateReceipt: (receipt) => { receipt.output_size_bytes = 1.5; },
        },
        {
            name: 'invalid-output-hash',
            mutateProbe: (probe) => { probe.output_sha256 = 'not-a-hash'; },
            mutateReceipt: (receipt) => { receipt.output_sha256 = 'not-a-hash'; },
        },
    ];

    for (const currentCase of cases) {
        const current = makeFixture(t);
        const plan = await current.provider.plan();
        const result = await current.provider.execute({
            planToken: plan.plan_token,
            confirmed: true,
            projectId: PROJECT_ID,
        });
        rewriteCurrentEvidence(
            current.root,
            result.run_id,
            currentCase.mutateProbe,
            currentCase.mutateReceipt,
        );
        const workspace = await current.provider.getWorkspace();
        assert.equal(workspace.status, 'blocked', currentCase.name);
        assert.equal(workspace.current_run, null, currentCase.name);
        assert.equal(workspace.output_quality_approved, false, currentCase.name);
        assert.equal(workspace.blockers.some((code) => /^FINISHING_[A-Z0-9_]+$/.test(code)), true, currentCase.name);
        assert.equal(JSON.stringify(workspace).includes(current.root), false, currentCase.name);
    }
});

test('lock-open EACCES is normalized to a path-free public finishing error', async (t) => {
    const current = makeFixture(t);
    const plan = await current.provider.plan();
    const originalOpenSync = fs.openSync;
    let caught;
    fs.openSync = function openSyncWithDeniedLock(target, ...args) {
        if (String(target).endsWith('.workbench.lock')) {
            throw Object.assign(new Error(`EACCES: permission denied, open '${target}'`), { code: 'EACCES' });
        }
        return originalOpenSync.call(fs, target, ...args);
    };
    try {
        await current.provider.execute({
            planToken: plan.plan_token,
            confirmed: true,
            projectId: PROJECT_ID,
        });
    } catch (error) {
        caught = error;
    } finally {
        fs.openSync = originalOpenSync;
    }

    assert.equal(caught?.code, 'FINISHING_LOCK_ACQUIRE_FAILED');
    assert.equal(caught?.message, 'FINISHING_LOCK_ACQUIRE_FAILED: FINISHING_LOCK_ACQUIRE_FAILED');
    assert.equal(caught?.message.includes(current.root), false);
    assert.doesNotMatch(caught?.message || '', /EACCES|permission denied|open '/i);
    assert.equal(fs.existsSync(path.join(current.root, 'final', 'workbench_runs', '.workbench.lock')), false);
});

test('bounded subprocess terminates a timeout without using a shell', async () => {
    await assert.rejects(runBoundedProcess('/bin/sleep', ['5'], {
        cwd: '/', env: { PATH: '/usr/bin:/bin' }, timeoutMs: 20, maxOutputBytes: 1024,
    }), /FINISHING_PROCESS_TIMEOUT/);
});

test('registered workspace and plan IPC are pathless while execute accepts only the exact bounded envelope', async (t) => {
    const current = makeFixture(t);
    const filmProvider = require('../electron/lib/filmPipelineProvider.js');
    const handlers = new Map();
    const planStore = new Map();
    filmProvider.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
        readConfigFn: () => ({
            productionRoot: current.root,
            productionParentRoot: '',
            recentProductionRoots: [current.root],
            pathProvenanceVersion: 1,
            dryRunMode: true,
        }),
        finishingHarnessRoot: current.harnessRoot,
        finishingAdapterPath: current.adapterPath,
        finishingRuntimeResolver: async () => current.binaries,
        finishingMediaProbe: current.mediaProbe,
        finishingRender: current.render,
        finishingNow: () => new Date('2026-07-14T04:00:00.000Z'),
        finishingNowMs: () => Date.parse('2026-07-14T04:00:00.000Z'),
        finishingRandomBytes: (size) => Buffer.alloc(size, 9),
        finishingPlanStore: planStore,
    });
    const workspaceHandler = handlers.get('film-pipeline:get-finishing-workspace');
    const planHandler = handlers.get('film-pipeline:plan-finishing-run');
    const executeHandler = handlers.get('film-pipeline:execute-finishing-run');
    assert.equal(typeof workspaceHandler, 'function');
    assert.equal(typeof planHandler, 'function');
    assert.equal(typeof executeHandler, 'function');
    assert.throws(() => workspaceHandler({}, current.root), { code: 'RENDERER_PATH_ARGUMENT_FORBIDDEN' });
    assert.throws(() => planHandler({}, current.root), { code: 'RENDERER_PATH_ARGUMENT_FORBIDDEN' });
    const plan = await planHandler({}, undefined);
    assert.equal(plan.ready, true);
    await assert.rejects(executeHandler({}, {
        planToken: plan.plan_token,
        confirmed: true,
        projectId: PROJECT_ID,
        outputPath: path.join(current.root, 'final', 'injected.mp4'),
    }), /FINISHING_EXECUTION_ENVELOPE_INVALID/);
    assert.equal(fs.existsSync(path.join(current.root, 'final', 'injected.mp4')), false);
});

test('valid token is consumed before malformed confirmation envelopes are rejected', async (t) => {
    const { provider } = makeFixture(t);
    const cases = [
        (token) => ({ planToken: token, confirmed: false, projectId: PROJECT_ID }),
        (token) => ({ planToken: token, confirmed: true, projectId: PROJECT_ID, outputPath: '/tmp/injected' }),
        (token) => ({ planToken: token, confirmed: true, projectId: `${PROJECT_ID} ` }),
    ];

    for (const payload of cases) {
        const plan = await provider.plan();
        await assert.rejects(provider.execute(payload(plan.plan_token)), /FINISHING_/);
        await assert.rejects(provider.execute({
            planToken: plan.plan_token,
            confirmed: true,
            projectId: PROJECT_ID,
        }), /FINISHING_PLAN_TOKEN_INVALID/);
    }
});

test('exact confirmed execution atomically publishes a private current run and relaunch reconstructs it', async (t) => {
    const { provider, root } = makeFixture(t);
    const selectedBefore = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'selected_takes.json'))).digest('hex');
    const plan = await provider.plan();
    const result = await provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: PROJECT_ID });

    assert.equal(result.ok, true);
    assert.equal(result.executed, true);
    assert.equal(result.status, 'success');
    assert.equal(result.fresh_probe_verified, true);
    assert.equal(result.output_quality_approved, false);
    assert.match(result.run_id, /^[a-f0-9]{24}$/);
    assert.equal(result.output_duration_seconds, 5);
    assert.equal(result.selected_duration_seconds, 5);
    assert.equal(JSON.stringify(result).includes(root), false);

    const runRoot = path.join(root, 'final', 'workbench_runs', result.run_id);
    const expectedFiles = ['fresh_probe.json', 'receipt.json', 'roughcut.mp4'];
    assert.deepEqual(fs.readdirSync(runRoot).sort(), expectedFiles);
    assert.equal(fs.statSync(runRoot).mode & 0o777, 0o700);
    for (const name of expectedFiles) assert.equal(fs.statSync(path.join(runRoot, name)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(root, 'final', 'workbench_runs', 'current.json')).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(path.join(root, 'final', 'master.mp4')), false);
    assert.equal(fs.existsSync(path.join(root, 'final', 'delivery_manifest.json')), false);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'selected_takes.json'))).digest('hex'), selectedBefore);

    const workspace = await provider.getWorkspace();
    assert.equal(workspace.status, 'success');
    assert.equal(workspace.current_run.run_id, result.run_id);
    assert.equal(workspace.current_run.fresh_probe_verified, true);
    assert.equal(workspace.current_run.output_quality_approved, false);
    const noOpPlan = await provider.plan();
    assert.equal(noOpPlan.status, 'already_current');
    assert.equal(noOpPlan.already_current, true);
    assert.equal(noOpPlan.plan_token, '');
});

test('unsupported transition and out-of-bounds source range fail closed before token issuance', async (t) => {
    const first = makeFixture(t);
    const selectedPath = path.join(first.root, 'selected_takes.json');
    const selected = JSON.parse(fs.readFileSync(selectedPath, 'utf8'));
    selected.takes[0].transition_in = { type: 'crossfade', dur: 0.2 };
    writeJson(selectedPath, selected);
    const unsupported = await first.provider.plan();
    assert.equal(unsupported.ready, false);
    assert.equal(unsupported.plan_token, '');
    assert.equal(unsupported.blockers.includes('FINISHING_TRANSITION_UNSUPPORTED'), true);

    const second = makeFixture(t);
    const secondPath = path.join(second.root, 'selected_takes.json');
    const outOfBounds = JSON.parse(fs.readFileSync(secondPath, 'utf8'));
    outOfBounds.takes[0].source_out_sec = 4.5;
    writeJson(secondPath, outOfBounds);
    const rangePlan = await second.provider.plan();
    assert.equal(rangePlan.ready, false);
    assert.equal(rangePlan.blockers.includes('FINISHING_SOURCE_RANGE_EXCEEDS_MEDIA'), true);
});
