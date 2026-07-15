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
const MP4_ALT = Buffer.concat([MP4, Buffer.from('canonical-result')]);

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

function writeReplicate(replicateRoot, number = 1, bytes = MP4) {
    const filePath = path.join(replicateRoot, `seedance_${number}.mp4`);
    fs.writeFileSync(filePath, bytes);
    return filePath;
}

function writeProviderReceipt(resultsRoot, providerName, resultId, bytes = MP4, overrides = {}) {
    const directory = path.join(resultsRoot, resultId);
    fs.mkdirSync(directory, { recursive: true });
    const videoPath = path.join(directory, 'result.mp4');
    fs.writeFileSync(videoPath, bytes);
    const receipt = {
        schema_version: provider.EXTERNAL_RESULT_SCHEMA,
        provider: providerName,
        result_id: resultId,
        status: 'succeeded',
        output_file: 'result.mp4',
        output_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        output_size_bytes: bytes.length,
        completed_at: '2026-07-15T09:00:00.000Z',
        ...overrides,
    };
    const receiptPath = path.join(directory, 'receipt.json');
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    return { directory, videoPath, receiptPath, receipt };
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
    const replicateRunRoot = path.join(base, 'replicate-run');
    const replicateResultsRoot = path.join(replicateRunRoot, 'replicate_seedance_clips');
    const replicateReceiptResultsRoot = path.join(base, 'replicate-receipts');
    const bytedanceReceiptResultsRoot = path.join(base, 'bytedance-receipts');
    const productionRoot = path.join(base, 'production');
    fs.mkdirSync(flowResultsRoot);
    fs.mkdirSync(grokResultsRoot);
    fs.mkdirSync(replicateResultsRoot, { recursive: true });
    fs.mkdirSync(replicateReceiptResultsRoot);
    fs.mkdirSync(bytedanceReceiptResultsRoot);
    fs.writeFileSync(path.join(replicateRunRoot, 'run_status.md'), '# MOCK run\nReplicate Seedance fallback\n');
    fs.mkdirSync(productionRoot);
    fs.writeFileSync(path.join(productionRoot, 'brief.md'), '# video import fixture\n');
    const source = writeRetrySources(productionRoot, options);
    const probe = mockFfprobe(options.probe);
    const context = {
        flowResultsRoot,
        grokResultsRoot,
        replicateResultsRoot,
        replicateReceiptResultsRoot,
        bytedanceReceiptResultsRoot,
        replicateShaAllowlist: {
            seedance_1: crypto.createHash('sha256').update(MP4).digest('hex'),
            seedance_2: crypto.createHash('sha256').update(MP4).digest('hex'),
            seedance_3: crypto.createHash('sha256').update(MP4).digest('hex'),
        },
        config: { productionRoot },
        tokenSecret: Buffer.alloc(32, 11),
        planStore: new Map(),
        runProcessFn: probe.runProcessFn,
        now: () => '2026-07-15T09:00:00.000Z',
    };
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return {
        base, flowResultsRoot, grokResultsRoot, replicateRunRoot, replicateResultsRoot,
        replicateReceiptResultsRoot, bytedanceReceiptResultsRoot,
        productionRoot, source, probe, context,
    };
}

function writeStoryboard(productionRoot, clips) {
    const directory = path.join(productionRoot, 'storyboard');
    fs.mkdirSync(directory, { recursive: true });
    const storyboardPath = path.join(directory, 'storyboard.json');
    fs.writeFileSync(storyboardPath, `${JSON.stringify({ clips })}\n`);
    return storyboardPath;
}

function initialFixture(t, options = {}) {
    const fx = fixture(t, options);
    fs.rmSync(path.join(fx.productionRoot, 'media_attempts.jsonl'));
    fs.rmSync(path.join(fx.productionRoot, 'reviews'), { recursive: true });
    const clips = options.clips || [
        { clip_id: 'clip_001', title: '비 오는 골목의 첫 장면', scene_title: '대체 장면 이름', scene_id: 'scene_001' },
        { clip_id: 'clip_002', scene_title: '낡은 차 안의 대화', scene_id: 'scene_002' },
        { clip_id: 'clip_003', scene_id: 'scene_003' },
    ];
    const storyboardPath = writeStoryboard(fx.productionRoot, clips);
    return { ...fx, clips, storyboardPath };
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

test('MOCK ffprobe: main-only private copy imports a clip larger than the renderer preview limit by stable streaming', (t) => {
    const fx = fixture(t);
    const large = Buffer.concat([MP4.subarray(0, 24), Buffer.alloc((33 * 1024 * 1024) - 24, 0x2a)]);
    writeFlow(fx.flowResultsRoot, 'large-flow-result', large);
    const workspace = provider.getVideoResultImportWorkspace(fx.context);
    const candidate = candidateFor(workspace, 'flow');
    assert.equal(candidate.preview_allowed, false);
    const privateRoot = path.join(fx.base, 'private-results');
    fs.mkdirSync(privateRoot, { mode: 0o700 });
    const destinationPath = path.join(privateRoot, '.video-source-0123456789abcdef01234567.tmp');
    const copied = provider.copyVideoResultCandidateToPrivateFile({
        candidateToken: candidate.candidate_token,
        destinationPath,
        destinationRoot: privateRoot,
    }, fx.context);
    assert.equal(copied.provider, 'flow');
    assert.equal(copied.byte_length, large.byteLength);
    assert.equal(copied.source_sha256, crypto.createHash('sha256').update(large).digest('hex'));
    assert.equal(copied.duration_seconds, 6);
    assert.equal(fs.lstatSync(destinationPath).mode & 0o777, 0o600);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(destinationPath)).digest('hex'), copied.source_sha256);
    assert.equal(fs.existsSync(path.join(fx.productionRoot, 'media', 'imports')), false,
        'main-only private copy never writes into production');
    const protectedFile = path.join(fx.base, 'protected.txt');
    fs.writeFileSync(protectedFile, 'keep');
    const occupiedPath = path.join(privateRoot, '.video-source-abcdef0123456789abcdef01.tmp');
    fs.symlinkSync(protectedFile, occupiedPath);
    assert.throws(() => provider.copyVideoResultCandidateToPrivateFile({
        candidateToken: candidate.candidate_token,
        destinationPath: occupiedPath,
        destinationRoot: privateRoot,
    }, fx.context), { code: 'EEXIST' });
    assert.equal(fs.lstatSync(occupiedPath).isSymbolicLink(), true, 'failed O_EXCL never removes a pre-existing entry');
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'keep');
});

test('MOCK ffprobe: storyboard-authoritative initial video targets are pathless, ordered, and use short Korean labels', (t) => {
    const fx = initialFixture(t);
    writeFlow(fx.flowResultsRoot);

    const workspace = provider.getVideoResultImportWorkspace(fx.context);
    assert.deepEqual(workspace.initial_targets.map((target) => ({
        kind: target.kind,
        id: target.target_id,
        label: target.target_label,
        sequence: target.sequence,
    })), [
        { kind: 'video', id: 'clip_001', label: '비 오는 골목의 첫 장면', sequence: 1 },
        { kind: 'video', id: 'clip_002', label: '낡은 차 안의 대화', sequence: 2 },
        { kind: 'video', id: 'clip_003', label: 'scene_003', sequence: 3 },
    ]);
    for (const target of workspace.initial_targets) {
        assert.deepEqual(Object.keys(target).sort(), [
            'kind', 'sequence', 'target_id', 'target_label', 'target_token',
        ]);
        assert.match(target.target_token, /^[A-Za-z0-9_-]{43}$/);
    }
    assert.equal(JSON.stringify(workspace.initial_targets).includes(fx.base), false);
    assert.equal(fs.existsSync(path.join(fx.productionRoot, 'media_attempts.jsonl')), false);
    assert.equal(fs.existsSync(path.join(fx.productionRoot, 'reviews')), false);
});

test('MOCK ffprobe: initial Flow result imports as attempt one without retry sources and is idempotent', (t) => {
    const fx = initialFixture(t);
    writeFlow(fx.flowResultsRoot);
    let workspace = provider.getVideoResultImportWorkspace(fx.context);
    let candidate = candidateFor(workspace, 'flow');
    const initialTarget = workspace.initial_targets[0];
    let plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        initialTargetToken: initialTarget.target_token,
    }, fx.context);

    assert.equal(plan.schema_version, provider.PLAN_SCHEMA);
    assert.equal(plan.status, 'ready', JSON.stringify(plan));
    assert.equal(plan.import_mode, 'initial');
    assert.equal(plan.retry_media_id, '');
    assert.equal(plan.target_id, 'clip_001');
    assert.equal(plan.target_label, '비 오는 골목의 첫 장면');
    assert.equal(plan.source_provider, 'flow');
    assert.equal(JSON.stringify(plan).includes(fx.base), false);

    let result = provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context);
    assert.equal(result.import_mode, 'initial');
    assert.equal(result.target_label, '비 오는 골목의 첫 장면');
    assert.deepEqual({ imported: result.imported, copied: result.copied, ledger: result.ledger_appended }, {
        imported: true,
        copied: true,
        ledger: true,
    });
    const records = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 1);
    assert.deepEqual({
        kind: records[0].kind,
        target: records[0].target_id,
        label: records[0].target_label,
        provider: records[0].provider,
        sourceProvider: records[0].source_provider,
        attempt: records[0].attempt,
        retry: records[0].retry_of,
        review: records[0].review_status,
    }, {
        kind: 'video',
        target: 'clip_001',
        label: '비 오는 골목의 첫 장면',
        provider: 'flow',
        sourceProvider: 'flow',
        attempt: 1,
        retry: '',
        review: 'unreviewed',
    });
    assert.equal(fs.existsSync(path.join(fx.productionRoot, 'reviews')), false);
    const target = contentTarget(fx.productionRoot, 'flow');
    assert.deepEqual(fs.readFileSync(target), MP4);
    assert.equal(fs.lstatSync(target).mode & 0o777, 0o600);

    workspace = provider.getVideoResultImportWorkspace(fx.context);
    assert.deepEqual(workspace.initial_targets.map((targetValue) => targetValue.target_id), ['clip_002', 'clip_003']);
    candidate = candidateFor(workspace, 'flow');
    plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        initialTargetToken: initialTarget.target_token,
    }, fx.context);
    assert.equal(plan.status, 'already_current', JSON.stringify(plan));
    result = provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context);
    assert.equal(result.import_mode, 'initial');
    assert.equal(result.target_label, '비 오는 골목의 첫 장면');
    assert.deepEqual({ imported: result.imported, copied: result.copied, ledger: result.ledger_appended }, {
        imported: false,
        copied: false,
        ledger: false,
    });
    assert.equal(fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('MOCK ffprobe: initial and retry plan envelopes are exact and mutually exclusive', (t) => {
    const fx = initialFixture(t);
    writeFlow(fx.flowResultsRoot);
    const workspace = provider.getVideoResultImportWorkspace(fx.context);
    const candidate = candidateFor(workspace, 'flow');
    const target = workspace.initial_targets[0];

    for (const payload of [
        { candidateToken: candidate.candidate_token },
        {
            candidateToken: candidate.candidate_token,
            retryMediaId: 'old_video',
            initialTargetToken: target.target_token,
        },
        {
            candidateToken: candidate.candidate_token,
            initialTargetToken: target.target_token,
            sourcePath: '/tmp/forged.mp4',
        },
    ]) {
        const blocked = provider.planVideoResultImport(payload, fx.context);
        assert.equal(blocked.import_mode, '');
        assert.equal(blocked.target_label, '');
        assert.deepEqual(blocked.blockers, ['VIDEO_IMPORT_PLAN_REQUEST_INVALID']);
    }
    const invalidToken = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        initialTargetToken: 'forged',
    }, fx.context);
    assert.deepEqual(invalidToken.blockers, ['VIDEO_IMPORT_INITIAL_TARGET_TOKEN_INVALID']);
});

test('MOCK ffprobe: initial storyboard, ledger, and conflicting target drift fail closed', (t) => {
    const storyboardFx = initialFixture(t);
    writeFlow(storyboardFx.flowResultsRoot);
    let workspace = provider.getVideoResultImportWorkspace(storyboardFx.context);
    let candidate = candidateFor(workspace, 'flow');
    let plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        initialTargetToken: workspace.initial_targets[0].target_token,
    }, storyboardFx.context);
    writeStoryboard(storyboardFx.productionRoot, [
        { clip_id: 'clip_001', title: '계획 뒤 바뀐 제목' },
    ]);
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, storyboardFx.context),
        { code: 'VIDEO_IMPORT_INITIAL_TARGET_UNKNOWN' },
    );

    const ledgerFx = initialFixture(t);
    writeFlow(ledgerFx.flowResultsRoot);
    workspace = provider.getVideoResultImportWorkspace(ledgerFx.context);
    candidate = candidateFor(workspace, 'flow');
    plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        initialTargetToken: workspace.initial_targets[0].target_token,
    }, ledgerFx.context);
    fs.writeFileSync(path.join(ledgerFx.productionRoot, 'media_attempts.jsonl'), `${JSON.stringify({
        media_id: 'unrelated_video', kind: 'video', target_id: 'clip_999', provider: 'flow', attempt: 1,
    })}\n`);
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, ledgerFx.context),
        { code: 'VIDEO_IMPORT_PLAN_STALE' },
    );

    const existingFx = initialFixture(t);
    writeFlow(existingFx.flowResultsRoot);
    workspace = provider.getVideoResultImportWorkspace(existingFx.context);
    candidate = candidateFor(workspace, 'flow');
    const initialTargetTokenValue = workspace.initial_targets[0].target_token;
    fs.writeFileSync(path.join(existingFx.productionRoot, 'media_attempts.jsonl'), `${JSON.stringify({
        media_id: 'other_video',
        kind: 'video',
        target_id: 'clip_001',
        target_label: '다른 결과',
        provider: 'flow',
        attempt: 1,
    })}\n`);
    const blocked = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        initialTargetToken: initialTargetTokenValue,
    }, existingFx.context);
    assert.deepEqual(blocked.blockers, ['VIDEO_IMPORT_INITIAL_TARGET_EXISTS']);
});

test('MOCK ffprobe: Replicate accepts only the three fixed Seedance names, approved hashes, and exact provenance', (t) => {
    const fx = fixture(t, { provider: 'replicate' });
    writeReplicate(fx.replicateResultsRoot, 1);
    writeReplicate(fx.replicateResultsRoot, 2, Buffer.concat([MP4, Buffer.from('wrong-hash')]));
    writeReplicate(fx.replicateResultsRoot, 4);
    fs.writeFileSync(path.join(fx.replicateResultsRoot, 'seedance_1_overlay.mp4'), MP4);
    fs.writeFileSync(path.join(fx.replicateResultsRoot, 'final.mp4'), MP4);

    const workspace = provider.getVideoResultImportWorkspace(fx.context);
    assert.deepEqual(workspace.candidates.map((item) => [item.provider, item.result_id]), [
        ['replicate', 'seedance_1'],
    ]);
    assert.ok(workspace.rejected_count >= 4, JSON.stringify(workspace));
    assert.equal(fx.probe.calls.length, 1, 'wrong hashes and non-allowlisted names stop before MOCK ffprobe');
    assert.equal(JSON.stringify(workspace).includes(fx.base), false);

    const candidate = candidateFor(workspace, 'replicate');
    const plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);
    const result = provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context);
    assert.equal(result.import_mode, 'retry');
    assert.equal(result.target_label, 'clip_002');
    assert.equal(result.imported, true);
    const imported = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(imported.source_provenance, 'historical_replicate_seedance_allowlist_v1');

    fs.writeFileSync(path.join(fx.replicateRunRoot, 'run_status.md'), '# MOCK run without required provenance\n');
    const blocked = provider.getVideoResultImportWorkspace(fx.context);
    assert.equal(blocked.candidates.some((item) => item.provider === 'replicate'), false);
    assert.ok(blocked.blockers.includes('VIDEO_IMPORT_REPLICATE_PROVENANCE_INVALID'), JSON.stringify(blocked));
});

test('MOCK ffprobe: canonical Replicate and ByteDance receipts stay pathless, prefer receipt evidence, and import provenance', (t) => {
    const fx = fixture(t, { provider: 'replicate' });
    writeReplicate(fx.replicateResultsRoot, 1, MP4);
    writeReplicate(fx.replicateResultsRoot, 2, MP4_ALT);
    fx.context.replicateShaAllowlist.seedance_2 = crypto.createHash('sha256').update(MP4_ALT).digest('hex');
    writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'seedance_1', MP4_ALT);
    writeProviderReceipt(fx.bytedanceReceiptResultsRoot, 'bytedance', 'byte_job_001', MP4);

    const workspace = provider.getVideoResultImportWorkspace(fx.context);
    assert.deepEqual(workspace.candidates.map((item) => [item.provider, item.result_id]).sort(), [
        ['bytedance', 'byte_job_001'],
        ['replicate', 'seedance_1'],
    ]);
    for (const candidate of workspace.candidates) {
        assert.deepEqual(Object.keys(candidate).sort(), [
            'candidate_token', 'duration_seconds', 'height', 'preview_allowed', 'provider', 'result_id', 'size_bytes', 'width',
        ]);
    }
    const serialized = JSON.stringify(workspace);
    assert.equal(serialized.includes(fx.base), false);
    assert.equal(serialized.includes('receipt.json'), false);
    assert.equal(serialized.includes('result.mp4'), false);
    assert.equal(serialized.includes(crypto.createHash('sha256').update(MP4_ALT).digest('hex')), false);

    const candidate = candidateFor(workspace, 'replicate');
    assert.equal(candidate.size_bytes, MP4_ALT.length, 'canonical receipt wins over the historical result with the same provider/result id');
    const plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, fx.context);
    assert.equal(plan.ready, true, JSON.stringify(plan));
    const result = provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context);
    assert.equal(result.imported, true);
    assert.deepEqual(fs.readFileSync(contentTarget(fx.productionRoot, 'replicate', MP4_ALT)), MP4_ALT);
    const imported = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(imported.source_provenance, 'provider_result_receipt_v1');
});

test('MOCK ffprobe: malformed canonical receipts, mismatched evidence, symlinks, and extra files are rejected', (t) => {
    const fx = fixture(t, { provider: 'replicate' });
    writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'bad_json');
    fs.writeFileSync(path.join(fx.replicateReceiptResultsRoot, 'bad_json', 'receipt.json'), '{');
    writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'bad_hash', MP4, { output_sha256: 'a'.repeat(64) });
    writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'bad_size', MP4, { output_size_bytes: MP4.length + 1 });
    writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'bad_provider', MP4, { provider: 'bytedance' });
    writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'bad_result_id', MP4, { result_id: 'different' });
    writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'bad_time', MP4, { completed_at: 'yesterday' });
    writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'extra_key', MP4, { unexpected: true });
    const oversized = writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'oversized_receipt');
    fs.writeFileSync(oversized.receiptPath, Buffer.alloc(64 * 1024 + 1, 0x20));
    const extra = writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'extra_file');
    fs.writeFileSync(path.join(extra.directory, 'extra.txt'), 'not allowed');

    const outsideVideo = path.join(fx.base, 'outside-video.mp4');
    fs.writeFileSync(outsideVideo, MP4);
    const linkedVideo = writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'linked_video');
    fs.unlinkSync(linkedVideo.videoPath);
    fs.symlinkSync(outsideVideo, linkedVideo.videoPath);
    const outsideReceipt = path.join(fx.base, 'outside-receipt.json');
    fs.writeFileSync(outsideReceipt, `${JSON.stringify(linkedVideo.receipt)}\n`);
    const linkedReceipt = writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'linked_receipt');
    fs.unlinkSync(linkedReceipt.receiptPath);
    fs.symlinkSync(outsideReceipt, linkedReceipt.receiptPath);

    const workspace = provider.getVideoResultImportWorkspace(fx.context);
    assert.equal(workspace.candidates.length, 0, JSON.stringify(workspace));
    assert.ok(workspace.rejected_count >= 11, JSON.stringify(workspace));
    assert.equal(fx.probe.calls.length, 0, 'declared hash and size mismatches stop before MOCK ffprobe');
});

test('MOCK ffprobe: absent receipt roots are non-blocking while an existing unsafe root is blocked', (t) => {
    const fx = fixture(t);
    fs.rmSync(fx.replicateReceiptResultsRoot, { recursive: true });
    fs.rmSync(fx.bytedanceReceiptResultsRoot, { recursive: true });
    writeFlow(fx.flowResultsRoot);
    const missing = provider.getVideoResultImportWorkspace(fx.context);
    assert.ok(candidateFor(missing, 'flow'));
    assert.equal(missing.blockers.some((code) => code.includes('RECEIPT_ROOT')), false, JSON.stringify(missing));

    const outside = path.join(fx.base, 'outside-receipts');
    fs.mkdirSync(outside);
    const linkedRoot = path.join(fx.base, 'linked-receipts');
    fs.symlinkSync(outside, linkedRoot);
    const unsafe = provider.getVideoResultImportWorkspace({ ...fx.context, replicateReceiptResultsRoot: linkedRoot });
    assert.ok(unsafe.blockers.includes('VIDEO_IMPORT_REPLICATE_RECEIPT_ROOT_UNSAFE'), JSON.stringify(unsafe));
});

test('MOCK ffprobe: changing a canonical receipt after planning invalidates the one-shot import', (t) => {
    const fx = fixture(t, { provider: 'replicate' });
    const written = writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'receipt_drift');
    const candidate = candidateFor(provider.getVideoResultImportWorkspace(fx.context), 'replicate');
    const plan = provider.planVideoResultImport({ candidateToken: candidate.candidate_token, retryMediaId: fx.source.media_id }, fx.context);
    const changed = { ...written.receipt, completed_at: '2026-07-15T09:01:00.000Z' };
    fs.writeFileSync(written.receiptPath, `${JSON.stringify(changed)}\n`);
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, fx.context),
        { code: 'VIDEO_IMPORT_SOURCE_CHANGED' },
    );
});

test('MOCK ffprobe: Replicate provenance change or deletion makes an issued plan stale', (t) => {
    const changedFx = fixture(t, { provider: 'replicate' });
    writeReplicate(changedFx.replicateResultsRoot, 1);
    let candidate = candidateFor(provider.getVideoResultImportWorkspace(changedFx.context), 'replicate');
    let plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: changedFx.source.media_id,
    }, changedFx.context);
    fs.appendFileSync(path.join(changedFx.replicateRunRoot, 'run_status.md'), 'changed\n');
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, changedFx.context),
        { code: 'VIDEO_IMPORT_SOURCE_CHANGED' },
    );

    const deletedFx = fixture(t, { provider: 'replicate' });
    writeReplicate(deletedFx.replicateResultsRoot, 1);
    candidate = candidateFor(provider.getVideoResultImportWorkspace(deletedFx.context), 'replicate');
    plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: deletedFx.source.media_id,
    }, deletedFx.context);
    fs.unlinkSync(path.join(deletedFx.replicateRunRoot, 'run_status.md'));
    assert.throws(
        () => provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, deletedFx.context),
        { code: 'VIDEO_IMPORT_SOURCE_CHANGED' },
    );
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

    const ledgerPath = path.join(fx.productionRoot, 'media_attempts.jsonl');
    const legacyRecords = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').map(JSON.parse);
    delete legacyRecords[1].target_label;
    fs.writeFileSync(ledgerPath, `${legacyRecords.map(JSON.stringify).join('\n')}\n`);

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
    assert.equal(fs.readFileSync(ledgerPath, 'utf8').trim().split('\n').length, 2);
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
const REAL_REPLICATE_VIDEO = '/Users/jessiek/StudioProjects/happyVideoFactory/docs/xhs_ad_tests/20260515_smart_doorbell_ai_reversal/replicate_seedance_clips/seedance_1.mp4';
const REAL_REPLICATE_STATUS = '/Users/jessiek/StudioProjects/happyVideoFactory/docs/xhs_ad_tests/20260515_smart_doorbell_ai_reversal/run_status.md';
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

test('REAL local smoke: allowlisted Replicate Seedance 1 passes ffprobe and imports into a temporary production', {
    skip: !fs.existsSync(REAL_REPLICATE_VIDEO) || !fs.existsSync(REAL_REPLICATE_STATUS) || !fs.existsSync(REAL_FFPROBE),
}, (t) => {
    const fx = fixture(t, { provider: 'replicate' });
    fs.copyFileSync(REAL_REPLICATE_VIDEO, path.join(fx.replicateResultsRoot, 'seedance_1.mp4'));
    fs.copyFileSync(REAL_REPLICATE_STATUS, path.join(fx.replicateRunRoot, 'run_status.md'));
    const realContext = {
        ...fx.context,
        replicateShaAllowlist: provider.DEFAULT_REPLICATE_SHA_ALLOWLIST,
    };
    delete realContext.runProcessFn;

    const workspace = provider.getVideoResultImportWorkspace(realContext);
    const candidate = candidateFor(workspace, 'replicate');
    assert.equal(candidate.result_id, 'seedance_1');
    assert.ok(candidate.duration_seconds > 0);
    assert.ok(candidate.width > 0 && candidate.height > 0);
    const plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, realContext);
    assert.equal(plan.ready, true, JSON.stringify(plan));
    const result = provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, realContext);
    assert.equal(result.imported, true);
    assert.equal(result.provider, 'replicate');
    const records = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse);
    const imported = records.at(-1);
    assert.equal(imported.source_provenance, 'historical_replicate_seedance_allowlist_v1');
    const target = path.join(fx.productionRoot, ...imported.relative_path.split('/'));
    assert.deepEqual(
        crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
        provider.DEFAULT_REPLICATE_SHA_ALLOWLIST.seedance_1,
    );
});

test('REAL local smoke: canonical Replicate receipt passes ffprobe and imports into a temporary production', {
    skip: !fs.existsSync(REAL_REPLICATE_VIDEO) || !fs.existsSync(REAL_FFPROBE),
}, (t) => {
    const fx = fixture(t, { provider: 'replicate' });
    const bytes = fs.readFileSync(REAL_REPLICATE_VIDEO);
    writeProviderReceipt(fx.replicateReceiptResultsRoot, 'replicate', 'real_seedance_receipt', bytes);
    const realContext = { ...fx.context };
    delete realContext.runProcessFn;

    const workspace = provider.getVideoResultImportWorkspace(realContext);
    const candidate = candidateFor(workspace, 'replicate');
    assert.equal(candidate.result_id, 'real_seedance_receipt');
    assert.ok(candidate.duration_seconds > 0);
    assert.ok(candidate.width > 0 && candidate.height > 0);
    const plan = provider.planVideoResultImport({
        candidateToken: candidate.candidate_token,
        retryMediaId: fx.source.media_id,
    }, realContext);
    assert.equal(plan.ready, true, JSON.stringify(plan));
    const result = provider.confirmVideoResultImport({ planToken: plan.plan_token, confirmed: true }, realContext);
    assert.equal(result.imported, true);
    const imported = fs.readFileSync(path.join(fx.productionRoot, 'media_attempts.jsonl'), 'utf8')
        .trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(imported.source_provenance, 'provider_result_receipt_v1');
    const target = path.join(fx.productionRoot, ...imported.relative_path.split('/'));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
        crypto.createHash('sha256').update(bytes).digest('hex'));
});
