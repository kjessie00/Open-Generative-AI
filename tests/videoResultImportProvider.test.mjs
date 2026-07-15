import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const provider = require('../electron/lib/videoResultImportProvider.js');

const MP4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from('isomiso2', 'ascii'),
    Buffer.alloc(4096, 0x5a),
]);

function mockFfprobe(options = {}) {
    const calls = [];
    const runProcessFn = (command, args, spawnOptions) => {
        calls.push({ command, args, options: spawnOptions });
        const width = options.width || 1080;
        const height = options.height || 1920;
        const duration = options.duration || 6;
        return {
            status: 0,
            signal: null,
            stdout: JSON.stringify({
                format: { format_name: options.formatName || 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(duration) },
                streams: [{ codec_type: 'video', width, height }],
            }),
            stderr: '',
        };
    };
    return { calls, runProcessFn };
}

function writeFlow(flowRoot, id = 'flow_result_001', bytes = MP4) {
    const directory = path.join(flowRoot, id);
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, 'result_1.mp4');
    fs.writeFileSync(filePath, bytes);
    return filePath;
}

function writeGrok(grokRoot, id = 'grok_result_001', bytes = MP4) {
    const filePath = path.join(grokRoot, `${id}.mp4`);
    fs.writeFileSync(filePath, bytes);
    return filePath;
}

function writeRetrySources(productionRoot, options = {}) {
    const providerName = options.provider || 'flow';
    const source = {
        media_id: options.mediaId || `${providerName}_video_retry`,
        kind: 'video',
        target_id: options.targetId || 'clip_002',
        provider: providerName,
        operation_id: 'old_submit',
        attempt: options.attempt || 1,
        reference_ids: [],
        relative_path: `media/old-${providerName}.mp4`,
        generation_status: 'downloaded',
        prompt: 'Cinematic video retry prompt',
        aspect_ratio: '9:16',
        duration: 6,
        quality: '720p',
        review_status: 'retry_requested',
        retry_of: '',
    };
    fs.mkdirSync(path.join(productionRoot, 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(productionRoot, 'media_attempts.jsonl'), `${JSON.stringify(source)}\n`);
    fs.writeFileSync(path.join(productionRoot, 'reviews', 'media_review_draft.json'), `${JSON.stringify({
        schema: 'film_pipeline.media_review_draft.v1',
        execution: 'not_run',
        reviews: [{
            media_id: source.media_id,
            review_status: 'retry_requested',
            review_note: '',
            selected_for_retry: true,
        }],
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
    return source;
}

function fixture(t, options = {}) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-video-import-')));
    const flowResultsRoot = path.join(base, 'flow-results');
    const grokResultsRoot = path.join(base, 'grok-results');
    const productionRoot = path.join(base, 'production');
    fs.mkdirSync(flowResultsRoot);
    fs.mkdirSync(grokResultsRoot);
    fs.mkdirSync(productionRoot);
    fs.writeFileSync(path.join(productionRoot, 'brief.md'), '# video import fixture\n');
    const source = writeRetrySources(productionRoot, options);
    const probe = mockFfprobe(options.probe);
    const context = {
        flowResultsRoot,
        grokResultsRoot,
        config: { productionRoot },
        tokenSecret: Buffer.alloc(32, 11),
        planStore: new Map(),
        runProcessFn: probe.runProcessFn,
        now: () => '2026-07-15T09:00:00.000Z',
    };
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, flowResultsRoot, grokResultsRoot, productionRoot, source, probe, context };
}

function candidateFor(workspace, providerName) {
    const candidate = workspace.candidates.find((item) => item.provider === providerName);
    assert.ok(candidate, JSON.stringify(workspace));
    return candidate;
}

function contentTarget(productionRoot, providerName, bytes = MP4) {
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    return path.join(productionRoot, 'media', 'imports', providerName, `${hash}.mp4`);
}

test('MOCK ffprobe: workspace discovers only bounded Flow/Grok result shapes and exposes a pathless public contract', (t) => {
    const fx = fixture(t);
    writeFlow(fx.flowResultsRoot);
    writeGrok(fx.grokResultsRoot);
    fs.writeFileSync(path.join(fx.flowResultsRoot, 'unrelated.mp4'), MP4);
    fs.mkdirSync(path.join(fx.flowResultsRoot, 'wrong_name'));
    fs.writeFileSync(path.join(fx.flowResultsRoot, 'wrong_name', 'other.mp4'), MP4);
    fs.mkdirSync(path.join(fx.grokResultsRoot, 'nested'));
    fs.writeFileSync(path.join(fx.grokResultsRoot, 'nested', 'nested.mp4'), MP4);

    const workspace = provider.getVideoResultImportWorkspace(fx.context);
    assert.equal(workspace.schema_version, provider.WORKSPACE_SCHEMA);
    assert.equal(workspace.status, 'ready');
    assert.equal(workspace.candidates.length, 2);
    for (const candidate of workspace.candidates) {
        assert.deepEqual(Object.keys(candidate).sort(), [
            'candidate_token', 'duration_seconds', 'height', 'preview_allowed', 'provider', 'result_id', 'size_bytes', 'width',
        ]);
        assert.match(candidate.candidate_token, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(candidate.preview_allowed, true);
        assert.equal(candidate.size_bytes, MP4.length);
        assert.equal(candidate.duration_seconds, 6);
        assert.equal(candidate.width, 1080);
        assert.equal(candidate.height, 1920);
    }
    const serialized = JSON.stringify(workspace);
    assert.equal(serialized.includes(fx.base), false);
    assert.equal(serialized.includes('result_1.mp4'), false);
    assert.equal(serialized.includes('.mp4'), false);
    assert.equal(serialized.includes(crypto.createHash('sha256').update(MP4).digest('hex')), false);
    assert.equal(workspace.executed, false);
    assert.equal(workspace.generation_executed, false);
    assert.equal(fx.probe.calls.length, 2);
    for (const call of fx.probe.calls) {
        assert.equal(call.command, provider.DEFAULT_FFPROBE_PATH);
        assert.equal(call.options.shell, false);
        assert.deepEqual(call.args.slice(0, 2), ['-v', 'error']);
        assert.equal(path.isAbsolute(call.args.at(-1)), true);
    }
});

test('MOCK ffprobe: opaque preview is G3-compatible, bounded, and rejects path injection', (t) => {
    const fx = fixture(t);
    writeFlow(fx.flowResultsRoot);
    const candidate = candidateFor(provider.getVideoResultImportWorkspace(fx.context), 'flow');
    const preview = provider.getVideoResultImportPreview({ candidateToken: candidate.candidate_token }, fx.context);

    assert.equal(preview.ok, true);
    assert.equal(preview.loaded, true);
    assert.equal(preview.mime_type, 'video/mp4');
    assert.equal(preview.byte_length, MP4.length);
    assert.deepEqual(Buffer.from(preview.base64, 'base64'), MP4);
    assert.equal(preview.executed, false);
    const forged = provider.getVideoResultImportPreview({
        candidateToken: candidate.candidate_token,
        sourcePath: writeFlow(fx.flowResultsRoot, 'forged'),
    }, fx.context);
    assert.equal(forged.ok, false);
    assert.equal(forged.loaded, false);
    assert.deepEqual(forged.blockers, ['VIDEO_IMPORT_PREVIEW_REQUEST_INVALID']);
});

test('MOCK ffprobe: real temp bytes stream into a content-addressed private target and append one unreviewed video attempt', (t) => {
    const fx = fixture(t);
    writeFlow(fx.flowResultsRoot);
    const candidate = candidateFor(provider.getVideoResultImportWorkspace(fx.context), 'flow');
    const plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);

    assert.equal(plan.schema_version, provider.PLAN_SCHEMA);
    assert.equal(plan.status, 'ready', JSON.stringify(plan));
    assert.equal(plan.ready, true);
    assert.match(plan.plan_token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(plan).includes(fx.base), false);
    assert.equal(JSON.stringify(plan).includes('.mp4'), false);
    assert.equal(Object.hasOwn(plan, 'target_relative_path'), false);
    assert.equal(plan.generation_executed, false, 'import authority is separate from generation runtime readiness');

    const result = provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context);
    assert.deepEqual({ imported: result.imported, copied: result.copied, ledger: result.ledger_appended }, {
        imported: true,
        copied: true,
        ledger: true,
    });
    assert.equal(result.generation_executed, false);
    const target = contentTarget(fx.productionRoot, 'flow');
    assert.deepEqual(fs.readFileSync(target), MP4);
    assert.equal(fs.lstatSync(target).mode & 0o777, 0o600);
    const records = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 2);
    assert.deepEqual({
        kind: records[1].kind,
        target: records[1].target_id,
        provider: records[1].provider,
        attempt: records[1].attempt,
        retry: records[1].retry_of,
        review: records[1].review_status,
        status: records[1].generation_status,
        duration: records[1].source_duration_seconds,
        dimensions: [records[1].source_width, records[1].source_height],
    }, {
        kind: 'video',
        target: 'clip_002',
        provider: 'flow',
        attempt: 2,
        retry: fx.source.media_id,
        review: 'unreviewed',
        status: 'imported',
        duration: 6,
        dimensions: [1080, 1920],
    });
    assert.equal(fs.existsSync(path.join(fx.productionRoot, '.film-pipeline-locks', 'media-attempts.lock')), false);
});

test('MOCK ffprobe: already imported content is idempotent and appends no duplicate ledger line', (t) => {
    const fx = fixture(t);
    writeFlow(fx.flowResultsRoot);
    let candidate = candidateFor(provider.getVideoResultImportWorkspace(fx.context), 'flow');
    let plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context);

    candidate = candidateFor(provider.getVideoResultImportWorkspace(fx.context), 'flow');
    plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    assert.equal(plan.status, 'already_current');
    assert.equal(plan.already_current, true);
    const result = provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context);
    assert.deepEqual({ imported: result.imported, executed: result.executed, copied: result.copied, ledger: result.ledger_appended }, {
        imported: false,
        executed: false,
        copied: false,
        ledger: false,
    });
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('MOCK ffprobe: JPEG spoof, candidate symlink, and unsafe result directory are rejected', (t) => {
    const fx = fixture(t);
    writeFlow(fx.flowResultsRoot, 'spoofed', Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(64)]));
    const outside = path.join(fx.base, 'outside.mp4');
    fs.writeFileSync(outside, MP4);
    fs.symlinkSync(outside, path.join(fx.grokResultsRoot, 'linked.mp4'));
    const outsideDirectory = path.join(fx.base, 'outside-directory');
    fs.mkdirSync(outsideDirectory);
    fs.writeFileSync(path.join(outsideDirectory, 'result_1.mp4'), MP4);
    fs.symlinkSync(outsideDirectory, path.join(fx.flowResultsRoot, 'linked-directory'));

    const workspace = provider.getVideoResultImportWorkspace(fx.context);
    assert.equal(workspace.candidates.length, 0);
    assert.equal(workspace.ready, false);
    assert.ok(workspace.rejected_count >= 3, JSON.stringify(workspace));
    assert.equal(fx.probe.calls.length, 0, 'MP4 magic and symlink checks happen before MOCK ffprobe');

    const realRoot = fx.flowResultsRoot;
    const linkedRoot = path.join(fx.base, 'flow-root-link');
    fs.symlinkSync(realRoot, linkedRoot);
    const linkedWorkspace = provider.getVideoResultImportWorkspace({ ...fx.context, flowResultsRoot: linkedRoot });
    assert.ok(linkedWorkspace.blockers.includes('VIDEO_IMPORT_FLOW_ROOT_UNSAFE'));
});

test('MOCK ffprobe: exact retry queue video/provider authority is required but generation runtime readiness is not', (t) => {
    const fx = fixture(t);
    writeFlow(fx.flowResultsRoot);
    writeGrok(fx.grokResultsRoot);
    const workspace = provider.getVideoResultImportWorkspace(fx.context);
    const flow = candidateFor(workspace, 'flow');
    const grok = candidateFor(workspace, 'grok');

    const flowPlan = provider.planVideoResultImport({ candidateToken: flow.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    assert.equal(flowPlan.ready, true, 'Flow runtime blockers do not erase an explicit local import authority');
    const mismatch = provider.planVideoResultImport({ candidateToken: grok.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    assert.equal(mismatch.ready, false);
    assert.deepEqual(mismatch.blockers, ['VIDEO_IMPORT_RETRY_QUEUE_INVALID']);

    const draftPath = path.join(fx.productionRoot, 'reviews', 'media_review_draft.json');
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    draft.retry_queue[0].target_id = 'clip_tampered';
    fs.writeFileSync(draftPath, `${JSON.stringify(draft)}\n`);
    const blocked = provider.planVideoResultImport({ candidateToken: flow.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    assert.equal(blocked.ready, false);
    assert.deepEqual(blocked.blockers, ['VIDEO_IMPORT_RETRY_QUEUE_INVALID']);
});

test('MOCK ffprobe: source, ledger, review, and target drift fail closed before a ledger append', (t) => {
    const sourceFx = fixture(t);
    const sourcePath = writeFlow(sourceFx.flowResultsRoot);
    let candidate = candidateFor(provider.getVideoResultImportWorkspace(sourceFx.context), 'flow');
    let plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: sourceFx.source.media_id }, sourceFx.context);
    fs.appendFileSync(sourcePath, Buffer.from('changed'));
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, sourceFx.context),
        { code: 'VIDEO_IMPORT_SOURCE_CHANGED' },
    );

    const ledgerFx = fixture(t);
    writeFlow(ledgerFx.flowResultsRoot);
    candidate = candidateFor(provider.getVideoResultImportWorkspace(ledgerFx.context), 'flow');
    plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: ledgerFx.source.media_id }, ledgerFx.context);
    fs.appendFileSync(path.join(ledgerFx.productionRoot, 'media_attempts.jsonl'), `${JSON.stringify({
        media_id: 'unrelated', kind: 'video', target_id: 'clip_999', provider: 'flow', attempt: 1,
    })}\n`);
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, ledgerFx.context),
        { code: 'VIDEO_IMPORT_PLAN_STALE' },
    );

    const reviewFx = fixture(t);
    writeFlow(reviewFx.flowResultsRoot);
    candidate = candidateFor(provider.getVideoResultImportWorkspace(reviewFx.context), 'flow');
    plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: reviewFx.source.media_id }, reviewFx.context);
    const reviewPath = path.join(reviewFx.productionRoot, 'reviews', 'media_review_draft.json');
    const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    review.reviews[0].review_note = 'changed';
    fs.writeFileSync(reviewPath, `${JSON.stringify(review)}\n`);
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, reviewFx.context),
        { code: 'VIDEO_IMPORT_PLAN_STALE' },
    );

    const targetFx = fixture(t);
    writeFlow(targetFx.flowResultsRoot);
    candidate = candidateFor(provider.getVideoResultImportWorkspace(targetFx.context), 'flow');
    plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: targetFx.source.media_id }, targetFx.context);
    const target = contentTarget(targetFx.productionRoot, 'flow');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.concat([MP4, Buffer.from('collision')]));
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, targetFx.context),
        { code: 'VIDEO_IMPORT_TARGET_COLLISION' },
    );
});

test('MOCK ffprobe: forged envelopes, unconfirmed/reused tokens, and expired plans are one-shot fail-closed', (t) => {
    const fx = fixture(t);
    writeFlow(fx.flowResultsRoot);
    const candidate = candidateFor(provider.getVideoResultImportWorkspace(fx.context), 'flow');
    const forged = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
        sourcePath: writeFlow(fx.flowResultsRoot, 'forged'),
    }, fx.context);
    assert.deepEqual(forged.blockers, ['VIDEO_IMPORT_PLAN_REQUEST_INVALID']);

    let plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: false }, fx.context),
        { code: 'VIDEO_IMPORT_CONFIRMATION_REQUIRED' },
    );
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context),
        { code: 'VIDEO_IMPORT_PLAN_TOKEN_INVALID' },
    );

    let clock = 1000;
    const expiring = { ...fx.context, planStore: new Map(), planTtlMs: 10, nowMs: () => clock };
    plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, expiring);
    clock += 11;
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, expiring),
        { code: 'VIDEO_IMPORT_PLAN_TOKEN_EXPIRED' },
    );
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, expiring),
        { code: 'VIDEO_IMPORT_PLAN_TOKEN_INVALID' },
    );
});

test('MOCK ffprobe: DST-compatible media-attempts O_EXCL lock prevents concurrent video mutation', (t) => {
    const fx = fixture(t);
    writeFlow(fx.flowResultsRoot);
    const candidate = candidateFor(provider.getVideoResultImportWorkspace(fx.context), 'flow');
    const plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    const lockDirectory = path.join(fx.productionRoot, '.film-pipeline-locks');
    fs.mkdirSync(lockDirectory);
    fs.writeFileSync(path.join(lockDirectory, 'media-attempts.lock'), `${JSON.stringify({
        schema_version: 'film_pipeline.media_attempts_lock.v1',
        pid: process.pid,
        created_at_ms: Date.now(),
        production_root_fingerprint: 'a'.repeat(64),
        token_sha256: 'b'.repeat(64),
    })}\n`, { mode: 0o600 });

    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context),
        { code: 'VIDEO_IMPORT_LOCKED' },
    );
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 1);
    assert.equal(fs.existsSync(contentTarget(fx.productionRoot, 'flow')), false);
});

const REAL_H1_VIDEO = '/Users/jessiek/StudioProjects/google_labs_flow_auto/outputs/generated/H1_ancient_campfire/result_1.mp4';
const REAL_FFPROBE = provider.DEFAULT_FFPROBE_PATH;

test('REAL local smoke: H1 bytes pass fixed ffprobe and plan/confirm into a temporary production', {
    skip: !fs.existsSync(REAL_H1_VIDEO) || !fs.existsSync(REAL_FFPROBE),
}, (t) => {
    const fx = fixture(t);
    const flowDirectory = path.join(fx.flowResultsRoot, 'H1_ancient_campfire');
    fs.mkdirSync(flowDirectory);
    fs.copyFileSync(REAL_H1_VIDEO, path.join(flowDirectory, 'result_1.mp4'));
    const realContext = { ...fx.context };
    delete realContext.runProcessFn;

    const workspace = provider.getVideoResultImportWorkspace(realContext);
    const candidate = candidateFor(workspace, 'flow');
    assert.equal(candidate.result_id, 'H1_ancient_campfire');
    assert.ok(candidate.duration_seconds > 0);
    assert.ok(candidate.width > 0 && candidate.height > 0);
    const plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, realContext);
    assert.equal(plan.ready, true, JSON.stringify(plan));
    const result = provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, realContext);
    assert.equal(result.imported, true);
    assert.equal(result.copied, true);
    assert.equal(result.ledger_appended, true);
    const records = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
    const imported = records.at(-1);
    const target = path.join(fx.productionRoot, ...imported.relative_path.split('/'));
    assert.deepEqual(
        crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
        crypto.createHash('sha256').update(fs.readFileSync(REAL_H1_VIDEO)).digest('hex'),
    );
});
