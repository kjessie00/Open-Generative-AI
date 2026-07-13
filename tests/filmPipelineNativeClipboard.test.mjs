import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    copyCommandPreview,
    resolveProductionDialogDefaultPath,
} = require('../electron/lib/filmPipelineProvider');

test('native folder dialog prefers the configured production parent', () => {
    const existing = new Set(['/approved/production', '/approved/production/current']);
    const selected = resolveProductionDialogDefaultPath({
        productionParentRoot: '/approved/production',
        productionRoot: '/approved/production/current',
    }, (candidate) => existing.has(candidate));

    assert.equal(selected, '/approved/production');
});

test('native folder dialog falls back to the current production parent directory', () => {
    const selected = resolveProductionDialogDefaultPath({
        productionParentRoot: '/missing/production',
        productionRoot: '/approved/production/current',
    }, (candidate) => candidate === '/approved/production');

    assert.equal(selected, '/approved/production');
});

test('command preview copy writes and verifies normalized text without execution', () => {
    let clipboardText = '';
    const clipboard = {
        writeText(value) { clipboardText = value; },
        readText() { return clipboardText; },
    };
    const result = copyCommandPreview({
        id: 'blocked-preview',
        command: 'dreamina',
        args: ['submit', '--dry-run'],
        side_effect_type: 'credit_consuming_generation',
    }, clipboard);

    assert.equal(result.ok, true);
    assert.equal(result.copied, true);
    assert.equal(result.verified, true);
    assert.equal(result.executed, false);
    assert.equal(result.length, clipboardText.length);
    assert.equal(result.sha256.length, 64);
});

test('command preview copy fails closed when clipboard verification differs', () => {
    const clipboard = {
        writeText() {},
        readText() { return 'different'; },
    };
    const result = copyCommandPreview({
        command: 'status',
        args: ['--dry-run'],
        side_effect_type: 'non_consuming_status',
    }, clipboard);

    assert.equal(result.ok, false);
    assert.equal(result.copied, false);
    assert.equal(result.verified, false);
    assert.equal(result.executed, false);
    assert.equal(result.error, 'CLIPBOARD_VERIFY_FAILED');
});
