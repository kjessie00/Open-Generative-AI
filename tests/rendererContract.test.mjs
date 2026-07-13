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
    let activeRoot = '/tmp/restored-production';

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
        async getHarnessContractStatus(...args) {
            calls.push(['getHarnessContractStatus', args]);
            return {
                ok: true,
                ready: true,
                readiness: 'available',
                readOnly: true,
                rootPath: '/Users/jessiek/StudioProjects/happyVideoFactory',
                entries: [
                    { id: 'pack_builder', ready: true, path: '/Users/jessiek/StudioProjects/happyVideoFactory/scripts/build_short_drama_pipeline_pack.py' },
                    { id: 'pack_validator', ready: true, path: '/Users/jessiek/StudioProjects/happyVideoFactory/scripts/validate_short_drama_pipeline_pack.py' },
                ],
            };
        },
        async selectProductionRoot(request) {
            calls.push(['selectProductionRoot', structuredClone(request)]);
            assert.deepEqual(request, { mode: 'production' });
            activeRoot = '/tmp/selected-production';
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
        async readProductionState(...args) {
            calls.push(['readProductionState', args]);
            return {
                ok: true,
                state: activeRoot === '/tmp/selected-production' ? selectedState : restoredState,
            };
        },
        async listProductionChildren(...args) {
            calls.push(['listProductionChildren', args]);
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
    assert.deepEqual(calls.find(([method]) => method === 'getHarnessContractStatus')[1], []);
    assert.deepEqual(
        calls.filter(([method]) => method === 'readProductionState').map(([, args]) => args),
        [[]],
        'saved productionRoot must restore renderer state without a renderer-supplied path',
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
    assert.deepEqual(calls.find(([method]) => method === 'selectProductionRoot')[1], { mode: 'production' });

    const refresh = byText(studio, 'button', '목록 새로고침');
    assert.ok(refresh, 'production refresh control must be rendered in Korean');
    await refresh.dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(studio.textContent, /상위 폴더를 읽을 수 없습니다: 로컬 경로 안전 정책에 따라 요청이 차단되었습니다/);
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
    assert.match(queueText, /Canonical 하네스 연결사용 가능읽기 전용 메타데이터/);
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

test('copy-disabled command card attaches no click handler and performs zero clipboard IPC', async (t) => {
    const calls = [];
    const bridge = {
        async copyCommandPreview(commandSpec) {
            calls.push(commandSpec);
            return { ok: true, copied: true, verified: true };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { CommandPreviewCard } = await import('../src/components/pipeline/CommandPreviewCard.js');

    const disabled = CommandPreviewCard({
        commandSpec: {
            id: 'missing-contract',
            label: 'Canonical pack validate',
            command: '',
            args: [],
            preview_only: true,
            side_effect_type: 'local_read',
            copy_allowed: false,
            disabled_reason: 'CANONICAL_PACK_INPUT_INCOMPLETE',
        },
    });
    const disabledButton = byText(disabled, 'button', '복사 불가');
    assert.ok(disabledButton);
    assert.equal(disabledButton.disabled, true);
    assert.equal(disabledButton.listeners.has('click'), false, 'disabled copy must have no click listener');
    await disabledButton.dispatchEvent({ type: 'click' });
    assert.equal(calls.length, 0, 'disabled copy must perform zero clipboard IPC');

    const usable = CommandPreviewCard({
        commandSpec: {
            id: 'canonical-pack-validate',
            label: 'Canonical pack validate',
            command: 'python3',
            args: ['/fixed/validate.py', '/configured/production', '--json'],
            cwd: '/fixed/harness',
            preview_only: true,
            side_effect_type: 'local_read',
            copy_allowed: true,
        },
    });
    const usableButton = byText(usable, 'button', '명령 복사');
    assert.ok(usableButton);
    assert.equal(usableButton.disabled, false);
    await usableButton.dispatchEvent({ type: 'click' });
    assert.equal(calls.length, 1, 'usable preview copy must keep the existing copy-only bridge');
});

test('settings renders partial and blocked fixed-root harness readiness in Korean', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { default: samplePipelineState } = await import('../src/lib/pipeline/mockData.js');
    const { PipelineSettingsPanel } = await import('../src/components/pipeline/PipelineSettingsPanel.js');
    const config = { productionRoot: '/tmp/production', productionParentRoot: '' };

    for (const [readiness, expected] of [['partial', '부분'], ['blocked', '차단']]) {
        const panel = PipelineSettingsPanel({
            state: samplePipelineState,
            config,
            harnessStatus: { readiness, rootPath: '/fixed/happyVideoFactory' },
        });
        assert.match(panel.textContent, new RegExp(`happyVideoFactory canonical 계약${expected}읽기 전용 메타데이터`));
        assert.match(panel.textContent, /main process는 고정 allowlist만 검사합니다/);
    }
});

test('PipelineStudio preserves native parent and sidebar child UX without renderer config mutation', async (t) => {
    const alerts = [];
    const calls = [];
    const unhandled = [];
    const { default: samplePipelineState } = await import('../src/lib/pipeline/mockData.js');
    const restoredState = structuredClone(samplePipelineState);
    restoredState.project.title = 'Main Owned Restored Production';
    restoredState.project.root_path = '/tmp/restored-production';
    const childState = structuredClone(samplePipelineState);
    childState.project.title = 'Main Owned Child Production';
    childState.project.root_path = '/tmp/production-parent/child-production';
    let config = {
        productionRoot: restoredState.project.root_path,
        productionParentRoot: '',
        pathProvenanceVersion: 1,
        dryRunMode: true,
        allowSafeCommandExecution: false,
    };
    let rejectChild = false;
    const bridge = {
        async getConfig() {
            return { config: structuredClone(config) };
        },
        async selectProductionRoot(request) {
            calls.push(['selectProductionRoot', structuredClone(request)]);
            if (request.mode === 'parent') {
                config = { ...config, productionParentRoot: '/tmp/production-parent' };
                return { ok: true, mode: 'parent', rootPath: config.productionParentRoot, config: structuredClone(config) };
            }
            if (request.mode === 'child') {
                if (rejectChild) throw new Error('SECRET_CHILD_PATH_REJECTION');
                config = { ...config, productionRoot: request.rootPath };
                return { ok: true, mode: 'child', rootPath: request.rootPath, config: structuredClone(config) };
            }
            throw new Error('UNEXPECTED_MODE');
        },
        async listProductionChildren(...args) {
            calls.push(['listProductionChildren', args]);
            return {
                ok: true,
                rootPath: config.productionParentRoot,
                entries: [{
                    name: 'child-production',
                    path: '/tmp/production-parent/child-production',
                    mtime: '2026-07-13T00:00:00.000Z',
                    fileCount: 3,
                    hasMarkdownBrief: true,
                    hasJsonlLedger: false,
                }],
            };
        },
        async readProductionState(...args) {
            calls.push(['readProductionState', args]);
            return {
                ok: true,
                state: config.productionRoot === childState.project.root_path ? childState : restoredState,
            };
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
    assert.equal(bridge.setConfig, undefined, 'renderer bridge fixture must have no public config mutation method');

    await byText(studio, 'button', '설정').dispatchEvent({ type: 'click' });
    await byText(studio, 'button', '상위 폴더 선택').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([, request]) => request?.mode === 'parent')[1], { mode: 'parent' });
    assert.equal(config.productionRoot, restoredState.project.root_path, 'parent selection must preserve production root');
    assert.deepEqual(
        calls.filter(([method]) => method === 'listProductionChildren').map(([, args]) => args),
        [[]],
        'refresh after parent selection must not pass a renderer-controlled parent path',
    );

    const childButton = byText(studio, 'span', 'child-production')?.parentNode;
    assert.ok(childButton, 'configured immediate child must be reachable in the sidebar');
    await childButton.dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(studio.textContent, /Main Owned Child Production/);
    assert.deepEqual(
        calls.find(([, request]) => request?.mode === 'child')[1],
        { mode: 'child', rootPath: '/tmp/production-parent/child-production' },
    );
    assert.ok(
        calls.filter(([method]) => method === 'readProductionState').every(([, args]) => args.length === 0),
        'production reads must never receive renderer path arguments',
    );

    rejectChild = true;
    const rerenderedChildButton = byText(studio, 'span', 'child-production')?.parentNode;
    await rerenderedChildButton.dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(alerts, ['로컬 경로 안전 정책에 따라 폴더 선택이 차단되었습니다.']);
    assert.doesNotMatch(alerts[0], /SECRET_CHILD_PATH_REJECTION/);
    assert.deepEqual(unhandled, []);
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

test('canonical finishing UI stays Korean, separates QC states, and exposes zero false final-command copies', async (t) => {
    let copyCalls = 0;
    const { restore } = installDeterministicDom({
        copyCommandPreview: async () => {
            copyCalls += 1;
            return { copied: true, verified: true };
        },
    });
    t.after(restore);
    const { default: samplePipelineState } = await import('../src/lib/pipeline/mockData.js');
    const { QAPanel } = await import('../src/components/pipeline/QAPanel.js');
    const { FinalReportPanel } = await import('../src/components/pipeline/FinalReportPanel.js');

    const state = structuredClone(samplePipelineState);
    state.project.root_path = '/tmp/synthetic-finishing';
    state.storyboard[0].clip_id = 'clip_SH01';
    state.promptPacks = [];
    state.submitRecords = [];
    state.heartbeatRecords = [];
    state.acceptedSeconds = [{
        clip_id: 'clip_SH01',
        source_file: '/tmp/synthetic-finishing/takes/SH01.mp4',
        source_exists: true,
        in_time: 0.5,
        out_time: 4.5,
        accepted: true,
        whole_clip_accepted: false,
        canonical_shot_id: 'SH01',
        canonical_beat_id: 'BEAT01',
        canonical_take_id: 'SH01_take_01',
        transition_type: 'cut',
        transition_duration_sec: 0,
        canonical_alias_source: 'shot_manifest.json+timeline_builder.clip_<shot_id>',
        canonical_provenance: 'selected_takes.json',
        reason: 'canonical_selected_take',
    }];
    state.qaRecords = [{
        clip_id: 'clip_SH01',
        canonical_shot_id: 'SH01',
        canonical_provider: 'seedance',
        deterministic_checks_passed: true,
        dialogue_intelligibility_score: 0.94,
        pronunciation_risk_flag: false,
        canonical_decision: 'accept',
        external_review_state: 'recorded_without_verdict',
        human_decision: 'UNREVIEWED',
        verdict: 'UNREVIEWED',
        canonical_provenance: 'qc_report.json',
    }];
    state.qaArtifacts = {
        shotManifestPath: '/tmp/synthetic-finishing/shot_manifest.json',
        selectedTakesPath: '/tmp/synthetic-finishing/selected_takes.json',
        qcReportPath: '/tmp/synthetic-finishing/qc_report.json',
        acceptedSecondsPath: '/tmp/synthetic-finishing/selected_takes.json',
    };
    state.canonicalHandoff = {
        shot_manifest_path: state.qaArtifacts.shotManifestPath,
        selected_takes_path: state.qaArtifacts.selectedTakesPath,
        qc_report_path: state.qaArtifacts.qcReportPath,
        selected_range_count: 1,
        selected_range_ready_count: 1,
        qc_record_count: 1,
        identifier_alias_ready: true,
        finishing_inconsistencies: [],
        final_ready: false,
    };
    state.fileEvidence = { '/tmp/synthetic-finishing/takes/SH01.mp4': true };
    state.files = ['/tmp/synthetic-finishing/takes/SH01.mp4'];
    state.blockers = ['OUTPUT_QUALITY_NOT_PROVEN'];
    state.finalReport = {
        ...state.finalReport,
        final_video_path: '/tmp/synthetic-finishing/final/final.mp4',
        concat_list_path: '/tmp/synthetic-finishing/final/concat_list.txt',
        report_path: '/tmp/synthetic-finishing/final/report.md',
        ffprobe_verified: false,
        blockers: ['OUTPUT_QUALITY_NOT_PROVEN'],
    };

    const qa = QAPanel({ state });
    const final = FinalReportPanel({ state });
    assert.match(qa.textContent, /정식 QC는 구조 증거일 뿐임/);
    assert.match(qa.textContent, /사람의 최종 판정은 미검토/);
    assert.match(qa.textContent, /원본 증거가 있는 채택 구간: 1/);
    assert.match(final.textContent, /정식 최종 준비 상태 미입증/);
    assert.match(final.textContent, /ffprobe 증거 저장과 선택 구간 렌더링이 구현되지 않아/);
    const buttons = findAll(final, 'button');
    assert.ok(buttons.length >= 2);
    assert.equal(buttons.every((button) => button.disabled), true);
    assert.equal(buttons.every((button) => (button.listeners.get('click') || []).length === 0), true);
    for (const button of buttons) await button.dispatchEvent({ type: 'click' });
    assert.equal(copyCalls, 0);
    assert.equal(buttons.some((button) => /실행|Run/i.test(button.textContent)), false);
});
