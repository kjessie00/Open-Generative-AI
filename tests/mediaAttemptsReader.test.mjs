import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { normalizeProductionReaderState } from '../src/lib/pipeline/productionNormalizer.js';

const require = createRequire(import.meta.url);
const { readProductionFolder } = require('../electron/lib/productionReader.js');

function fixture(t) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-media-attempts-'));
    const root = path.join(base, 'production');
    fs.mkdirSync(path.join(root, 'media'), { recursive: true });
    fs.mkdirSync(path.join(root, 'reviews'), { recursive: true });
    fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'brief.md'), '# Media review fixture\n\nConcept: Reader verification.\nLogline: Local media attempts.\n');
    fs.writeFileSync(path.join(root, 'media', 'frame.png'), Buffer.from('fixture-image'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root };
}

test('reader uses the exact root media attempts and exact review draft, then normalizer overlays reviews safely', (t) => {
    const { root } = fixture(t);
    const records = [
        {
            media_id: 'scene-safe', kind: 'scene_image', target_id: 'clip_001', provider: 'dst',
            operation_id: 'dst-001', attempt: 2, reference_ids: ['character-1'], relative_path: 'media/frame.png',
            generation_status: 'downloaded', prompt: '정확한 재생성 프롬프트', aspect_ratio: '9:16', duration: 10, quality: '720p',
            review_status: 'unreviewed', retry_of: '', review_note: '',
        },
        {
            media_id: 'outside', kind: 'video', target_id: 'clip_001', provider: 'grok', path: '../outside.mp4',
            prompt: `invalid\0prompt`, aspect_ratio: '4:3', duration: 999, quality: '4k',
        },
        { media_id: 'url', kind: 'scene_image', target_id: 'clip_001', provider: 'replicate', path: 'https://example.invalid/a.png' },
        { media_id: 'nul', kind: 'scene_image', target_id: 'clip_001', provider: 'bytedance', path: 'media/a\0.png' },
    ];
    fs.writeFileSync(path.join(root, 'media_attempts.jsonl'), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    fs.writeFileSync(path.join(root, 'nested', 'media_attempts.jsonl'), `${JSON.stringify({ media_id: 'decoy' })}\n`);
    fs.writeFileSync(path.join(root, 'reviews', 'media_review_draft.json'), JSON.stringify({
        schema: 'film_pipeline.media_review_draft.v1',
        reviews: [{
            media_id: 'scene-safe',
            review_status: 'retry_requested',
            review_note: '인물 표정을 다시 확인',
            selected_for_retry: true,
        }],
    }));

    const raw = readProductionFolder(root);
    const state = normalizeProductionReaderState(raw);
    assert.equal(raw.parsed.mediaAttempts.relative_path, 'media_attempts.jsonl');
    assert.equal(raw.parsed.mediaReviewDraft.relative_path, path.join('reviews', 'media_review_draft.json'));
    assert.equal(raw.parsed.mediaAttempts.records.some((record) => record.media_id === 'decoy'), false);
    assert.equal(state.mediaAttempts.length, 4);
    assert.equal(state.mediaAttempts[0].path, path.join(root, 'media', 'frame.png'));
    assert.equal(state.mediaAttempts[0].relative_path, 'media/frame.png');
    assert.equal(state.mediaAttempts[0].review_status, 'retry_requested');
    assert.equal(state.mediaAttempts[0].review_note, '인물 표정을 다시 확인');
    assert.equal(state.mediaAttempts[0].selected_for_retry, true);
    assert.equal(state.mediaAttempts[0].prompt, '정확한 재생성 프롬프트');
    assert.equal(state.mediaAttempts[0].aspect_ratio, '9:16');
    assert.equal(state.mediaAttempts[0].duration, 10);
    assert.equal(state.mediaAttempts[0].quality, '720p');
    assert.deepEqual(
        [state.mediaAttempts[1].prompt, state.mediaAttempts[1].aspect_ratio, state.mediaAttempts[1].duration, state.mediaAttempts[1].quality],
        ['', '', 0, ''],
    );
    assert.deepEqual(state.mediaAttempts.slice(1).map((record) => record.path), ['', '', '']);
});

test('malformed root media attempts remain visible as an explicit reader blocker', (t) => {
    const { root } = fixture(t);
    fs.writeFileSync(path.join(root, 'media_attempts.jsonl'), '{"media_id":"valid"}\n{broken\n');

    const raw = readProductionFolder(root);
    const state = normalizeProductionReaderState(raw);
    assert.equal(raw.parsed.mediaAttempts.exists, true);
    assert.equal(raw.parsed.mediaAttempts.parsed, false);
    assert.match(raw.parsed.mediaAttempts.errors[0], /^line 2:/);
    assert.ok(raw.blockers.includes('MEDIA_ATTEMPTS_INVALID'));
    assert.ok(state.blockers.includes('MEDIA_ATTEMPTS_INVALID'));
});
