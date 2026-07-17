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
        ...(options.runProcessFn ? { runProcessFn: options.runProcessFn } : {}),
        ...(options.userDataPath ? { userDataPath: options.userDataPath } : {}),
        ...(Object.hasOwn(options, 'env') ? { env: options.env } : {}),
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

test('external media roots accept only a provider enum and persist native non-symlink selections', async (t) => {
    const base = fixture(t);
    const selected = mkdir(path.join(base, 'dst-images'));
    const outside = mkdir(path.join(base, 'outside'));
    const linked = path.join(base, 'linked-results');
    fs.symlinkSync(outside, linked, 'dir');
    const harness = createIpcHarness({
        productionRoot: '',
        productionParentRoot: '',
        recentProductionRoots: [],
        pathProvenanceVersion: 1,
        externalMediaRoots: { dst: '', flow: '', grok: '', replicate: '', bytedance: '' },
        externalMediaRootProvenanceVersion: 1,
    }, {
        dialogResults: [
            { canceled: false, filePaths: [selected] },
            { canceled: false, filePaths: [linked] },
        ],
    });

    await assert.rejects(
        harness.invoke('film-pipeline:select-external-media-root', { provider: 'dst', rootPath: outside }),
        (error) => error.code === 'EXTERNAL_MEDIA_ROOT_SELECTION_INVALID',
    );
    await assert.rejects(
        harness.invoke('film-pipeline:select-external-media-root', { provider: 'unknown' }),
        (error) => error.code === 'EXTERNAL_MEDIA_ROOT_SELECTION_INVALID',
    );
    assert.equal(harness.dialogCalls.length, 0, 'invalid renderer requests never open a native dialog');

    const accepted = await harness.invoke('film-pipeline:select-external-media-root', { provider: 'dst' });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.provider, 'dst');
    assert.equal(harness.getConfig().externalMediaRoots.dst, selected);
    assert.equal(harness.getConfig().externalMediaRoots.flow, '');
    assert.equal(harness.getConfig().externalMediaRootProvenanceVersion, 1);
    assert.equal(harness.dialogCalls[0].dialogOptions.title, '결과 폴더 선택');
    assert.deepEqual(harness.dialogCalls[0].dialogOptions.properties, ['openDirectory']);

    await assert.rejects(
        harness.invoke('film-pipeline:select-external-media-root', { provider: 'flow' }),
        (error) => error.code === 'EXTERNAL_MEDIA_ROOT_SELECTION_INVALID',
    );
    assert.equal(harness.getConfig().externalMediaRoots.flow, '');
});

test('external media root provenance is independently invalidated from production provenance', () => {
    const migrated = sanitizeConfig({
        productionRoot: '/main-owned/production',
        productionParentRoot: '/main-owned',
        recentProductionRoots: ['/main-owned/production'],
        pathProvenanceVersion: 1,
        externalMediaRoots: { dst: '/renderer/dst', flow: '/renderer/flow', grok: '', replicate: '', bytedance: '' },
    });
    assert.equal(migrated.productionRoot, '/main-owned/production');
    assert.deepEqual(migrated.externalMediaRoots, { dst: '', flow: '', grok: '', replicate: '', bytedance: '' });
    assert.equal(migrated.externalMediaRootProvenanceVersion, 1);
});

test('configured roots discover portable DST and all video provider results after relaunch', async (t) => {
    const base = fs.realpathSync.native(fixture(t));
    const roots = Object.fromEntries(['dst', 'flow', 'grok', 'replicate', 'bytedance']
        .map((providerName) => [providerName, mkdir(path.join(base, providerName))]));
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('portable-dst-image'),
    ]);
    const bundleRoot = mkdir(path.join(roots.dst, '20260717_portable_bundle'));
    mkdir(path.join(bundleRoot, 'images'));
    fs.writeFileSync(path.join(bundleRoot, 'manifest.json'), JSON.stringify({
        id: 'portable_bundle_20260717',
        type: 'image_generation',
        status: 'complete',
        profile: 'goldpure369',
        query: 'Portable image result',
        files: { images: 'images/' },
        created_at: '2026-07-17T03:00:00.000Z',
    }));
    fs.writeFileSync(path.join(bundleRoot, 'metadata.json'), JSON.stringify({
        status: 'complete', profile: 'goldpure369', image_count: 1, query: 'Portable image result',
    }));
    fs.writeFileSync(path.join(bundleRoot, 'images', 'image_01.png'), png);

    const mp4 = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom', 'ascii'),
        Buffer.from([0x00, 0x00, 0x02, 0x00]), Buffer.from('isomiso2', 'ascii'), Buffer.alloc(128, 0x5a),
    ]);
    const flowRoot = mkdir(path.join(roots.flow, 'portable_flow'));
    fs.writeFileSync(path.join(flowRoot, 'result_1.mp4'), mp4);
    fs.writeFileSync(path.join(roots.grok, 'portable_grok.mp4'), mp4);
    for (const providerName of ['replicate', 'bytedance']) {
        const resultId = `portable_${providerName}`;
        const resultRoot = mkdir(path.join(roots[providerName], resultId));
        fs.writeFileSync(path.join(resultRoot, 'result.mp4'), mp4);
        fs.writeFileSync(path.join(resultRoot, 'receipt.json'), JSON.stringify({
            schema_version: 'film_pipeline.external_video_result.v1',
            provider: providerName,
            result_id: resultId,
            status: 'succeeded',
            output_file: 'result.mp4',
            output_sha256: sha256(path.join(resultRoot, 'result.mp4')),
            output_size_bytes: mp4.length,
            completed_at: '2026-07-17T03:00:00.000Z',
        }));
    }

    const harness = createIpcHarness({
        externalMediaRoots: roots,
        externalMediaRootProvenanceVersion: 1,
    }, {
        env: {},
        userDataPath: mkdir(path.join(base, 'user-data')),
        runProcessFn: () => ({
            status: 0,
            signal: null,
            stdout: JSON.stringify({
                format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '6' },
                streams: [{ codec_type: 'video', width: 1080, height: 1920 }],
            }),
            stderr: '',
        }),
    });
    const restored = sanitizeConfig(harness.getConfig());
    assert.deepEqual(restored.externalMediaRoots, roots, 'main-owned roots survive config reload');

    const dstWorkspace = await harness.invoke('film-pipeline:get-dst-bundle-import-workspace');
    assert.equal(dstWorkspace.ready, true, JSON.stringify(dstWorkspace));
    assert.equal(dstWorkspace.candidates.length, 1);
    const videoWorkspace = await harness.invoke('film-pipeline:get-video-result-import-workspace');
    assert.deepEqual(new Set(videoWorkspace.candidates.map((candidate) => candidate.provider)),
        new Set(['flow', 'grok', 'replicate', 'bytedance']));
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
