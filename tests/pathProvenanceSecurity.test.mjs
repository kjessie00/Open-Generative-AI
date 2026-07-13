import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import provider from '../electron/lib/filmPipelineProvider.js';

const { register, sanitizeConfig } = provider;

function fixture(t) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-path-provenance-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return base;
}

function mkdir(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true });
    return directoryPath;
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createIpcHarness(initialConfig, options = {}) {
    let config = sanitizeConfig(initialConfig);
    const handlers = new Map();
    const dialogCalls = [];
    const dialogResults = [...(options.dialogResults || [])];
    const ipcApi = {
        handle(channel, handler) {
            assert.equal(handlers.has(channel), false, `duplicate handler: ${channel}`);
            handlers.set(channel, handler);
        },
    };
    const dependencies = {
        readConfigFn: () => structuredClone(config),
        writeConfigFn: (nextConfig) => {
            config = sanitizeConfig(nextConfig);
            return structuredClone(config);
        },
        dialogApi: {
            async showOpenDialog(window, dialogOptions) {
                dialogCalls.push({ window, dialogOptions });
                return dialogResults.shift() || { canceled: true, filePaths: [] };
            },
        },
        mainWindow: null,
        readProductionFolderFn: options.readProductionFolderFn || ((rootPath) => ({ rootPath })),
    };
    register(ipcApi, dependencies);
    return {
        handlers,
        dialogCalls,
        getConfig: () => structuredClone(config),
        invoke(channel, payload) {
            const handler = handlers.get(channel);
            assert.ok(handler, `missing handler: ${channel}`);
            return handler({}, payload);
        },
    };
}

test('legacy renderer-owned config paths are invalidated and public IPC has no config mutation handler', async () => {
    const migrated = sanitizeConfig({
        productionRoot: '/renderer/chosen/root',
        productionParentRoot: '/renderer/chosen/parent',
        recentProductionRoots: ['/renderer/chosen/root'],
        dryRunMode: false,
    });
    assert.equal(migrated.productionRoot, '');
    assert.equal(migrated.productionParentRoot, '');
    assert.deepEqual(migrated.recentProductionRoots, []);
    assert.equal(migrated.pathProvenanceVersion, 1);
    assert.equal(migrated.allowSafeCommandExecution, false);

    const harness = createIpcHarness(migrated);
    assert.equal(harness.handlers.has('film-pipeline:set-config'), false);
    assert.deepEqual(
        [...harness.handlers.keys()].filter((channel) => /config/.test(channel)),
        ['film-pipeline:get-config'],
    );
    const returned = await harness.invoke('film-pipeline:get-config');
    assert.equal(returned.productionRoot, '');
    assert.equal(returned.productionParentRoot, '');
});

test('native production and parent modes reject injected paths and persist only dialog results', async (t) => {
    const base = fixture(t);
    const originalParent = mkdir(path.join(base, 'original-parent'));
    const originalRoot = mkdir(path.join(originalParent, 'original-production'));
    const nativeRoot = mkdir(path.join(base, 'native-production'));
    const nativeParent = mkdir(path.join(base, 'native-parent'));
    const injected = mkdir(path.join(base, 'renderer-injected'));
    const harness = createIpcHarness({
        productionRoot: originalRoot,
        productionParentRoot: originalParent,
        recentProductionRoots: [originalRoot],
        pathProvenanceVersion: 1,
    }, {
        dialogResults: [
            { canceled: false, filePaths: [nativeRoot] },
            { canceled: false, filePaths: [nativeParent] },
        ],
    });

    await assert.rejects(
        harness.invoke('film-pipeline:select-production-root', { mode: 'production', rootPath: injected }),
        (error) => error.code === 'PATH_SELECTION_INVALID',
    );
    assert.equal(harness.dialogCalls.length, 0, 'path injection must fail before native dialog access');
    assert.equal(harness.getConfig().productionRoot, originalRoot);

    const selectedProduction = await harness.invoke('film-pipeline:select-production-root', { mode: 'production' });
    assert.equal(selectedProduction.rootPath, nativeRoot);
    assert.equal(selectedProduction.config.productionRoot, nativeRoot);
    assert.equal(selectedProduction.config.productionParentRoot, originalParent);
    assert.equal(harness.dialogCalls.length, 1);
    assert.deepEqual(harness.dialogCalls[0].dialogOptions.properties, ['openDirectory']);

    const selectedParent = await harness.invoke('film-pipeline:select-production-root', { mode: 'parent' });
    assert.equal(selectedParent.rootPath, nativeParent);
    assert.equal(selectedParent.config.productionParentRoot, nativeParent);
    assert.equal(selectedParent.config.productionRoot, nativeRoot, 'parent selection must not overwrite production root');
    assert.equal(harness.dialogCalls.length, 2);
});

test('configured immediate real child is the only renderer-addressable production and binds write/read IPC', async (t) => {
    const base = fixture(t);
    const parent = mkdir(path.join(base, 'productions'));
    const goodChild = mkdir(path.join(parent, 'good-child'));
    const grandchild = mkdir(path.join(goodChild, 'nested-grandchild'));
    const sibling = mkdir(path.join(base, 'sibling'));
    const outside = mkdir(path.join(base, 'outside'));
    const sentinel = path.join(outside, 'sentinel.txt');
    fs.writeFileSync(sentinel, 'outside-sentinel');
    const sentinelHash = sha256(sentinel);
    const symlinkChild = path.join(parent, 'symlink-child');
    fs.symlinkSync(outside, symlinkChild, 'dir');
    const nonDirectory = path.join(parent, 'not-a-directory');
    fs.writeFileSync(nonDirectory, 'file');
    const hiddenChild = mkdir(path.join(parent, '.hidden-child'));
    const missing = path.join(parent, 'missing-child');
    fs.writeFileSync(path.join(goodChild, 'ledger.jsonl'), '{"ok":true}\n');
    fs.symlinkSync(sentinel, path.join(goodChild, 'outside-link.jsonl'));

    const harness = createIpcHarness({
        productionRoot: '',
        productionParentRoot: parent,
        recentProductionRoots: [],
        pathProvenanceVersion: 1,
    }, {
        readProductionFolderFn(rootPath) {
            assert.equal(rootPath, goodChild);
            return { rootPath, layout: 'temp-fixture' };
        },
    });

    const activated = await harness.invoke('film-pipeline:select-production-root', {
        mode: 'child',
        rootPath: goodChild,
    });
    assert.equal(activated.config.productionRoot, goodChild);
    assert.equal(activated.config.productionParentRoot, parent);

    const writeResult = await harness.invoke('film-pipeline:write-planning-file', {
        rootPath: goodChild,
        relativePath: 'storyboard/drafts/clip_001_shot_payload.json',
        content: '{"safe":true}',
    });
    assert.equal(writeResult.ok, true);
    assert.equal(writeResult.executed, false);
    assert.equal(
        fs.readFileSync(path.join(goodChild, 'storyboard/drafts/clip_001_shot_payload.json'), 'utf8'),
        '{"safe":true}',
    );

    const children = await harness.invoke('film-pipeline:list-production-children');
    assert.equal(children.rootPath, parent);
    assert.ok(children.entries.some((entry) => entry.path === goodChild));
    assert.equal(children.entries.some((entry) => entry.path === symlinkChild), false);
    assert.equal(children.entries.some((entry) => entry.path === hiddenChild), false);
    assert.deepEqual(await harness.invoke('film-pipeline:read-production-state'), {
        ok: true,
        rootPath: goodChild,
        state: { rootPath: goodChild, layout: 'temp-fixture' },
    });
    assert.equal((await harness.invoke('film-pipeline:list-assets')).rootPath, goodChild);
    const jsonl = await harness.invoke('film-pipeline:read-jsonl', { relativePath: 'ledger.jsonl' });
    assert.equal(jsonl.rootPath, goodChild);
    assert.equal(jsonl.records.length, 1);
    assert.throws(
        () => harness.invoke('film-pipeline:read-jsonl', { relativePath: 'outside-link.jsonl' }),
        (error) => error.code === 'READ_PATH_SYMLINK',
    );

    const blocked = [
        [sibling, 'PRODUCTION_CHILD_NOT_IMMEDIATE'],
        [grandchild, 'PRODUCTION_CHILD_NOT_IMMEDIATE'],
        [symlinkChild, 'PRODUCTION_CHILD_INVALID'],
        [nonDirectory, 'PRODUCTION_CHILD_INVALID'],
        [missing, 'PRODUCTION_CHILD_INVALID'],
        [hiddenChild, 'PRODUCTION_CHILD_NOT_IMMEDIATE'],
    ];
    for (const [rootPath, code] of blocked) {
        await assert.rejects(
            harness.invoke('film-pipeline:select-production-root', { mode: 'child', rootPath }),
            (error) => error.code === code,
        );
        assert.equal(harness.getConfig().productionRoot, goodChild);
        assert.equal(sha256(sentinel), sentinelHash);
    }

    assert.throws(
        () => harness.invoke('film-pipeline:write-planning-file', {
            rootPath: outside,
            relativePath: 'docs/ui_integration/intake_snapshot.json',
            content: 'redirect',
        }),
        (error) => error.code === 'PLANNING_ROOT_MISMATCH',
    );
    assert.throws(
        () => harness.invoke('film-pipeline:read-jsonl', { rootPath: outside, relativePath: 'sentinel.txt' }),
        (error) => error.code === 'READ_ROOT_MISMATCH',
    );
    for (const channel of [
        'film-pipeline:list-production-children',
        'film-pipeline:read-production-state',
        'film-pipeline:list-assets',
    ]) {
        assert.throws(
            () => harness.invoke(channel, outside),
            (error) => error.code === 'RENDERER_PATH_ARGUMENT_FORBIDDEN',
        );
    }
    assert.equal(sha256(sentinel), sentinelHash);
});
