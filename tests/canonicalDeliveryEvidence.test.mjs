import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { finalReadyState } from '../src/fixtures/pipeline/queueRuleStates.js';
import { normalizeProductionReaderState } from '../src/lib/pipeline/productionNormalizer.js';
import { validateFinalReady } from '../src/lib/pipeline/validators.js';

const require = createRequire(import.meta.url);
const { readProductionFolder } = require('../electron/lib/productionReader.js');

const DELIVERY_SCHEMA = 'short_drama_room.delivery.v1';
const MAX_CANONICAL_MEDIA_BYTES = 16 * 1024 * 1024 * 1024;

function fixture(t, name = 'delivery-fixture') {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-delivery-'));
    const root = path.join(base, name);
    for (const directory of ['intake', 'storyboard', 'prompts', 'generated', 'final', 'qa']) {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'intake/brief.md'), '# Synthetic delivery fixture\n');
    fs.writeFileSync(path.join(root, 'storyboard/storyboard.json'), JSON.stringify({
        clips: [{ scene_id: 'SC01', clip_id: 'clip_SH01', duration: 5 }],
    }));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root };
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeDelivery(root, options = {}) {
    const key = options.key || 'master';
    const fileName = options.fileName || (key === 'master_sub' ? 'master_sub.mp4' : 'master.mp4');
    const masterPath = path.join(root, 'final', fileName);
    if (options.createMaster !== false) fs.writeFileSync(masterPath, options.content || 'synthetic canonical master');
    const checksum = options.checksum ?? (options.createMaster === false ? 'a'.repeat(64) : sha256(masterPath));
    const manifest = {
        schema_version: DELIVERY_SCHEMA,
        master: null,
        master_sub: null,
        mobile: null,
        square: null,
        thumbnail_poster: null,
        thumbnail_1280x720: null,
        subtitles: { ass: null, srt: null },
        checksums: { [key]: checksum },
        probe: { [key]: { duration: 5.25, has_video: true, has_audio: true } },
        gate_status: 'pass',
        ignored_private_error: 'PRIVATE DELIVERY ERROR MUST NOT LEAK',
        ...options.manifest,
    };
    manifest[key] = options.pathValue ?? masterPath;
    if (options.probe !== undefined) manifest.probe[key] = options.probe;
    const manifestPath = path.join(root, 'final/delivery_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    return { manifest, manifestPath, masterPath };
}

test('exact Layout A delivery manifest verifies master and producer-style master_sub paths without a fresh probe', (t) => {
    for (const [name, key, fileName] of [
        ['master', 'master', 'master.mp4'],
        ['producer-master-sub', 'master', 'master_sub.mp4'],
        ['explicit-master-sub', 'master_sub', 'master_sub.mp4'],
    ]) {
        const { root } = fixture(t, name);
        const { masterPath, manifestPath } = writeDelivery(root, { key, fileName });
        const raw = readProductionFolder(root);
        const state = normalizeProductionReaderState(raw);
        const delivery = raw.parsed.deliveryManifest;

        assert.equal(delivery.relative_path, 'final/delivery_manifest.json', name);
        assert.equal(delivery.verified, true, name);
        assert.equal(delivery.value.canonical_master.path, masterPath, name);
        assert.equal(delivery.value.canonical_master.sha256_verified, true, name);
        assert.equal(delivery.value.canonical_master.persisted_probe.duration_seconds, 5.25, name);
        assert.equal(delivery.value.canonical_master.fresh_probe_verified, false, name);
        assert.equal(state.finalReport.final_video_path, masterPath, name);
        assert.equal(state.finalReport.delivery_manifest_path, manifestPath, name);
        assert.equal(state.finalReport.persisted_probe_verified, true, name);
        assert.equal(state.finalReport.fresh_probe_verified, false, name);
        assert.equal(state.fileEvidence[masterPath], true, name);
        assert.equal(state.fileEvidence[manifestPath], true, name);
        assert.equal(JSON.stringify({ raw, state }).includes('PRIVATE DELIVERY ERROR MUST NOT LEAK'), false, name);
    }
});

test('verified delivery satisfies only final media, persisted probe, and stitch evidence', (t) => {
    const { root } = fixture(t);
    writeDelivery(root);
    const state = normalizeProductionReaderState(readProductionFolder(root));
    const validation = validateFinalReady(state);

    assert.equal(validation.ok, false);
    assert.equal(validation.details.deliveryEvidence, 'canonical_delivery_manifest_sha256_verified');
    assert.equal(validation.details.stitchEvidence, 'canonical_filter_complex_delivery_manifest');
    assert.equal(validation.details.persistedProbe, 'producer_persisted_probe_verified');
    assert.equal(validation.details.freshProbe, 'not_run');
    assert.equal(validation.details.concatList, undefined);
    assert.equal(validation.details.ffprobe, undefined);
    assert.ok(validation.details.missingSubmitIds?.length);
    assert.ok(validation.details.missingDownloads?.length);
    assert.ok(validation.details.missingQa?.length || validation.details.qaNotPassedOrException?.length);
    assert.ok(validation.details.missingAcceptedSeconds?.length);
    assert.equal(validation.details.report, 'missing_report_evidence');
    assert.ok(validation.details.activeBlockers?.length);
});

test('delivery manifest is exact-path only and unrelated mp4 or ffprobe files cannot promote evidence', (t) => {
    const { root } = fixture(t);
    const unrelated = path.join(root, 'final/unrelated.mp4');
    fs.writeFileSync(unrelated, 'unrelated');
    fs.writeFileSync(path.join(root, 'final/unrelated.ffprobe.json'), JSON.stringify({ duration: 99 }));
    const misplaced = writeDelivery(root);
    fs.renameSync(misplaced.manifestPath, path.join(root, 'delivery_manifest.json'));

    let raw = readProductionFolder(root);
    let state = normalizeProductionReaderState(raw);
    assert.equal(raw.parsed.deliveryManifest.exists, false);
    assert.notEqual(state.finalReport.final_video_path, unrelated);
    assert.equal(state.finalReport.ffprobe_verified, false);

    fs.writeFileSync(path.join(root, 'final/delivery_manifest.json'), '{bad');
    raw = readProductionFolder(root);
    state = normalizeProductionReaderState(raw);
    assert.equal(raw.parsed.deliveryManifest.verified, false);
    assert.equal(state.finalReport.final_video_path, '');
    assert.equal(state.finalReport.ffprobe_path, '');
    assert.equal(state.finalReport.delivery_verified, false);
    assert.equal(validateFinalReady(state).details.finalVideo, 'missing_final_mp4_evidence');
});

test('malformed, oversized, symlinked, schema-invalid, and gate-failed manifests fail closed', (t) => {
    const cases = [
        ['malformed', ({ root }) => fs.writeFileSync(path.join(root, 'final/delivery_manifest.json'), '{bad')],
        ['oversized', ({ root }) => fs.writeFileSync(path.join(root, 'final/delivery_manifest.json'), `{"padding":"${'x'.repeat(513 * 1024)}"}`)],
        ['symlinked', ({ base, root }) => {
            const outside = path.join(base, 'outside-delivery.json');
            fs.writeFileSync(outside, '{}');
            fs.symlinkSync(outside, path.join(root, 'final/delivery_manifest.json'));
        }],
        ['schema', ({ root }) => writeDelivery(root, { manifest: { schema_version: 'wrong.schema' } })],
        ['gate', ({ root }) => writeDelivery(root, { manifest: { gate_status: 'blocked' } })],
    ];

    for (const [name, setup] of cases) {
        const current = fixture(t, `manifest-${name}`);
        setup(current);
        const delivery = readProductionFolder(current.root).parsed.deliveryManifest;
        assert.equal(delivery.exists, true, name);
        assert.equal(delivery.verified, false, name);
        assert.equal(delivery.issues.length > 0, true, name);
        assert.equal(JSON.stringify(delivery).includes('PRIVATE DELIVERY ERROR MUST NOT LEAK'), false, name);
    }
});

test('unsafe, sensitive, symlinked, missing, and oversized canonical masters fail closed without path leakage', (t) => {
    const cases = [
        ['outside', ({ base, root }) => {
            const outside = path.join(base, 'outside-master.mp4');
            fs.writeFileSync(outside, 'outside');
            writeDelivery(root, { pathValue: outside, checksum: sha256(outside) });
        }, 'outside-master.mp4'],
        ['sensitive', ({ root }) => {
            fs.mkdirSync(path.join(root, 'secret-cache'), { recursive: true });
            const sensitive = path.join(root, 'secret-cache/master.mp4');
            fs.writeFileSync(sensitive, 'secret');
            writeDelivery(root, { pathValue: sensitive, checksum: sha256(sensitive) });
        }, 'secret-cache'],
        ['symlinked', ({ root }) => {
            const real = path.join(root, 'final/real-master.mp4');
            const linked = path.join(root, 'final/master.mp4');
            fs.writeFileSync(real, 'real');
            fs.symlinkSync(real, linked);
            writeDelivery(root, { createMaster: false, pathValue: linked, checksum: sha256(real) });
        }, 'real-master.mp4'],
        ['missing', ({ root }) => writeDelivery(root, { createMaster: false }), 'master.mp4'],
        ['oversized', ({ root }) => {
            const { masterPath } = writeDelivery(root);
            fs.truncateSync(masterPath, MAX_CANONICAL_MEDIA_BYTES + 1);
            const manifest = JSON.parse(fs.readFileSync(path.join(root, 'final/delivery_manifest.json'), 'utf8'));
            manifest.checksums.master = 'a'.repeat(64);
            fs.writeFileSync(path.join(root, 'final/delivery_manifest.json'), JSON.stringify(manifest));
        }, 'master.mp4'],
    ];

    for (const [name, setup, forbiddenPathFragment] of cases) {
        const current = fixture(t, `master-${name}`);
        setup(current);
        const delivery = readProductionFolder(current.root).parsed.deliveryManifest;
        const serialized = JSON.stringify(delivery);
        assert.equal(delivery.verified, false, name);
        assert.equal(delivery.issues.length > 0, true, name);
        assert.equal(serialized.includes(forbiddenPathFragment), false, name);
    }
});

test('checksum and persisted probe errors plus partial manifests fail closed', (t) => {
    const cases = [
        ['missing-checksum', ({ root }) => writeDelivery(root, { checksum: undefined, manifest: { checksums: {} } })],
        ['malformed-checksum', ({ root }) => writeDelivery(root, { checksum: 'not-a-sha' })],
        ['mismatch-checksum', ({ root }) => writeDelivery(root, { checksum: 'a'.repeat(64) })],
        ['zero-duration', ({ root }) => writeDelivery(root, { probe: { duration: 0, has_video: true, has_audio: true } })],
        ['missing-video', ({ root }) => writeDelivery(root, { probe: { duration: 5, has_video: false, has_audio: true } })],
        ['missing-audio', ({ root }) => writeDelivery(root, { probe: { duration: 5, has_video: true, has_audio: false } })],
        ['partial-mobile', ({ root }) => writeDelivery(root, {
            manifest: { mobile: path.join(root, 'final/mobile.mp4') },
        })],
    ];

    for (const [name, setup] of cases) {
        const current = fixture(t, `evidence-${name}`);
        setup(current);
        const delivery = readProductionFolder(current.root).parsed.deliveryManifest;
        assert.equal(delivery.verified, false, name);
        assert.equal(delivery.issues.length > 0, true, name);
    }
});

test('a manifest older than its master and a master changed during hashing are rejected', (t) => {
    const stale = fixture(t, 'stale');
    const staleFiles = writeDelivery(stale.root);
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(staleFiles.masterPath, future, future);
    assert.match(readProductionFolder(stale.root).parsed.deliveryManifest.issues.join(','), /manifest_stale/);

    const changed = fixture(t, 'changed');
    const changedFiles = writeDelivery(changed.root, { content: 'x'.repeat(128 * 1024) });
    const originalReadSync = fs.readSync;
    let mutated = false;
    fs.readSync = function patchedReadSync(descriptor, buffer, offset, length, position) {
        const bytesRead = originalReadSync.call(fs, descriptor, buffer, offset, length, position);
        if (!mutated && buffer.length === 1024 * 1024) {
            mutated = true;
            fs.appendFileSync(changedFiles.masterPath, 'changed');
        }
        return bytesRead;
    };
    try {
        const delivery = readProductionFolder(changed.root).parsed.deliveryManifest;
        assert.equal(mutated, true);
        assert.equal(delivery.verified, false);
        assert.match(delivery.issues.join(','), /source_file_changed/);
    } finally {
        fs.readSync = originalReadSync;
    }
});

test('legacy strict final-ready fixture remains a PASS without canonical delivery fields', () => {
    const state = finalReadyState();
    assert.equal(state.finalReport.delivery_verified, undefined);
    assert.equal(validateFinalReady(state).ok, true);
});
