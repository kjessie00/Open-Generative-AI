import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import clipSelectionProvider from '../electron/lib/newProjectClipSelectionProvider.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-clip-selection-')));
    const userDataPath = path.join(base, 'user-data');
    const draftRoot = path.join(userDataPath, 'film-pipeline', 'drafts', 'canonical-project-bootstrap-v1');
    fs.mkdirSync(draftRoot, { recursive: true, mode: 0o700 });
    for (const part of [userDataPath, path.join(userDataPath, 'film-pipeline'), path.join(userDataPath, 'film-pipeline', 'drafts'), draftRoot]) {
        fs.chmodSync(part, 0o700);
    }
    const upstream = {
        design_revision_sha256: A,
        image_plan_revision_sha256: B,
        video_plan_revision_sha256: C,
        sources: [1, 2].map((sequence) => ({
            task_token: `task_${String(sequence).repeat(64)}`,
            result_token: `result_${String(sequence + 2).repeat(64)}`,
            result_sha256: String(sequence + 4).repeat(64),
            duration_seconds: 5,
            sequence,
            source_id: `scene_0${sequence}`,
            label: `장면 ${sequence}`,
        })),
    };
    const context = { userDataPath, getValidatedVideoSelectionSources: () => structuredClone(upstream) };
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath, upstream, context };
}

function expected(state) {
    return {
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: state.video_plan_revision_sha256,
        expected_clip_selection_revision_sha256: state.revision_sha256,
    };
}

test('private clip selections start empty, save partial explicit ranges, and restore pathlessly', (t) => {
    const parts = fixture(t);
    let state = clipSelectionProvider.getNewProjectClipSelection(parts.context);
    assert.equal(state.status, 'empty');
    assert.equal(state.accepted_count, 0, 'whole connected video is not automatically accepted');
    assert.equal(state.total_count, 2);
    state = clipSelectionProvider.saveNewProjectClipSelection({
        selections: [{
            task_token: state.clips[0].task_token, in_seconds: 0.5, out_seconds: 3.25,
            reason: '표정과 동작이 자연스러운 구간', reviewer_confidence: 'high',
        }],
        ...expected(state),
    }, parts.context);
    assert.equal(state.status, 'saved');
    assert.equal(state.accepted_count, 1);
    assert.equal(state.clips[1].in_seconds, null);
    const restored = clipSelectionProvider.getNewProjectClipSelection(parts.context);
    assert.equal(restored.status, 'restored');
    assert.equal(restored.accepted_count, 1);
    assert.equal(JSON.stringify(restored).includes(parts.base), false);
    assert.equal(JSON.stringify(restored).includes('result_sha256'), false);
    assert.equal(JSON.stringify(restored).includes('source_provenance'), false);
    const paths = clipSelectionProvider.exactPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(paths.root).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(paths.selectionPath).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(paths.root).filter((name) => name.startsWith('.clip-selection-')), []);
});

test('clip selection validates range, reason, confidence, exact shape, and optimistic revision', (t) => {
    const parts = fixture(t);
    const state = clipSelectionProvider.getNewProjectClipSelection(parts.context);
    const selection = {
        task_token: state.clips[0].task_token, in_seconds: 0, out_seconds: 5,
        reason: '전체 장면 사용', reviewer_confidence: 'medium',
    };
    assert.throws(() => clipSelectionProvider.saveNewProjectClipSelection({
        selections: [{ ...selection, out_seconds: 6 }], ...expected(state),
    }, parts.context), { code: 'CLIP_SELECTION_RANGE_INVALID' });
    assert.throws(() => clipSelectionProvider.saveNewProjectClipSelection({
        selections: [{ ...selection, reason: '' }], ...expected(state),
    }, parts.context), { code: 'CLIP_SELECTION_REASON_REQUIRED' });
    assert.throws(() => clipSelectionProvider.saveNewProjectClipSelection({
        selections: [{ ...selection, reviewer_confidence: 'certain' }], ...expected(state),
    }, parts.context), { code: 'CLIP_SELECTION_INPUT_INVALID' });
    assert.throws(() => clipSelectionProvider.saveNewProjectClipSelection({
        selections: [{ ...selection, extra: true }], ...expected(state),
    }, parts.context), { code: 'CLIP_SELECTION_INPUT_INVALID' });
    assert.throws(() => clipSelectionProvider.saveNewProjectClipSelection({
        selections: [selection], ...expected(state), expected_clip_selection_revision_sha256: A,
    }, parts.context), { code: 'CLIP_SELECTION_REVISION_STALE' });
});

test('result drift opens a fresh explicit selection while malformed, symlink, and unsafe mode fail closed', (t) => {
    const parts = fixture(t);
    let state = clipSelectionProvider.getNewProjectClipSelection(parts.context);
    state = clipSelectionProvider.saveNewProjectClipSelection({
        selections: [{
            task_token: state.clips[0].task_token, in_seconds: 1, out_seconds: 4,
            reason: '가운데 구간', reviewer_confidence: 'low',
        }], ...expected(state),
    }, parts.context);
    parts.upstream.sources[0].result_sha256 = '9'.repeat(64);
    const changedContext = { ...parts.context, getValidatedVideoSelectionSources: () => structuredClone(parts.upstream) };
    const changed = clipSelectionProvider.getNewProjectClipSelection(changedContext);
    assert.equal(changed.ok, true);
    assert.equal(changed.status, 'upstream_changed');
    assert.equal(changed.accepted_count, 0);
    const rebased = clipSelectionProvider.saveNewProjectClipSelection({ selections: [], ...expected(changed) }, changedContext);
    assert.equal(rebased.ok, true);
    assert.equal(rebased.accepted_count, 0);

    const paths = clipSelectionProvider.exactPaths(parts.userDataPath);
    fs.writeFileSync(paths.selectionPath, '{bad json}\n', { mode: 0o600 });
    assert.deepEqual(clipSelectionProvider.getNewProjectClipSelection(changedContext).blockers, ['CLIP_SELECTION_FILE_INVALID']);
    fs.rmSync(paths.selectionPath);
    const external = path.join(parts.base, 'external.json');
    fs.writeFileSync(external, '{}\n', { mode: 0o600 });
    fs.symlinkSync(external, paths.selectionPath);
    assert.deepEqual(clipSelectionProvider.getNewProjectClipSelection(changedContext).blockers, ['CLIP_SELECTION_FILE_UNSAFE']);
    fs.unlinkSync(paths.selectionPath);
    fs.writeFileSync(paths.selectionPath, '{}\n', { mode: 0o644 });
    assert.deepEqual(clipSelectionProvider.getNewProjectClipSelection(changedContext).blockers, ['CLIP_SELECTION_FILE_UNSAFE']);
});
