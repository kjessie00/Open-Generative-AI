import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import provider from '../electron/lib/filmPipelineProvider.js';

const {
    getHarnessContractStatus,
    HARNESS_CONTRACT_ALLOWLIST,
    HAPPY_VIDEO_FACTORY_ROOT,
    register,
} = provider;

const markerContent = Object.freeze({
    pack_builder: '#!/usr/bin/env python3\n--brief --script --production-id --output-root --target-generator\n',
    pack_validator: '#!/usr/bin/env python3\nvalidate_pipeline_pack production_dir --json\n',
    room_plan_builder: '#!/usr/bin/env python3\nbuild_drama_selection_plan --package-dir --ledger-output\n',
    room_verifier: '#!/usr/bin/env python3\nrun_drama_room_pipeline_verification selected_takes_contract_matches_edit_render_consumer\n',
    canonical_pack_contract: 'PACK_CONTRACT_VERSION\nactual_generation_submitted\ncanonical_production_id_mismatch\n',
});

function fixture(t) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-hvf-contract-'));
    const root = path.join(base, 'happyVideoFactory');
    fs.mkdirSync(root);
    for (const contract of HARNESS_CONTRACT_ALLOWLIST) {
        const filePath = path.join(root, contract.relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, markerContent[contract.id]);
    }
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root };
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fixtureHashes(root) {
    return Object.fromEntries(HARNESS_CONTRACT_ALLOWLIST.map((contract) => [
        contract.relativePath,
        sha256(path.join(root, contract.relativePath)),
    ]));
}

test('fixed allowlist returns only bounded metadata and exact SHA-256 without changing source files', (t) => {
    const { root } = fixture(t);
    const before = fixtureHashes(root);
    const status = getHarnessContractStatus({ harnessRoot: root });

    assert.equal(HAPPY_VIDEO_FACTORY_ROOT, '/Users/jessiek/StudioProjects/happyVideoFactory');
    assert.equal(status.ok, true);
    assert.equal(status.readiness, 'available');
    assert.equal(status.ready, true);
    assert.deepEqual(status.entries.map((entry) => entry.relativePath), HARNESS_CONTRACT_ALLOWLIST.map((entry) => entry.relativePath));
    assert.equal(status.entries.length, 5);
    for (const entry of status.entries) {
        assert.equal(entry.ready, true);
        assert.equal(entry.sha256, before[entry.relativePath]);
        assert.equal(entry.size, Buffer.byteLength(markerContent[entry.id]));
        assert.equal(Object.hasOwn(entry, 'content'), false);
        assert.equal(Object.hasOwn(entry, 'markers'), false);
        assert.equal(entry.liveSideEffect, false);
    }
    assert.deepEqual(fixtureHashes(root), before);
    assert.equal(JSON.stringify(status).includes('--target-generator'), false, 'source markers must not be returned');
});

test('missing, malformed, oversized, and symlinked entries fail closed while the remaining allowlist stays partial', (t) => {
    const { base, root } = fixture(t);
    const missing = HARNESS_CONTRACT_ALLOWLIST[0];
    fs.unlinkSync(path.join(root, missing.relativePath));
    let status = getHarnessContractStatus({ harnessRoot: root });
    assert.equal(status.readiness, 'partial');
    assert.equal(status.entries.find((entry) => entry.id === missing.id).reason, 'missing');

    fs.writeFileSync(path.join(root, missing.relativePath), 'malformed');
    status = getHarnessContractStatus({ harnessRoot: root });
    assert.equal(status.entries.find((entry) => entry.id === missing.id).reason, 'contract_markers_missing');

    fs.writeFileSync(path.join(root, missing.relativePath), Buffer.alloc(2 * 1024 * 1024 + 1));
    status = getHarnessContractStatus({ harnessRoot: root });
    assert.equal(status.entries.find((entry) => entry.id === missing.id).reason, 'file_too_large');

    fs.unlinkSync(path.join(root, missing.relativePath));
    const outside = path.join(base, 'outside.py');
    fs.writeFileSync(outside, markerContent[missing.id]);
    fs.symlinkSync(outside, path.join(root, missing.relativePath));
    status = getHarnessContractStatus({ harnessRoot: root });
    assert.equal(status.entries.find((entry) => entry.id === missing.id).reason, 'not_regular_file');
    assert.equal(status.entries.find((entry) => entry.id === missing.id).sha256, '');
});

test('symlinked allowlist parent component is rejected even when the leaf itself is regular', (t) => {
    const { base, root } = fixture(t);
    const outsideScripts = path.join(base, 'outside-scripts');
    fs.renameSync(path.join(root, 'scripts'), outsideScripts);
    fs.symlinkSync(outsideScripts, path.join(root, 'scripts'), 'dir');

    const status = getHarnessContractStatus({ harnessRoot: root });
    assert.equal(status.readiness, 'partial');
    for (const entry of status.entries.filter((candidate) => candidate.relativePath.startsWith('scripts/'))) {
        assert.equal(entry.ready, false);
        assert.equal(entry.reason, 'parent_not_directory');
        assert.equal(entry.sha256, '');
    }
    assert.equal(status.entries.find((entry) => entry.id === 'canonical_pack_contract').ready, true);
});

test('missing and symlink roots are blocked without scanning alternate locations', (t) => {
    const { base, root } = fixture(t);
    const missing = getHarnessContractStatus({ harnessRoot: path.join(base, 'missing') });
    assert.equal(missing.readiness, 'blocked');
    assert.equal(missing.reason, 'root_missing');
    assert.ok(missing.entries.every((entry) => entry.ready === false));

    const rootLink = path.join(base, 'happyVideoFactory-link');
    fs.symlinkSync(root, rootLink, 'dir');
    const linked = getHarnessContractStatus({ harnessRoot: rootLink });
    assert.equal(linked.readiness, 'blocked');
    assert.equal(linked.reason, 'root_not_directory');

    const malformed = getHarnessContractStatus({ harnessRoot: { renderer: 'injected' } });
    assert.equal(malformed.readiness, 'blocked');
    assert.equal(malformed.reason, 'root_invalid');
});

test('registered handler accepts no renderer argument and ignores all renderer path injection surfaces', async (t) => {
    const { root } = fixture(t);
    const handlers = new Map();
    register({ handle(channel, handler) { handlers.set(channel, handler); } }, { harnessRoot: root });
    const handler = handlers.get('film-pipeline:get-harness-contract-status');
    assert.ok(handler);

    const status = await handler({});
    assert.equal(status.rootPath, root);
    assert.equal(status.readiness, 'available');
    for (const injected of [root, { rootPath: root }, null]) {
        assert.throws(() => handler({}, injected), (error) => error.code === 'RENDERER_PATH_ARGUMENT_FORBIDDEN');
    }
});
