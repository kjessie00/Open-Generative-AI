import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import finalStitchProvider from '../electron/lib/newProjectFinalStitchProvider.js';

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-final-stitch-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    draftProvider.saveNewProjectDraft({
        production_id: 'final-stitch-01', brief: '장면을 잇는 이야기', script: '첫 장면 뒤에 둘째 장면이 이어진다.',
        route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 4,
    }, { userDataPath });
    const input = {
        project_id: 'final-stitch-01',
        design_revision_sha256: 'a'.repeat(64),
        image_plan_revision_sha256: 'b'.repeat(64),
        video_plan_revision_sha256: 'c'.repeat(64),
        clip_selection_revision_sha256: 'd'.repeat(64),
        clips: [1, 2].map((sequence) => ({
            task_token: `task_${String(sequence).repeat(64)}`,
            result_token: `result_${String(sequence + 2).repeat(64)}`,
            result_sha256: String(sequence + 4).repeat(64),
            source_path: path.join(base, `scene-${sequence}.mp4`),
            provider: sequence === 1 ? 'flow' : 'replicate', width: 1080, height: 1920,
            duration_seconds: 5, sequence, source_id: `scene_0${sequence}`, label: `장면 ${sequence}`,
            in_seconds: sequence - 1, out_seconds: sequence + 2,
            reason: '사용할 구간', reviewer_confidence: sequence === 1 ? 'high' : 'medium',
        })),
    };
    for (const clip of input.clips) fs.writeFileSync(clip.source_path, 'private-video', { mode: 0o600 });
    const context = { userDataPath, getCompleteNewProjectClipSelectionInput: () => structuredClone(input) };
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath, input, context };
}

test('final stitch stages exact private render handoff and exposes only a simple pathless summary', (t) => {
    const parts = fixture(t);
    let state = finalStitchProvider.getNewProjectFinalStitch(parts.context);
    assert.equal(state.status, 'ready');
    assert.equal(state.staged, false);
    assert.equal(state.selected_count, 2);
    assert.equal(state.total_duration_seconds, 6);
    state = finalStitchProvider.stageNewProjectFinalStitch({ expected_revision: state.revision }, parts.context);
    assert.equal(state.status, 'staged');
    assert.equal(state.staged, true);
    assert.equal(state.executed, false);
    assert.equal(state.rendered, false);
    assert.equal(state.generation_executed, false);
    const publicText = JSON.stringify(state);
    assert.equal(publicText.includes(parts.base), false);
    assert.doesNotMatch(publicText, /sha256|task_token|result_token|source_path|provider|provenance/);
    const paths = finalStitchProvider.exactPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(paths.root).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(paths.handoffPath).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(paths.root).filter((name) => name.startsWith('.final-stitch-')), []);
    const record = JSON.parse(fs.readFileSync(paths.handoffPath, 'utf8'));
    assert.equal(record.schema_version, finalStitchProvider.SCHEMA);
    assert.equal(record.render_payload.schema_version, 'film_pipeline.finishing_render_payload.v1');
    assert.deepEqual(record.render_payload.timeline_beats.scenes.map((scene) => scene.scene_id), ['scene_01', 'scene_02']);
    assert.deepEqual(record.render_payload.timeline_beats.scenes.flatMap((scene) => scene.beats)
        .map((item) => item.beat_id), ['scene_01', 'scene_02']);
    assert.deepEqual(record.render_payload.selected_takes.takes.map((item) => item.chosen_provider), ['flow', 'replicate']);
    assert.deepEqual(record.render_payload.expected_order.map((item) => item.shot_id), ['scene_01', 'scene_02']);
    assert.deepEqual(record.render_payload.expected_order.map((item) => [item.source_in_sec, item.source_out_sec]), [[0, 3], [1, 4]]);
    assert.deepEqual(record.sources.map((item) => item.source_path), parts.input.clips.map((item) => item.source_path));
    assert.equal(record.executed, false);
    assert.equal(record.rendered, false);
});

test('selection drift returns a fresh ready state and never restores an old handoff', (t) => {
    const parts = fixture(t);
    const ready = finalStitchProvider.getNewProjectFinalStitch(parts.context);
    finalStitchProvider.stageNewProjectFinalStitch({ expected_revision: ready.revision }, parts.context);
    parts.input.clips[0].in_seconds = 0.5;
    const changed = finalStitchProvider.getNewProjectFinalStitch(parts.context);
    assert.equal(changed.ok, true);
    assert.equal(changed.status, 'upstream_changed');
    assert.equal(changed.staged, false);
    assert.throws(() => finalStitchProvider.stageNewProjectFinalStitch({
        expected_revision: ready.revision,
    }, parts.context), { code: 'FINAL_STITCH_REVISION_STALE' });
    const replaced = finalStitchProvider.stageNewProjectFinalStitch({ expected_revision: changed.revision }, parts.context);
    assert.equal(replaced.staged, true);
});

test('malformed, symlink, unsafe-mode, incomplete input, and non-exact stage envelopes fail closed', (t) => {
    const parts = fixture(t);
    const ready = finalStitchProvider.getNewProjectFinalStitch(parts.context);
    assert.throws(() => finalStitchProvider.stageNewProjectFinalStitch({
        expected_revision: ready.revision, path: '/tmp/injected',
    }, parts.context), { code: 'FINAL_STITCH_STAGE_SHAPE_INVALID' });
    finalStitchProvider.stageNewProjectFinalStitch({ expected_revision: ready.revision }, parts.context);
    const paths = finalStitchProvider.exactPaths(parts.userDataPath);
    fs.writeFileSync(paths.handoffPath, '{bad json}\n', { mode: 0o600 });
    assert.deepEqual(finalStitchProvider.getNewProjectFinalStitch(parts.context).blockers, ['FINAL_STITCH_FILE_INVALID']);
    fs.rmSync(paths.handoffPath);
    const external = path.join(parts.base, 'external.json');
    fs.writeFileSync(external, '{}\n', { mode: 0o600 });
    fs.symlinkSync(external, paths.handoffPath);
    assert.deepEqual(finalStitchProvider.getNewProjectFinalStitch(parts.context).blockers, ['FINAL_STITCH_FILE_UNSAFE']);
    fs.unlinkSync(paths.handoffPath);
    fs.writeFileSync(paths.handoffPath, '{}\n', { mode: 0o644 });
    assert.deepEqual(finalStitchProvider.getNewProjectFinalStitch(parts.context).blockers, ['FINAL_STITCH_FILE_UNSAFE']);
    const incomplete = {
        ...parts.context,
        getCompleteNewProjectClipSelectionInput: () => { const error = new Error('required'); error.code = 'FINAL_STITCH_COMPLETE_SELECTION_REQUIRED'; throw error; },
    };
    assert.deepEqual(finalStitchProvider.getNewProjectFinalStitch(incomplete).blockers, ['FINAL_STITCH_COMPLETE_SELECTION_REQUIRED']);
});
