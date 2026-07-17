import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildMediaRetryPlan } = require('../electron/lib/mediaRetryPlanProvider.js');
const filmProvider = require('../electron/lib/filmPipelineProvider.js');

function fixture(t, records, queue) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-retry-plan-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'reviews'), { recursive: true });
    fs.mkdirSync(path.join(root, 'media'), { recursive: true });
    fs.writeFileSync(path.join(root, 'brief.md'), '# Test production\n');
    fs.writeFileSync(path.join(root, 'media', 'reference.png'), Buffer.from('safe-local-reference'));
    fs.writeFileSync(path.join(root, 'media_attempts.jsonl'), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    fs.writeFileSync(path.join(root, 'reviews', 'media_review_draft.json'), `${JSON.stringify({
        schema: 'film_pipeline.media_review_draft.v1',
        execution: 'not_run',
        reviews: [],
        retry_queue: queue,
    }, null, 2)}\n`);
    return root;
}

function record(overrides = {}) {
    return {
        media_id: 'scene_dst', kind: 'scene_image', target_id: 'clip_002', provider: 'dst', attempt: 2,
        prompt: 'Cinematic retry prompt', reference_ids: [], aspect_ratio: '9:16', path: 'media/source.png',
        ...overrides,
    };
}

function queueItem(source, sequence) {
    return {
        sequence,
        media_id: source.media_id,
        kind: source.kind,
        target_id: source.target_id,
        provider: source.provider,
        attempt: source.attempt,
        retry_of: source.media_id,
        review_note: '',
        execution_status: 'draft_not_executed',
    };
}

test('real temp production builds provider previews in saved queue order without execution', (t) => {
    const ref = record({
        media_id: 'reference', kind: 'character_sheet', target_id: 'hero', attempt: 1,
        prompt: 'Hero reference', path: 'media/reference.png',
    });
    const dst = record({ reference_ids: ['reference'] });
    const flow = record({
        media_id: 'video_flow', kind: 'video', target_id: 'clip_001', provider: 'flow', attempt: 1,
        prompt: 'Slow camera push', reference_ids: [], aspect_ratio: '16:9',
    });
    const grok = record({
        media_id: 'video_grok', kind: 'video', target_id: 'clip_003', provider: 'grok', attempt: 3,
        prompt: 'Subtle motion', reference_ids: [], duration: 15, quality: '720p',
    });
    const grokI2v = record({
        media_id: 'video_grok_i2v', kind: 'video', target_id: 'clip_003b', provider: 'grok', attempt: 1,
        prompt: 'Subtle reference motion', reference_ids: ['reference'], duration: 6,
    });
    const replicate = record({
        media_id: 'video_replicate', kind: 'video', target_id: 'clip_004', provider: 'replicate', attempt: 1,
        prompt: 'External candidate',
    });
    const ordered = [flow, dst, grok, grokI2v, replicate];
    const root = fixture(t, [ref, ...ordered], ordered.map((item, index) => queueItem(item, index + 1)));

    const plan = buildMediaRetryPlan(root);

    assert.equal(plan.schema, 'film_pipeline.media_retry_plan.v1');
    assert.equal(plan.execution, 'not_run');
    assert.equal(plan.executed, false);
    assert.deepEqual(plan.items.map((item) => item.media_id), ordered.map((item) => item.media_id));
    assert.deepEqual(plan.items.map((item) => item.sequence), [1, 2, 3, 4, 5]);
    assert.equal(plan.items.every((item) => item.executed === false), true);
    assert.equal(plan.ready, false);
    assert.equal(plan.execution_ready, false);
    assert.equal(plan.preview_ready, true);

    const dstItem = plan.items[1];
    assert.equal(dstItem.readiness, 'preview_ready');
    assert.equal(dstItem.command_spec.command, '/Users/jessiek/.pyenv/versions/3.11.7/bin/python');
    assert.deepEqual(dstItem.command_spec.args.slice(0, 5), ['-m', 'dst', 'image', dst.prompt, '-p']);
    assert.ok(dstItem.command_spec.args.includes('kjessie003'));
    assert.ok(dstItem.command_spec.args.includes('-a'));
    assert.ok(dstItem.command_spec.args.includes('--attach'));
    assert.ok(dstItem.command_spec.args.includes(path.join(root, 'media', 'reference.png')));
    assert.equal(dstItem.command_spec.preview_only, true);
    assert.equal(dstItem.command_spec.side_effect_type, 'credit_consuming_generation');
    assert.equal(dstItem.command_spec.copy_allowed, false);
    assert.equal(dstItem.preview_ready, true);
    assert.equal(dstItem.execution_ready, false);

    const flowItem = plan.items[0];
    assert.match(flowItem.command_spec.args[0], /flow_cdp_video_text_smoke\.py$/);
    assert.ok(flowItem.command_spec.args.includes('--no-submit'));
    assert.ok(flowItem.command_spec.args.includes('<FLOW_CDP_URL>'));
    assert.equal(flowItem.command_spec.copy_allowed, false);
    assert.ok(flowItem.blockers.includes('MISSING_FLOW_RUNTIME_CONTEXT'));

    const grokItem = plan.items[2];
    assert.deepEqual(grokItem.command_spec.args.slice(0, 2), ['grok_imagine_bot.py', 'video']);
    assert.ok(grokItem.command_spec.args.includes('15'));
    assert.ok(grokItem.command_spec.args.includes('/Users/jessiek/StudioProjects/grok-auto/grok-browser/outputs/video_grok_retry_4.mp4'));
    assert.equal(grokItem.command_spec.args.some((arg) => typeof arg === 'string' && arg.startsWith(root + path.sep) && arg.endsWith('.mp4')), false);
    assert.equal(grokItem.command_spec.copy_allowed, false);
    assert.ok(grokItem.blockers.includes('GROK_RUNTIME_UNVERIFIED'));

    const grokI2vItem = plan.items[3];
    assert.equal(grokI2vItem.command_spec.command, '');
    assert.equal(grokI2vItem.command_spec.args.some((arg) => typeof arg === 'string' && arg.startsWith(root + path.sep)), false);
    assert.ok(grokI2vItem.blockers.includes('GROK_REFERENCE_STAGING_REQUIRED'));
    assert.equal(grokI2vItem.preview_ready, false);

    const replicateItem = plan.items[4];
    assert.equal(replicateItem.command_spec.command, '');
    assert.equal(replicateItem.command_spec.copy_allowed, false);
    assert.deepEqual(replicateItem.blockers, ['MISSING_PROVIDER_ADAPTER']);
});

test('real temp production fails closed on missing prompt, unsafe reference, and queue attempt drift', (t) => {
    const unsafeRef = record({
        media_id: 'unsafe_ref', kind: 'character_sheet', target_id: 'hero', attempt: 1,
        prompt: 'ref', path: 'https://example.invalid/reference.png',
    });
    const missingPrompt = record({ media_id: 'missing_prompt', prompt: '' });
    const unsafeReferenceUse = record({ media_id: 'unsafe_use', reference_ids: ['unsafe_ref'] });
    const unsafeFlowReference = record({
        media_id: 'unsafe_flow_use', kind: 'video', target_id: 'clip_unsafe', provider: 'flow',
        attempt: 1, reference_ids: ['unsafe_ref'],
    });
    const root = fixture(t, [unsafeRef, missingPrompt, unsafeReferenceUse, unsafeFlowReference], [
        queueItem(missingPrompt, 1),
        queueItem(unsafeReferenceUse, 2),
        queueItem(unsafeFlowReference, 3),
    ]);
    const plan = buildMediaRetryPlan(root);
    assert.deepEqual(plan.items[0].blockers, ['MISSING_RETRY_PROMPT']);
    assert.ok(plan.items[1].blockers.includes('UNSAFE_REFERENCE_PATH'));
    assert.equal(plan.items[1].command_spec.copy_allowed, false);
    assert.equal(plan.items[1].command_spec.command, '');
    assert.deepEqual(plan.items[1].command_spec.args, []);
    assert.equal(plan.items[2].preview_ready, false);
    assert.equal(plan.items[2].command_spec.command, '');
    assert.deepEqual(plan.items[2].command_spec.args, []);
    assert.ok(plan.items[2].blockers.includes('UNSAFE_REFERENCE_PATH'));
    assert.ok(plan.items[2].blockers.includes('FLOW_REFERENCE_COUNT_MUST_BE_TWO'));

    const draftPath = path.join(root, 'reviews', 'media_review_draft.json');
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    draft.retry_queue[0].attempt = 999;
    fs.writeFileSync(draftPath, JSON.stringify(draft));
    const drifted = buildMediaRetryPlan(root);
    assert.deepEqual(drifted.items[0].blockers, ['RETRY_ATTEMPT_MISMATCH']);
    assert.equal(drifted.items[0].command_spec.command, '');
});

test('real temp production rejects malformed schema, duplicate ids, and non-contiguous sequence', (t) => {
    const source = record();
    const root = fixture(t, [source], [queueItem(source, 1)]);
    const draftPath = path.join(root, 'reviews', 'media_review_draft.json');
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    draft.schema = 'unexpected';
    fs.writeFileSync(draftPath, JSON.stringify(draft));
    assert.deepEqual(buildMediaRetryPlan(root).blockers, ['MEDIA_REVIEW_DRAFT_CONTRACT_INVALID']);

    draft.schema = 'film_pipeline.media_review_draft.v1';
    draft.retry_queue[0].sequence = 2;
    fs.writeFileSync(draftPath, JSON.stringify(draft));
    assert.deepEqual(buildMediaRetryPlan(root).blockers, ['MEDIA_RETRY_QUEUE_INVALID']);

    draft.retry_queue = [queueItem(source, 1)];
    fs.writeFileSync(draftPath, JSON.stringify(draft));
    fs.appendFileSync(path.join(root, 'media_attempts.jsonl'), `${JSON.stringify(source)}\n`);
    assert.deepEqual(buildMediaRetryPlan(root).blockers, ['DUPLICATE_MEDIA_ATTEMPT_ID']);
});

test('MOCK IPC registration keeps media retry planning pathless and main-owned', async (t) => {
    const source = record();
    const root = fixture(t, [source], [queueItem(source, 1)]);
    const handlers = new Map();
    filmProvider.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
        readConfigFn: () => ({
            productionRoot: root,
            productionParentRoot: path.dirname(root),
            recentProductionRoots: [root],
            pathProvenanceVersion: 1,
            dryRunMode: true,
            allowSafeCommandExecution: false,
        }),
    });
    const handler = handlers.get('film-pipeline:get-media-retry-plan');
    assert.equal(typeof handler, 'function');
    const result = await handler({}, undefined);
    assert.equal(result.items[0].media_id, source.media_id);
    assert.equal(result.executed, false);
    await assert.rejects(
        Promise.resolve().then(() => handler({}, { rootPath: root })),
        (error) => error?.code === 'RENDERER_PATH_ARGUMENT_FORBIDDEN',
    );
});
