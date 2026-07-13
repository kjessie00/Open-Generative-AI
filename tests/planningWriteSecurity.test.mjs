import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import provider from '../electron/lib/filmPipelineProvider.js';

const { writePlanningFile } = provider;
const MAX_BYTES = 1024 * 1024;

function fixture(t) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-planning-write-'));
    const root = path.join(base, 'production');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root, outside };
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function planningTemps(root) {
    const found = [];
    function walk(current) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.name.startsWith('.film-pipeline-planning-')) found.push(fullPath);
            if (entry.isDirectory() && !entry.isSymbolicLink()) walk(fullPath);
        }
    }
    walk(root);
    return found;
}

function write(root, relativePath, content = '{"safe":true}', options = {}) {
    return writePlanningFile({ rootPath: root, relativePath, content }, {
        configuredRoot: root,
        ...options,
    });
}

function assertBlocked(fn, code) {
    assert.throws(fn, (error) => {
        assert.equal(error.code, code);
        return true;
    });
}

test('planning write allowlist atomically creates and updates the three exact UI outputs', (t) => {
    const { root } = fixture(t);
    const cases = [
        ['docs/ui_integration/intake_snapshot.json', '{"kind":"intake"}'],
        ['storyboard/drafts/clip_001_shot_payload.json', '{"kind":"shot"}'],
        ['image_generation/prompts/clip.001-v2_deepsearch_scene_image.md', '# prompt'],
    ];

    for (const [relativePath, content] of cases) {
        const result = write(root, relativePath, content);
        assert.deepEqual({
            ok: result.ok,
            written: result.written,
            executed: result.executed,
            sideEffectType: result.sideEffectType,
            relativePath: result.relativePath,
            bytes: result.bytes,
        }, {
            ok: true,
            written: true,
            executed: false,
            sideEffectType: 'local_planning_write',
            relativePath,
            bytes: Buffer.byteLength(content, 'utf8'),
        });
        assert.equal(Object.hasOwn(result, 'content'), false, 'write result must not echo planning content');
        assert.equal(fs.readFileSync(path.join(root, relativePath), 'utf8'), content);
        assert.deepEqual(planningTemps(root), []);
    }

    const updatePath = 'storyboard/drafts/clip_001_shot_payload.json';
    const updated = '{"kind":"shot","version":2}';
    write(root, updatePath, updated);
    assert.equal(fs.readFileSync(path.join(root, updatePath), 'utf8'), updated);
    assert.deepEqual(planningTemps(root), []);

    const boundaryPath = 'docs/ui_integration/intake_snapshot.json';
    const boundaryContent = 'x'.repeat(MAX_BYTES);
    write(root, boundaryPath, boundaryContent);
    assert.equal(fs.statSync(path.join(root, boundaryPath)).size, MAX_BYTES);
    assert.deepEqual(planningTemps(root), []);
});

test('planning write rejects arbitrary paths, unsafe ids, invalid content, and mismatched roots before writing', (t) => {
    const { root, outside } = fixture(t);
    const sentinel = path.join(outside, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'outside-sentinel');
    const originalHash = sha256(sentinel);
    const existingBrief = path.join(root, 'brief.md');
    fs.writeFileSync(existingBrief, 'do-not-overwrite');

    const rejectedPaths = [
        '../outside/sentinel.txt',
        path.join(outside, 'absolute.json'),
        'brief.md',
        'reviews/review.md',
        'storyboard/drafts/shot.json',
        'storyboard/drafts/_shot_payload.json',
        'storyboard/drafts/.hidden_shot_payload.json',
        'storyboard/drafts/clip..001_shot_payload.json',
        'storyboard/drafts/clip/001_shot_payload.json',
        'storyboard\\drafts\\clip_001_shot_payload.json',
        'storyboard/drafts/clip_001_shot_payload.md',
        'storyboard/drafts/한글_shot_payload.json',
        `storyboard/drafts/${'a'.repeat(129)}_shot_payload.json`,
        'image_generation/prompts/_deepsearch_scene_image.md',
        'image_generation/prompts/clip_001_deepsearch_scene_image.txt',
        'docs/ui_integration/intake_snapshot.jsonl',
        'docs/ui_integration/intake_snapshot.json\0suffix',
    ];
    for (const relativePath of rejectedPaths) {
        assertBlocked(() => write(root, relativePath), 'PLANNING_PATH_NOT_ALLOWED');
        assert.equal(sha256(sentinel), originalHash);
        assert.deepEqual(planningTemps(root), []);
    }

    assertBlocked(() => writePlanningFile({
        rootPath: outside,
        relativePath: 'docs/ui_integration/intake_snapshot.json',
        content: '{}',
    }, { configuredRoot: root }), 'PLANNING_ROOT_MISMATCH');
    assertBlocked(() => write(root, 'docs/ui_integration/intake_snapshot.json', Buffer.from('{}')), 'PLANNING_CONTENT_INVALID');
    assertBlocked(() => write(root, 'docs/ui_integration/intake_snapshot.json', 'before\0after'), 'PLANNING_CONTENT_INVALID');
    assertBlocked(() => write(root, 'docs/ui_integration/intake_snapshot.json', '\uD800'), 'PLANNING_CONTENT_INVALID');
    assertBlocked(
        () => write(root, 'docs/ui_integration/intake_snapshot.json', 'x'.repeat(MAX_BYTES + 1)),
        'PLANNING_CONTENT_TOO_LARGE',
    );
    assert.equal(fs.readFileSync(existingBrief, 'utf8'), 'do-not-overwrite');
    assert.equal(sha256(sentinel), originalHash);
    assert.deepEqual(planningTemps(root), []);
    assert.equal(fs.existsSync(path.join(root, 'docs')), false, 'rejected content must not create parent directories');
});

test('planning write rejects stable root, parent, and leaf symlink escapes without changing the outside sentinel', (t) => {
    const { base, root, outside } = fixture(t);
    const sentinel = path.join(outside, 'sentinel.json');
    fs.writeFileSync(sentinel, '{"outside":true}');
    const originalHash = sha256(sentinel);

    const rootLink = path.join(base, 'production-link');
    fs.symlinkSync(root, rootLink, 'dir');
    assertBlocked(() => write(rootLink, 'docs/ui_integration/intake_snapshot.json'), 'PLANNING_ROOT_INVALID');

    fs.symlinkSync(outside, path.join(root, 'storyboard'), 'dir');
    assertBlocked(
        () => write(root, 'storyboard/drafts/clip_001_shot_payload.json'),
        'PLANNING_PARENT_UNSAFE',
    );
    fs.unlinkSync(path.join(root, 'storyboard'));

    const promptDir = path.join(root, 'image_generation', 'prompts');
    fs.mkdirSync(promptDir, { recursive: true });
    fs.symlinkSync(sentinel, path.join(promptDir, 'clip_001_deepsearch_scene_image.md'));
    assertBlocked(
        () => write(root, 'image_generation/prompts/clip_001_deepsearch_scene_image.md', '# overwrite'),
        'PLANNING_TARGET_UNSAFE',
    );

    assert.equal(sha256(sentinel), originalHash);
    assert.deepEqual(planningTemps(root), []);
});

test('planning write rejects non-directory parents and non-regular targets', (t) => {
    const { root, outside } = fixture(t);
    const sentinel = path.join(outside, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'outside-sentinel');
    const originalHash = sha256(sentinel);
    fs.writeFileSync(path.join(root, 'storyboard'), 'not-a-directory');
    assertBlocked(
        () => write(root, 'storyboard/drafts/clip_001_shot_payload.json'),
        'PLANNING_PARENT_UNSAFE',
    );

    const target = path.join(root, 'docs', 'ui_integration', 'intake_snapshot.json');
    fs.mkdirSync(target, { recursive: true });
    assertBlocked(
        () => write(root, 'docs/ui_integration/intake_snapshot.json'),
        'PLANNING_TARGET_UNSAFE',
    );
    assert.equal(sha256(sentinel), originalHash);
    assert.deepEqual(planningTemps(root), []);
});

test('planning write removes same-directory temp files when atomic rename fails', (t) => {
    const { root, outside } = fixture(t);
    const sentinel = path.join(outside, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'outside-sentinel');
    const originalHash = sha256(sentinel);
    const relativePath = 'storyboard/drafts/clip_001_shot_payload.json';
    assert.throws(
        () => write(root, relativePath, '{"draft":true}', {
            renameFile() {
                const error = new Error('injected rename failure');
                error.code = 'EIO';
                throw error;
            },
        }),
        /injected rename failure/,
    );
    assert.equal(fs.existsSync(path.join(root, relativePath)), false);
    assert.equal(sha256(sentinel), originalHash);
    assert.deepEqual(planningTemps(root), []);
});
