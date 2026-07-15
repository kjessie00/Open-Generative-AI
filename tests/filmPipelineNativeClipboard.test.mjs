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

test('renderer-owned command preview copy is blocked even when the payload claims it is allowed', () => {
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
        copy_allowed: true,
    }, clipboard);

    assert.equal(result.ok, false);
    assert.equal(result.copied, false);
    assert.equal(result.verified, false);
    assert.equal(result.executed, false);
    assert.equal(result.error, 'COMMAND_COPY_REQUIRES_MAIN_OWNED_PLAN');
    assert.equal(clipboardText, '');
});

test('renderer-owned benign-looking command cannot bypass the main-owned copy boundary', () => {
    const clipboard = {
        writeText() {},
        readText() { return 'different'; },
    };
    const result = copyCommandPreview({
        command: 'status',
        args: ['--dry-run'],
        side_effect_type: 'non_consuming_status',
        preview_only: true,
        copy_allowed: true,
    }, clipboard);

    assert.equal(result.ok, false);
    assert.equal(result.copied, false);
    assert.equal(result.verified, false);
    assert.equal(result.executed, false);
    assert.equal(result.error, 'COMMAND_COPY_REQUIRES_MAIN_OWNED_PLAN');
});
