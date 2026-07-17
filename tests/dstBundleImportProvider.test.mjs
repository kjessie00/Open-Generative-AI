import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const provider = require('../electron/lib/dstBundleImportProvider.js');
const filmProvider = require('../electron/lib/filmPipelineProvider.js');
const { readProductionFolder } = require('../electron/lib/productionReader.js');

const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('dst-import-real-local-fixture'),
]);

function pngFixture(label) {
    return Buffer.concat([PNG.subarray(0, 8), Buffer.from(label)]);
}

function writeBundle(dstRoot, overrides = {}) {
    const bundleName = overrides.bundleName || '20260715_1200_fixture_bundle_abcdef1234';
    const bundleRoot = path.join(dstRoot, bundleName);
    const imageName = overrides.imageName || 'image_01.png';
    const images = overrides.images || [{ name: imageName, buffer: overrides.image || PNG }];
    fs.mkdirSync(path.join(bundleRoot, 'images'), { recursive: true });
    const manifest = {
        id: overrides.id || 'fixture_bundle_abcdef1234',
        type: 'image_generation',
        status: 'complete',
        profile: 'goldpure369',
        query: 'Cinematic scene retry prompt',
        files: { images: 'images/' },
        created_at: '2026-07-15T03:00:00.000Z',
        ...overrides.manifest,
    };
    const metadata = {
        status: 'complete',
        profile: 'goldpure369',
        image_count: images.length,
        query: manifest.query,
        ...overrides.metadata,
    };
    fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(bundleRoot, 'metadata.json'), JSON.stringify(metadata));
    for (const image of images) fs.writeFileSync(path.join(bundleRoot, 'images', image.name), image.buffer);
    return { bundleRoot, imageName: images[0].name, imageNames: images.map((image) => image.name), manifest, metadata };
}

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-dst-import-')));
    const dstRoot = path.join(base, 'dst-images');
    const productionRoot = path.join(base, 'production');
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(dstRoot);
    fs.mkdirSync(path.join(productionRoot, 'reviews'), { recursive: true });
    fs.mkdirSync(userDataPath);
    fs.writeFileSync(path.join(productionRoot, 'brief.md'), '# DST import fixture\n');
    const source = {
        media_id: 'scene_dst_retry',
        kind: 'scene_image',
        target_id: 'clip_002',
        provider: 'dst',
        operation_id: 'old_operation',
        attempt: 1,
        reference_ids: [],
        relative_path: 'media/old.png',
        generation_status: 'downloaded',
        prompt: 'Retry this scene',
        aspect_ratio: '9:16',
        review_status: 'retry_requested',
        retry_of: '',
    };
    fs.writeFileSync(path.join(productionRoot, 'media_attempts.jsonl'), `${JSON.stringify(source)}\n`);
    fs.writeFileSync(path.join(productionRoot, 'reviews', 'media_review_draft.json'), `${JSON.stringify({
        schema: 'film_pipeline.media_review_draft.v1',
        execution: 'not_run',
        reviews: [{ media_id: source.media_id, review_status: 'retry_requested', review_note: '', selected_for_retry: true }],
        retry_queue: [{
            sequence: 1,
            media_id: source.media_id,
            kind: source.kind,
            target_id: source.target_id,
            provider: source.provider,
            attempt: source.attempt,
            retry_of: source.media_id,
            review_note: '',
            execution_status: 'draft_not_executed',
        }],
    })}\n`);
    const bundle = writeBundle(dstRoot);
    const context = {
        dstImagesRoot: dstRoot,
        userDataPath,
        config: { productionRoot },
        tokenSecret: Buffer.alloc(32, 7),
        planStore: new Map(),
    };
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, dstRoot, productionRoot, userDataPath, source, bundle, context };
}

function selectedCandidate(context) {
    const workspace = provider.getDstBundleImportWorkspace(context);
    assert.equal(workspace.status, 'ready');
    assert.equal(workspace.ready, true);
    assert.equal(workspace.candidates.length, 1);
    return workspace.candidates[0];
}

test('durable DST execution locator revalidates bundle image bytes and regenerates a session candidate token', (t) => {
    const fx = fixture(t);
    const imagePath = path.join(fx.bundle.bundleRoot, 'images', fx.bundle.imageName);
    const imageSha = crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex');
    const locator = `dst:${fx.bundle.manifest.id}:1:${imageSha}`;
    const first = provider.resolveDstExecutionResultLocator(locator, fx.context);
    const relaunched = provider.resolveDstExecutionResultLocator(locator, {
        ...fx.context,
        tokenSecret: Buffer.alloc(32, 8),
    });
    assert.ok(first?.candidate_token);
    assert.equal(first.image_index, 1);
    assert.ok(relaunched?.candidate_token);
    assert.notEqual(first.candidate_token, relaunched.candidate_token);
    assert.equal(provider.resolveDstExecutionResultLocator(`dst:${fx.bundle.manifest.id}:1:${'f'.repeat(64)}`, fx.context), null);
});

function configureRetryTargets(fx, specs) {
    const records = specs.map((spec) => ({
        media_id: spec.mediaId,
        kind: spec.kind,
        target_id: spec.targetId,
        provider: spec.provider || 'dst',
        operation_id: `old_${spec.mediaId}`,
        attempt: 1,
        reference_ids: [],
        relative_path: `media/${spec.mediaId}.png`,
        generation_status: 'downloaded',
        prompt: `Retry ${spec.mediaId}`,
        aspect_ratio: '9:16',
        review_status: 'retry_requested',
        retry_of: '',
    }));
    fs.writeFileSync(
        path.join(fx.productionRoot, 'media_attempts.jsonl'),
        records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    );
    fs.writeFileSync(path.join(fx.productionRoot, 'reviews', 'media_review_draft.json'), `${JSON.stringify({
        schema: 'film_pipeline.media_review_draft.v1',
        execution: 'not_run',
        reviews: records.map((record) => ({
            media_id: record.media_id,
            review_status: 'retry_requested',
            review_note: '',
            selected_for_retry: true,
        })),
        retry_queue: records.map((record, index) => ({
            sequence: index + 1,
            media_id: record.media_id,
            kind: record.kind,
            target_id: record.target_id,
            provider: record.provider,
            attempt: record.attempt,
            retry_of: record.media_id,
            review_note: '',
            execution_status: 'draft_not_executed',
        })),
    })}\n`);
    return records;
}

function writeStoryboard(fx, clips) {
    const directory = path.join(fx.productionRoot, 'storyboard');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'storyboard.json'), `${JSON.stringify({ clips })}\n`);
}

function removeRetrySources(fx) {
    fs.rmSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), { force: true });
    fs.rmSync(path.join(fx.productionRoot, 'reviews', 'media_review_draft.json'), { force: true });
}

function targetsOfKind(workspace, kind) {
    return workspace.initial_targets.filter((target) => target.kind === kind);
}

test('real local workspace returns only opaque bounded completed single-image bundle evidence', (t) => {
    const fx = fixture(t);
    writeBundle(fx.dstRoot, {
        bundleName: '20260715_1100_invalid_profile_abcdef1234',
        id: 'invalid_profile_abcdef1234',
        manifest: { profile: 'another-profile' },
    });

    const workspace = provider.getDstBundleImportWorkspace(fx.context);
    assert.equal(workspace.schema_version, provider.WORKSPACE_SCHEMA);
    assert.equal(workspace.candidates.length, 1);
    assert.equal(workspace.rejected_count, 1);
    const candidate = workspace.candidates[0];
    assert.match(candidate.candidate_token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(candidate.mime_type, 'image/png');
    assert.equal(candidate.preview, undefined, 'workspace inventory must not carry image bodies');
    assert.equal(candidate.prompt_excerpt, 'Cinematic scene retry prompt');
    assert.equal(candidate.sha256, undefined);
    assert.equal(candidate.image_name, undefined);
    const serialized = JSON.stringify(workspace);
    assert.equal(serialized.includes(fx.base), false);
    assert.equal(serialized.includes(fx.dstRoot), false);
    assert.equal(serialized.includes(PNG.toString('base64')), false);
    assert.equal(workspace.executed, false);
    assert.equal(workspace.generation_executed, false);

    const envWorkspace = provider.getDstBundleImportWorkspace({
        ...fx.context,
        dstImagesRoot: undefined,
        env: { OPEN_GENERATIVE_AI_DST_IMAGES_ROOT: fx.dstRoot },
    });
    assert.equal(envWorkspace.candidates.length, 1, 'Electron main may select an isolated DST inventory root');

    const preview = provider.getDstBundleImportPreview({ candidateToken: candidate.candidate_token }, fx.context);
    assert.deepEqual(Object.keys(preview).sort(), [
        'blockers', 'candidate_token', 'executed', 'generation_executed', 'image_index', 'preview', 'ready', 'status',
    ]);
    assert.equal(preview.status, 'ready');
    assert.equal(preview.candidate_token, candidate.candidate_token);
    assert.equal(preview.image_index, 1);
    assert.deepEqual(Buffer.from(preview.preview.base64, 'base64'), PNG);
    assert.equal(preview.preview.byte_length, PNG.length);
    assert.equal(preview.executed, false);
    assert.equal(preview.generation_executed, false);

    const forged = provider.getDstBundleImportPreview({
        candidateToken: candidate.candidate_token,
        sourcePath: fx.bundle.bundleRoot,
    }, fx.context);
    assert.deepEqual(forged.blockers, ['DST_IMPORT_PREVIEW_REQUEST_INVALID']);
});

test('workspace accepts bundles from the current kjessie003 profile', (t) => {
    const fx = fixture(t);
    fs.rmSync(fx.bundle.bundleRoot, { recursive: true, force: true });
    writeBundle(fx.dstRoot, {
        manifest: { profile: 'kjessie003' },
        metadata: { profile: 'kjessie003' },
    });

    const workspace = provider.getDstBundleImportWorkspace(fx.context);
    assert.equal(workspace.candidates.length, 1);
    assert.equal(workspace.rejected_count, 0);
});

test('workspace hard-caps newest valid inventory candidates at twelve', (t) => {
    const fx = fixture(t);
    for (let index = 0; index < 13; index += 1) {
        writeBundle(fx.dstRoot, {
            bundleName: `20260715_${String(1300 + index)}_candidate_${String(index).padStart(2, '0')}_abcdef1234`,
            id: `candidate_${String(index).padStart(2, '0')}_abcdef1234`,
        });
    }
    const workspace = provider.getDstBundleImportWorkspace({ ...fx.context, maxCandidates: 99 });
    assert.equal(workspace.candidates.length, 12);
});

test('completed multi-image bundle is one representative candidate and imports the whole set atomically', (t) => {
    const fx = fixture(t);
    const images = [
        { name: 'image_01.png', buffer: pngFixture('multi-one') },
        { name: 'image_02.png', buffer: pngFixture('multi-two') },
        { name: 'image_03.png', buffer: pngFixture('multi-three') },
    ];
    writeBundle(fx.dstRoot, { images });

    const workspace = provider.getDstBundleImportWorkspace(fx.context);
    assert.equal(workspace.candidates.length, 1);
    const candidate = workspace.candidates[0];
    assert.equal(candidate.image_count, 3);
    assert.equal(candidate.size_bytes, images[0].buffer.length, 'singular size remains the representative image size');
    assert.equal(candidate.total_size_bytes, images.reduce((total, image) => total + image.buffer.length, 0));
    assert.equal(candidate.image_name, undefined);
    assert.equal(candidate.sha256, undefined);
    assert.equal(JSON.stringify(candidate).includes(fx.dstRoot), false);

    const preview = provider.getDstBundleImportPreview({ candidateToken: candidate.candidate_token }, fx.context);
    assert.deepEqual(Buffer.from(preview.preview.base64, 'base64'), images[0].buffer);
    assert.equal(preview.image_index, 1);
    for (let imageIndex = 1; imageIndex <= images.length; imageIndex += 1) {
        const indexed = provider.getDstBundleImportPreview({
            candidateToken: candidate.candidate_token,
            imageIndex,
        }, fx.context);
        assert.equal(indexed.status, 'ready');
        assert.equal(indexed.image_index, imageIndex);
        assert.deepEqual(Buffer.from(indexed.preview.base64, 'base64'), images[imageIndex - 1].buffer);
    }
    for (const imageIndex of [0, 4, 1.5, '2']) {
        const blocked = provider.getDstBundleImportPreview({
            candidateToken: candidate.candidate_token,
            imageIndex,
        }, fx.context);
        assert.deepEqual(blocked.blockers, ['DST_IMPORT_PREVIEW_IMAGE_INDEX_INVALID']);
        assert.equal(blocked.preview, null);
    }
    const extraPreviewField = provider.getDstBundleImportPreview({
        candidateToken: candidate.candidate_token,
        imageIndex: 2,
        sourcePath: fx.dstRoot,
    }, fx.context);
    assert.deepEqual(extraPreviewField.blockers, ['DST_IMPORT_PREVIEW_REQUEST_INVALID']);

    const plan = provider.planDstBundleImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);
    assert.equal(plan.ready, true, JSON.stringify(plan));
    assert.equal(plan.image_count, 3);
    assert.equal(plan.new_image_count, 3);
    assert.equal(plan.already_current_count, 0);
    assert.equal(plan.total_size_bytes, candidate.total_size_bytes);
    assert.equal(plan.source_image_name, 'image_01.png', 'singular fields describe the representative image');

    const result = provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, fx.context);
    assert.deepEqual({
        imported: result.imported,
        importedCount: result.imported_count,
        copied: result.copied,
        copyCount: result.copy_count,
        ledger: result.ledger_appended,
        ledgerCount: result.ledger_appended_count,
    }, {
        imported: true,
        importedCount: 3,
        copied: true,
        copyCount: 3,
        ledger: true,
        ledgerCount: 3,
    });
    const records = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.slice(1).map((record) => record.attempt), [2, 3, 4]);
    assert.deepEqual(records.slice(1).map((record) => record.source_image_name), images.map((image) => image.name));
    assert.equal(new Set(records.slice(1).map((record) => record.media_id)).size, 3);
    for (let index = 0; index < images.length; index += 1) {
        const target = path.join(fx.productionRoot, ...records[index + 1].relative_path.split('/'));
        assert.deepEqual(fs.readFileSync(target), images[index].buffer);
    }

    const again = provider.planDstBundleImport({
        candidateToken: selectedCandidate(fx.context).candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);
    assert.equal(again.status, 'already_current');
    assert.equal(again.image_count, 3);
    assert.equal(again.new_image_count, 0);
    assert.equal(again.already_current_count, 3);
    const noOp = provider.confirmDstBundleImport({ planToken: again.plan_token, confirmed: true }, fx.context);
    assert.deepEqual({
        imported: noOp.imported,
        importedCount: noOp.imported_count,
        copyCount: noOp.copy_count,
        ledgerCount: noOp.ledger_appended_count,
    }, { imported: false, importedCount: 0, copyCount: 0, ledgerCount: 0 });
});

test('multi-image bundles reject the whole set on count, sequence, extra-entry, type, or symlink failures', (t) => {
    const cases = [
        {
            name: 'count mismatch',
            setup(fx) { writeBundle(fx.dstRoot, { metadata: { image_count: 2 } }); },
        },
        {
            name: 'sequence gap',
            setup(fx) {
                writeBundle(fx.dstRoot, { images: [
                    { name: 'image_01.png', buffer: pngFixture('one') },
                    { name: 'image_03.png', buffer: pngFixture('three') },
                ] });
            },
        },
        {
            name: 'extra hidden entry',
            setup(fx) { fs.writeFileSync(path.join(fx.bundle.bundleRoot, 'images', '.DS_Store'), 'extra'); },
        },
        {
            name: 'unsupported extension',
            setup(fx) { writeBundle(fx.dstRoot, { images: [{ name: 'image_01.gif', buffer: pngFixture('gif-spoof') }] }); },
        },
        {
            name: 'secondary symlink',
            setup(fx) {
                const outside = path.join(fx.base, 'outside.png');
                fs.writeFileSync(outside, pngFixture('outside'));
                writeBundle(fx.dstRoot, { images: [
                    { name: 'image_01.png', buffer: pngFixture('one') },
                    { name: 'image_02.png', buffer: pngFixture('placeholder') },
                ] });
                const linked = path.join(fx.bundle.bundleRoot, 'images', 'image_02.png');
                fs.unlinkSync(linked);
                fs.symlinkSync(outside, linked);
            },
        },
    ];
    for (const item of cases) {
        const fx = fixture(t);
        item.setup(fx);
        const workspace = provider.getDstBundleImportWorkspace(fx.context);
        assert.equal(workspace.candidates.length, 0, item.name);
        assert.equal(workspace.rejected_count, 1, item.name);
    }
});

test('multi-image identity includes the canonical image name while single-image media ids remain compatible', (t) => {
    const fx = fixture(t);
    const duplicate = pngFixture('same-pixels');
    writeBundle(fx.dstRoot, { images: [
        { name: 'image_01.png', buffer: duplicate },
        { name: 'image_02.png', buffer: duplicate },
    ] });
    const candidate = selectedCandidate(fx.context);
    const plan = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    const result = provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, fx.context);
    assert.equal(result.imported_count, 2);
    assert.equal(result.copy_count, 1, 'content-addressed storage writes duplicate pixels once');
    assert.equal(result.ledger_appended_count, 2);
    const records = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(new Set(records.slice(1).map((record) => record.media_id)).size, 2);
    assert.deepEqual(records.slice(1).map((record) => record.source_image_name), ['image_01.png', 'image_02.png']);
});

test('multi-image ledger publication is one atomic rename and repairs after copy-only partial failure', (t) => {
    const fx = fixture(t);
    writeBundle(fx.dstRoot, { images: [
        { name: 'image_01.png', buffer: pngFixture('atomic-one') },
        { name: 'image_02.png', buffer: pngFixture('atomic-two') },
        { name: 'image_03.png', buffer: pngFixture('atomic-three') },
    ] });
    const candidate = selectedCandidate(fx.context);
    const plan = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    let renameCount = 0;
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, {
            ...fx.context,
            ledgerRenameFile() {
                renameCount += 1;
                throw Object.assign(new Error('injected ledger rename failure'), { code: 'EIO' });
            },
        }),
        { code: 'EIO' },
    );
    assert.equal(renameCount, 1);
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 1);
    assert.equal(fs.readdirSync(path.join(fx.productionRoot, 'media', 'imports', 'dst')).length, 3);

    const repair = provider.planDstBundleImport({
        candidateToken: selectedCandidate(fx.context).candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);
    const repaired = provider.confirmDstBundleImport({ planToken: repair.plan_token, confirmed: true }, fx.context);
    assert.deepEqual({
        imported: repaired.imported_count,
        copied: repaired.copy_count,
        ledger: repaired.ledger_appended_count,
    }, { imported: 3, copied: 0, ledger: 3 });
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 4);
});

test('first import uses storyboard-authoritative character targets without ledger or review and is atomic and idempotent', (t) => {
    const fx = fixture(t);
    removeRetrySources(fx);
    writeStoryboard(fx, [{
        clip_id: 'clip_001',
        characters: ['김지아', 'hero_side'],
        location: '서울 골목',
    }]);
    writeBundle(fx.dstRoot, { images: [
        { name: 'image_01.png', buffer: pngFixture('initial-character-one') },
        { name: 'image_02.png', buffer: pngFixture('initial-character-two') },
    ] });

    const workspace = provider.getDstBundleImportWorkspace(fx.context);
    const characters = targetsOfKind(workspace, 'character_sheet');
    assert.deepEqual(characters.map((target) => target.target_label), ['김지아', 'hero_side']);
    assert.match(characters[0].target_id, /^character_sheet_[a-f0-9]{20}$/);
    assert.equal(characters[1].target_id, 'hero_side');
    assert.deepEqual(workspace.initial_targets.map((target) => target.sequence), [1, 2, 1, 1]);
    assert.ok(workspace.initial_targets.every((target) => /^[A-Za-z0-9_-]{43}$/.test(target.target_token)));
    const candidate = workspace.candidates[0];
    const initialMappings = characters.map((target, index) => ({
        imageIndex: index + 1,
        targetToken: target.target_token,
    }));
    const plan = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, initialMappings }, fx.context);
    assert.equal(plan.status, 'ready', JSON.stringify(plan));
    assert.equal(plan.mapping_mode, 'initial_targets');
    assert.equal(plan.kind, 'character_sheet');
    assert.equal(plan.target_label, '김지아');

    let renameCount = 0;
    const result = provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, {
        ...fx.context,
        ledgerRenameFile(from, to) {
            renameCount += 1;
            fs.renameSync(from, to);
        },
    });
    assert.equal(renameCount, 1);
    assert.deepEqual({ imported: result.imported_count, copied: result.copy_count, ledger: result.ledger_appended_count }, {
        imported: 2, copied: 2, ledger: 2,
    });
    assert.equal(fs.existsSync(path.join(fx.productionRoot, 'reviews', 'media_review_draft.json')), false);
    const records = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map((record) => ({
        kind: record.kind,
        target: record.target_id,
        label: record.target_label,
        attempt: record.attempt,
        retryOf: record.retry_of,
        provider: record.provider,
        review: record.review_status,
    })), [{
        kind: 'character_sheet', target: characters[0].target_id, label: '김지아', attempt: 1,
        retryOf: '', provider: 'dst', review: 'unreviewed',
    }, {
        kind: 'character_sheet', target: 'hero_side', label: 'hero_side', attempt: 1,
        retryOf: '', provider: 'dst', review: 'unreviewed',
    }]);
    const refreshedWorkspace = provider.getDstBundleImportWorkspace(fx.context);
    assert.equal(targetsOfKind(refreshedWorkspace, 'character_sheet').length, 0, 'claimed initial targets stay hidden');
    assert.deepEqual(refreshedWorkspace.initial_targets.map((target) => target.kind), ['location_sheet', 'scene_image']);

    const replay = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, initialMappings }, fx.context);
    assert.equal(replay.status, 'already_current', JSON.stringify(replay));
    const replayed = provider.confirmDstBundleImport({ planToken: replay.plan_token, confirmed: true }, fx.context);
    assert.equal(replayed.already_current, true);
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('first import supports location and scene targets in storyboard first-appearance order', (t) => {
    const fx = fixture(t);
    removeRetrySources(fx);
    writeStoryboard(fx, [{
        clip_id: 'clip_001', characters: [], location: '학교 상담실',
    }, {
        clip_id: 'clip_002', characters: [], location: 'rain_car',
    }, {
        clip_id: 'requires_scene', characters: [], location: 'Unresolved from structural evidence', structural_only: true,
    }]);
    writeBundle(fx.dstRoot, { images: [
        { name: 'image_01.png', buffer: pngFixture('initial-place-one') },
        { name: 'image_02.png', buffer: pngFixture('initial-place-two') },
    ] });
    const workspace = provider.getDstBundleImportWorkspace(fx.context);
    const locations = targetsOfKind(workspace, 'location_sheet');
    const scenes = targetsOfKind(workspace, 'scene_image');
    assert.deepEqual(locations.map((target) => target.target_label), ['학교 상담실', 'rain_car']);
    assert.match(locations[0].target_id, /^location_sheet_[a-f0-9]{20}$/);
    assert.equal(locations[1].target_id, 'rain_car');
    assert.deepEqual(scenes.map((target) => target.target_id), ['clip_001', 'clip_002']);
    assert.deepEqual(workspace.initial_targets.map((target) => target.kind), [
        'location_sheet', 'scene_image', 'location_sheet', 'scene_image',
    ]);
    const candidate = workspace.candidates[0];
    const map = (targets) => targets.map((target, index) => ({ imageIndex: index + 1, targetToken: target.target_token }));
    const locationPlan = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, initialMappings: map(locations) }, fx.context);
    assert.equal(locationPlan.ready, true, JSON.stringify(locationPlan));
    provider.confirmDstBundleImport({ planToken: locationPlan.plan_token, confirmed: true }, fx.context);
    const scenePlan = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, initialMappings: map(scenes) }, fx.context);
    assert.equal(scenePlan.ready, true, JSON.stringify(scenePlan));
    provider.confirmDstBundleImport({ planToken: scenePlan.plan_token, confirmed: true }, fx.context);
    const records = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map((record) => record.kind), [
        'location_sheet', 'location_sheet', 'scene_image', 'scene_image',
    ]);
    assert.ok(records.every((record) => record.attempt === 1 && record.retry_of === ''));
});

test('first import rejects malformed, duplicate, mixed-kind, wrong-count, unordered, and unknown target mappings', (t) => {
    const fx = fixture(t);
    removeRetrySources(fx);
    writeStoryboard(fx, [{ clip_id: 'clip_001', characters: ['hero', 'friend'], location: 'office' }]);
    writeBundle(fx.dstRoot, { images: [
        { name: 'image_01.png', buffer: pngFixture('initial-invalid-one') },
        { name: 'image_02.png', buffer: pngFixture('initial-invalid-two') },
    ] });
    const workspace = provider.getDstBundleImportWorkspace(fx.context);
    const candidateToken = workspace.candidates[0].candidate_token;
    const characters = targetsOfKind(workspace, 'character_sheet');
    const location = targetsOfKind(workspace, 'location_sheet')[0];
    const valid = characters.map((target, index) => ({ imageIndex: index + 1, targetToken: target.target_token }));
    const cases = [{
        name: 'count', mappings: valid.slice(0, 1), blocker: 'DST_IMPORT_INITIAL_MAPPING_COUNT_INVALID',
    }, {
        name: 'sequence', mappings: [valid[1], valid[0]], blocker: 'DST_IMPORT_INITIAL_MAPPING_SEQUENCE_INVALID',
    }, {
        name: 'duplicate', mappings: [valid[0], { imageIndex: 2, targetToken: valid[0].targetToken }], blocker: 'DST_IMPORT_INITIAL_TARGET_DUPLICATE',
    }, {
        name: 'mixed kind', mappings: [valid[0], { imageIndex: 2, targetToken: location.target_token }], blocker: 'DST_IMPORT_INITIAL_TARGET_KIND_MISMATCH',
    }, {
        name: 'unknown', mappings: [valid[0], { imageIndex: 2, targetToken: 'A'.repeat(43) }], blocker: 'DST_IMPORT_INITIAL_TARGET_UNKNOWN',
    }, {
        name: 'mapping extra key', mappings: [{ ...valid[0], targetId: 'forged' }, valid[1]], blocker: 'DST_IMPORT_INITIAL_MAPPING_INVALID',
    }];
    for (const item of cases) {
        const plan = provider.planDstBundleImport({ candidateToken, initialMappings: item.mappings }, fx.context);
        assert.deepEqual(plan.blockers, [item.blocker], item.name);
    }
    const forged = provider.planDstBundleImport({ candidateToken, initialMappings: valid, targetPath: '/tmp/forged.png' }, fx.context);
    assert.deepEqual(forged.blockers, ['DST_IMPORT_PLAN_REQUEST_INVALID']);
    assert.equal(fs.existsSync(path.join(fx.productionRoot, 'media_attempts.jsonl')), false);
});

test('first import blocks an existing target and fails closed on storyboard or ledger drift', (t) => {
    const existing = fixture(t);
    fs.rmSync(path.join(existing.productionRoot, 'reviews', 'media_review_draft.json'), { force: true });
    writeStoryboard(existing, [{ clip_id: 'clip_001', characters: ['hero'], location: '' }]);
    const existingWorkspace = provider.getDstBundleImportWorkspace(existing.context);
    const existingTargetToken = targetsOfKind(existingWorkspace, 'character_sheet')[0].target_token;
    fs.writeFileSync(path.join(existing.productionRoot, 'media_attempts.jsonl'), `${JSON.stringify({
        media_id: 'old_hero', kind: 'character_sheet', target_id: 'hero', provider: 'dst', attempt: 1,
    })}\n`);
    const existingPlan = provider.planDstBundleImport({
        candidateToken: existingWorkspace.candidates[0].candidate_token,
        initialMappings: [{ imageIndex: 1, targetToken: existingTargetToken }],
    }, existing.context);
    assert.deepEqual(existingPlan.blockers, ['DST_IMPORT_INITIAL_TARGET_EXISTS']);

    const storyboardDrift = fixture(t);
    removeRetrySources(storyboardDrift);
    writeStoryboard(storyboardDrift, [{ clip_id: 'clip_001', characters: ['hero'], location: '' }]);
    const storyboardWorkspace = provider.getDstBundleImportWorkspace(storyboardDrift.context);
    const storyboardPlan = provider.planDstBundleImport({
        candidateToken: storyboardWorkspace.candidates[0].candidate_token,
        initialMappings: [{ imageIndex: 1, targetToken: targetsOfKind(storyboardWorkspace, 'character_sheet')[0].target_token }],
    }, storyboardDrift.context);
    assert.equal(storyboardPlan.ready, true);
    writeStoryboard(storyboardDrift, [{ clip_id: 'clip_001', characters: ['changed_hero'], location: '' }]);
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: storyboardPlan.plan_token, confirmed: true }, storyboardDrift.context),
        { code: 'DST_IMPORT_INITIAL_TARGET_UNKNOWN' },
    );
    assert.equal(fs.existsSync(path.join(storyboardDrift.productionRoot, 'media_attempts.jsonl')), false);

    const ledgerDrift = fixture(t);
    removeRetrySources(ledgerDrift);
    writeStoryboard(ledgerDrift, [{ clip_id: 'clip_001', characters: ['hero'], location: '' }]);
    const ledgerWorkspace = provider.getDstBundleImportWorkspace(ledgerDrift.context);
    const ledgerPlan = provider.planDstBundleImport({
        candidateToken: ledgerWorkspace.candidates[0].candidate_token,
        initialMappings: [{ imageIndex: 1, targetToken: targetsOfKind(ledgerWorkspace, 'character_sheet')[0].target_token }],
    }, ledgerDrift.context);
    assert.equal(ledgerPlan.ready, true);
    fs.writeFileSync(path.join(ledgerDrift.productionRoot, 'media_attempts.jsonl'), `${JSON.stringify({
        media_id: 'unrelated', kind: 'scene_image', target_id: 'clip_other', provider: 'dst', attempt: 1,
    })}\n`);
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: ledgerPlan.plan_token, confirmed: true }, ledgerDrift.context),
        { code: 'DST_IMPORT_PLAN_STALE' },
    );
    assert.equal(fs.existsSync(path.join(ledgerDrift.productionRoot, 'media', 'imports', 'dst')), false);
});

test('explicit sheet mapping imports each image into its own saved DST retry item with one ledger rename', (t) => {
    const fx = fixture(t);
    const images = [
        { name: 'image_01.png', buffer: pngFixture('character-one') },
        { name: 'image_02.png', buffer: pngFixture('character-two') },
        { name: 'image_03.png', buffer: pngFixture('character-three') },
    ];
    writeBundle(fx.dstRoot, { images });
    const sources = configureRetryTargets(fx, [
        { mediaId: 'character_retry_1', kind: 'character_sheet', targetId: 'character_1' },
        { mediaId: 'character_retry_2', kind: 'character_sheet', targetId: 'character_2' },
        { mediaId: 'character_retry_3', kind: 'character_sheet', targetId: 'character_3' },
    ]);
    const candidate = selectedCandidate(fx.context);
    const mappings = sources.map((source, index) => ({ imageIndex: index + 1, retryMediaId: source.media_id }));
    const plan = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, mappings }, fx.context);
    assert.equal(plan.status, 'ready', JSON.stringify(plan));
    assert.equal(plan.mapping_mode, 'explicit_retry_items');
    assert.equal(plan.retry_media_id, 'character_retry_1');
    assert.equal(plan.target_id, 'character_1');
    assert.equal(plan.image_count, 3);
    assert.equal(plan.new_image_count, 3);
    assert.equal(JSON.stringify(plan).includes(fx.productionRoot), false);

    let renameCount = 0;
    const result = provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, {
        ...fx.context,
        ledgerRenameFile(from, to) {
            renameCount += 1;
            fs.renameSync(from, to);
        },
    });
    assert.equal(renameCount, 1);
    assert.deepEqual({
        imported: result.imported_count,
        copied: result.copy_count,
        ledger: result.ledger_appended_count,
    }, { imported: 3, copied: 3, ledger: 3 });
    const records = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const imported = records.slice(3);
    assert.deepEqual(imported.map((record) => record.retry_of), sources.map((source) => source.media_id));
    assert.deepEqual(imported.map((record) => record.target_id), sources.map((source) => source.target_id));
    assert.deepEqual(imported.map((record) => record.kind), ['character_sheet', 'character_sheet', 'character_sheet']);
    assert.deepEqual(imported.map((record) => record.attempt), [2, 2, 2]);
    assert.deepEqual(imported.map((record) => record.source_image_name), images.map((image) => image.name));
});

test('explicit sheet mapping rejects missing, unordered, duplicate, unknown, mixed-kind, non-DST, and forged mappings', (t) => {
    const make = (specs) => {
        const fx = fixture(t);
        writeBundle(fx.dstRoot, { images: [
            { name: 'image_01.png', buffer: pngFixture('mapped-one') },
            { name: 'image_02.png', buffer: pngFixture('mapped-two') },
            { name: 'image_03.png', buffer: pngFixture('mapped-three') },
        ] });
        const sources = configureRetryTargets(fx, specs || [
            { mediaId: 'sheet_retry_1', kind: 'location_sheet', targetId: 'location_1' },
            { mediaId: 'sheet_retry_2', kind: 'location_sheet', targetId: 'location_2' },
            { mediaId: 'sheet_retry_3', kind: 'location_sheet', targetId: 'location_3' },
        ]);
        return { fx, sources, candidate: selectedCandidate(fx.context) };
    };
    const validMappings = (sources) => sources.map((source, index) => ({ imageIndex: index + 1, retryMediaId: source.media_id }));

    const cases = [
        {
            name: 'missing mapping',
            setup: () => make(),
            payload: ({ sources }) => ({ mappings: validMappings(sources).slice(0, 2) }),
        },
        {
            name: 'unordered image sequence',
            setup: () => make(),
            payload: ({ sources }) => ({ mappings: [
                { imageIndex: 2, retryMediaId: sources[0].media_id },
                { imageIndex: 1, retryMediaId: sources[1].media_id },
                { imageIndex: 3, retryMediaId: sources[2].media_id },
            ] }),
        },
        {
            name: 'duplicate retry item',
            setup: () => make(),
            payload: ({ sources }) => ({ mappings: [
                { imageIndex: 1, retryMediaId: sources[0].media_id },
                { imageIndex: 2, retryMediaId: sources[0].media_id },
                { imageIndex: 3, retryMediaId: sources[2].media_id },
            ] }),
        },
        {
            name: 'unknown retry item',
            setup: () => make(),
            payload: ({ sources }) => ({ mappings: [
                ...validMappings(sources).slice(0, 2),
                { imageIndex: 3, retryMediaId: 'unknown_retry_item' },
            ] }),
        },
        {
            name: 'mixed sheet kinds',
            setup: () => make([
                { mediaId: 'sheet_retry_1', kind: 'character_sheet', targetId: 'character_1' },
                { mediaId: 'sheet_retry_2', kind: 'character_sheet', targetId: 'character_2' },
                { mediaId: 'sheet_retry_3', kind: 'location_sheet', targetId: 'location_3' },
            ]),
            payload: ({ sources }) => ({ mappings: validMappings(sources) }),
        },
        {
            name: 'non-DST retry item',
            setup: () => make([
                { mediaId: 'sheet_retry_1', kind: 'location_sheet', targetId: 'location_1' },
                { mediaId: 'sheet_retry_2', kind: 'location_sheet', targetId: 'location_2', provider: 'flow' },
                { mediaId: 'sheet_retry_3', kind: 'location_sheet', targetId: 'location_3' },
            ]),
            payload: ({ sources }) => ({ mappings: validMappings(sources) }),
        },
        {
            name: 'extra mapping authority',
            setup: () => make(),
            payload: ({ sources }) => ({ mappings: validMappings(sources).map((mapping, index) => (
                index === 0 ? { ...mapping, targetId: 'forged_target' } : mapping
            )) }),
        },
    ];
    for (const item of cases) {
        const setup = item.setup();
        const payload = item.payload(setup);
        const plan = provider.planDstBundleImport({
            candidateToken: setup.candidate.candidate_token,
            ...payload,
        }, setup.fx.context);
        assert.equal(plan.ready, false, item.name);
        assert.equal(plan.status, 'blocked', item.name);
        assert.equal(fs.existsSync(path.join(setup.fx.productionRoot, 'media', 'imports', 'dst')), false, item.name);
        assert.equal(
            fs.readFileSync(path.join(setup.fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length,
            3,
            item.name,
        );
    }

    const forgedTopLevel = make();
    const blocked = provider.planDstBundleImport({
        candidateToken: forgedTopLevel.candidate.candidate_token,
        mappings: validMappings(forgedTopLevel.sources),
        targetPath: '/tmp/forged.png',
    }, forgedTopLevel.fx.context);
    assert.deepEqual(blocked.blockers, ['DST_IMPORT_PLAN_REQUEST_INVALID']);
});

test('explicit sheet mapping becomes stale when the saved review mapping changes before confirm', (t) => {
    const fx = fixture(t);
    writeBundle(fx.dstRoot, { images: [
        { name: 'image_01.png', buffer: pngFixture('stale-one') },
        { name: 'image_02.png', buffer: pngFixture('stale-two') },
    ] });
    const sources = configureRetryTargets(fx, [
        { mediaId: 'location_retry_1', kind: 'location_sheet', targetId: 'location_1' },
        { mediaId: 'location_retry_2', kind: 'location_sheet', targetId: 'location_2' },
    ]);
    const candidate = selectedCandidate(fx.context);
    const plan = provider.planDstBundleImport({
        candidateToken: candidate.candidate_token,
        mappings: sources.map((source, index) => ({ imageIndex: index + 1, retryMediaId: source.media_id })),
    }, fx.context);
    assert.equal(plan.ready, true, JSON.stringify(plan));
    const reviewPath = path.join(fx.productionRoot, 'reviews', 'media_review_draft.json');
    const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    review.retry_queue[1].review_note = 'changed after plan';
    fs.writeFileSync(reviewPath, `${JSON.stringify(review)}\n`);
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, fx.context),
        { code: 'DST_IMPORT_PLAN_STALE' },
    );
    assert.equal(fs.existsSync(path.join(fx.productionRoot, 'media', 'imports', 'dst')), false);
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('single-target contract allows one reference or multiple scene images but rejects multi-reference bundles', (t) => {
    const singleReference = fixture(t);
    configureRetryTargets(singleReference, [
        { mediaId: 'single_character_retry', kind: 'character_sheet', targetId: 'character_1' },
    ]);
    const singleReferenceCandidate = selectedCandidate(singleReference.context);
    const singleReferencePlan = provider.planDstBundleImport({
        candidateToken: singleReferenceCandidate.candidate_token,
        retryMediaId: 'single_character_retry',
    }, singleReference.context);
    assert.equal(singleReferencePlan.ready, true, JSON.stringify(singleReferencePlan));
    assert.equal(singleReferencePlan.mapping_mode, 'single_retry_target');
    assert.equal(singleReferencePlan.image_count, 1);

    const multiScene = fixture(t);
    writeBundle(multiScene.dstRoot, { images: [
        { name: 'image_01.png', buffer: pngFixture('scene-one') },
        { name: 'image_02.png', buffer: pngFixture('scene-two') },
    ] });
    const multiSceneCandidate = selectedCandidate(multiScene.context);
    const multiScenePlan = provider.planDstBundleImport({
        candidateToken: multiSceneCandidate.candidate_token,
        retryMediaId: multiScene.source.media_id,
    }, multiScene.context);
    assert.equal(multiScenePlan.ready, true, JSON.stringify(multiScenePlan));
    assert.equal(multiScenePlan.mapping_mode, 'single_retry_target');
    assert.equal(multiScenePlan.image_count, 2);

    const multiReference = fixture(t);
    writeBundle(multiReference.dstRoot, { images: [
        { name: 'image_01.png', buffer: pngFixture('reference-one') },
        { name: 'image_02.png', buffer: pngFixture('reference-two') },
    ] });
    configureRetryTargets(multiReference, [
        { mediaId: 'multi_location_retry', kind: 'location_sheet', targetId: 'location_1' },
    ]);
    const multiReferenceCandidate = selectedCandidate(multiReference.context);
    const blocked = provider.planDstBundleImport({
        candidateToken: multiReferenceCandidate.candidate_token,
        retryMediaId: 'multi_location_retry',
    }, multiReference.context);
    assert.equal(blocked.ready, false);
    assert.deepEqual(blocked.blockers, ['DST_IMPORT_MAPPING_REQUIRED']);
    assert.equal(fs.existsSync(path.join(multiReference.productionRoot, 'media', 'imports', 'dst')), false);
    assert.equal(
        fs.readFileSync(path.join(multiReference.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length,
        1,
    );
});

test('blocked or mismatched retry plans cannot be used as import write authority', (t) => {
    const fx = fixture(t);
    const reviewPath = path.join(fx.productionRoot, 'reviews', 'media_review_draft.json');
    const draft = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    draft.retry_queue[0].target_id = 'clip_tampered';
    fs.writeFileSync(reviewPath, `${JSON.stringify(draft)}\n`);

    const candidate = selectedCandidate(fx.context);
    const plan = provider.planDstBundleImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);
    assert.equal(plan.ready, false);
    assert.deepEqual(plan.blockers, ['DST_IMPORT_RETRY_PLAN_BLOCKED']);
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('real local plan and confirm copy content-addressed image and atomically append one unreviewed attempt', (t) => {
    const fx = fixture(t);
    const candidate = selectedCandidate(fx.context);
    const plan = provider.planDstBundleImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);

    assert.equal(plan.schema_version, provider.PLAN_SCHEMA);
    assert.equal(plan.status, 'ready');
    assert.equal(plan.ready, true, JSON.stringify(plan));
    assert.equal(plan.executed, false);
    assert.equal(plan.preview, null, 'plan response must not duplicate the selected image body');
    assert.match(plan.plan_token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(plan.target_relative_path, /^media\/imports\/dst\/[a-f0-9]{64}\.png$/);
    assert.equal(JSON.stringify(plan).includes(fx.base), false);

    const result = provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, fx.context);
    assert.deepEqual(
        { imported: result.imported, executed: result.executed, copied: result.copied, ledger: result.ledger_appended },
        { imported: true, executed: true, copied: true, ledger: true },
    );
    const target = path.join(fx.productionRoot, ...result.target_relative_path.split('/'));
    assert.deepEqual(fs.readFileSync(target), PNG);
    assert.equal(fs.lstatSync(target).mode & 0o777, 0o600);
    const lines = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.deepEqual({
        provider: lines[1].provider,
        target: lines[1].target_id,
        attempt: lines[1].attempt,
        retry: lines[1].retry_of,
        review: lines[1].review_status,
        path: lines[1].relative_path,
        hash: lines[1].source_image_sha256,
    }, {
        provider: 'dst',
        target: 'clip_002',
        attempt: 2,
        retry: fx.source.media_id,
        review: 'unreviewed',
        path: result.target_relative_path,
        hash: result.sha256,
    });
    const raw = readProductionFolder(fx.productionRoot);
    assert.equal(raw.parsed.mediaAttempts.parsed, true);
    assert.equal(raw.parsed.mediaAttempts.records.length, 2);
    assert.equal(fs.readdirSync(fx.productionRoot).some((name) => name.startsWith('.dst-media-attempts-')), false);

    const again = provider.planDstBundleImport({
        candidateToken: selectedCandidate(fx.context).candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);
    assert.equal(again.status, 'already_current');
    assert.equal(again.already_current, true);
    const noOp = provider.confirmDstBundleImport({ planToken: again.plan_token, confirmed: true }, fx.context);
    assert.deepEqual({ imported: noOp.imported, executed: noOp.executed, copied: noOp.copied, ledger: noOp.ledger_appended }, {
        imported: false, executed: false, copied: false, ledger: false,
    });
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('forged path fields and consumed or stale one-shot plans fail closed before production writes', (t) => {
    const fx = fixture(t);
    const candidate = selectedCandidate(fx.context);
    const forged = provider.planDstBundleImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
        sourcePath: fx.bundle.bundleRoot,
    }, fx.context);
    assert.deepEqual(forged.blockers, ['DST_IMPORT_PLAN_REQUEST_INVALID']);

    const plan = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: false }, fx.context),
        { code: 'DST_IMPORT_CONFIRMATION_REQUIRED' },
    );
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, fx.context),
        { code: 'DST_IMPORT_PLAN_TOKEN_INVALID' },
    );

    let clock = 1000;
    const expiringContext = {
        ...fx.context,
        planStore: new Map(),
        planTtlMs: 10,
        nowMs: () => clock,
    };
    const expiring = provider.planDstBundleImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, expiringContext);
    clock += 11;
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: expiring.plan_token, confirmed: true }, expiringContext),
        { code: 'DST_IMPORT_PLAN_TOKEN_EXPIRED' },
    );
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: expiring.plan_token, confirmed: true }, expiringContext),
        { code: 'DST_IMPORT_PLAN_TOKEN_INVALID' },
    );

    const drift = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    fs.appendFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), `${JSON.stringify({
        media_id: 'unrelated', kind: 'scene_image', target_id: 'clip_999', provider: 'dst', attempt: 1,
        prompt: 'unrelated', reference_ids: [], aspect_ratio: '9:16',
    })}\n`);
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: drift.plan_token, confirmed: true }, fx.context),
        { code: 'DST_IMPORT_PLAN_STALE' },
    );
    assert.equal(fs.existsSync(path.join(fx.productionRoot, 'media', 'imports', 'dst')), false);
});

test('source symlinks, MIME spoofing, and source mutation are rejected without import', (t) => {
    const linked = fixture(t);
    const imagePath = path.join(linked.bundle.bundleRoot, 'images', linked.bundle.imageName);
    const outside = path.join(linked.base, 'outside.png');
    fs.writeFileSync(outside, PNG);
    fs.unlinkSync(imagePath);
    fs.symlinkSync(outside, imagePath);
    const linkedWorkspace = provider.getDstBundleImportWorkspace(linked.context);
    assert.equal(linkedWorkspace.candidates.length, 0);

    const spoofed = fixture(t);
    fs.writeFileSync(path.join(spoofed.bundle.bundleRoot, 'images', spoofed.bundle.imageName), Buffer.from('not-a-png'));
    assert.equal(provider.getDstBundleImportWorkspace(spoofed.context).candidates.length, 0);

    const changed = fixture(t);
    const candidate = selectedCandidate(changed.context);
    const plan = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, retryMediaId: changed.source.media_id }, changed.context);
    fs.appendFileSync(path.join(changed.bundle.bundleRoot, 'images', changed.bundle.imageName), Buffer.from('changed'));
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, changed.context),
        { code: 'DST_IMPORT_SOURCE_CHANGED' },
    );
    assert.equal(fs.existsSync(path.join(changed.productionRoot, 'media', 'imports', 'dst')), false);

    const replaced = fixture(t);
    const replacedCandidate = selectedCandidate(replaced.context);
    const replacedPlan = provider.planDstBundleImport({
        candidateToken: replacedCandidate.candidate_token,
        retryMediaId: replaced.source.media_id,
    }, replaced.context);
    const manifestPath = path.join(replaced.bundle.bundleRoot, 'manifest.json');
    const sameManifest = fs.readFileSync(manifestPath);
    fs.unlinkSync(manifestPath);
    fs.writeFileSync(manifestPath, sameManifest);
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: replacedPlan.plan_token, confirmed: true }, replaced.context),
        { code: 'DST_IMPORT_PLAN_STALE' },
    );
});

test('copy-first partial failure leaves immutable content and a fresh idempotent plan repairs only the ledger', (t) => {
    const fx = fixture(t);
    const candidate = selectedCandidate(fx.context);
    const plan = provider.planDstBundleImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, {
            ...fx.context,
            ledgerRenameFile() { throw Object.assign(new Error('injected ledger rename failure'), { code: 'EIO' }); },
        }),
        { code: 'EIO' },
    );
    const target = path.join(fx.productionRoot, ...plan.target_relative_path.split('/'));
    assert.deepEqual(fs.readFileSync(target), PNG);
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 1);

    const repair = provider.planDstBundleImport({
        candidateToken: selectedCandidate(fx.context).candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);
    assert.equal(repair.status, 'ready');
    const repaired = provider.confirmDstBundleImport({ planToken: repair.plan_token, confirmed: true }, fx.context);
    assert.deepEqual({ copied: repaired.copied, ledger: repaired.ledger_appended, executed: repaired.executed }, {
        copied: false, ledger: true, executed: true,
    });
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 2);
});

function productionFingerprint(root) {
    const stats = fs.lstatSync(root);
    return crypto.createHash('sha256').update(`${fs.realpathSync.native(root)}\0${stats.dev}\0${stats.ino}`).digest('hex');
}

function writeProductionLock(root, fileName, value) {
    const directory = path.join(root, '.film-pipeline-locks');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, fileName), `${JSON.stringify(value)}\n`, { mode: 0o600 });
    return path.join(directory, fileName);
}

test('production-root cooperative ledger lock blocks live writers and recovers dead stale owners', (t) => {
    const live = fixture(t);
    const liveContext = {
        ...live.context,
        nowMs: () => 100_000,
        staleLockMs: 10,
        isProcessAliveFn: () => true,
    };
    const liveCandidate = selectedCandidate(liveContext);
    const livePlan = provider.planDstBundleImport({
        candidateToken: liveCandidate.candidate_token,
        retryMediaId: live.source.media_id,
    }, liveContext);
    let renameCalled = false;
    const liveLock = writeProductionLock(live.productionRoot, 'media-attempts.lock', {
        schema_version: 'film_pipeline.media_attempts_lock.v1',
        pid: 424242,
        created_at_ms: 0,
        production_root_fingerprint: productionFingerprint(live.productionRoot),
        token_sha256: '0'.repeat(64),
    });
    assert.throws(
        () => provider.confirmDstBundleImport({ planToken: livePlan.plan_token, confirmed: true }, {
            ...liveContext,
            ledgerRenameFile() { renameCalled = true; },
        }),
        { code: 'DST_IMPORT_LOCKED' },
    );
    assert.equal(renameCalled, false, 'a cooperating live writer blocks before the ledger CAS boundary');
    assert.equal(fs.existsSync(liveLock), true);
    assert.equal(fs.readFileSync(path.join(live.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 1);

    const stale = fixture(t);
    const staleContext = {
        ...stale.context,
        nowMs: () => 100_000,
        staleLockMs: 10,
        isProcessAliveFn: () => false,
    };
    const staleCandidate = selectedCandidate(staleContext);
    const stalePlan = provider.planDstBundleImport({
        candidateToken: staleCandidate.candidate_token,
        retryMediaId: stale.source.media_id,
    }, staleContext);
    const staleLock = writeProductionLock(stale.productionRoot, 'media-attempts.lock', {
        schema_version: 'film_pipeline.media_attempts_lock.v1',
        pid: 424243,
        created_at_ms: 0,
        production_root_fingerprint: productionFingerprint(stale.productionRoot),
        token_sha256: '1'.repeat(64),
    });
    const recovered = provider.confirmDstBundleImport({ planToken: stalePlan.plan_token, confirmed: true }, staleContext);
    assert.equal(recovered.imported, true);
    assert.equal(fs.existsSync(staleLock), false);
    assert.equal(fs.readFileSync(path.join(stale.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('dead stale recovery claim is itself recoverable without weakening live-owner fail-closed behavior', (t) => {
    const fx = fixture(t);
    const context = {
        ...fx.context,
        nowMs: () => 100_000,
        staleLockMs: 10,
        isProcessAliveFn: () => false,
    };
    const candidate = selectedCandidate(context);
    const plan = provider.planDstBundleImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, context);
    const recoveryPath = writeProductionLock(fx.productionRoot, 'media-attempts.recovery.lock', {
        schema_version: 'film_pipeline.media_attempts_lock_recovery.v1',
        pid: 424244,
        created_at_ms: 0,
        production_root_fingerprint: productionFingerprint(fx.productionRoot),
    });
    const result = provider.confirmDstBundleImport({ planToken: plan.plan_token, confirmed: true }, context);
    assert.equal(result.imported, true);
    assert.equal(fs.existsSync(recoveryPath), false);
});

test('MOCK Electron IPC keeps DST discovery pathless and completes the main-owned import', (t) => {
    const fx = fixture(t);
    const handlers = new Map();
    filmProvider.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
        ...fx.context,
        readConfigFn: () => ({ productionRoot: fx.productionRoot, pathProvenanceVersion: 1 }),
    });

    const workspace = handlers.get('film-pipeline:get-dst-bundle-import-workspace')({}, undefined);
    assert.equal(workspace.ready, true);
    assert.throws(
        () => handlers.get('film-pipeline:get-dst-bundle-import-workspace')({}, fx.dstRoot),
        { code: 'RENDERER_PATH_ARGUMENT_FORBIDDEN' },
    );
    const plan = handlers.get('film-pipeline:plan-dst-bundle-import')({}, {
        candidateToken: workspace.candidates[0].candidate_token,
        retryMediaId: fx.source.media_id,
    });
    assert.equal(plan.ready, true, JSON.stringify(plan));
    const result = handlers.get('film-pipeline:confirm-dst-bundle-import')({}, {
        planToken: plan.plan_token,
        confirmed: true,
    });
    assert.equal(result.imported, true);
    assert.equal(result.generation_executed, false);
    assert.equal(readProductionFolder(fx.productionRoot).parsed.mediaAttempts.records.length, 2);
});
