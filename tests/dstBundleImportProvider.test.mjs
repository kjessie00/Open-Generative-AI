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

function writeBundle(dstRoot, overrides = {}) {
    const bundleName = overrides.bundleName || '20260715_1200_fixture_bundle_abcdef1234';
    const bundleRoot = path.join(dstRoot, bundleName);
    const imageName = overrides.imageName || 'image_01.png';
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
        image_count: 1,
        query: manifest.query,
        ...overrides.metadata,
    };
    fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(bundleRoot, 'metadata.json'), JSON.stringify(metadata));
    fs.writeFileSync(path.join(bundleRoot, 'images', imageName), overrides.image || PNG);
    return { bundleRoot, imageName, manifest, metadata };
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

    const preview = provider.getDstBundleImportPreview({ candidateToken: candidate.candidate_token }, fx.context);
    assert.deepEqual(Object.keys(preview).sort(), [
        'blockers', 'candidate_token', 'executed', 'generation_executed', 'preview', 'ready', 'status',
    ]);
    assert.equal(preview.status, 'ready');
    assert.equal(preview.candidate_token, candidate.candidate_token);
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
