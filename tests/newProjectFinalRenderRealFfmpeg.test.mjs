import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import finalStitchProvider from '../electron/lib/newProjectFinalStitchProvider.js';
import finalRenderProvider from '../electron/lib/newProjectFinalRenderProvider.js';

const HARNESS_ROOT = '/Users/jessiek/StudioProjects/happyVideoFactory';
const ADAPTER_PATH = path.resolve('scripts/run_selected_range_roughcut.py');
const FFMPEG_CANDIDATES = ['/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];

function executable(candidates) {
    return candidates.find((candidate) => {
        try { return fs.statSync(candidate).isFile() && (fs.statSync(candidate).mode & 0o111) !== 0; } catch { return false; }
    });
}

function run(binary, args, options = {}) {
    const result = spawnSync(binary, args, {
        env: { PATH: `${path.dirname(binary)}:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C' },
        shell: false, timeout: options.timeout || 120_000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, String(result.stderr || '').slice(-1200));
    return result;
}

test('real ffmpeg: video-only 0.2-0.8 selection renders a fresh review MP4 with synthesized AAC', { timeout: 180_000 }, async (t) => {
    const ffmpeg = executable(FFMPEG_CANDIDATES);
    const ffprobe = ffmpeg && path.join(path.dirname(ffmpeg), 'ffprobe');
    if (!ffmpeg || !fs.existsSync(ffprobe) || !fs.existsSync(HARNESS_ROOT) || !fs.existsSync(ADAPTER_PATH)) {
        t.skip('fixed local ffmpeg/happyVideoFactory runtime unavailable');
        return;
    }
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-real-final-render-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    draftProvider.saveNewProjectDraft({
        production_id: 'real-final-render-01', brief: '실제 검토 영상', script: '푸른 장면 하나를 검토한다.',
        route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 2,
    }, { userDataPath });
    const sourcePath = path.join(base, 'video-only.mp4');
    run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:r=24:d=1',
        '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath]);
    fs.chmodSync(sourcePath, 0o600);
    const input = {
        project_id: 'real-final-render-01',
        design_revision_sha256: 'a'.repeat(64), image_plan_revision_sha256: 'b'.repeat(64),
        video_plan_revision_sha256: 'c'.repeat(64), clip_selection_revision_sha256: 'd'.repeat(64),
        clips: [{
            task_token: `task_${'1'.repeat(64)}`, result_token: `result_${'2'.repeat(64)}`,
            result_sha256: '3'.repeat(64), source_path: sourcePath, provider: 'grok',
            width: 360, height: 640, duration_seconds: 1, sequence: 1,
            source_id: 'scene_01', label: '푸른 장면', in_seconds: 0.2, out_seconds: 0.8,
            reason: '사용할 구간', reviewer_confidence: 'high',
        }],
    };
    const stitchContext = { userDataPath, getCompleteNewProjectClipSelectionInput: () => structuredClone(input) };
    const stitch = finalStitchProvider.getNewProjectFinalStitch(stitchContext);
    finalStitchProvider.stageNewProjectFinalStitch({ expected_revision: stitch.revision }, stitchContext);
    const internalErrors = [];
    const makeProvider = () => finalRenderProvider.createNewProjectFinalRenderProvider({
        userDataPath,
        getStagedInput: () => finalStitchProvider.getStagedNewProjectFinalStitchInput(stitchContext),
        harnessRoot: HARNESS_ROOT,
        adapterPath: ADAPTER_PATH,
        planStore: new Map(),
        onInternalError: (error) => internalErrors.push(error.code || error.message),
    });
    const provider = makeProvider();
    const plan = await provider.plan();
    assert.equal(plan.ready, true, `${plan.notice} ${internalErrors.join(',')}`);
    const rendered = await provider.execute({ planToken: plan.plan_token, confirmed: true, projectId: input.project_id });
    assert.equal(rendered.rendered, true);
    assert.equal(rendered.fresh_probe_verified, true);
    assert.equal(rendered.has_video, true);
    assert.equal(rendered.has_audio, true);
    assert.ok(Math.abs(rendered.output_duration_seconds - 0.6) <= 0.35, String(rendered.output_duration_seconds));
    assert.equal(rendered.output_quality_approved, false);
    assert.equal(rendered.generation_executed, false);
    assert.equal(rendered.legacy_production_modified, false);
    assert.equal(rendered.canonical_delivery_modified, false);

    const paths = finalRenderProvider.pathsFor(userDataPath);
    const pointer = JSON.parse(fs.readFileSync(paths.currentPath, 'utf8'));
    const runRoot = path.join(paths.runsRoot, pointer.run_id);
    const outputPath = path.join(runRoot, 'roughcut.mp4');
    const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name',
        '-show_entries', 'format=duration', '-of', 'json', '--', outputPath]).stdout);
    assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ['audio', 'video']);
    assert.equal(probe.streams.find((stream) => stream.codec_type === 'audio').codec_name, 'aac');
    assert.ok(Math.abs(Number(probe.format.duration) - 0.6) <= 0.35);
    assert.deepEqual(fs.readdirSync(runRoot).sort(), ['fresh_probe.json', 'receipt.json', 'roughcut.mp4']);
    assert.deepEqual(fs.readdirSync(paths.runsRoot).filter((name) => name.startsWith('.staging-')), []);
    const restored = await makeProvider().get();
    assert.equal(restored.status, 'already_current', internalErrors.join(','));
    assert.equal(restored.rendered, true);
    const preview = await makeProvider().preview();
    assert.equal(preview.ready, true);
    assert.equal(preview.mime_type, 'video/mp4');
    assert.equal(Buffer.from(preview.base64, 'base64').byteLength, fs.statSync(outputPath).size);
});
