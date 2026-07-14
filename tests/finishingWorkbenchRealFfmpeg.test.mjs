import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFinishingWorkbenchProvider } = require('../electron/lib/finishingWorkbenchProvider.js');

const HARNESS_ROOT = '/Users/jessiek/StudioProjects/happyVideoFactory';
const ADAPTER_PATH = path.resolve('scripts/run_selected_range_roughcut.py');
const FFMPEG_CANDIDATES = [
    '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/local/anaconda3/bin/ffmpeg',
    '/usr/bin/ffmpeg',
];

function executable(candidates) {
    return candidates.find((candidate) => {
        try { return fs.statSync(candidate).isFile() && (fs.statSync(candidate).mode & 0o111) !== 0; } catch { return false; }
    });
}

function run(binary, args, options = {}) {
    const result = spawnSync(binary, args, {
        cwd: options.cwd,
        env: options.env || { PATH: `${path.dirname(binary)}:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C' },
        shell: false,
        timeout: options.timeout || 60_000,
        encoding: options.encoding || 'utf8',
        maxBuffer: options.maxBuffer || 1024 * 1024,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, String(result.stderr || '').slice(-800));
    return result;
}

function writeJson(root, name, value) {
    fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function digest(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function sampleRgb(ffmpeg, output, atSeconds) {
    const result = run(ffmpeg, [
        '-v', 'error', '-ss', String(atSeconds), '-i', output,
        '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ], { encoding: 'buffer', maxBuffer: 64 * 1024 });
    assert.ok(result.stdout.byteLength >= 3);
    return [...result.stdout.subarray(0, 3)];
}

test('real temp ffmpeg render honors canonical beat order and exact selected-range sum', { timeout: 120_000 }, async (t) => {
    const ffmpeg = executable(FFMPEG_CANDIDATES);
    if (!ffmpeg || !fs.existsSync(HARNESS_ROOT) || !fs.existsSync(ADAPTER_PATH)) {
        t.skip('fixed local ffmpeg/happyVideoFactory finishing harness unavailable');
        return;
    }
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-real-finishing-'));
    const root = path.join(base, 'synthetic_real_project');
    fs.mkdirSync(path.join(root, 'takes'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(root, 'final'), { recursive: true, mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    const shotA = path.join(root, 'takes', 'shot_a.mp4');
    const shotB = path.join(root, 'takes', 'shot_b.mp4');
    for (const [target, color, frequency] of [[shotA, 'blue', 440], [shotB, 'red', 660]]) {
        run(ffmpeg, [
            '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:r=24:d=2.4`,
            '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=2.4`,
            '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', target,
        ]);
        fs.chmodSync(target, 0o600);
    }

    writeJson(root, 'beats.json', {
        schema_version: 'short-drama-room-beats-v1', project_id: 'synthetic_real_project', episode_id: 'ep01', runtime_target_sec: 3,
        beats: [
            { beat_id: 'beat_a', scene_id: 'scene_01', order: 1, title: 'A', summary: 'A', characters_present: [], emotional_beat: 'A', target_duration_sec: 1 },
            { beat_id: 'beat_b', scene_id: 'scene_01', order: 2, title: 'B', summary: 'B', characters_present: [], emotional_beat: 'B', target_duration_sec: 1.5 },
        ],
    });
    writeJson(root, 'shot_manifest.json', {
        schema_version: 'short-drama-room-shot-manifest-v1', project_id: 'synthetic_real_project', episode_id: 'ep01',
        runtime_target_sec: 3, aspect_ratio: '9:16',
        shots: [
            { shot_id: 'shot_a', scene_id: 'scene_01', dialogue: [] },
            { shot_id: 'shot_b', scene_id: 'scene_01', dialogue: [] },
        ],
    });
    writeJson(root, 'selected_takes.json', {
        schema_version: 'short-drama-room-selected-takes-v1', project_id: 'synthetic_real_project', episode_id: 'ep01',
        takes: [
            { shot_id: 'shot_b', chosen_provider: 'flow', video_path: shotB, dialogue_source: 'native_video_lipsync', qc_report_ref: 'shot_b', selected_at: '2026-07-14T00:00:00+09:00', beat_id: 'beat_b', take_id: 'take_b', source_in_sec: 0.5, source_out_sec: 2.0, transition_in: { type: 'cut', dur: 0 } },
            { shot_id: 'shot_a', chosen_provider: 'seedance', video_path: shotA, dialogue_source: 'native_video_lipsync', qc_report_ref: 'shot_a', selected_at: '2026-07-14T00:00:00+09:00', beat_id: 'beat_a', take_id: 'take_a', source_in_sec: 0.2, source_out_sec: 1.2, transition_in: { type: 'cut', dur: 0 } },
        ],
    });
    writeJson(root, 'qc_report.json', {
        schema_version: 'short-drama-room-qc-report-v1', project_id: 'synthetic_real_project', episode_id: 'ep01',
        shot_qc: [
            { shot_id: 'shot_a', provider: 'seedance', deterministic_checks_passed: true, gemini_findings: [], dialogue_intelligibility_score: 0.95, pronunciation_risk_flag: false, decision: 'accept' },
            { shot_id: 'shot_b', provider: 'flow', deterministic_checks_passed: true, gemini_findings: [], dialogue_intelligibility_score: 0.92, pronunciation_risk_flag: false, decision: 'accept' },
        ],
        subtitle_audio_drift_s: 0.02,
    });
    const selectedPath = path.join(root, 'selected_takes.json');
    const qcPath = path.join(root, 'qc_report.json');
    const selectedTime = new Date('2026-07-14T00:00:00.000Z');
    const qcTime = new Date('2026-07-14T00:01:00.000Z');
    fs.utimesSync(selectedPath, selectedTime, selectedTime);
    fs.utimesSync(qcPath, qcTime, qcTime);
    const immutableBefore = Object.fromEntries([
        'beats.json', 'shot_manifest.json', 'selected_takes.json', 'qc_report.json', 'takes/shot_a.mp4', 'takes/shot_b.mp4',
    ].map((name) => [name, digest(path.join(root, name))]));

    const provider = createFinishingWorkbenchProvider({
        config: { productionRoot: root },
        harnessRoot: HARNESS_ROOT,
        adapterPath: ADAPTER_PATH,
        planStore: new Map(),
    });
    const plan = await provider.plan();
    assert.equal(plan.status, 'ready', plan.blockers.join(','));
    assert.equal(plan.selected_range_count, 2);
    assert.equal(plan.selected_duration_seconds, 2.5);
    assert.equal(JSON.stringify(plan).includes(root), false);
    const result = await provider.execute({
        planToken: plan.plan_token,
        confirmed: true,
        projectId: 'synthetic_real_project',
    });
    assert.equal(result.executed, true);
    assert.equal(result.fresh_probe_verified, true);
    assert.equal(result.output_quality_approved, false);
    assert.ok(Math.abs(result.output_duration_seconds - 2.5) <= 0.35, String(result.output_duration_seconds));

    const output = path.join(root, 'final', 'workbench_runs', result.run_id, 'roughcut.mp4');
    const firstRgb = sampleRgb(ffmpeg, output, 0.35);
    const secondRgb = sampleRgb(ffmpeg, output, 1.35);
    assert.ok(firstRgb[2] > firstRgb[0] + 80, `first canonical beat must be blue: ${firstRgb}`);
    assert.ok(secondRgb[0] > secondRgb[2] + 80, `second canonical beat must be red: ${secondRgb}`);
    assert.deepEqual(Object.fromEntries(Object.keys(immutableBefore).map((name) => [name, digest(path.join(root, name))])), immutableBefore);
    assert.equal(fs.existsSync(path.join(root, 'final', 'master.mp4')), false);
    assert.equal(fs.existsSync(path.join(root, 'final', 'delivery_manifest.json')), false);

    const restored = await provider.getWorkspace();
    assert.equal(restored.status, 'success');
    assert.equal(restored.current_run.run_id, result.run_id);
    assert.equal(restored.current_run.fresh_probe_verified, true);
    assert.equal(restored.current_run.output_quality_approved, false);
    const noOp = await provider.plan();
    assert.equal(noOp.status, 'already_current');
    assert.equal(noOp.plan_token, '');
});
