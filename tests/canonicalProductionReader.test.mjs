import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { normalizeProductionReaderState } from '../src/lib/pipeline/productionNormalizer.js';
import { validateFinalReady } from '../src/lib/pipeline/validators.js';

const require = createRequire(import.meta.url);
const { readProductionFolder } = require('../electron/lib/productionReader.js');

function fixture(t, name = 'canonical-pack') {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-canonical-reader-'));
    const root = path.join(base, name);
    for (const directory of ['intake', 'storyboard', 'prompts', 'generated', 'final', 'qa', 'downloads']) {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'intake/brief.md'), '# Canonical fixture\n');
    fs.writeFileSync(path.join(root, 'intake/script.txt'), 'SYNTHETIC SCRIPT CONTENT MUST NOT BE COPIED\n');
    fs.writeFileSync(path.join(root, 'storyboard/storyboard.json'), JSON.stringify({
        clips: [{ scene_id: 'scene_01', clip_id: 'clip_001', duration: 5 }],
    }));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root };
}

function writeJson(root, relativePath, value) {
    fs.writeFileSync(path.join(root, relativePath), JSON.stringify(value));
}

test('Layout A canonical pack restores script.txt and sanitized report/manifests without promoting quality', (t) => {
    const { base, root } = fixture(t);
    const clipPath = path.join(root, 'downloads', 'scene_0.mp4');
    fs.writeFileSync(clipPath, 'synthetic-video-marker');
    writeJson(root, 'pipeline_pack_report.json', {
        pack_contract_version: 'short-drama-pipeline-pack.v2',
        canonical_production_id: path.basename(root),
        target_generator: 'flow',
        scene_count: 1,
        actual_generation_submitted: true,
        common_ir_enabled: true,
        created_files: ['RAW_LIST_MUST_NOT_BE_COPIED'],
        next_required_gate: 'RAW NARRATIVE MUST NOT BE COPIED',
    });
    writeJson(root, 'submission_manifest.json', [{
        scene_index: 0,
        shot_id: 'SHOT_01',
        gen_status: 'processing',
        model: 'seedance2.0',
        submit_id: 'task_001',
        prompt: 'PRIVATE NARRATIVE MUST NOT BE COPIED',
        image: '/private/reference.png',
        error: 'PRIVATE ERROR MUST NOT BE COPIED',
    }]);
    writeJson(root, 'jimeng_state.json', {
        provider: 'dreamina_cli',
        submitted_indices: [0],
        completed_indices: [],
        downloaded_indices: [0],
        failed_indices: [],
        submit_ids: { 0: 'task_001' },
        model: 'seedance2.0',
        downloads_dir: '/private/raw/path',
    });
    writeJson(root, 'download_manifest.json', {
        0: {
            submit_id: 'task_001',
            downloaded_paths: [clipPath, path.join(base, 'outside.mp4')],
            provider: 'dreamina_cli',
            raw_note: 'PRIVATE DOWNLOAD NOTE',
        },
    });

    const raw = readProductionFolder(root);
    const state = normalizeProductionReaderState(raw);
    const serialized = JSON.stringify(raw);

    assert.equal(raw.layout, 'A');
    assert.equal(raw.markdown.script.relative_path, 'intake/script.txt');
    assert.equal(raw.parsed.pipelinePackReport.parsed, true);
    assert.equal(raw.parsed.submissionManifest.parsed, true);
    assert.equal(raw.parsed.jimengState.parsed, true);
    assert.equal(raw.parsed.downloadManifest.parsed, true);
    assert.equal(raw.parsed.downloadManifest.records[0].downloaded_paths.length, 1);
    for (const forbidden of [
        'SYNTHETIC SCRIPT CONTENT MUST NOT BE COPIED',
        'RAW_LIST_MUST_NOT_BE_COPIED',
        'RAW NARRATIVE MUST NOT BE COPIED',
        'PRIVATE NARRATIVE MUST NOT BE COPIED',
        'PRIVATE ERROR MUST NOT BE COPIED',
        'PRIVATE DOWNLOAD NOTE',
        path.join(base, 'outside.mp4'),
    ]) assert.equal(serialized.includes(forbidden), false, forbidden);

    assert.equal(state.project.route, 'flow_omni');
    assert.equal(state.brief.script_path, path.join(root, 'intake/script.txt'));
    assert.equal(state.submitRecords[0].clip_id, 'SHOT_01');
    assert.equal(state.submitRecords[0].status, 'processing');
    assert.equal(state.submitRecords[0].submitted_cli_model, 'seedance2.0');
    assert.equal(state.submitRecords[0].downloaded, true);
    assert.equal(state.submitRecords[0].download_dir, path.join(root, 'downloads'));
    assert.equal(state.canonicalHandoff.validation_input_ready, true);
    assert.equal(state.canonicalHandoff.final_ready, false);
    assert.ok(state.blockers.includes('OUTPUT_QUALITY_NOT_PROVEN'));
    assert.equal(validateFinalReady(state).ok, false);
});

test('partial, stale, malformed, oversized, and missing canonical inputs stay explicit and fail closed', (t) => {
    const { root } = fixture(t, 'partial-pack');
    writeJson(root, 'pipeline_pack_report.json', {
        canonical_production_id: 'wrong-production-id',
        target_generator: 'unsupported',
        scene_count: 1,
        actual_generation_submitted: false,
    });
    writeJson(root, 'submission_manifest.json', [{ scene_index: 0, shot_id: 'SHOT_01' }]);
    fs.writeFileSync(path.join(root, 'jimeng_state.json'), '{malformed');
    fs.writeFileSync(path.join(root, 'download_manifest.json'), `${' '.repeat(512 * 1024)}{}`);

    let raw = readProductionFolder(root);
    let state = normalizeProductionReaderState(raw);
    assert.equal(raw.parsed.jimengState.parsed, false);
    assert.equal(raw.parsed.downloadManifest.parsed, false);
    assert.ok(raw.parsed.downloadManifest.error.includes('file too large'));
    assert.ok(raw.canonical.inconsistencies.includes('pipeline_report_submission_state_stale'));
    assert.ok(raw.canonical.inconsistencies.includes('canonical_production_id_mismatch'));
    assert.ok(raw.canonical.inconsistencies.includes('unsupported_target_generator'));
    assert.ok(raw.canonical.inconsistencies.includes('jimeng_state.json:malformed_or_oversized'));
    assert.ok(raw.canonical.inconsistencies.includes('download_manifest.json:malformed_or_oversized'));
    assert.equal(state.submitRecords[0].status, 'unknown');
    assert.equal(state.submitRecords[0].submitted_cli_model, 'unknown');
    assert.equal(state.canonicalHandoff.validation_input_ready, false);
    assert.equal(state.canonicalHandoff.final_ready, false);
    assert.equal(validateFinalReady(state).ok, false);

    fs.unlinkSync(path.join(root, 'intake/script.txt'));
    raw = readProductionFolder(root);
    state = normalizeProductionReaderState(raw);
    assert.equal(state.canonicalHandoff.validation_input_ready, false);
    assert.equal(validateFinalReady(state).ok, false);
});

test('symlinked canonical JSON and sensitive download path components are rejected', (t) => {
    const { base, root } = fixture(t, 'symlink-pack');
    const outsideReport = path.join(base, 'outside-report.json');
    writeJson(base, 'outside-report.json', {
        canonical_production_id: 'symlink-pack',
        target_generator: 'both',
        scene_count: 1,
        actual_generation_submitted: false,
    });
    fs.symlinkSync(outsideReport, path.join(root, 'pipeline_pack_report.json'));
    writeJson(root, 'download_manifest.json', {
        0: { downloaded_paths: [path.join(root, 'secret', 'private.mp4')] },
    });

    const raw = readProductionFolder(root);
    const state = normalizeProductionReaderState(raw);
    assert.equal(raw.parsed.pipelinePackReport.exists, true);
    assert.equal(raw.parsed.pipelinePackReport.parsed, false);
    assert.match(raw.parsed.pipelinePackReport.error, /non-symlink regular file/);
    assert.deepEqual(raw.parsed.downloadManifest.records[0].downloaded_paths, []);
    assert.equal(state.canonicalHandoff.validation_input_ready, false);
    assert.equal(validateFinalReady(state).ok, false);
});
