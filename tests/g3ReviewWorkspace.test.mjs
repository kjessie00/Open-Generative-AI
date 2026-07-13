import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    SELECTED_TAKES_SCHEMA,
    getG3ReviewWorkspace,
    saveG3ReviewDraft,
    exportG3ReviewPacket,
    loadG3CandidatePreview,
} = require('../electron/lib/g3ReviewDraftProvider.js');

const NOW = '2026-07-14T09:30:00.000Z';

function fixture(t, { shots = ['SH01', 'SH02'], beats = true, qcSchema = 'short-drama-room-qc-report-v1' } = {}) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-g3-')));
    const root = path.join(base, 'production');
    const userDataPath = path.join(base, 'user-data');
    for (const directory of ['intake', 'storyboard', 'prompts', 'generated/downloads', 'final', 'qa']) {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    fs.chmodSync(userDataPath, 0o700);
    fs.writeFileSync(path.join(root, 'intake/brief.md'), '# G3 fixture\n');
    fs.writeFileSync(path.join(root, 'storyboard/storyboard.json'), JSON.stringify({ clips: [] }));
    fs.writeFileSync(path.join(root, 'generated/downloads/SH01_take_a.mp4'), 'fixture-candidate-a');
    fs.writeFileSync(path.join(root, 'generated/downloads/SH02_take_b.webm'), 'fixture-candidate-b');
    fs.writeFileSync(path.join(root, 'shot_manifest.json'), JSON.stringify({
        schema_version: 'short-drama-room-shot-manifest-v1',
        project_id: 'project_01',
        episode_id: 'episode_01',
        shots: shots.map((shotId) => ({ shot_id: shotId })),
    }));
    if (beats) {
        fs.writeFileSync(path.join(root, 'beats.json'), JSON.stringify({
            schema_version: 'short-drama-room-beats-v1',
            project_id: 'project_01',
            episode_id: 'episode_01',
            beats: shots.map((_, index) => ({ beat_id: `BEAT${String(index + 1).padStart(2, '0')}` })),
        }));
    }
    fs.writeFileSync(path.join(root, 'qc_report.json'), JSON.stringify({
        schema_version: qcSchema,
        project_id: 'project_01',
        episode_id: 'episode_01',
        subtitle_audio_drift_s: 0.05,
        shot_qc: shots.map((shotId) => ({
            shot_id: shotId,
            provider: 'seedance',
            deterministic_checks_passed: true,
            gemini_findings: ['private finding must not cross the boundary'],
            dialogue_intelligibility_score: 0.96,
            pronunciation_risk_flag: false,
            decision: 'accept',
        })),
    }));
    const selectedSentinel = '{"existing":"production-selected-takes-must-not-change"}\n';
    fs.writeFileSync(path.join(root, 'selected_takes.json'), selectedSentinel);
    const context = {
        config: { productionRoot: root },
        userDataPath,
        tokenSecret: Buffer.alloc(32, 7),
        now: () => NOW,
        durationByRelativePath: {
            'generated/downloads/SH01_take_a.mp4': 5,
            'generated/downloads/SH02_take_b.webm': 6,
        },
    };
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root, userDataPath, context, selectedSentinel };
}

function payload(state, { partial = false } = {}) {
    return {
        draft_id: state.draft_id,
        selections: state.shots.map((shot, index) => ({
            shot_id: shot.shot_id,
            candidate_token: partial && index === 1 ? '' : state.candidates[index].candidate_token,
            chosen_provider: partial && index === 1 ? '' : 'seedance',
            dialogue_source: partial && index === 1 ? '' : 'native_video_lipsync',
            beat_id: partial && index === 1 ? '' : `BEAT${String(index + 1).padStart(2, '0')}`,
            take_id: partial && index === 1 ? '' : `${shot.shot_id}_take_selected`,
            source_in_sec: 0.25,
            source_out_sec: partial && index === 1 ? null : 4.5,
            transition_in: index === 0 ? null : { type: 'crossfade', dur: 0.2 },
            selection_reason: partial && index === 1 ? '' : `사람이 확인한 ${shot.shot_id} 선택 사유`,
            notes: index === 0 ? '첫 샷 메모' : '',
        })),
        overall_notes: '전체 인간 검토 메모',
    };
}

function findDraftRoot(userDataPath) {
    const root = path.join(userDataPath, 'film-pipeline', 'drafts', 'g3-review-v1');
    const namespaces = fs.readdirSync(root);
    assert.equal(namespaces.length, 1);
    return path.join(root, namespaces[0]);
}

test('G3 workspace exposes opaque candidates and canonical machine QC without absolute paths or findings', (t) => {
    const { base, root, context } = fixture(t);
    const state = getG3ReviewWorkspace(context);
    const serialized = JSON.stringify(state);

    assert.equal(state.ok, true);
    assert.equal(state.status, 'empty');
    assert.equal(state.label, '초안/비승격');
    assert.equal(state.promotion_ready, false);
    assert.equal(state.machine_qc_contract, 'short-drama-room-qc-report-v1');
    assert.equal(state.machine_qc_read_only, true);
    assert.equal(state.shots.length, 2);
    assert.equal(state.candidates.length, 2);
    assert.match(state.candidates[0].candidate_token, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(state.candidates[0].display_path, /^generated\/downloads\//);
    assert.equal(serialized.includes(root), false);
    assert.equal(serialized.includes(base), false);
    assert.equal(serialized.includes('private finding'), false);
    assert.equal(state.validation_blockers.includes('G3_SELECTION_INCOMPLETE'), true);
});

test('partial save writes only a private userData draft atomically and never mutates production selected takes', (t) => {
    const { root, userDataPath, context, selectedSentinel } = fixture(t);
    const initial = getG3ReviewWorkspace(context);
    const result = saveG3ReviewDraft(payload(initial, { partial: true }), context);
    const draftRoot = findDraftRoot(userDataPath);
    const names = fs.readdirSync(draftRoot);

    assert.equal(result.saved, true);
    assert.equal(result.exported, false);
    assert.deepEqual(names, ['draft.json']);
    assert.equal(fs.statSync(draftRoot).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(draftRoot, 'draft.json')).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(root, 'selected_takes.json'), 'utf8'), selectedSentinel);
    assert.equal(names.some((name) => name.startsWith('.g3-review-')), false);
    assert.equal(result.state.validation_blockers.includes('G3_SELECTION_INCOMPLETE'), true);
});

test('strict export writes exact canonical selected takes plus a non-promotion human-review envelope', (t) => {
    const { root, userDataPath, context, selectedSentinel } = fixture(t);
    const initial = getG3ReviewWorkspace(context);
    const result = exportG3ReviewPacket(payload(initial), context);
    const draftRoot = findDraftRoot(userDataPath);
    const selected = JSON.parse(fs.readFileSync(path.join(draftRoot, 'selected_takes.json'), 'utf8'));
    const envelope = JSON.parse(fs.readFileSync(path.join(draftRoot, 'g3_review_export.json'), 'utf8'));

    assert.equal(result.exported, true);
    assert.equal(result.promotion_ready, false);
    assert.deepEqual(Object.keys(selected), ['schema_version', 'project_id', 'episode_id', 'takes']);
    assert.equal(selected.schema_version, SELECTED_TAKES_SCHEMA);
    assert.deepEqual(Object.keys(selected.takes[0]), [
        'shot_id', 'chosen_provider', 'video_path', 'dialogue_source', 'qc_report_ref', 'selected_at',
        'beat_id', 'take_id', 'source_in_sec', 'source_out_sec', 'transition_in',
    ]);
    assert.equal(selected.takes[0].video_path, 'generated/downloads/SH01_take_a.mp4');
    assert.equal(selected.takes[0].selected_at, NOW);
    assert.equal(envelope.schema_version, 'film_pipeline.g3_review_export.v1');
    assert.equal(envelope.human_review.status, 'draft_unpromoted');
    assert.equal(envelope.human_review.overall_notes, '전체 인간 검토 메모');
    assert.equal(envelope.validation.machine_qc_read_only, true);
    assert.equal(envelope.validation.human_decision_separate, true);
    assert.equal(envelope.validation.duration_upper_bound_checked, true);
    assert.equal(envelope.promotion_ready, false);
    assert.equal(JSON.stringify(envelope).includes(root), false);
    assert.equal(fs.readFileSync(path.join(root, 'selected_takes.json'), 'utf8'), selectedSentinel);
    for (const name of ['draft.json', 'selected_takes.json', 'g3_review_export.json']) {
        assert.equal(fs.statSync(path.join(draftRoot, name)).mode & 0o777, 0o600);
    }
});

test('candidate preview returns bounded content only through an opaque token', (t) => {
    const { root, context } = fixture(t);
    const state = getG3ReviewWorkspace(context);
    const preview = loadG3CandidatePreview({ candidateToken: state.candidates[0].candidate_token }, context);

    assert.equal(preview.loaded, true);
    assert.equal(preview.mime_type, 'video/mp4');
    assert.equal(Buffer.from(preview.base64, 'base64').toString('utf8'), 'fixture-candidate-a');
    assert.equal(JSON.stringify(preview).includes(root), false);
    assert.throws(
        () => loadG3CandidatePreview({ candidateToken: state.candidates[0].candidate_token, path: root }, context),
        { code: 'G3_PREVIEW_REQUEST_INVALID' },
    );
});

test('strict validation rejects missing coverage, invalid enums, ranges, beat ids, QC mismatches, and duration overflow', (t) => {
    const { context } = fixture(t);
    const state = getG3ReviewWorkspace(context);
    const valid = payload(state);
    const cases = [
        ['G3_SHOT_COVERAGE_INVALID', { ...valid, selections: valid.selections.slice(0, 1) }],
        ['G3_PROVIDER_INVALID', { ...valid, selections: valid.selections.map((item, index) => index ? item : { ...item, chosen_provider: 'other' }) }],
        ['G3_RANGE_INVALID', { ...valid, selections: valid.selections.map((item, index) => index ? item : { ...item, source_out_sec: 0.1 }) }],
        ['G3_BEAT_ID_INVALID', { ...valid, selections: valid.selections.map((item, index) => index ? item : { ...item, beat_id: 'UNKNOWN' }) }],
        ['G3_MACHINE_QC_PROVIDER_MISMATCH', { ...valid, selections: valid.selections.map((item, index) => index ? item : { ...item, chosen_provider: 'flow' }) }],
        ['G3_RANGE_EXCEEDS_DURATION', { ...valid, selections: valid.selections.map((item, index) => index ? item : { ...item, source_out_sec: 5.5 }) }],
    ];
    for (const [code, candidatePayload] of cases) {
        assert.throws(() => exportG3ReviewPacket(candidatePayload, context), { code });
    }
});

test('noncanonical QC, symlink candidates, stale tokens, unsafe drafts, and atomic rename failure fail closed', (t) => {
    const noncanonical = fixture(t, { qcSchema: 'short_drama_qc.v1' });
    const blocked = getG3ReviewWorkspace(noncanonical.context);
    assert.equal(blocked.machine_qc_contract, '');
    assert.equal(blocked.blockers.includes('G3_MACHINE_QC_NONCANONICAL'), true);

    const stale = fixture(t);
    const staleState = getG3ReviewWorkspace(stale.context);
    fs.writeFileSync(path.join(stale.root, 'generated/downloads/SH01_take_a.mp4'), 'changed-candidate-content');
    assert.throws(
        () => loadG3CandidatePreview({ candidateToken: staleState.candidates[0].candidate_token }, stale.context),
        { code: 'G3_CANDIDATE_TOKEN_INVALID' },
    );

    const linked = fixture(t);
    const outside = path.join(linked.base, 'outside.mp4');
    fs.writeFileSync(outside, 'outside');
    fs.unlinkSync(path.join(linked.root, 'generated/downloads/SH01_take_a.mp4'));
    fs.symlinkSync(outside, path.join(linked.root, 'generated/downloads/SH01_take_a.mp4'));
    const linkedState = getG3ReviewWorkspace(linked.context);
    assert.equal(linkedState.candidates.some((candidate) => candidate.file_name === 'SH01_take_a.mp4'), false);
    assert.equal(linkedState.blockers.includes('G3_PRODUCTION_SCAN_SKIPPED_SYMLINKS'), true);

    const renameFailure = fixture(t);
    const initial = getG3ReviewWorkspace(renameFailure.context);
    assert.throws(() => saveG3ReviewDraft(payload(initial, { partial: true }), {
        ...renameFailure.context,
        renameFile() { const error = new Error('injected rename failure'); error.code = 'EIO'; throw error; },
    }), { code: 'EIO' });
    const draftRoot = findDraftRoot(renameFailure.userDataPath);
    assert.equal(fs.readdirSync(draftRoot).some((name) => name.startsWith('.g3-review-')), false);
});
