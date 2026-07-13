import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { normalizeProductionReaderState } from '../src/lib/pipeline/productionNormalizer.js';
import {
    validateFinalReady,
    validateImageDashboard,
    validateProductionBrief,
    validateStoryboardClip,
} from '../src/lib/pipeline/validators.js';

const require = createRequire(import.meta.url);
const { readProductionFolder } = require('../electron/lib/productionReader.js');

const repoRoot = path.resolve(import.meta.dirname, '..');
const layoutARoot = path.join(repoRoot, 'src/fixtures/pipeline/layoutAProduction/20260713-studio-fixture');
const layoutBRoot = path.join(repoRoot, 'src/fixtures/pipeline/sampleProductionFolder');

function withTempDir(name, callback) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
    try {
        return callback(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function assertReconstructable(raw, state, expected) {
    assert.equal(raw.layout, expected.layout);
    assert.equal(state.project.route, expected.route);
    assert.equal(state.project.production_id, path.basename(raw.rootPath));
    assert.ok(state.project.title);
    assert.ok(state.brief.concept);
    assert.ok(state.brief.logline);
    assert.ok(state.brief.script_path.endsWith('script.md'));
    assert.equal(validateProductionBrief(state).ok, true);

    assert.equal(state.storyboard.length, 1);
    assert.equal(validateStoryboardClip(state.storyboard[0]).ok, true);
    assert.equal(state.motionBoard.length, 1);
    assert.equal(state.motionBoard[0].duration_lock, true);
    assert.equal(state.imageDashboard.parsed, true);
    assert.equal(state.assets.length, 1);
    assert.equal(validateImageDashboard(state).blockers.includes('MISSING_IMAGE_DASHBOARD'), false);
    assert.equal(state.submitRecords.length, 1);
    assert.equal(state.heartbeatRecords.length, 1);
    assert.equal(state.acceptedSeconds.length, 1);
    assert.equal(state.fileStatus.quality_accepted, 1);
    assert.ok(state.finalReport.report_path.endsWith('report.md'));

    const finalValidation = validateFinalReady(state);
    assert.equal(finalValidation.ok, false);
    assert.ok(finalValidation.blockers.includes('OUTPUT_QUALITY_NOT_PROVEN'));
    assert.equal(state.reviewGates.find((gate) => gate.type === 'accepted_seconds')?.status, 'PASS');
    assert.equal(state.reviewGates.find((gate) => gate.type === 'submit_confirmation')?.status, 'BLOCK');
}

test('Layout A fixture is detected and reconstructed through reader, normalizer, and validators', () => {
    const raw = readProductionFolder(layoutARoot);
    const state = normalizeProductionReaderState(raw);

    assertReconstructable(raw, state, { layout: 'A', route: 'seedance' });
    assert.ok(raw.markdown.intake.relative_path.startsWith('intake/'));
    assert.ok(raw.parsed.acceptedSeconds.relative_path.startsWith('qa/'));
    assert.ok(state.finalReport.final_video_path.endsWith('final/final.mp4'));
    assert.equal(state.fileEvidence[state.finalReport.final_video_path], true);
    assert.equal(state.finalReport.ffprobe_verified, true);
});

test('Layout B fixture uses production-root markers and reconstructs the alternate paths', () => {
    const raw = readProductionFolder(layoutBRoot);
    const state = normalizeProductionReaderState(raw);

    assertReconstructable(raw, state, { layout: 'B', route: 'both' });
    assert.equal(raw.markdown.brief.relative_path, 'brief.md');
    assert.ok(raw.parsed.acceptedSeconds.relative_path.startsWith('edit/'));
    assert.ok(state.finalReport.final_video_path.endsWith('edit/final.mp4'));
    assert.equal(state.fileEvidence[state.finalReport.final_video_path], false);
});

test('nested production folder is selected as Layout B without confusing its parent with Layout A', () => {
    withTempDir('reader-nested-layout-b', (selectedRoot) => {
        const production = path.join(selectedRoot, 'production');
        fs.mkdirSync(production);
        fs.writeFileSync(path.join(production, 'brief.md'), '# Nested B\n\nConcept: Nested fixture.\nLogline: Nested production root.\n');

        const raw = readProductionFolder(selectedRoot);
        assert.equal(raw.layout, 'B');
        assert.equal(raw.selectedRoot, selectedRoot);
        assert.equal(raw.rootPath, production);
    });
});

test('malformed JSON, JSONL, dashboard JavaScript, CSV, and accepted-seconds markdown fail closed', () => {
    withTempDir('reader-malformed', (root) => {
        fs.mkdirSync(path.join(root, 'assets'));
        fs.mkdirSync(path.join(root, 'storyboard'));
        fs.mkdirSync(path.join(root, 'motion_board'));
        fs.mkdirSync(path.join(root, 'image_dashboard'));
        fs.mkdirSync(path.join(root, 'dreamina_outputs'));
        fs.mkdirSync(path.join(root, 'edit'));
        fs.writeFileSync(path.join(root, 'brief.md'), '# Malformed fixture\n');
        fs.writeFileSync(path.join(root, 'storyboard/storyboard.json'), '{broken');
        fs.writeFileSync(path.join(root, 'motion_board/motion_board.json'), '[broken');
        fs.writeFileSync(path.join(root, 'image_dashboard/image-dashboard-data.js'), 'export default not-json;');
        fs.writeFileSync(path.join(root, 'dreamina_outputs/submit_records.jsonl'), '{bad-line}\n');
        fs.writeFileSync(path.join(root, 'dreamina_outputs/heartbeat_log.jsonl'), '{also-bad}\n');
        fs.writeFileSync(path.join(root, 'ledger.csv'), '\n');
        fs.writeFileSync(path.join(root, 'edit/accepted_seconds.md'), '# no table here\n');

        const raw = readProductionFolder(root);
        const state = normalizeProductionReaderState(raw);

        assert.equal(raw.layout, 'B');
        assert.equal(raw.parsed.storyboardJson.parsed, false);
        assert.equal(raw.parsed.motionBoardJson.parsed, false);
        assert.equal(raw.parsed.imageDashboard.parsed, false);
        assert.equal(raw.parsed.submitRecords.parsed, false);
        assert.equal(raw.parsed.heartbeatLog.parsed, false);
        assert.equal(raw.parsed.ledgerCsv.parsed, false);
        assert.equal(raw.parsed.acceptedSeconds.parsed, false);
        assert.match(raw.parsed.acceptedSeconds.error, /missing required table headers/);
        assert.ok(raw.blockers.includes('MISSING_STORYBOARD_CONTINUITY_PACKET'));
        assert.ok(raw.blockers.includes('MISSING_MOTION_BOARD'));
        assert.ok(raw.blockers.includes('MISSING_IMAGE_DASHBOARD'));
        assert.ok(raw.blockers.includes('MISSING_ACCEPTED_SECONDS'));
        assert.equal(state.storyboard.length, 0);
        assert.equal(validateFinalReady(state).ok, false);
    });
});

test('sensitive names, ignored directories, and symlink escapes are skipped without path or content leakage', () => {
    withTempDir('reader-safety', (root) => {
        const outside = path.join(path.dirname(root), `${path.basename(root)}-outside-private.txt`);
        try {
            fs.mkdirSync(path.join(root, 'assets'));
            fs.mkdirSync(path.join(root, '.git'));
            fs.mkdirSync(path.join(root, 'node_modules'));
            fs.mkdirSync(path.join(root, 'credentials'));
            fs.writeFileSync(path.join(root, 'brief.md'), '# Safety\n\nConcept: Safe fixture.\nLogline: No sensitive content.\n');
            fs.writeFileSync(path.join(root, 'secret-token.txt'), 'DO_NOT_LEAK_MARKER');
            fs.writeFileSync(path.join(root, '.env'), 'DO_NOT_LEAK_MARKER');
            fs.writeFileSync(path.join(root, 'api_key.txt'), 'DO_NOT_LEAK_MARKER');
            fs.writeFileSync(path.join(root, '.git/config'), 'DO_NOT_LEAK_MARKER');
            fs.writeFileSync(path.join(root, 'node_modules/private.js'), 'DO_NOT_LEAK_MARKER');
            fs.writeFileSync(path.join(root, 'credentials/private.txt'), 'DO_NOT_LEAK_MARKER');
            fs.writeFileSync(outside, 'OUTSIDE_DO_NOT_LEAK_MARKER');
            fs.symlinkSync(outside, path.join(root, 'assets/outside.txt'));

            const raw = readProductionFolder(root);
            const serialized = JSON.stringify(raw);

            assert.equal(serialized.includes('DO_NOT_LEAK_MARKER'), false);
            assert.equal(serialized.includes('OUTSIDE_DO_NOT_LEAK_MARKER'), false);
            assert.equal(serialized.includes(outside), false);
            assert.equal(raw.files.some((file) => /secret|token|credential|api_key|\.env|node_modules|\.git/.test(file.relative_path)), false);
            assert.equal(raw.security.skipped.sensitive_name >= 4, true);
            assert.equal(raw.security.skipped.ignored_directory, 2);
            assert.equal(raw.security.skipped.symlink, 1);
        } finally {
            fs.rmSync(outside, { force: true });
        }
    });
});

test('dashboard path traversal is removed during normalization', () => {
    withTempDir('reader-path-traversal', (root) => {
        fs.mkdirSync(path.join(root, 'assets'));
        fs.mkdirSync(path.join(root, 'image_dashboard'));
        fs.writeFileSync(path.join(root, 'brief.md'), '# Safe root\n');
        fs.writeFileSync(
            path.join(root, 'image_dashboard/image-dashboard-data.js'),
            'export default {"assets":[{"asset_id":"escape","path":"../../outside-private.txt","type":"reference","continuity_notes":"fixture"}]};',
        );

        const state = normalizeProductionReaderState(readProductionFolder(root));
        assert.equal(state.assets[0].path, '');
        assert.equal(state.referenceMediaPaths.length, 0);
    });
});

test('walker depth and file limits are explicit, deterministic, and fail safe', () => {
    withTempDir('reader-limits', (root) => {
        fs.mkdirSync(path.join(root, 'assets/deep'), { recursive: true });
        fs.writeFileSync(path.join(root, 'a.txt'), 'a');
        fs.writeFileSync(path.join(root, 'b.txt'), 'b');
        fs.writeFileSync(path.join(root, 'c.txt'), 'c');
        fs.writeFileSync(path.join(root, 'assets/deep/hidden.txt'), 'hidden');

        const fileLimited = readProductionFolder(root, { maxFiles: 2, maxDepth: 8 });
        assert.equal(fileLimited.files.length, 2);
        assert.equal(fileLimited.security.walk_truncated, true);
        assert.equal(fileLimited.security.skipped.file_limit > 0, true);

        const depthLimited = readProductionFolder(root, { maxFiles: 20, maxDepth: 0 });
        assert.equal(depthLimited.files.some((file) => file.relative_path.endsWith('hidden.txt')), false);
        assert.equal(depthLimited.security.walk_truncated, true);
        assert.equal(depthLimited.security.skipped.depth_limit > 0, true);
    });
});

test('missing, symlinked, and sensitive-name roots are rejected', () => {
    withTempDir('reader-root-policy', (parent) => {
        const realRoot = path.join(parent, 'production');
        const symlinkRoot = path.join(parent, 'production-link');
        const sensitiveRoot = path.join(parent, 'auth-bundle');
        fs.mkdirSync(realRoot);
        fs.mkdirSync(sensitiveRoot);
        fs.symlinkSync(realRoot, symlinkRoot);

        assert.throws(() => readProductionFolder(path.join(parent, 'missing')), /does not exist/);
        assert.throws(() => readProductionFolder(symlinkRoot), /does not exist/);
        assert.throws(() => readProductionFolder(sensitiveRoot), /rejected by safety policy/);
    });
});
