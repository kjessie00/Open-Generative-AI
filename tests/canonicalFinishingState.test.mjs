import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { buildFfmpegConcatPreviewCommand, buildFfprobeValidationCommands } from '../src/lib/pipeline/commandBuilders.js';
import { normalizeProductionReaderState } from '../src/lib/pipeline/productionNormalizer.js';
import { classifySideEffect, renderShellCommand } from '../src/lib/pipeline/sideEffects.js';
import { validateFinalReady } from '../src/lib/pipeline/validators.js';

const require = createRequire(import.meta.url);
const { readProductionFolder } = require('../electron/lib/productionReader.js');
const canonicalStore = require('../electron/lib/contentAddressedCommitStore.js');

const SELECTED_SCHEMA = 'short-drama-room-selected-takes-v1';
const QC_SCHEMA = 'short-drama-room-qc-report-v1';
const SHOT_SCHEMA = 'short-drama-room-shot-manifest-v1';

function fixture(t, name = 'finishing-fixture') {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-finishing-'));
    const root = path.join(base, name);
    for (const directory of ['intake', 'storyboard', 'prompts', 'generated', 'final', 'qa', 'takes']) {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'intake/brief.md'), '# Synthetic finishing fixture\n');
    fs.writeFileSync(path.join(root, 'intake/script.txt'), 'SYNTHETIC SCRIPT MUST NOT ENTER FINISHING STATE\n');
    fs.writeFileSync(path.join(root, 'storyboard/storyboard.json'), JSON.stringify({
        clips: [{ scene_id: 'SC01', clip_id: 'clip_SH01', duration: 5 }],
    }));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root };
}

function writeJson(root, relativePath, value) {
    fs.writeFileSync(path.join(root, relativePath), JSON.stringify(value));
}

function shotManifest(shotIds = ['SH01'], overrides = {}) {
    return {
        schema_version: SHOT_SCHEMA,
        project_id: 'project_01',
        episode_id: 'episode_01',
        runtime_target_sec: 5,
        aspect_ratio: '9:16',
        shots: shotIds.map((shotId) => ({ shot_id: shotId })),
        ...overrides,
    };
}

function selectedTake(root, shotId = 'SH01', overrides = {}) {
    return {
        shot_id: shotId,
        chosen_provider: 'seedance',
        video_path: path.join(root, 'takes', `${shotId}.mp4`),
        dialogue_source: 'native_video_lipsync',
        qc_report_ref: shotId,
        selected_at: '2026-07-13T22:30:00+09:00',
        beat_id: 'BEAT01',
        take_id: `${shotId}_take_01`,
        source_in_sec: 0.5,
        source_out_sec: 4.5,
        transition_in: { type: 'cut', dur: 0 },
        ...overrides,
    };
}

function selectedDoc(root, takes = [selectedTake(root)], overrides = {}) {
    return {
        schema_version: SELECTED_SCHEMA,
        project_id: 'project_01',
        episode_id: 'episode_01',
        takes,
        ...overrides,
    };
}

function qcEntry(shotId = 'SH01', overrides = {}) {
    return {
        shot_id: shotId,
        provider: 'seedance',
        deterministic_checks_passed: true,
        gemini_findings: ['PRIVATE FINDING MUST NOT LEAK'],
        dialogue_intelligibility_score: 0.94,
        pronunciation_risk_flag: false,
        decision: 'accept',
        ...overrides,
    };
}

function qcDoc(entries = [qcEntry()], overrides = {}) {
    return {
        schema_version: QC_SCHEMA,
        project_id: 'project_01',
        episode_id: 'episode_01',
        shot_qc: entries,
        subtitle_audio_drift_s: 0.08,
        ...overrides,
    };
}

function writeGolden(root) {
    fs.writeFileSync(path.join(root, 'takes/SH01.mp4'), 'synthetic source evidence');
    writeJson(root, 'shot_manifest.json', shotManifest());
    writeJson(root, 'selected_takes.json', selectedDoc(root));
    writeJson(root, 'qc_report.json', qcDoc());
}

test('golden canonical selected takes and QC become provenance-rich finishing inputs without quality promotion', (t) => {
    const { root } = fixture(t);
    writeGolden(root);

    const raw = readProductionFolder(root);
    const state = normalizeProductionReaderState(raw);
    const range = state.acceptedSeconds[0];
    const qc = state.qaRecords[0];
    const serialized = JSON.stringify({ raw, state });

    assert.equal(raw.parsed.shotManifest.parsed, true);
    assert.equal(raw.parsed.selectedTakes.parsed, true);
    assert.equal(raw.parsed.qcReport.parsed, true);
    assert.deepEqual(Object.keys(raw.parsed.selectedTakes.records[0]).sort(), [
        'beat_id', 'canonical_commit_id', 'canonical_payload_hash', 'provenance', 'provider', 'range_valid', 'record_ready', 'shot_id', 'source_exists',
        'source_in_sec', 'source_out_sec', 'source_reason', 'take_id', 'transition_duration_sec',
        'transition_type', 'video_path',
    ].sort());
    assert.equal(range.clip_id, 'clip_SH01');
    assert.equal(range.accepted, true);
    assert.equal(range.source_exists, true);
    assert.equal(range.whole_clip_accepted, false);
    assert.equal(range.canonical_alias_source, 'shot_manifest.json+timeline_builder.clip_<shot_id>');
    assert.equal(qc.deterministic_checks_passed, true);
    assert.equal(qc.canonical_decision, 'accept');
    assert.equal(qc.external_finding_count, 1);
    assert.equal(qc.human_decision, 'UNREVIEWED');
    assert.equal(qc.verdict, 'UNREVIEWED');
    assert.equal(state.canonicalHandoff.selected_range_ready_count, 1);
    assert.equal(state.canonicalHandoff.final_ready, false);
    assert.equal(validateFinalReady(state).ok, false);
    assert.equal(serialized.includes('PRIVATE FINDING MUST NOT LEAK'), false);
    assert.equal(serialized.includes('SYNTHETIC SCRIPT MUST NOT ENTER FINISHING STATE'), false);
});

test('selected-takes graph wins over tampered or missing compatibility cache and exposes commit provenance', (t) => {
    const { root } = fixture(t);
    writeGolden(root);
    const graphValue = selectedDoc(root, [selectedTake(root, 'SH01', { take_id: 'graph_take_01' })]);
    const committed = canonicalStore.appendValue(root, canonicalStore.NAMESPACES.SELECTED_TAKES, graphValue, {
        expectedParent: null,
        codePrefix: 'SELECTED_TAKES_GRAPH',
    });

    for (const cacheState of ['tampered', 'missing']) {
        if (cacheState === 'tampered') fs.writeFileSync(path.join(root, 'selected_takes.json'), '{bad');
        else fs.rmSync(path.join(root, 'selected_takes.json'), { force: true });
        const raw = readProductionFolder(root);
        const state = normalizeProductionReaderState(raw);
        assert.equal(raw.parsed.selectedTakes.parsed, true, cacheState);
        assert.equal(raw.parsed.selectedTakes.source_authority, 'content_addressed_commit_graph');
        assert.equal(raw.parsed.selectedTakes.canonical_commit_id, committed.headCommitId);
        assert.equal(raw.parsed.selectedTakes.canonical_payload_hash, committed.payloadHash);
        assert.equal(raw.parsed.selectedTakes.records[0].take_id, 'graph_take_01');
        assert.equal(state.acceptedSeconds[0].canonical_provenance, 'selected_takes.commit_graph');
        assert.equal(state.acceptedSeconds[0].canonical_commit_id, committed.headCommitId);
        assert.equal(state.canonicalHandoff.selected_takes_authority, 'content_addressed_commit_graph');
        assert.equal(state.canonicalHandoff.selected_takes_path, '');
    }
});

test('invalid selected-takes graph never falls back to a valid compatibility cache', (t) => {
    const { root } = fixture(t);
    writeGolden(root);
    canonicalStore.appendValue(root, canonicalStore.NAMESPACES.SELECTED_TAKES, selectedDoc(root), {
        expectedParent: null,
        codePrefix: 'SELECTED_TAKES_GRAPH',
    });
    const paths = canonicalStore.graphPaths(root, canonicalStore.NAMESPACES.SELECTED_TAKES, {
        codePrefix: 'SELECTED_TAKES_GRAPH',
    });
    const [commitName] = fs.readdirSync(paths.commitRoot);
    fs.chmodSync(path.join(paths.commitRoot, commitName), 0o644);

    const raw = readProductionFolder(root);
    assert.equal(raw.parsed.selectedTakes.parsed, false);
    assert.equal(raw.parsed.selectedTakes.source_authority, 'content_addressed_commit_graph');
    assert.equal(raw.parsed.selectedTakes.error, 'SELECTED_TAKES_GRAPH_RECORD_MODE_INVALID');
    assert.equal(raw.canonical.finishing_inconsistencies.includes('SELECTED_TAKES_GRAPH_RECORD_MODE_INVALID'), true);
});

test('invalid, negative, reversed, non-finite-like, and missing-source ranges never count as accepted', (t) => {
    const { root } = fixture(t);
    const shotIds = ['SH01', 'SH02', 'SH03', 'SH04'];
    writeJson(root, 'shot_manifest.json', shotManifest(shotIds));
    writeJson(root, 'selected_takes.json', selectedDoc(root, [
        selectedTake(root, 'SH01', { source_in_sec: -1 }),
        selectedTake(root, 'SH02', { beat_id: 'BEAT02', source_in_sec: 4, source_out_sec: 2 }),
        selectedTake(root, 'SH03', { beat_id: 'BEAT03', source_in_sec: 'NaN' }),
        selectedTake(root, 'SH04', { beat_id: 'BEAT04' }),
    ]));
    writeJson(root, 'qc_report.json', qcDoc(shotIds.map((shotId) => qcEntry(shotId))));

    const raw = readProductionFolder(root);
    const state = normalizeProductionReaderState(raw);

    assert.equal(state.acceptedSeconds.length, 4);
    assert.equal(state.acceptedSeconds.every((record) => record.accepted === false), true);
    assert.equal(state.fileStatus.quality_accepted, 0);
    assert.equal(raw.canonical.finishing_inconsistencies.some((reason) => reason.startsWith('selected_takes:invalid_range:')), true);
    assert.equal(raw.canonical.finishing_inconsistencies.some((reason) => reason.includes('missing_source_file')), true);
    assert.equal(validateFinalReady(state).ok, false);
});

test('missing, malformed, oversized, and symlinked canonical finishing documents fail closed', (t) => {
    const cases = [
        ['missing', () => {}],
        ['malformed', ({ root }) => {
            fs.writeFileSync(path.join(root, 'selected_takes.json'), '{bad');
            writeJson(root, 'qc_report.json', []);
        }],
        ['oversized', ({ root }) => {
            fs.writeFileSync(path.join(root, 'selected_takes.json'), `{"padding":"${'x'.repeat(513 * 1024)}"}`);
        }],
        ['symlink', ({ base, root }) => {
            const outside = path.join(base, 'outside-selected.json');
            writeJson(base, 'outside-selected.json', selectedDoc(root));
            fs.symlinkSync(outside, path.join(root, 'selected_takes.json'));
        }],
    ];

    for (const [name, setup] of cases) {
        const current = fixture(t, `case-${name}`);
        setup(current);
        const raw = readProductionFolder(current.root);
        const state = normalizeProductionReaderState(raw);
        assert.equal(state.acceptedSeconds.length, 0, name);
        assert.equal(state.canonicalHandoff.final_ready, false, name);
        assert.equal(validateFinalReady(state).ok, false, name);
        assert.equal(raw.canonical.finishing_inconsistencies.length > 0, true, name);
    }
});

test('outside, sensitive, and symlinked source paths are rejected without leaking raw paths or private content', (t) => {
    const { base, root } = fixture(t);
    const outside = path.join(base, 'outside-private.mp4');
    fs.writeFileSync(outside, 'outside');
    fs.mkdirSync(path.join(root, 'credential-cache'), { recursive: true });
    fs.writeFileSync(path.join(root, 'credential-cache/private.mp4'), 'sensitive');
    const realSource = path.join(root, 'takes/real.mp4');
    fs.writeFileSync(realSource, 'real');
    fs.symlinkSync(realSource, path.join(root, 'takes/linked.mp4'));
    writeJson(root, 'shot_manifest.json', shotManifest(['SH01', 'SH02', 'SH03']));
    writeJson(root, 'selected_takes.json', selectedDoc(root, [
        selectedTake(root, 'SH01', { video_path: outside }),
        selectedTake(root, 'SH02', { beat_id: 'BEAT02', video_path: path.join(root, 'credential-cache/private.mp4') }),
        selectedTake(root, 'SH03', { beat_id: 'BEAT03', video_path: path.join(root, 'takes/linked.mp4') }),
    ]));
    writeJson(root, 'qc_report.json', qcDoc(['SH01', 'SH02', 'SH03'].map((shotId) => qcEntry(shotId))));

    const raw = readProductionFolder(root);
    const serialized = JSON.stringify(raw.parsed.selectedTakes);

    assert.equal(raw.parsed.selectedTakes.records.every((record) => record.video_path === ''), true);
    assert.equal(serialized.includes(outside), false);
    assert.equal(serialized.includes('credential-cache'), false);
    assert.equal(serialized.includes('linked.mp4'), false);
    assert.equal(serialized.includes('PRIVATE FINDING MUST NOT LEAK'), false);
});

test('duplicate and mismatched shot/provider/QC state, plus stale QC, remain explicit blockers', (t) => {
    const { root } = fixture(t);
    fs.writeFileSync(path.join(root, 'takes/SH01.mp4'), 'source');
    writeJson(root, 'shot_manifest.json', shotManifest(['SH01']));
    writeJson(root, 'qc_report.json', qcDoc([
        qcEntry('SH02'),
        qcEntry('SH02', { provider: 'flow', decision: 'retry', deterministic_checks_passed: false }),
    ]));
    const qcTime = new Date('2026-07-13T10:00:00.000Z');
    fs.utimesSync(path.join(root, 'qc_report.json'), qcTime, qcTime);
    writeJson(root, 'selected_takes.json', selectedDoc(root, [
        selectedTake(root, 'SH01'),
        selectedTake(root, 'SH01', { take_id: 'duplicate_take' }),
    ]));
    const selectedTime = new Date('2026-07-13T11:00:00.000Z');
    fs.utimesSync(path.join(root, 'selected_takes.json'), selectedTime, selectedTime);

    const raw = readProductionFolder(root);
    const state = normalizeProductionReaderState(raw);
    const issues = raw.canonical.finishing_inconsistencies;

    assert.equal(issues.includes('selected_takes:duplicate_shot_id:SH01'), true);
    assert.equal(issues.includes('qc_report:duplicate_shot_id:SH02'), true);
    assert.equal(issues.includes('qc_report:missing_for_shot:SH01'), true);
    assert.equal(issues.includes('qc_report:unknown_selected_shot:SH02'), true);
    assert.equal(issues.includes('qc_report:stale_for_selected_takes'), true);
    assert.equal(state.acceptedSeconds.every((record) => record.accepted === false), true);
    assert.equal(state.qaRecords.every((record) => record.verdict === 'UNREVIEWED'), true);
    assert.equal(validateFinalReady(state).ok, false);
});

test('unfinished ffprobe and selected-range render commands expose no command, evidence claim, or copy path', () => {
    const state = {
        project: { root_path: '/tmp/synthetic-production' },
        qaRecords: [{ file_path: '/tmp/synthetic-production/takes/SH01.mp4' }],
        finalReport: {
            final_video_path: '/tmp/synthetic-production/final/final.mp4',
            concat_list_path: '/tmp/synthetic-production/final/concat_list.txt',
        },
    };
    const specs = [...buildFfprobeValidationCommands(state), buildFfmpegConcatPreviewCommand(state)];
    for (const spec of specs) {
        assert.equal(spec.command, '');
        assert.deepEqual(spec.args, []);
        assert.equal(spec.copy_allowed, false);
        assert.equal(spec.evidence_output_path, '');
        assert.equal(renderShellCommand(spec).includes('ffmpeg'), false);
        assert.equal(renderShellCommand(spec).includes('ffprobe'), false);
        assert.equal(classifySideEffect(spec).mode, 'blocked');
        assert.equal(classifySideEffect(spec).copyAllowed, false);
    }
});
