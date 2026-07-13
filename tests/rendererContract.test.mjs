import assert from 'node:assert/strict';
import test from 'node:test';

class TestNode {
    constructor(nodeType, tagName = '') {
        this.nodeType = nodeType;
        this.tagName = tagName.toUpperCase();
        this.parentNode = null;
        this.childNodes = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.className = '';
        this.disabled = false;
        this.readOnly = false;
        this.value = '';
        this._text = '';
    }

    get textContent() {
        return this._text + this.childNodes.map((child) => child.textContent).join('');
    }

    set textContent(value) {
        this._text = String(value ?? '');
        this.childNodes = [];
    }

    get innerHTML() {
        return this.textContent;
    }

    set innerHTML(value) {
        this._text = String(value || '');
        this.childNodes = [];
    }

    appendChild(child) {
        assert.ok(child && typeof child.nodeType === 'number', 'appendChild expects a DOM-like node');
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    replaceChildren(...children) {
        this._text = '';
        this.childNodes = [];
        children.forEach((child) => this.appendChild(child));
    }

    setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    async dispatchEvent(event) {
        const normalized = { target: this, ...event };
        const results = (this.listeners.get(normalized.type) || []).map((listener) => listener(normalized));
        await Promise.all(results);
        return true;
    }

    querySelector(selector) {
        return findAll(this, selector)[0] || null;
    }
}

function descendants(root) {
    return root.childNodes.flatMap((child) => [child, ...descendants(child)]);
}

function findAll(root, selector) {
    const normalized = selector.toUpperCase();
    return descendants(root).filter((node) => node.tagName === normalized);
}

function byText(root, tagName, text) {
    return findAll(root, tagName).find((node) => node.textContent.trim() === text) || null;
}

function byAttribute(root, tagName, name, value) {
    return findAll(root, tagName).find((node) => node.attributes.get(name) === value) || null;
}

function installDeterministicDom(bridge, options = {}) {
    const previous = {
        document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
        window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    };
    const documentListeners = new Map();
    const document = {
        body: new TestNode(1, 'body'),
        activeElement: null,
        createElement: (tagName) => new TestNode(1, tagName),
        createTextNode: (text) => {
            const node = new TestNode(3);
            node.textContent = text;
            return node;
        },
        addEventListener(type, listener) {
            const listeners = documentListeners.get(type) || [];
            listeners.push(listener);
            documentListeners.set(type, listeners);
        },
        removeEventListener(type, listener) {
            const listeners = documentListeners.get(type) || [];
            documentListeners.set(type, listeners.filter((candidate) => candidate !== listener));
        },
    };
    const windowListeners = new Map();
    const window = {
        document,
        filmPipeline: bridge,
        alert(message) {
            options.alerts?.push(String(message));
        },
        addEventListener(type, listener) {
            const listeners = windowListeners.get(type) || [];
            listeners.push(listener);
            windowListeners.set(type, listeners);
        },
        dispatchEvent(event) {
            (windowListeners.get(event.type) || []).forEach((listener) => listener(event));
        },
    };

    globalThis.document = document;
    globalThis.window = window;
    const restore = () => {
        for (const [key, descriptor] of Object.entries(previous)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    };
    return { restore };
}

async function flushRenderer() {
    for (let index = 0; index < 8; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

test('PipelineStudio renders the Korean compact workbench and preserves dry-run boundaries', async (t) => {
    const calls = [];
    const { default: samplePipelineState } = await import('../src/lib/pipeline/mockData.js');
    const restoredState = structuredClone(samplePipelineState);
    restoredState.project.title = 'Restored Production State';
    restoredState.project.root_path = '/tmp/restored-production';
    const selectedState = structuredClone(samplePipelineState);
    selectedState.project.title = 'Folder Selected Production';
    selectedState.project.root_path = '/tmp/selected-production';

    const bridge = {
        async getConfig() {
            calls.push(['getConfig']);
            return {
                config: {
                    productionRoot: '/tmp/restored-production',
                    productionParentRoot: '/tmp/production-parent',
                    dryRunMode: false,
                    allowSafeCommandExecution: true,
                },
            };
        },
        async setConfig(config) {
            calls.push(['setConfig', structuredClone(config)]);
            return { ok: true, config };
        },
        async selectProductionRoot() {
            calls.push(['selectProductionRoot']);
            return {
                ok: true,
                canceled: false,
                rootPath: '/tmp/selected-production',
                config: {
                    productionRoot: '/tmp/selected-production',
                    productionParentRoot: '/tmp/production-parent',
                    dryRunMode: false,
                    allowSafeCommandExecution: true,
                },
            };
        },
        async readProductionState(rootPath) {
            calls.push(['readProductionState', rootPath]);
            return {
                ok: true,
                state: rootPath === '/tmp/selected-production' ? selectedState : restoredState,
            };
        },
        async listProductionChildren(parentPath) {
            calls.push(['listProductionChildren', parentPath]);
            return { ok: false, reason: 'READ_PARENT_BLOCKED_FOR_TEST', entries: [] };
        },
        async writePlanningFile(payload) {
            calls.push(['writePlanningFile', payload]);
            return { ok: false, executed: false, reason: 'TEST_WRITE_BLOCKED' };
        },
        async previewCommand(commandSpec) {
            calls.push(['previewCommand', commandSpec]);
            return { ok: true, executed: false };
        },
        async runSafeCommand(commandSpec) {
            calls.push(['runSafeCommand', commandSpec]);
            return { ok: false, executed: false };
        },
        onProgress() {
            calls.push(['onProgress']);
            return () => {};
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();

    await flushRenderer();
    assert.match(studio.textContent, /Restored Production State/);
    assert.deepEqual(
        calls.filter(([method]) => method === 'readProductionState').map(([, rootPath]) => rootPath),
        ['/tmp/restored-production'],
        'saved productionRoot must restore renderer state through the bridge',
    );
    assert.match(studio.textContent, /안전 모드 · 생성 및 업로드 차단/);
    assert.doesNotMatch(studio.textContent, /Dry-run disabled/);
    assert.equal(findAll(studio, 'h1').length, 1, 'the current production is the single page h1');
    assert.equal(findAll(studio, 'main').length, 0, 'PipelineStudio must not nest a main landmark inside the app main');

    const workflowNav = byAttribute(studio, 'nav', 'aria-label', '파이프라인 작업 단계');
    assert.ok(workflowNav, 'workflow navigation must have a Korean accessible name');
    assert.ok(byAttribute(studio, 'button', 'aria-current', 'page'), 'active workflow step must expose aria-current=page');
    for (const group of ['기획', '제작 준비', '생성·검토', '마무리']) {
        assert.ok(byText(studio, 'h2', group), `${group} workflow group must be rendered`);
    }
    const mobileWorkflow = byAttribute(studio, 'select', 'aria-label', '파이프라인 작업 단계');
    assert.ok(mobileWorkflow, 'mobile workflow select must have a Korean accessible name');
    mobileWorkflow.value = 'storyboard';
    await mobileWorkflow.dispatchEvent({ type: 'change' });
    assert.ok(byText(studio, 'h2', '스토리보드'), 'mobile workflow change must render the storyboard panel');
    assert.equal(
        byAttribute(studio, 'select', 'aria-label', '파이프라인 작업 단계').value,
        'storyboard',
        'the rerendered mobile workflow select must preserve the selected step',
    );
    assert.deepEqual(
        findAll(studio, 'dt').map((node) => node.textContent.trim()),
        ['파일', '파싱', '검토', '채택'],
        'file evidence must be a compact four-metric strip',
    );
    const details = findAll(studio, 'details');
    assert.ok(details.length >= 2, 'safety and production lists must use progressive disclosure');
    assert.ok(details.every((node) => !node.attributes.has('open')), 'progressive details must be collapsed by default');

    const openFolder = byText(studio, 'button', '제작 폴더 열기');
    assert.ok(openFolder, 'folder-selection UI must be rendered in Korean');
    await openFolder.dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(studio.textContent, /Folder Selected Production/);
    assert.equal(calls.filter(([method]) => method === 'selectProductionRoot').length, 1);

    const refresh = byText(studio, 'button', '목록 새로고침');
    assert.ok(refresh, 'production refresh control must be rendered in Korean');
    await refresh.dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(studio.textContent, /상위 폴더를 읽을 수 없습니다: READ_PARENT_BLOCKED_FOR_TEST/);
    assert.ok(byText(studio, 'button', '설정 열기'), 'reader error must expose a Korean recovery action');

    const tabs = [
        ['프로젝트', '프로젝트 개요'],
        ['스토리보드', '스토리보드'],
        ['샷 설계', '샷 설계'],
        ['모션 보드', '모션 보드'],
        ['참조 이미지', '첫 프레임·참조 이미지'],
        ['프롬프트 팩', '프롬프트 팩'],
        ['검토 게이트', '검토 게이트'],
        ['생성 대기열', '생성 대기열'],
        ['클립 QA', '클립 QA·채택 구간'],
        ['최종 편집', '최종 편집·보고서'],
        ['설정', '파이프라인 설정'],
    ];

    const renderedPanelTexts = [];
    for (const [tabLabel, panelHeading] of tabs) {
        const tab = byText(studio, 'button', tabLabel);
        assert.ok(tab, `${tabLabel} tab must be rendered`);
        await tab.dispatchEvent({ type: 'click' });
        assert.ok(
            findAll(studio, 'h2').some((heading) => heading.textContent.trim() === panelHeading),
            `${tabLabel} must render the ${panelHeading} panel`,
        );
        assert.equal(byText(studio, 'button', tabLabel).attributes.get('aria-current'), 'page');
        renderedPanelTexts.push(studio.textContent);
    }
    const allPanelText = renderedPanelTexts.join('\n');
    for (const staleUiLabel of [
        'Cinematic Pipeline Studio',
        'Open Production Folder',
        'Refresh productions',
        'Shot Designer',
        'Review Gates',
        'Live submit is disabled',
        'Copy command',
        'Open Settings',
    ]) {
        assert.doesNotMatch(allPanelText, new RegExp(staleUiLabel), `${staleUiLabel} must not remain in the default Korean UI`);
    }

    await byText(studio, 'button', '참조 이미지').dispatchEvent({ type: 'click' });
    assert.match(studio.textContent, /하네스 이미지 대시보드를 읽기 전용으로 보여 줍니다/);

    await byText(studio, 'button', '생성 대기열').dispatchEvent({ type: 'click' });
    const queueText = studio.textContent;
    assert.match(queueText, /라이브 제출은 차단/);
    assert.match(queueText, /미리보기 카드만 제공합니다. 실행 버튼은 표시하지 않습니다./);
    assert.match(queueText, /명령 복사/);
    assert.match(queueText, /CREDIT_CONFIRMATION_REQUIRED/);
    assert.match(queueText, /이미지 생성차단/);
    assert.ok(byText(studio, 'button', '제출 차단')?.disabled, 'submit control must stay visibly disabled');

    const unsafeEnabledButtons = findAll(studio, 'button').filter((button) => (
        button.disabled !== true
        && /^(run|execute|generate|submit|upload|실행|생성|제출|업로드)\b/i.test(button.textContent.trim())
    ));
    assert.deepEqual(
        unsafeEnabledButtons.map((button) => button.textContent.trim()),
        [],
        'renderer must not expose an enabled unsafe action button in either language',
    );
    assert.equal(calls.filter(([method]) => method === 'previewCommand').length, 0);
    assert.equal(calls.filter(([method]) => method === 'runSafeCommand').length, 0);
    assert.equal(calls.filter(([method]) => method === 'writePlanningFile').length, 0);
    assert.match(studio.textContent, /\/tmp\/selected-production/, 'technical paths must remain unmodified');
});

test('PipelineStudio reports planning write rejection in Korean without leaking the thrown error or rejecting the click', async (t) => {
    const alerts = [];
    const unhandled = [];
    const { default: samplePipelineState } = await import('../src/lib/pipeline/mockData.js');
    const state = structuredClone(samplePipelineState);
    state.project.root_path = '/tmp/planning-write-rejection';
    const bridge = {
        async getConfig() {
            return {
                config: {
                    productionRoot: state.project.root_path,
                    productionParentRoot: '',
                    dryRunMode: true,
                    allowSafeCommandExecution: false,
                },
            };
        },
        async readProductionState() {
            return { ok: true, state };
        },
        async writePlanningFile() {
            throw new Error('SECRET_PAYLOAD_SHOULD_NOT_RENDER');
        },
    };
    const { restore } = installDeterministicDom(bridge, { alerts });
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    t.after(() => {
        process.off('unhandledRejection', onUnhandled);
        restore();
    });

    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    const saveButton = byText(studio, 'button', '계획 파일 저장');
    assert.ok(saveButton, 'intake planning save button must be available');
    await saveButton.dispatchEvent({ type: 'click' });
    await flushRenderer();

    assert.deepEqual(alerts, ['저장이 차단되었습니다: 안전한 계획 파일 경로와 내용인지 확인하세요.']);
    assert.doesNotMatch(alerts[0], /SECRET_PAYLOAD/);
    assert.deepEqual(unhandled, []);
});

test('PipelineSidebar keeps grouped navigation ahead of a collapsed Korean production list', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { PipelineSidebar } = await import('../src/components/pipeline/PipelineSidebar.js');

    const sidebar = PipelineSidebar({
        tabs: [{ id: 'intake', label: '프로젝트', group: 'planning', groupLabel: '기획' }],
        activeTab: 'intake',
        productions: [{
            name: 'sanitized-production',
            path: '/tmp/sanitized-production',
            mtime: '2026-07-13T00:00:00.000Z',
            fileCount: 3,
            hasMarkdownBrief: true,
            hasJsonlLedger: false,
        }],
        productionsState: { status: 'ok', reason: '' },
        onSelect() {},
        onSelectProduction() {},
        onOpenSettings() {},
        onRefreshProductions() {},
    });

    assert.match(sidebar.textContent, /sanitized-production/);
    assert.match(sidebar.textContent, /파일 3개/);
    assert.ok(
        sidebar.textContent.indexOf('프로젝트') < sidebar.textContent.indexOf('제작 목록'),
        'primary workflow navigation must remain ahead of the production list',
    );
    assert.ok(byAttribute(sidebar, 'nav', 'aria-label', '파이프라인 작업 단계'));
    assert.equal(byText(sidebar, 'button', '프로젝트').attributes.get('aria-current'), 'page');
    assert.ok(byAttribute(sidebar, 'button', 'aria-label', '제작 목록 새로고침'));
    assert.equal(findAll(sidebar, 'details').length, 1);
    assert.equal(findAll(sidebar, 'details')[0].attributes.has('open'), false);
});

test('pipeline media surfaces keep relative and external paths as metadata without resource fetch nodes', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { default: samplePipelineState } = await import('../src/lib/pipeline/mockData.js');
    const { GenerationHistoryGrid } = await import('../src/components/pipeline/GenerationHistoryGrid.js');
    const { FinalReportPanel } = await import('../src/components/pipeline/FinalReportPanel.js');

    const relativePath = samplePipelineState.assets[0].path;
    const history = GenerationHistoryGrid({ state: samplePipelineState });
    const finalReport = FinalReportPanel({ state: samplePipelineState });

    assert.match(history.textContent, new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(finalReport.textContent, new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(history.textContent, /미리보기 불가/);
    assert.match(finalReport.textContent, /미리보기 불가/);
    assert.equal(findAll(history, 'img').length, 0, 'relative shot artifacts must not create image fetch nodes');
    assert.equal(findAll(finalReport, 'img').length, 0, 'relative final-report artifacts must not create image fetch nodes');

    const externalPath = 'https://example.invalid/external-preview.png';
    const externalState = structuredClone(samplePipelineState);
    externalState.generationHistory = [{ id: 'external', label: 'External', path: externalPath, type: 'image' }];
    externalState.assets[0].path = externalPath;
    const externalHistory = GenerationHistoryGrid({ state: externalState });
    const externalFinal = FinalReportPanel({ state: externalState });
    assert.match(externalHistory.textContent, /https:\/\/example\.invalid\/external-preview\.png/);
    assert.match(externalFinal.textContent, /https:\/\/example\.invalid\/external-preview\.png/);
    assert.equal(findAll(externalHistory, 'img').length, 0, 'HTTP sources must stay metadata-only');
    assert.equal(findAll(externalFinal, 'img').length, 0, 'HTTP final-report sources must stay metadata-only');

    const relativeVideoPath = 'production/clip/generated.mp4';
    const relativeVideoHistory = GenerationHistoryGrid({
        state: { generationHistory: [{ id: 'relative-video', label: 'Relative video', path: relativeVideoPath, type: 'video' }] },
    });
    await findAll(relativeVideoHistory, 'button')[0].dispatchEvent({ type: 'click' });
    assert.equal(findAll(document.body, 'video').length, 0, 'relative video artifacts must not create video fetch nodes');
    assert.match(document.body.textContent, /production\/clip\/generated\.mp4/);
    assert.match(document.body.textContent, /자동 미디어 미리보기를 사용할 수 없습니다/);
});

test('pipeline media surfaces preserve explicit safe local image sources', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { default: samplePipelineState } = await import('../src/lib/pipeline/mockData.js');
    const { GenerationHistoryGrid } = await import('../src/components/pipeline/GenerationHistoryGrid.js');
    const { FinalReportPanel } = await import('../src/components/pipeline/FinalReportPanel.js');

    const safeSources = [
        '/private/tmp/fixture.png',
        'file:///private/tmp/fixture.png',
        'data:image/png;base64,AA==',
        'blob:fixture-preview',
    ];
    const historyState = {
        generationHistory: safeSources.map((source, index) => ({
            id: `safe-${index}`,
            label: `Safe ${index}`,
            path: source,
            type: 'image',
        })),
    };
    const history = GenerationHistoryGrid({ state: historyState });
    assert.deepEqual(
        findAll(history, 'img').map((node) => node.attributes.get('src')),
        safeSources,
        'safe local source forms must remain usable in the shot preview grid',
    );

    const finalState = structuredClone(samplePipelineState);
    finalState.assets[0].path = safeSources[0];
    const finalReport = FinalReportPanel({ state: finalState });
    assert.equal(findAll(finalReport, 'img')[0]?.attributes.get('src'), safeSources[0]);
    assert.match(finalReport.textContent, /\/private\/tmp\/fixture\.png/);

    const videoHistory = GenerationHistoryGrid({
        state: { generationHistory: [{ id: 'safe-video', label: 'Safe video', path: '/private/tmp/fixture.mp4', type: 'video' }] },
    });
    await findAll(videoHistory, 'button')[0].dispatchEvent({ type: 'click' });
    assert.equal(findAll(document.body, 'video')[0]?.attributes.get('src'), '/private/tmp/fixture.mp4');
});

test('local media source policy is deny-by-default and never permits remote file hosts', async () => {
    const { localMediaSource } = await import('../src/lib/pipeline/mediaSources.js');

    assert.equal(localMediaSource('production/clip/frame.png', 'image'), '');
    assert.equal(localMediaSource('https://example.invalid/frame.png', 'image'), '');
    assert.equal(localMediaSource('//server/share/frame.png', 'image'), '');
    assert.equal(localMediaSource('file://server/share/frame.png', 'image'), '');
    assert.equal(localMediaSource('data:text/html,unsafe', 'image'), '');
    assert.equal(localMediaSource('data:image/svg+xml,<svg/>', 'image'), '');
    assert.equal(localMediaSource('/private/tmp/frame.png', 'image'), '/private/tmp/frame.png');
    assert.equal(localMediaSource('file:///private/tmp/frame.png', 'image'), 'file:///private/tmp/frame.png');
});
