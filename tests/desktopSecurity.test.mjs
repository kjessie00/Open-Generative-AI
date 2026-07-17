import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { installNavigationPolicy } = require('../electron/lib/navigationPolicy');
const { createMainWindow } = require('../electron/lib/createMainWindow');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function source(relativePath) {
    return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

function captureNavigationPolicy() {
    let popupHandler;
    let navigationHandler;
    const webContents = {
        setWindowOpenHandler(handler) { popupHandler = handler; },
        on(event, handler) {
            assert.equal(event, 'will-navigate');
            navigationHandler = handler;
        },
    };

    installNavigationPolicy(webContents);
    return { popupHandler, navigationHandler };
}

test('Electron denies every popup and navigation scheme by default', () => {
    const { popupHandler, navigationHandler } = captureNavigationPolicy();

    for (const url of [
        'javascript:alert(1)',
        'file:///etc/passwd',
        'http://unknown.example/',
        'https://unknown.example/',
        'custom-protocol://external/action',
    ]) {
        assert.deepEqual(popupHandler({ url }), { action: 'deny' });

        let prevented = false;
        navigationHandler({ preventDefault() { prevented = true; } }, url);
        assert.equal(prevented, true, `will-navigate must deny ${url}`);
    }
});

test('desktop window installs the policy on its own webContents before loading', () => {
    const calls = [];
    const webContents = {
        on(event) { calls.push(`webContents:${event}`); },
    };
    let browserOptions;

    class FakeBrowserWindow {
        constructor(options) {
            browserOptions = options;
            this.webContents = webContents;
        }

        loadFile(file) {
            calls.push(`load:${file}`);
            return Promise.resolve();
        }

        once(event) { calls.push(`window:${event}`); }
        show() { calls.push('window:show'); }
    }

    const window = createMainWindow({
        BrowserWindow: FakeBrowserWindow,
        installNavigationPolicy(target) {
            assert.equal(target, webContents);
            calls.push('policy');
        },
        pathModule: path,
        dirname: '/repo/electron',
        platform: 'linux',
    });

    assert.equal(window.webContents, webContents);
    assert.equal(calls[0], 'policy', 'policy must precede renderer loading');
    assert.equal(calls[1], 'load:/repo/dist/index.html');
    assert.equal(browserOptions.webPreferences.contextIsolation, true);
    assert.equal(browserOptions.webPreferences.nodeIntegration, false);
    assert.equal(browserOptions.webPreferences.sandbox, true);
    assert.equal(browserOptions.webPreferences.preload, '/repo/electron/preload.js');
});

test('Electron web preferences preserve the isolated preload boundary', async () => {
    const main = await source('electron/main.js');
    const windowFactory = await source('electron/lib/createMainWindow.js');
    const preload = await source('electron/preload.js');

    assert.match(main, /createMainWindow\(\{[\s\S]*installNavigationPolicy/);
    assert.match(windowFactory, /contextIsolation:\s*true/);
    assert.match(windowFactory, /nodeIntegration:\s*false/);
    assert.match(windowFactory, /sandbox:\s*true/);
    assert.doesNotMatch(`${main}\n${windowFactory}`, /webSecurity:\s*false/);
    assert.doesNotMatch(`${main}\n${windowFactory}`, /shell\.openExternal/);
    assert.match(preload, /exposeInMainWorld\(['"]filmPipeline['"]/);
    assert.match(preload, /copyCommandPreview:[\s\S]*film-pipeline:copy-command-preview/);
    assert.match(preload, /copyNewProjectBuildCommand:[\s\S]*film-pipeline:copy-new-project-build-command/);
    assert.match(preload, /getG3ReviewWorkspace:[\s\S]*film-pipeline:get-g3-review-workspace/);
    assert.match(preload, /exportG3ReviewPacket:[\s\S]*film-pipeline:export-g3-review-packet/);
    assert.match(preload, /planG3ProductionPromotion:[\s\S]*film-pipeline:plan-g3-production-promotion/);
    assert.match(preload, /promoteG3ProductionSelection:[\s\S]*film-pipeline:promote-g3-production-selection/);
    assert.match(preload, /getNewProjectExecutionState:[\s\S]*film-pipeline:get-new-project-execution-state/);
    assert.match(preload, /stageNewProjectExecutionHandoff:[\s\S]*film-pipeline:stage-new-project-execution-handoff/);
    assert.doesNotMatch(preload, /publishExecutionReceipt|inspectExecutionHandoff|prepareNewProjectExecution|readNewProjectImageExecutionReference|reference_files|referencesManifest/,
        'renderer may read or stage the pathless handoff but must not inspect, publish, resolve, or receive reference files');
    assert.doesNotMatch(preload, /film-pipeline:set-config|\bsetConfig\b/);
    assert.doesNotMatch(preload, /g3[^'"\n]*(?:generation|upload|ledger-write|run-command)/i);
});

test('final preview scheme is privileged before ready and its handler plus IPC precede window loading', async () => {
    const main = await source('electron/main.js');
    const provider = await source('electron/lib/filmPipelineProvider.js');
    const html = await source('index.html');
    const preload = await source('electron/preload.js');
    const privilege = main.indexOf('registerSchemePrivileges(protocol)');
    const ready = main.indexOf('app.whenReady()');
    const handler = main.indexOf('finalRenderPreviewService.register(protocol)');
    const ipc = main.indexOf('registerFilmPipeline(undefined, { finalRenderPreviewService })');
    const window = main.indexOf('createWindow();', ready);
    assert.ok(privilege >= 0 && privilege < ready);
    assert.ok(handler > ready && handler < window);
    assert.ok(ipc > handler && ipc < window);
    assert.match(html, /media-src[^;]*film-preview:/);
    assert.match(html, /connect-src 'none'/);
    assert.doesNotMatch(preload, /film-preview|finalRenderPreview/);
    for (const channel of [
        'get-new-project-final-render',
        'execute-new-project-final-render',
        'get-new-project-final-render-preview',
    ]) {
        assert.match(provider, new RegExp(`ipcApi\\.handle\\('film-pipeline:${channel}'[\\s\\S]{0,180}const lease = finalRenderLease\\(event, options\\)`));
    }
});

function assertDefaultElectronEntryBoundary(main, preload) {
    assert.doesNotMatch(main, /(?:require\s*\(\s*['"]\.\/lib\/|register)(?:localInference|wan2gpProvider)/i);
    assert.doesNotMatch(main, /register(?:LocalInference|Wan2gp)\s*\(/i);
    assert.deepEqual(
        [...preload.matchAll(/exposeInMainWorld\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
        ['filmPipeline'],
    );
    assert.doesNotMatch(preload, /local-ai:|wan2gp:|\blocalAI\b/i);
    for (const match of preload.matchAll(/ipcRenderer\.(?:invoke|on|removeListener)\(\s*['"]([^'"]+)['"]/g)) {
        assert.match(match[1], /^film-pipeline:/);
    }
}

test('default Electron entrypoints expose and register only the cinematic pipeline', async () => {
    const main = await source('electron/main.js');
    const preload = await source('electron/preload.js');
    assertDefaultElectronEntryBoundary(main, preload);

    assert.throws(
        () => assertDefaultElectronEntryBoundary(`${main}\nrequire('./lib/localInference').register();`, preload),
        /localInference/i,
        'active provider imports must fail the boundary regression',
    );
    assert.throws(
        () => assertDefaultElectronEntryBoundary(main, `${preload}\ncontextBridge.exposeInMainWorld('localAI', {});`),
        /filmPipeline|localAI/i,
        'a second renderer bridge must fail the boundary regression',
    );
    assert.throws(
        () => assertDefaultElectronEntryBoundary(main, preload.replace('film-pipeline:get-config', 'wan2gp:probe')),
        /wan2gp/i,
        'a legacy IPC channel must fail the boundary regression',
    );
});

test('preload behavior presents the exact filmPipeline bridge without invoking IPC on load', async () => {
    const preload = await source('electron/preload.js');
    const exposed = new Map();
    const invocations = [];
    const eventCalls = [];
    const ipcRenderer = {
        invoke(channel, ...args) {
            invocations.push([channel, args]);
            return Promise.resolve({ channel, args });
        },
        on(channel, listener) {
            eventCalls.push(['on', channel, listener]);
        },
        removeListener(channel, listener) {
            eventCalls.push(['removeListener', channel, listener]);
        },
    };
    const contextBridge = {
        exposeInMainWorld(name, bridge) {
            exposed.set(name, bridge);
        },
    };

    runInNewContext(preload, {
        require(specifier) {
            assert.equal(specifier, 'electron');
            return { contextBridge, ipcRenderer };
        },
    }, { filename: 'electron/preload.js' });

    assert.deepEqual([...exposed.keys()], ['filmPipeline']);
    assert.equal(invocations.length, 0, 'preload initialization must not invoke any IPC channel');
    const bridge = exposed.get('filmPipeline');
    assert.deepEqual(Object.keys(bridge).sort(), [
        'confirmDstBundleImport',
        'confirmVideoResultImport',
        'connectNewProjectImageResult',
        'connectNewProjectVideoResult',
        'copyCommandPreview',
        'copyNewProjectBuildCommand',
        'decideDesignAgentSuggestion',
        'decideImagePromptAgentSuggestion',
        'decidePlanningAgentSuggestion',
        'decideVideoPromptAgentSuggestion',
        'enqueueDesignAgentRequest',
        'enqueueImagePromptAgentRequest',
        'enqueuePlanningAgentRequest',
        'enqueueVideoPromptAgentRequest',
        'executeFinishingRun',
        'executeNewProjectFinalRender',
        'exportG3ReviewPacket',
        'getConfig',
        'getDstBundleImportWorkspace',
        'getFinishingWorkspace',
        'getG3ReviewWorkspace',
        'getHarnessContractStatus',
        'getMediaRetryPlan',
        'getNewProjectClipSelection',
        'getNewProjectDesignState',
        'getNewProjectDraftState',
        'getNewProjectExecutionState',
        'getNewProjectFinalRender',
        'getNewProjectFinalRenderPreview',
        'getNewProjectFinalStitch',
        'getNewProjectImagePlan',
        'getNewProjectImageResultPreview',
        'getNewProjectImageResultWorkspace',
        'getNewProjectVideoPlan',
        'getNewProjectVideoResultPreview',
        'getNewProjectVideoResultWorkspace',
        'getVideoResultImportWorkspace',
        'listAssets',
        'listProductionChildren',
        'loadDstBundleImportPreview',
        'loadG3CandidatePreview',
        'loadVideoResultImportPreview',
        'onProgress',
        'planDstBundleImport',
        'planFinishingRun',
        'planG3ProductionPromotion',
        'planNewProjectFinalRender',
        'planVideoResultImport',
        'prepareNewProjectImagePlan',
        'prepareNewProjectVideoPlan',
        'previewCommand',
        'promoteG3ProductionSelection',
        'readJsonl',
        'readProductionState',
        'runDesignAgentRequest',
        'runImagePromptAgentRequest',
        'runPlanningAgentRequest',
        'runSafeCommand',
        'runVideoPromptAgentRequest',
        'saveG3ReviewDraft',
        'saveNewProjectClipSelection',
        'saveNewProjectDesignBoard',
        'saveNewProjectDraft',
        'saveNewProjectFinalReviewDecision',
        'saveNewProjectImagePlan',
        'saveNewProjectImageRetrySelection',
        'saveNewProjectImageReviewDecision',
        'saveNewProjectVideoPlan',
        'saveNewProjectVideoRetrySelection',
        'saveNewProjectVideoReviewDecision',
        'selectExternalMediaRoot',
        'selectProductionRoot',
        'stageNewProjectExecutionHandoff',
        'stageNewProjectFinalStitch',
        'writePlanningFile',
    ]);

    await bridge.getConfig();
    await bridge.selectExternalMediaRoot({ provider: 'dst' });
    await bridge.getHarnessContractStatus();
    await bridge.getMediaRetryPlan();
    await bridge.getDstBundleImportWorkspace();
    await bridge.loadDstBundleImportPreview({ candidateToken: 'opaque' });
    await bridge.planDstBundleImport({ candidateToken: 'opaque', retryMediaId: 'media_01' });
    await bridge.confirmDstBundleImport({ planToken: 'opaque', confirmed: true });
    await bridge.getVideoResultImportWorkspace();
    await bridge.loadVideoResultImportPreview({ candidateToken: 'video-opaque' });
    await bridge.planVideoResultImport({ candidateToken: 'video-opaque', retryMediaId: 'video_01' });
    await bridge.confirmVideoResultImport({ planToken: 'video-plan', confirmed: true });
    await bridge.getNewProjectDraftState();
    await bridge.saveNewProjectDraft({ production_id: 'test-project' });
    await bridge.enqueuePlanningAgentRequest({
        stage: 'brief', instruction: '기획을 검토해 주세요.', expected_revision_sha256: 'a'.repeat(64),
    });
    await bridge.runPlanningAgentRequest({ stage: 'brief' });
    await bridge.decidePlanningAgentSuggestion({
        suggestion_token: `suggestion_${'a'.repeat(64)}`,
        action: 'hold',
        expected_revision_sha256: 'a'.repeat(64),
    });
    await bridge.getNewProjectDesignState();
    await bridge.saveNewProjectDesignBoard({ board: {}, expected_design_revision_sha256: 'a'.repeat(64) });
    await bridge.enqueueDesignAgentRequest({ instruction: '설계해 주세요.', expected_design_revision_sha256: 'a'.repeat(64) });
    await bridge.runDesignAgentRequest();
    await bridge.decideDesignAgentSuggestion({
        suggestion_token: `suggestion_${'a'.repeat(64)}`, action: 'hold', expected_design_revision_sha256: 'a'.repeat(64),
    });
    await bridge.getNewProjectImagePlan();
    await bridge.saveNewProjectImagePlan({ tasks: [] });
    await bridge.prepareNewProjectImagePlan({ expected_image_plan_revision_sha256: 'a'.repeat(64) });
    await bridge.getNewProjectImageResultWorkspace();
    await bridge.connectNewProjectImageResult({ task_token: `task_${'a'.repeat(64)}` });
    await bridge.getNewProjectImageResultPreview({ result_token: `result_${'a'.repeat(64)}` });
    await bridge.saveNewProjectImageRetrySelection({ task_tokens: [] });
    await bridge.getNewProjectVideoPlan();
    await bridge.saveNewProjectVideoPlan({ tasks: [] });
    await bridge.prepareNewProjectVideoPlan({ expected_video_plan_revision_sha256: 'a'.repeat(64) });
    await bridge.getNewProjectVideoResultWorkspace();
    await bridge.connectNewProjectVideoResult({ task_token: `task_${'a'.repeat(64)}` });
    await bridge.getNewProjectVideoResultPreview({ result_token: `result_${'a'.repeat(64)}` });
    await bridge.saveNewProjectVideoRetrySelection({ task_tokens: [] });
    await bridge.saveNewProjectImageReviewDecision({ task_token: 'opaque', decision: 'use' });
    await bridge.saveNewProjectVideoReviewDecision({ task_token: 'opaque', decision: 'retry' });
    await bridge.getNewProjectClipSelection();
    await bridge.saveNewProjectClipSelection({ selections: [] });
    await bridge.getNewProjectFinalStitch();
    await bridge.stageNewProjectFinalStitch({ expected_revision: 'handoff_opaque' });
    await bridge.getNewProjectFinalRender();
    await bridge.planNewProjectFinalRender();
    await bridge.executeNewProjectFinalRender({ planToken: 'opaque', confirmed: true, projectId: 'test-project' });
    await bridge.getNewProjectFinalRenderPreview();
    await bridge.saveNewProjectFinalReviewDecision({ decision: 'use', expected_review_version: 'a'.repeat(64) });
    await bridge.getNewProjectExecutionState();
    await bridge.copyNewProjectBuildCommand();
    assert.equal(bridge.setConfig, undefined, 'renderer must not receive a public config mutation method');
    await bridge.selectProductionRoot({ mode: 'production' });
    await bridge.listProductionChildren();
    await bridge.readProductionState();
    await bridge.writePlanningFile({});
    await bridge.listAssets();
    await bridge.readJsonl({});
    await bridge.previewCommand({});
    await bridge.copyCommandPreview({});
    await bridge.runSafeCommand({});
    await bridge.getG3ReviewWorkspace();
    await bridge.loadG3CandidatePreview({ candidateToken: 'opaque' });
    await bridge.saveG3ReviewDraft({ draft_id: 'draft' });
    await bridge.exportG3ReviewPacket({ draft_id: 'draft' });
    await bridge.planG3ProductionPromotion();
    await bridge.promoteG3ProductionSelection({ planToken: 'opaque', projectIdConfirmation: 'project_01', confirmed: true });
    await bridge.getFinishingWorkspace();
    await bridge.planFinishingRun();
    await bridge.executeFinishingRun({ planToken: 'opaque', projectId: 'project_01', confirmed: true });
    assert.deepEqual(
        invocations.map(([channel]) => channel),
        [
            'film-pipeline:get-config',
            'film-pipeline:select-external-media-root',
            'film-pipeline:get-harness-contract-status',
            'film-pipeline:get-media-retry-plan',
            'film-pipeline:get-dst-bundle-import-workspace',
            'film-pipeline:load-dst-bundle-import-preview',
            'film-pipeline:plan-dst-bundle-import',
            'film-pipeline:confirm-dst-bundle-import',
            'film-pipeline:get-video-result-import-workspace',
            'film-pipeline:load-video-result-import-preview',
            'film-pipeline:plan-video-result-import',
            'film-pipeline:confirm-video-result-import',
            'film-pipeline:get-new-project-draft-state',
            'film-pipeline:save-new-project-draft',
            'film-pipeline:enqueue-planning-agent-request',
            'film-pipeline:run-planning-agent-request',
            'film-pipeline:decide-planning-agent-suggestion',
            'film-pipeline:get-new-project-design-state',
            'film-pipeline:save-new-project-design-board',
            'film-pipeline:enqueue-design-agent-request',
            'film-pipeline:run-design-agent-request',
            'film-pipeline:decide-design-agent-suggestion',
            'film-pipeline:get-new-project-image-plan',
            'film-pipeline:save-new-project-image-plan',
            'film-pipeline:prepare-new-project-image-plan',
            'film-pipeline:get-new-project-image-result-workspace',
            'film-pipeline:connect-new-project-image-result',
            'film-pipeline:get-new-project-image-result-preview',
            'film-pipeline:save-new-project-image-retry-selection',
            'film-pipeline:get-new-project-video-plan',
            'film-pipeline:save-new-project-video-plan',
            'film-pipeline:prepare-new-project-video-plan',
            'film-pipeline:get-new-project-video-result-workspace',
            'film-pipeline:connect-new-project-video-result',
            'film-pipeline:get-new-project-video-result-preview',
            'film-pipeline:save-new-project-video-retry-selection',
            'film-pipeline:save-new-project-image-review-decision',
            'film-pipeline:save-new-project-video-review-decision',
            'film-pipeline:get-new-project-clip-selection',
            'film-pipeline:save-new-project-clip-selection',
            'film-pipeline:get-new-project-final-stitch',
            'film-pipeline:stage-new-project-final-stitch',
            'film-pipeline:get-new-project-final-render',
            'film-pipeline:plan-new-project-final-render',
            'film-pipeline:execute-new-project-final-render',
            'film-pipeline:get-new-project-final-render-preview',
            'film-pipeline:save-new-project-final-review-decision',
            'film-pipeline:get-new-project-execution-state',
            'film-pipeline:copy-new-project-build-command',
            'film-pipeline:select-production-root',
            'film-pipeline:list-production-children',
            'film-pipeline:read-production-state',
            'film-pipeline:write-planning-file',
            'film-pipeline:list-assets',
            'film-pipeline:read-jsonl',
            'film-pipeline:preview-command',
            'film-pipeline:copy-command-preview',
            'film-pipeline:run-safe-command',
            'film-pipeline:get-g3-review-workspace',
            'film-pipeline:load-g3-candidate-preview',
            'film-pipeline:save-g3-review-draft',
            'film-pipeline:export-g3-review-packet',
            'film-pipeline:plan-g3-production-promotion',
            'film-pipeline:promote-g3-production-selection',
            'film-pipeline:get-finishing-workspace',
            'film-pipeline:plan-finishing-run',
            'film-pipeline:execute-finishing-run',
        ],
    );
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:select-production-root')[1],
        [{ mode: 'production' }],
    );
    for (const channel of [
        'film-pipeline:get-harness-contract-status',
        'film-pipeline:get-media-retry-plan',
        'film-pipeline:get-dst-bundle-import-workspace',
        'film-pipeline:get-video-result-import-workspace',
        'film-pipeline:get-new-project-draft-state',
        'film-pipeline:get-new-project-design-state',
        'film-pipeline:get-new-project-image-plan',
        'film-pipeline:get-new-project-image-result-workspace',
        'film-pipeline:get-new-project-video-plan',
        'film-pipeline:get-new-project-video-result-workspace',
        'film-pipeline:get-new-project-clip-selection',
        'film-pipeline:get-new-project-final-stitch',
        'film-pipeline:get-new-project-final-render',
        'film-pipeline:plan-new-project-final-render',
        'film-pipeline:get-new-project-final-render-preview',
        'film-pipeline:get-new-project-execution-state',
        'film-pipeline:copy-new-project-build-command',
        'film-pipeline:list-production-children',
        'film-pipeline:read-production-state',
        'film-pipeline:list-assets',
        'film-pipeline:get-g3-review-workspace',
        'film-pipeline:plan-g3-production-promotion',
        'film-pipeline:get-finishing-workspace',
        'film-pipeline:plan-finishing-run',
    ]) {
        assert.deepEqual(
            invocations.find(([candidate]) => candidate === channel)[1],
            [],
            `${channel} must not carry a renderer path argument`,
        );
    }
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:save-new-project-draft')[1],
        [{ production_id: 'test-project' }],
    );
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:load-g3-candidate-preview')[1],
        [{ candidateToken: 'opaque' }],
    );
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:load-video-result-import-preview')[1],
        [{ candidateToken: 'video-opaque' }],
    );
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:plan-video-result-import')[1],
        [{ candidateToken: 'video-opaque', retryMediaId: 'video_01' }],
    );
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:confirm-video-result-import')[1],
        [{ planToken: 'video-plan', confirmed: true }],
    );
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:promote-g3-production-selection')[1],
        [{ planToken: 'opaque', projectIdConfirmation: 'project_01', confirmed: true }],
    );
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:execute-new-project-final-render')[1],
        [{ planToken: 'opaque', confirmed: true, projectId: 'test-project' }],
    );
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:save-new-project-final-review-decision')[1],
        [{ decision: 'use', expected_review_version: 'a'.repeat(64) }],
    );
    assert.deepEqual(
        invocations.find(([channel]) => channel === 'film-pipeline:execute-finishing-run')[1],
        [{ planToken: 'opaque', projectId: 'project_01', confirmed: true }],
    );

    const unsubscribe = bridge.onProgress(() => {});
    assert.equal(eventCalls.length, 1);
    assert.equal(eventCalls[0][0], 'on');
    assert.equal(eventCalls[0][1], 'film-pipeline:progress');
    unsubscribe();
    assert.equal(eventCalls.length, 2);
    assert.equal(eventCalls[1][0], 'removeListener');
    assert.equal(eventCalls[1][1], 'film-pipeline:progress');
    assert.equal(eventCalls[1][2], eventCalls[0][2]);
});

const importPattern = /(?:import\s*(?:[^'"()]*?\s+from\s*)?|import\s*\(|require\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;

async function resolveImport(fromFile, specifier) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')];
    for (const candidate of candidates) {
        try {
            const candidateStat = await stat(candidate);
            if (candidateStat.isFile()) return candidate;
        } catch {
            // Try the next supported local module form.
        }
    }
    throw new Error(`unresolved active import ${specifier} from ${fromFile}`);
}

async function collectActiveGraph(entrypoints) {
    const pending = entrypoints.map((entry) => path.join(repoRoot, entry));
    const visited = new Set();
    while (pending.length) {
        const file = pending.pop();
        if (visited.has(file)) continue;
        visited.add(file);
        const text = await readFile(file, 'utf8');
        for (const match of text.matchAll(importPattern)) {
            pending.push(await resolveImport(file, match[1]));
        }
    }
    return visited;
}

test('default package lifecycle is only the local Vite/Electron studio', async () => {
    const pkg = JSON.parse(await source('package.json'));
    const indexHtml = await source('index.html');
    assert.equal(pkg.scripts.dev, 'vite');
    assert.equal(pkg.scripts.build, 'vite build');
    assert.equal(pkg.scripts.start, 'npm run build && electron .');
    assert.match(pkg.description, /Local Electron workbench/);
    assert.match(indexHtml, /<title>Cinematic Pipeline Studio<\/title>/);
    assert.doesNotMatch(indexHtml, /free, open-source|20\+ models|MuAPI/i);

    for (const name of ['dev', 'build', 'start']) {
        assert.doesNotMatch(pkg.scripts[name], /\bnext\b|\bapp\//i);
    }
    for (const [name, command] of Object.entries(pkg.scripts)) {
        assert.doesNotMatch(command, /\bnext\b/i, `${name} must not execute the legacy Next product`);
    }
});

test('active desktop import graph has no hosted service or legacy Next reachability', async () => {
    const activeFiles = await collectActiveGraph([
        'src/main.js',
        'electron/main.js',
        'electron/preload.js',
        'vite.config.mjs',
    ]);

    for (const expected of [
        'src/components/pipeline/PipelineStudio.js',
        'electron/lib/createMainWindow.js',
        'electron/lib/navigationPolicy.js',
        'electron/preload.js',
    ]) {
        assert.equal(activeFiles.has(path.join(repoRoot, expected)), true, `active graph must include ${expected}`);
    }

    for (const file of activeFiles) {
        const relative = path.relative(repoRoot, file);
        const text = await readFile(file, 'utf8');
        assert.doesNotMatch(text, /muapi|api\.muapi/i, `${relative} must not reference the hosted service`);
        assert.equal(relative.startsWith(`app${path.sep}`), false, `${relative} must not reach the legacy Next app`);
        assert.equal(relative.startsWith(`components${path.sep}`), false, `${relative} must not reach legacy hosted components`);
        assert.equal(relative.startsWith(`lib${path.sep}`), false, `${relative} must not reach legacy hosted libraries`);
    }

    for (const dormant of [
        'electron/lib/localInference.js',
        'electron/lib/wan2gpProvider.js',
        'src/components/LocalModelManager.js',
        'src/lib/localInferenceClient.js',
        'src/lib/uploadHistory.js',
        'src/lib/pendingJobs.js',
        'src/lib/uploadProxyTarget.js',
    ]) {
        assert.equal(activeFiles.has(path.join(repoRoot, dormant)), false, `${dormant} must remain unreachable`);
    }
});

test('product execution surfaces reject hosted service reintroduction', async () => {
    const scanRoots = ['src', 'electron'];
    const files = [];
    for (const root of scanRoots) {
        const pending = [path.join(repoRoot, root)];
        while (pending.length) {
            const current = pending.pop();
            for (const entry of await readdir(current, { withFileTypes: true })) {
                const child = path.join(current, entry.name);
                if (entry.isDirectory()) pending.push(child);
                else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(child);
            }
        }
    }

    const rootConfigs = [
        'afterPack.js',
        'index.html',
        'jsconfig.json',
        'next.config.mjs',
        'package.json',
        'postcss.config.js',
        'tailwind.config.js',
        'vite.config.mjs',
    ].map((file) => path.join(repoRoot, file));

    // middleware.js is the sole exact dormant execution-file exception. It is
    // a Next-only proxy and is unreachable from all default scripts and the
    // active Vite/Electron graph proved above.
    const exactDormantAllowlist = new Set([path.join(repoRoot, 'middleware.js')]);
    assert.deepEqual([...exactDormantAllowlist].map((file) => path.relative(repoRoot, file)), ['middleware.js']);

    for (const file of [...files, ...rootConfigs]) {
        assert.equal(exactDormantAllowlist.has(file), false);
        const text = await readFile(file, 'utf8');
        assert.doesNotMatch(text, /muapi|api\.muapi/i, `${path.relative(repoRoot, file)} must not reference the hosted service`);
    }

    const vite = await source('vite.config.mjs');
    const settings = await source('src/components/SettingsModal.js');
    assert.doesNotMatch(vite, /proxy\s*:/);
    assert.doesNotMatch(settings, /localStorage|type=["']password["']/);
    assert.doesNotMatch(settings, /LocalModelManager\s*\(|isLocalAIAvailable\s*\(|from\s+['"][^'"]*(?:LocalModelManager|localInferenceClient)/i);
    assert.match(settings, /settings\.pipelineNote/);
});
