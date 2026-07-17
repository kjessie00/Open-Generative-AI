import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

    removeChild(child) {
        const index = this.childNodes.indexOf(child);
        if (index >= 0) this.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
    }

    get isConnected() {
        let current = this;
        while (current?.parentNode) current = current.parentNode;
        return current === globalThis.document?.body;
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

test('new project execution panel shows short Korean progress without private metadata', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectExecutionPanel } = await import('../src/components/pipeline/NewProjectExecutionPanel.js');
    const opened = [];
    let refreshed = 0;
    let staged = 0;
    const executionPreview = (outputKind) => ({
        mode: 'preview_ready', status_label: '내용 확인 가능',
        user_status: '작업 내용이 준비되었습니다.', next_action: '프롬프트를 확인하세요.',
        output_kind: outputKind, output_count: 1, preview_only: true,
    });
    const panel = NewProjectExecutionPanel({
        executionState: {
            status: 'running',
            prepared: false,
            summary: { queued: 1, running: 1, succeeded: 1, failed: 1 },
            tasks: [
                { task_token: 'private-image-token', lane: 'image', sequence: 1, label: '인물 시트 · 주인공', provider_label: 'DST 이미지', status: 'succeeded', progress: 100, result_received: true, result_match_status: 'waiting', execution_preview: executionPreview('image') },
                { task_token: 'private-scene-token', lane: 'image', sequence: 2, label: '장면 이미지 · 첫 만남', provider_label: 'DST 이미지', status: 'failed', progress: 45, failure_code: 'PROVIDER_UNAVAILABLE', failure_label: '생성 도구 응답 없음', result_received: false, execution_preview: {
                    ...executionPreview('image'),
                    user_status: '참조 이미지와 작업 내용이 준비되었습니다.',
                    next_action: '이미지 작업에서 장면 프롬프트를 확인하세요.',
                } },
                { task_token: 'private-video-token', lane: 'video', sequence: 3, label: '장면 영상 · 첫 만남', provider_label: '플로우', status: 'running', progress: 35, result_received: false, execution_preview: {
                    mode: 'review_required', status_label: '확인 필요',
                    user_status: '현재 참조 구성으로는 영상 작업을 준비할 수 없습니다.',
                    next_action: '영상 작업에서 다른 도구를 선택하거나 완료 영상을 연결하세요.',
                    output_kind: 'video', output_count: 1, preview_only: true,
                    provider: 'flow', blockers: ['FLOW_REFERENCE_COUNT_MUST_BE_ZERO_OR_TWO'],
                    path: '/private/hidden/reference.png', token: 'private-flow-preview-token',
                    hash: 'a'.repeat(64), command: 'flow submit --reference private.png',
                    mime_type: 'image/png', size_bytes: 4096,
                } },
                { task_token: 'private-wait-token', lane: 'video', sequence: 4, label: '장면 영상 · 결심', provider_label: '그록', status: 'queued', progress: 0, result_received: false, execution_preview: {
                    mode: 'setup_required', status_label: '준비 필요',
                    user_status: '현재 장면 길이는 이 도구에서 지원되지 않습니다.',
                    next_action: '완료 영상을 연결하거나 설계에서 장면 길이를 확인하세요.',
                    output_kind: 'video', output_count: 1, preview_only: true,
                    provider: 'grok', blockers: ['GROK_DURATION_UNSUPPORTED'],
                    path: '/private/hidden/grok.mp4', token: 'private-grok-preview-token',
                    hash: 'b'.repeat(64), command: 'grok submit --duration 5',
                    mime_type: 'video/mp4', size_bytes: 8192,
                } },
                { task_token: 'private-replicate-token', lane: 'video', sequence: 5, label: '장면 영상 · 마무리', provider_label: 'Replicate', status: 'queued', progress: 0, result_received: false, execution_preview: {
                    mode: 'preview_ready', status_label: '요청 내용 확인 가능', reason: 'private_replicate_request_ready',
                    user_status: 'Replicate에 보낼 영상 요청이 준비되었습니다. 아직 전송되지 않았습니다.',
                    next_action: '영상 작업에서 프롬프트·길이·첫 화면을 확인하세요.',
                    output_kind: 'video', output_count: 1, preview_only: true,
                    request_spec: { url: 'https://api.replicate.com/private', authorization_env: 'REPLICATE_API_TOKEN' },
                    claim_path: '/private/hidden/task.claim.json', request_revision_sha256: 'c'.repeat(64),
                } },
            ],
        },
        onRefreshExecution: () => { refreshed += 1; },
        onStageExecution: () => { staged += 1; },
        onOpenWorkItem: (payload) => opened.push(payload),
    });
    document.body.appendChild(panel);

    assert.match(panel.textContent, /시작 전 2 · 진행 1 · 결과 1 · 문제 1/);
    assert.match(panel.textContent, /이미지를 먼저 완성한 뒤 영상을 만듭니다/);
    assert.match(panel.textContent, /작업 목록 준비는 .* 생성은 시작하지 않습니다/);
    assert.match(panel.textContent, /결과 도착 · 연결 확인 필요|문제 발생 · 생성 도구 응답 없음|진행 중 35%/);
    assert.match(panel.textContent, /시작 전 · 요청 준비됨/);
    assert.match(panel.textContent, /내용 확인 가능 · 작업 내용이 준비되었습니다/);
    assert.match(panel.textContent, /실행 전 확인/);
    assert.match(panel.textContent, /현재 장면 길이는 이 도구에서 지원되지 않습니다/);
    assert.match(panel.textContent, /다음 행동: 완료 영상을 연결하거나 설계에서 장면 길이를 확인하세요/);
    assert.match(panel.textContent, /Replicate에 보낼 영상 요청이 준비되었습니다\. 아직 전송되지 않았습니다/);
    assert.match(panel.textContent, /다음 행동: 영상 작업에서 프롬프트·길이·첫 화면을 확인하세요/);
    assert.doesNotMatch(panel.textContent, /현재 참조 구성으로는 영상 작업을 준비할 수 없습니다|참조 이미지와 작업 내용이 준비되었습니다/,
        'preflight copy disappears after work starts or finishes');
    assert.match(panel.textContent, /예상 결과: 이미지 1장|예상 결과: 영상 1개/);
    assert.doesNotMatch(panel.textContent, /DST 이미지|플로우|그록/);
    assert.doesNotMatch(panel.textContent, /private-|PROVIDER_UNAVAILABLE|FLOW_REFERENCE_COUNT_MUST_BE_ZERO_OR_TWO|GROK_DURATION_UNSUPPORTED|task_|result_|preparation_|reference_files|relative_path|request_spec|authorization_env|REPLICATE_API_TOKEN|api\.replicate\.com|claim|\.png|\.mp4|flow submit|grok submit|image\/png|video\/mp4|4096|8192|[a-f0-9]{64}/);
    assert.ok(byAttribute(panel, 'section', 'data-work-progress', ''));
    assert.ok(byAttribute(panel, 'section', 'data-work-lane', 'image'));
    assert.ok(byAttribute(panel, 'section', 'data-work-lane', 'video'));
    assert.equal(findAll(panel, 'span').some((span) => span.className.includes('text-[11px]')), false, 'progress UI uses no badges');

    await byAttribute(panel, 'button', 'aria-label', '작업 상태 새로고침').dispatchEvent({ type: 'click' });
    await byText(panel, 'button', '실행 목록 준비').dispatchEvent({ type: 'click' });
    await byText(panel, 'button', '결과 연결 확인').dispatchEvent({ type: 'click' });
    await byText(panel, 'button', '영상 작업 열기').dispatchEvent({ type: 'click' });
    assert.equal(refreshed, 1);
    assert.equal(staged, 1);
    assert.deepEqual(opened, [
        { kind: 'image', sequence: 1, candidateToken: '', imageIndex: 0, openConnector: true },
        { kind: 'video', sequence: 3, candidateToken: '', imageIndex: 0, openConnector: false },
    ]);
});

test('new project execution state safely overlays sanitized receipts by unique lane and sequence', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectExecutionPanel, deriveExecutionDisplayState } = await import('../src/components/pipeline/NewProjectExecutionPanel.js');
    const planTask = (sequence, taskToken, label = `장면 ${sequence}`) => ({
        task_token: taskToken, kind: 'scene_image', sequence, label, status: '준비', result_token: '',
    });
    const imagePlanTasks = [
        planTask(1, 'current-running'),
        planTask(2, 'current-result'),
        planTask(3, 'exact-result'),
        planTask(4, 'duplicate-plan-a'),
        planTask(4, 'duplicate-plan-b'),
        planTask(5, 'ambiguous-receipt'),
        planTask(6, 'sequence-mismatch'),
        planTask(7, 'different-token'),
        planTask(8, 'wrong-lane'),
    ];
    const receiptTasks = [
        { lane: 'image', sequence: 1, status: 'running', progress: 37, result_received: false },
        { lane: 'image', sequence: 2, status: 'succeeded', progress: 100, result_received: true, result_match_status: 'ready', path: '/private/result.mp4', url: 'https://private.invalid/result.mp4' },
        { task_token: 'exact-result', lane: 'image', sequence: 3, status: 'failed', progress: 19, result_received: false, failure_label: '안전한 오류' },
        { lane: 'image', sequence: 3, status: 'running', progress: 88, result_received: false },
        { lane: 'image', sequence: 4, status: 'running', progress: 44, result_received: false },
        { lane: 'image', sequence: 5, status: 'running', progress: 51, result_received: false },
        { lane: 'image', sequence: 5, status: 'succeeded', progress: 100, result_received: true },
        { task_token: 'sequence-mismatch', lane: 'image', sequence: 60, status: 'running', progress: 60, result_received: false },
        { task_token: 'some-other-task', lane: 'image', sequence: 7, status: 'running', progress: 70, result_received: false },
        { lane: 'video', sequence: 8, status: 'running', progress: 80, result_received: false },
    ];

    const state = deriveExecutionDisplayState({
        executionState: { tasks: receiptTasks },
        imagePlanTasks,
        videoPlanTasks: [],
    });
    const bySequence = (sequence) => state.tasks.filter((task) => task.lane === 'image' && task.sequence === sequence);

    assert.deepEqual(bySequence(1).map(({ status, progress, result_received }) => ({ status, progress, result_received })), [
        { status: 'running', progress: 37, result_received: false },
    ]);
    assert.deepEqual(bySequence(2).map(({ status, progress, result_received, result_match_status }) => ({ status, progress, result_received, result_match_status })), [
        { status: 'succeeded', progress: 100, result_received: true, result_match_status: 'ready' },
    ]);
    assert.deepEqual(bySequence(3).map(({ status, progress }) => ({ status, progress })), [
        { status: 'failed', progress: 19 },
    ], 'the exact lane and task token match wins over the sanitized sequence candidate');
    assert.deepEqual(bySequence(4).map(({ status, progress }) => ({ status, progress })), [
        { status: 'queued', progress: 0 },
        { status: 'queued', progress: 0 },
    ], 'duplicate plan sequences are not overlaid');
    assert.deepEqual(bySequence(5).map(({ status, progress }) => ({ status, progress })), [
        { status: 'queued', progress: 0 },
    ], 'duplicate receipt sequences are not overlaid');
    assert.equal(bySequence(6)[0].status, 'queued', 'an exact token with a different sequence is not overlaid');
    assert.equal(bySequence(7)[0].status, 'queued', 'a different non-empty receipt token cannot use sequence fallback');
    assert.equal(bySequence(8)[0].status, 'queued', 'a receipt from a different lane is not overlaid');

    const panel = NewProjectExecutionPanel({
        executionState: { tasks: receiptTasks }, imagePlanTasks, videoPlanTasks: [],
    });
    assert.match(panel.textContent, /진행 중 37%|결과 도착 · 연결 준비됨/);
    assert.doesNotMatch(panel.textContent, /current-|exact-result|duplicate-|sequence-mismatch|some-other-task|\/private\/|private\.invalid/);
    assert.doesNotMatch(JSON.stringify(state), /\/private\/|private\.invalid/,
        'synthetic receipt paths and URLs are not retained in derived renderer state');
});

test('subset retry receipt keeps original scene three identity in the renderer fallback', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { deriveExecutionDisplayState } = await import('../src/components/pipeline/NewProjectExecutionPanel.js');
    const planTask = (sequence) => ({
        task_token: `scene-${sequence}`, kind: 'scene_image', sequence,
        label: `장면 ${sequence}`, status: '준비', result_token: '',
    });
    const state = deriveExecutionDisplayState({
        executionState: {
            tasks: [{ lane: 'image', sequence: 3, status: 'running', progress: 63, result_received: false }],
        },
        imagePlanTasks: [planTask(1), planTask(3)],
        videoPlanTasks: [],
    });
    assert.deepEqual(state.tasks.map(({ sequence, status, progress }) => ({ sequence, status, progress })), [
        { sequence: 1, status: 'queued', progress: 0 },
        { sequence: 3, status: 'running', progress: 63 },
    ]);
});

test('new project progress exposes image and video preparation next actions', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectExecutionPanel } = await import('../src/components/pipeline/NewProjectExecutionPanel.js');
    const opened = [];
    const empty = NewProjectExecutionPanel({
        executionState: { tasks: [] }, imagePlanTasks: [], videoPlanTasks: [],
        onOpenNextAction: (action) => opened.push(action),
    });
    await byText(empty, 'button', '이미지 작업 준비').dispatchEvent({ type: 'click' });

    const imageTask = {
        task_token: 'image-current', kind: 'character_sheet', sequence: 1, label: '주인공',
        status: '결과연결', result_token: 'image-result', reference_task_ids: [],
    };
    const imageReady = NewProjectExecutionPanel({
        executionState: { tasks: [] },
        imagePlanState: {
            tasks: [imageTask], review_decisions: [{ task_token: imageTask.task_token, decision: 'use' }],
        },
        videoPlanTasks: [],
        onOpenNextAction: (action) => opened.push(action),
    });
    await byText(imageReady, 'button', '영상 작업 준비').dispatchEvent({ type: 'click' });

    assert.deepEqual(opened, [
        { id: 'image-work', label: '이미지 작업 준비', tab: 'assets' },
        { id: 'video-work', label: '영상 작업 준비', tab: 'videos' },
    ]);
});

test('next-stage controls and review use counts require a connected reviewed result', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { GenerationPreparationPanel } = await import('../src/components/pipeline/GenerationPreparationPanel.js');
    const { VideoPreparationPanel } = await import('../src/components/pipeline/VideoPreparationPanel.js');
    const { ReviewGatesPanel } = await import('../src/components/pipeline/ReviewGatesPanel.js');
    const pendingImage = {
        task_token: 'image-task', kind: 'character_sheet', sequence: 1, label: '주인공', prompt: '프롬프트',
        reference_task_ids: [], status: '준비', result_token: '',
    };
    const pendingVideo = {
        task_token: 'video-task', kind: 'scene_video', sequence: 1, label: '첫 장면', provider: 'flow', prompt: '프롬프트',
        status: '준비', result_token: '',
    };
    const imageDecision = [{ task_token: pendingImage.task_token, decision: 'use' }];
    const videoDecision = [{ task_token: pendingVideo.task_token, decision: 'use' }];
    const pendingImagePanel = GenerationPreparationPanel({
        state: {}, config: { productionRoot: '' }, imagePlanTasks: [pendingImage],
        imagePlanState: { tasks: [pendingImage], review_decisions: imageDecision },
        onOpenImageResultReview() {}, onOpenImageNext() {},
    });
    const pendingVideoPanel = VideoPreparationPanel({
        videoPlanTasks: [pendingVideo], videoPlanState: { tasks: [pendingVideo], review_decisions: videoDecision },
        onOpenVideoNext() {},
    });
    const pendingGates = ReviewGatesPanel({
        state: {}, imagePlanTasks: [pendingImage],
        imagePlanState: { tasks: [pendingImage], review_decisions: imageDecision },
    });

    assert.equal(byText(pendingImagePanel, 'button', '영상 작업으로'), null);
    assert.equal(byText(pendingImagePanel, 'button', '결과 검토로'), null);
    assert.equal(byText(pendingVideoPanel, 'button', '클립 선택으로'), null);
    assert.match(pendingGates.textContent, /사용 0\/1 · 확인 1 · 다시 0/);

    const connectedImage = { ...pendingImage, status: '결과연결', result_token: 'image-result' };
    const connectedVideo = { ...pendingVideo, status: '결과연결', result_token: 'video-result' };
    const readyImagePanel = GenerationPreparationPanel({
        state: {}, config: { productionRoot: '' }, imagePlanTasks: [connectedImage],
        imagePlanState: { tasks: [connectedImage], review_decisions: imageDecision }, onOpenImageNext() {},
    });
    const readyVideoPanel = VideoPreparationPanel({
        videoPlanTasks: [connectedVideo], videoPlanState: { tasks: [connectedVideo], review_decisions: videoDecision },
        onOpenVideoNext() {},
    });
    const readyGates = ReviewGatesPanel({
        state: {}, imagePlanTasks: [connectedImage],
        imagePlanState: { tasks: [connectedImage], review_decisions: imageDecision },
    });

    assert.ok(byText(readyImagePanel, 'button', '영상 작업으로'));
    assert.ok(byText(readyVideoPanel, 'button', '클립 선택으로'));
    assert.match(readyGates.textContent, /사용 1\/1 · 확인 0 · 다시 0/);

    const reviewCalls = [];
    const reviewImagePanel = GenerationPreparationPanel({
        state: {}, config: { productionRoot: '' }, imagePlanTasks: [connectedImage],
        imagePlanState: { tasks: [connectedImage], review_decisions: [] },
        onOpenImageResultReview: () => reviewCalls.push('review'), onOpenImageNext() {},
    });
    const reviewButton = byText(reviewImagePanel, 'button', '결과 검토로');
    assert.ok(reviewButton, 'a connected unreviewed image exposes the review action without opening details');
    await reviewButton.dispatchEvent({ type: 'click' });
    assert.deepEqual(reviewCalls, ['review']);
    assert.equal(byText(reviewImagePanel, 'button', '영상 작업으로'), null);
});

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
    const projectTitles = [];
    window.addEventListener('pipeline:project-title', (event) => projectTitles.push(event.detail?.title));
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();

    await flushRenderer();
    assert.equal(projectTitles.at(-1), 'Restored Production State');
    assert.deepEqual(calls.find(([method]) => method === 'getHarnessContractStatus')[1], []);
    assert.deepEqual(
        calls.filter(([method]) => method === 'readProductionState').map(([, args]) => args),
        [[]],
        'saved productionRoot must restore renderer state without a renderer-supplied path',
    );
    assert.ok(byText(studio, 'h1', '지금 할 일'));
    assert.match(studio.textContent, /클립을 검토하고 사용할 구간을 선택하세요/);
    assert.ok(byText(studio, 'button', '클립 QA 열기'));
    assert.match(studio.textContent, /채택한 구간이 0개라 최종 편집을 시작할 수 없습니다/);
    assert.match(studio.textContent, /바로 할 수 있음/);
    assert.match(studio.textContent, /준비 후 가능/);
    assert.match(studio.textContent, /앱에서 실행 안 함/);
    assert.equal(findAll(studio, 'h1').length, 1, 'the overview must own the single page h1');
    assert.equal(findAll(studio, 'main').length, 0, 'PipelineStudio must not nest a main landmark inside the app main');

    const workflowNav = byAttribute(studio, 'nav', 'aria-label', '파이프라인 작업 단계');
    assert.ok(workflowNav, 'workflow navigation must have a Korean accessible name');
    assert.ok(byAttribute(studio, 'button', 'aria-current', 'step'), 'active workflow stage must expose aria-current=step');
    for (const [number, label] of [['1', '기획·대본'], ['2', '설계'], ['3', '생성 준비'], ['4', '클립 선택'], ['5', '마무리']]) {
        assert.ok(byAttribute(studio, 'button', 'aria-label', `${number} ${label}`), `${label} stage must be rendered`);
    }
    assert.deepEqual(
        findAll(byAttribute(studio, 'dl', 'aria-label', '파이프라인 파일 상태'), 'dt')
            .map((node) => node.textContent.trim()),
        ['파일', '파싱', '검토', '채택'],
        'file evidence must be a compact four-metric strip',
    );
    await byText(studio, 'button', '클립 QA 열기').dispatchEvent({ type: 'click' });
    assert.ok(byText(studio, 'h2', '클립 선택'), 'overview CTA must open the clip selection panel');
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'overview' } });
    const mobileWorkflow = byAttribute(studio, 'select', 'aria-label', '파이프라인 작업 단계');
    assert.ok(mobileWorkflow, 'mobile workflow select must have a Korean accessible name');
    assert.equal(mobileWorkflow.childNodes.length, 5, 'mobile workflow must expose exactly five stages');
    mobileWorkflow.value = 'design';
    await mobileWorkflow.dispatchEvent({ type: 'change' });
    assert.ok(byText(studio, 'h2', '스토리보드'), 'mobile workflow change must render the storyboard panel');
    assert.equal(
        byAttribute(studio, 'select', 'aria-label', '파이프라인 작업 단계').value,
        'design',
        'the rerendered mobile workflow select must preserve the selected step',
    );
    const details = findAll(studio, 'details');
    assert.ok(details.length >= 1, 'production tools must use progressive disclosure');
    const resultReviewDetails = details.find((node) => byText(node, 'summary', '기존 제작 결과'));
    assert.ok(resultReviewDetails && !resultReviewDetails.attributes.has('open'), 'existing-production review stays collapsed by default');

    const openFolder = byText(studio, 'button', '제작 폴더 열기');
    assert.ok(openFolder, 'folder-selection UI must be rendered in Korean');
    await openFolder.dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.equal(projectTitles.at(-1), 'Folder Selected Production');
    assert.equal(calls.filter(([method]) => method === 'selectProductionRoot').length, 1);
    assert.deepEqual(calls.find(([method]) => method === 'selectProductionRoot')[1], { mode: 'production' });

    const refresh = byText(studio, 'button', '목록 새로고침');
    assert.ok(refresh, 'production refresh control must be rendered in Korean');
    await refresh.dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(studio.textContent, /상위 폴더를 읽을 수 없습니다: 로컬 경로 안전 정책에 따라 요청이 차단되었습니다/);
    assert.ok(byText(studio, 'button', '목록 새로고침'), 'reader error must expose a Korean retry action');

    const stages = [
        ['1 기획·대본', [['기획·대본', '기획·대본']]],
        ['2 설계', [['스토리보드', '스토리보드'], ['샷 설계', '샷 설계'], ['모션 보드', '모션 보드']]],
        ['3 생성 준비', [['작업 진행', '작업 진행'], ['이미지 작업', '이미지 작업'], ['영상 작업', '영상 작업'], ['프롬프트 팩', '프롬프트 팩'], ['검토 게이트', '검토 게이트']]],
        ['4 클립 선택', [['클립 QA', '클립 선택']]],
        ['5 마무리', [['최종 편집', '최종 편집·보고서']]],
    ];

    const renderedPanelTexts = [];
    for (const [stageLabel, tabs] of stages) {
        await byAttribute(studio, 'button', 'aria-label', stageLabel).dispatchEvent({ type: 'click' });
        for (const [tabLabel, panelHeading] of tabs) {
            const tab = byText(studio, 'button', tabLabel);
            assert.ok(tab, `${tabLabel} subtask must be rendered in its active stage`);
            await tab.dispatchEvent({ type: 'click' });
            assert.ok(findAll(studio, 'h2').some((heading) => heading.textContent.trim() === panelHeading));
            assert.equal(byText(studio, 'button', tabLabel).attributes.get('aria-current'), 'page');
            renderedPanelTexts.push(studio.textContent);
        }
    }
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'settings' } });
    assert.ok(byText(studio, 'h2', '파이프라인 설정'));
    assert.equal(byText(studio, 'button', '설정'), null, 'settings must not appear in the stage list');
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

    await byAttribute(studio, 'button', 'aria-label', '3 생성 준비').dispatchEvent({ type: 'click' });
    const visibleBadgeLabels = () => findAll(studio, 'span')
        .filter((span) => span.className.includes('text-[11px]'))
        .map((span) => span.textContent.trim());

    assert.ok(byText(studio, 'h2', '작업 진행'));
    assert.match(studio.textContent, /시작 전 0 · 진행 0 · 결과 0 · 문제 0/);
    assert.deepEqual(visibleBadgeLabels(), []);

    await byText(studio, 'button', '이미지 작업').dispatchEvent({ type: 'click' });
    assert.match(studio.textContent, /기존 제작 폴더의 검토 수만 보여 줍니다/);
    assert.deepEqual(visibleBadgeLabels(), []);

    await byText(studio, 'button', '프롬프트 팩').dispatchEvent({ type: 'click' });
    assert.deepEqual(visibleBadgeLabels(), []);

    await byText(studio, 'button', '검토 게이트').dispatchEvent({ type: 'click' });
    assert.deepEqual(visibleBadgeLabels(), [], 'review gate states stay readable without repeated badges');
    assert.match(studio.textContent, /통과|준비 필요|검토 전|확인 필요/);

    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'queue' } });
    const queueText = studio.textContent;
    assert.match(queueText, /Canonical 하네스 연결통과/);
    assert.match(queueText, /라이브 제출은 차단/);
    assert.match(queueText, /필요할 때만 펼쳐서 명령 내용을 확인하세요/);
    assert.match(queueText, /복사 불가/);
    assert.match(queueText, /생성 승인 필요/);
    assert.doesNotMatch(queueText, /CREDIT_CONFIRMATION_REQUIRED|DREAMINA_PREFLIGHT_BLOCKED/);
    assert.deepEqual(visibleBadgeLabels(), []);
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
    const usableButton = byText(usable, 'button', '복사 불가');
    assert.ok(usableButton);
    assert.equal(usableButton.disabled, true);
    await usableButton.dispatchEvent({ type: 'click' });
    assert.equal(calls.length, 0, 'renderer-owned preview must not reach clipboard IPC');
});

test('MOCK media review board updates selection and filter, then saves the exact review draft payload', async (t) => {
    const calls = [];
    let planRefreshes = 0;
    let reportedSaveStatus = '';
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { StoryboardPanel } = await import('../src/components/pipeline/StoryboardPanel.js');
    const state = {
        project: { root_path: '/tmp/media-review-production' },
        storyboard: [{ clip_id: 'clip_001', scene_id: 'scene_01', dramatic_beat: '검토 장면' }],
        mediaAttempts: [{
            media_id: 'scene-image-1',
            kind: 'scene_image',
            target_id: 'clip_001',
            provider: 'dst',
            operation_id: 'dst-001',
            attempt: 1,
            path: '',
            generation_status: 'downloaded',
            review_status: 'unreviewed',
            review_note: '',
            selected_for_retry: false,
        }],
    };
    const board = StoryboardPanel({
        state,
        mediaRetryPlan: {
            schema: 'film_pipeline.media_retry_plan.v1',
            execution: 'not_run',
            status: 'preview_ready',
            ready: true,
            blockers: [],
            executed: false,
            items: [{
                sequence: 1,
                media_id: 'scene-image-1',
                kind: 'scene_image',
                target_id: 'clip_001',
                provider: 'dst',
                readiness: 'preview_ready',
                blockers: [],
                executed: false,
                command_spec: {
                    id: 'retry_scene-image-1',
                    label: 'DeepSearchTeam dst image · clip_001',
                    command: '/Users/jessiek/.pyenv/versions/3.11.7/bin/python',
                    args: ['-m', 'dst', 'image', 'retry prompt', '-p', 'goldpure369'],
                    cwd: '/Users/jessiek/StudioProjects/deepSearchTeam',
                    preview_only: true,
                    side_effect_type: 'credit_consuming_generation',
                    requires_confirmation: true,
                    copy_allowed: true,
                    disabled_reason: 'CREDIT_CONSUMING_GENERATION_PREVIEW_ONLY',
                },
            }],
        },
        async onSavePlanningFile(payload) {
            calls.push(payload);
            return { ok: true, written: true, executed: false };
        },
        async onRefreshMediaRetryPlan() {
            planRefreshes += 1;
            return { status: 'preview_ready', items: [] };
        },
        onMediaReviewSaveStatusChange(status) {
            reportedSaveStatus = status;
        },
    });

    assert.match(board.textContent, /다시 만들기 0개 선택/);
    assert.match(board.textContent, /실행 안 함/);
    assert.match(board.textContent, /제공자별 다시 만들기 계획/);
    assert.match(board.textContent, /1번/);
    assert.match(board.textContent, /미리보기 준비/);
    assert.match(board.textContent, /goldpure369/);
    assert.equal(findAll(board, 'button').some((button) => /^(?:run|execute|명령 실행|생성 실행)$/i.test(button.textContent.trim())), false);
    const note = byAttribute(board, 'textarea', 'aria-label', 'scene-image-1 검토 메모');
    note.value = '손 모양과 조명을 수정';
    await note.dispatchEvent({ type: 'input' });
    const retryCardButton = findAll(board, 'button').find((button) => (
        button.textContent.trim() === '다시 만들기' && !button.attributes.has('aria-pressed')
    ));
    await retryCardButton.dispatchEvent({ type: 'click' });
    assert.match(board.textContent, /다시 만들기 1개 선택/);
    assert.ok(byText(board, 'button', '선택 해제'));

    const retryFilterButton = findAll(board, 'button').find((button) => (
        button.textContent.trim() === '다시 만들기 선택' && button.attributes.has('aria-pressed')
    ));
    await retryFilterButton.dispatchEvent({ type: 'click' });
    assert.equal(byText(board, 'button', '선택 해제') !== null, true, 'filter button remains available after card label changes');
    assert.match(board.textContent, /scene-image-1|clip_001/);

    await byText(board, 'button', '선택 항목 순차 대기열에 담기').dispatchEvent({ type: 'click' });
    assert.match(board.textContent, /실행 안 함 · 순차 대기열 1개/);
    assert.match(board.textContent, /실제 이미지·영상 생성은 시작되지 않습니다|clip_001/);
    await byText(board, 'button', '검토 초안 저장').dispatchEvent({ type: 'click' });

    assert.equal(calls.length, 1);
    assert.equal(planRefreshes, 1, 'successful draft save must refresh the pathless main-owned plan');
    assert.equal(reportedSaveStatus, '검토 초안 저장됨');
    assert.equal(calls[0].rootPath, '/tmp/media-review-production');
    assert.equal(calls[0].relativePath, 'reviews/media_review_draft.json');
    const saved = JSON.parse(calls[0].content);
    assert.equal(saved.schema, 'film_pipeline.media_review_draft.v1');
    assert.equal(saved.execution, 'not_run');
    assert.deepEqual(saved.reviews, [{
        media_id: 'scene-image-1',
        review_status: 'retry_requested',
        review_note: '손 모양과 조명을 수정',
        selected_for_retry: true,
    }]);
    assert.deepEqual(saved.retry_queue.map(({ sequence, media_id, execution_status }) => ({ sequence, media_id, execution_status })), [{
        sequence: 1,
        media_id: 'scene-image-1',
        execution_status: 'draft_not_executed',
    }]);
    assert.equal(saved.retry_queue[0].attempt, 1);

    await byText(board, 'button', '실행 계획 확인').dispatchEvent({ type: 'click' });
    assert.equal(planRefreshes, 2);

    const rerendered = StoryboardPanel({
        state,
        mediaRetryPlan: { status: 'empty', blockers: [], items: [] },
        mediaReviewSaveStatus: reportedSaveStatus,
    });
    assert.match(rerendered.textContent, /검토 초안 저장됨/);
});

test('new-project media review keeps reference sheets and scene image-video pairs together with pathless retry controls', async (t) => {
    const decisions = [];
    const opened = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectMediaReviewBoard } = await import('../src/components/pipeline/NewProjectMediaReviewBoard.js');
    const png = { preview: { mime_type: 'image/png', base64: 'iVBORw0KGgo=' } };
    const imageTasks = [
        {
            task_token: 'private-scene-2', kind: 'scene_image', source_id: 'scene_02', sequence: 4,
            label: '장면 이미지 · 두 번째 장면', status: '준비', result_token: '', private_path: '/private/scene-2.png',
        },
        {
            task_token: 'private-character', kind: 'character_sheet', source_id: 'character_01', sequence: 1,
            label: '인물 시트 · 지아', status: '결과연결', result_token: 'private-character-result', revision_sha256: 'a'.repeat(64),
        },
        {
            task_token: 'private-location', kind: 'location_sheet', source_id: 'location_01', sequence: 2,
            label: '장소 시트 · 상담실', status: '재제작', result_token: 'private-location-result', provider: 'private-provider-code',
        },
        {
            task_token: 'private-scene-1', kind: 'scene_image', source_id: 'scene_01', sequence: 3,
            label: '장면 이미지 · 첫 번째 장면', status: '결과연결', result_token: 'private-scene-result',
        },
    ];
    const videoTasks = [
        {
            task_token: 'private-video-2', kind: 'scene_video', source_id: 'scene_02', sequence: 2,
            label: '장면 영상 · 두 번째 장면', status: '재제작', result_token: 'private-video-result-2',
            provider: 'grok', command: '/private/grok.py', provider_code: 'GROK_PRIVATE_CODE',
        },
        {
            task_token: 'private-video-1', kind: 'scene_video', source_id: 'scene_01', sequence: 1,
            label: '장면 영상 · 첫 번째 장면', status: '결과연결', result_token: 'private-video-result-1', provider: 'flow',
        },
    ];
    const board = NewProjectMediaReviewBoard({
        designBoard: {
            scenes: [
                { id: 'scene_01', title: '첫 번째 장면' },
                { id: 'scene_02', title: '두 번째 장면' },
            ],
        },
        imagePlanTasks: imageTasks,
        imageReviewDecisions: [
            { task_token: 'private-character', result_token: 'private-character-result', decision: 'use' },
            { task_token: 'private-location', result_token: 'private-location-result', decision: 'retry' },
            { task_token: 'private-scene-1', result_token: 'private-scene-result', decision: 'pending' },
        ],
        imageResultPreviews: {
            'private-character-result': png,
            'private-location-result': png,
            'private-scene-result': { ...png, source_path: '/private/hidden-scene.png' },
        },
        videoPlanTasks: videoTasks,
        videoReviewDecisions: [
            { task_token: 'private-video-1', result_token: 'private-video-result-1', decision: 'use' },
            { task_token: 'private-video-2', result_token: 'private-video-result-2', decision: 'retry' },
        ],
        videoResultPreviews: {
            'private-video-result-1': { source: 'blob:safe-new-project-video', source_path: '/private/hidden-video.mp4' },
            'private-video-result-2': { source: '/private/not-a-renderable-video.mp4' },
        },
        onSaveImageReviewDecision: (taskToken, decision) => decisions.push(['image', taskToken, decision]),
        onSaveVideoReviewDecision: (taskToken, decision) => decisions.push(['video', taskToken, decision]),
        onOpenWorkItem: (payload) => opened.push(payload),
    });

    assert.match(board.textContent, /인물 기준.*인물 시트 · 지아.*장소 기준.*장소 시트 · 상담실.*첫 번째 장면.*장면 이미지 · 첫 번째 장면.*장면 영상 · 첫 번째 장면.*두 번째 장면.*장면 이미지 · 두 번째 장면.*장면 영상 · 두 번째 장면/s);
    assert.deepEqual(findAll(board, 'article').map((card) => findAll(card, 'h4')[0].textContent), [
        '인물 시트 · 지아',
        '장소 시트 · 상담실',
        '장면 이미지 · 첫 번째 장면',
        '장면 영상 · 첫 번째 장면',
        '장면 이미지 · 두 번째 장면',
        '장면 영상 · 두 번째 장면',
    ]);
    assert.ok(byAttribute(board, 'img', 'alt', '인물 시트 · 지아 결과'));
    assert.ok(byAttribute(board, 'video', 'src', 'blob:safe-new-project-video'));
    assert.equal(findAll(board, 'video').some((video) => video.attributes.get('src')?.includes('/private/')), false);
    assert.equal(findAll(board, 'span').filter((node) => node.className.includes('text-[11px]')).length, 0, 'new review must not add badges');
    assert.doesNotMatch(board.textContent, /private-|revision_sha256|GROK_PRIVATE_CODE|\/private\/|private-provider-code/);
    assert.match(board.textContent, /확인 필요 1 · 사용 2 · 다시 만들기 2/);
    assert.match(board.textContent, /다음 할 일: 이미지 1개 다시 만들기 준비/);
    assert.match(board.textContent, /이미지를 다시 만든 뒤 영상 검토를 이어가세요/);
    const imageRetryAction = byText(board, 'button', '이미지 작업 열기');
    assert.match(imageRetryAction.className, /min-h-11/);
    await imageRetryAction.dispatchEvent({ type: 'click' });
    assert.deepEqual(opened, [{ kind: 'image', sequence: 2 }]);
    opened.length = 0;

    const characterCard = findAll(board, 'article').find((card) => card.textContent.includes('인물 시트 · 지아'));
    await byText(characterCard, 'button', '작업 열기').dispatchEvent({ type: 'click' });
    assert.deepEqual(opened, [{ kind: 'image', sequence: 1 }]);
    await byText(characterCard, 'button', '이 결과 사용').dispatchEvent({ type: 'click' });
    assert.deepEqual(decisions.at(-1), ['image', 'private-character', 'use']);
    await byText(characterCard, 'button', '다시 만들기').dispatchEvent({ type: 'click' });
    assert.deepEqual(decisions.at(-1), ['image', 'private-character', 'retry']);
    assert.match(board.textContent, /확인 필요 1 · 사용 1 · 다시 만들기 3/);

    await byText(board, 'button', '검토할 결과').dispatchEvent({ type: 'click' });
    assert.match(board.textContent, /장면 이미지 · 첫 번째 장면/);
    assert.doesNotMatch(board.textContent, /인물 시트 · 지아|장소 시트 · 상담실|두 번째 장면/);

    await byText(board, 'button', '다시 만들기').dispatchEvent({ type: 'click' });
    assert.match(board.textContent, /인물 시트 · 지아.*장소 시트 · 상담실.*장면 영상 · 두 번째 장면/s);
    assert.doesNotMatch(board.textContent, /장면 이미지 · 첫 번째 장면|장면 영상 · 첫 번째 장면/);
    const retryVideoCard = findAll(board, 'article').find((card) => card.textContent.includes('장면 영상 · 두 번째 장면'));
    await byText(retryVideoCard, 'button', '작업 열기').dispatchEvent({ type: 'click' });
    await byText(retryVideoCard, 'button', '이 결과 사용').dispatchEvent({ type: 'click' });
    assert.deepEqual(opened.at(-1), { kind: 'video', sequence: 2 });
    assert.deepEqual(decisions.at(-1), ['video', 'private-video-2', 'use']);
    assert.doesNotMatch(board.textContent, /private-|GROK_PRIVATE_CODE|\/private\//);

    const videoOnlyOpened = [];
    const videoOnly = NewProjectMediaReviewBoard({
        designBoard: { scenes: [{ id: 'scene_02', title: '두 번째 장면' }] },
        imagePlanTasks: imageTasks.map((task) => ({ ...task, status: task.result_token ? '결과연결' : '준비' })),
        imageReviewDecisions: imageTasks.filter((task) => task.result_token).map((task) => ({
            task_token: task.task_token, result_token: task.result_token, decision: 'use',
        })),
        videoPlanTasks: [videoTasks[0]],
        videoReviewDecisions: [{ task_token: 'private-video-2', result_token: 'private-video-result-2', decision: 'retry' }],
        reviewNotice: '결과 선택을 저장하지 못했습니다. 다시 선택하세요.',
        onOpenWorkItem: (payload) => videoOnlyOpened.push(payload),
    });
    assert.match(videoOnly.textContent, /다음 할 일: 영상 1개 다시 만들기 준비/);
    assert.match(videoOnly.textContent, /결과 선택을 저장하지 못했습니다\. 다시 선택하세요/);
    assert.equal(byText(videoOnly, 'button', '이미지 작업 열기'), null);
    await byText(videoOnly, 'button', '영상 작업 열기').dispatchEvent({ type: 'click' });
    assert.deepEqual(videoOnlyOpened, [{ kind: 'video', sequence: 2 }]);
    assert.doesNotMatch(videoOnly.textContent, /private-|GROK_PRIVATE_CODE|\/private\//);
});

test('new project clip selection uses Korean native controls and never auto-accepts a whole video', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectClipSelectionPanel } = await import('../src/components/pipeline/NewProjectClipSelectionPanel.js');
    const changes = [];
    let saves = 0;
    const clip = {
        task_token: `task_${'a'.repeat(64)}`, result_token: `result_${'b'.repeat(64)}`,
        sequence: 1, source_id: 'scene_01', label: '장면 영상 · 첫 장면', duration_seconds: 5,
        in_seconds: null, out_seconds: null, reason: '', reviewer_confidence: 'medium',
    };
    const panel = NewProjectClipSelectionPanel({
        selectionState: { ok: true, status: 'empty', accepted_count: 0, total_count: 1 },
        clips: [clip], resultPreviews: { [clip.result_token]: { source: 'blob:test-video' } },
        dirty: true, notice: '저장하지 않은 선택이 있습니다.',
        onChange: (taskToken, patch) => changes.push([taskToken, patch]),
        onSave: () => { saves += 1; },
    });
    assert.match(panel.textContent, /선택 0\/1/);
    assert.match(panel.textContent, /영상 전체가 자동으로 선택되지는 않습니다/);
    assert.doesNotMatch(panel.textContent, /PASS|BLOCK|badge/i);
    assert.ok(byText(panel, 'button', '여기를 시작으로'));
    assert.ok(byText(panel, 'button', '여기를 끝으로'));
    assert.ok(byText(panel, 'button', '선택 지우기'));
    await byText(panel, 'button', '전체 구간').dispatchEvent({ type: 'click' });
    assert.deepEqual(changes.at(-1), [clip.task_token, { in_seconds: 0, out_seconds: 5, reason: '전체 구간 사용' }]);
    const start = byAttribute(panel, 'input', 'aria-label', `${clip.label} 시작 초`);
    start.value = '1.25';
    await start.dispatchEvent({ type: 'input', target: start });
    assert.deepEqual(changes.at(-1), [clip.task_token, { in_seconds: 1.25 }]);
    await byText(panel, 'button', '선택 저장').dispatchEvent({ type: 'click' });
    assert.equal(saves, 1);
    assert.equal(findAll(panel, 'button').every((button) => button.className.includes('min-h-11')), true);
});

test('new project final stitch stays simple, stages an exact pathless revision, and restores ready copy', async (t) => {
    const calls = [];
    const ready = {
        ok: true, status: 'ready', revision: `handoff_${'a'.repeat(64)}`, staged: false,
        selected_count: 2, total_duration_seconds: 6.5,
        clips: [
            { sequence: 1, label: '장면 1', in_seconds: 0.5, out_seconds: 3.5 },
            { sequence: 2, label: '장면 2', in_seconds: 1, out_seconds: 4.5 },
        ], blockers: [], executed: false, rendered: false, generation_executed: false,
    };
    const bridge = {
        async getNewProjectFinalStitch() { calls.push(['getFinal']); return structuredClone(ready); },
        async stageNewProjectFinalStitch(payload) {
            calls.push(['stageFinal', structuredClone(payload)]);
            return { ...structuredClone(ready), status: 'staged', staged: true, saved: true };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'final' } });
    assert.ok(byText(studio, 'h3', '최종 편집 준비'));
    assert.match(studio.textContent, /선택 2개 · 총 6.5초/);
    assert.match(studio.textContent, /아직 영상을 합치거나 완성하지 않습니다/);
    assert.ok(byText(studio, 'summary', '기존 제작 마감 결과'));
    await byText(studio, 'button', '최종 편집 준비 저장').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'stageFinal'), [
        'stageFinal', { expected_revision: ready.revision },
    ]);
    assert.match(studio.textContent, /준비됨 · 아직 영상으로 합치지 않음/);
    assert.doesNotMatch(studio.textContent.split('기존 제작 마감 결과')[0], /sha256|task_token|result_token|source_path/);
});

test('blocked final stitch points back to clip selection without badges', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectFinalStitchPanel } = await import('../src/components/pipeline/NewProjectFinalStitchPanel.js');
    let opened = 0;
    const panel = NewProjectFinalStitchPanel({
        state: { ok: false, status: 'blocked', clips: [], blockers: ['PRIVATE_BLOCKER'] },
        onOpenClipSelection: () => { opened += 1; },
    });
    assert.match(panel.textContent, /모든 장면에서 사용할 구간을 먼저 선택/);
    assert.doesNotMatch(panel.textContent, /PRIVATE_BLOCKER|PASS|BLOCK|badge/i);
    await byText(panel, 'button', '클립 선택 열기').dispatchEvent({ type: 'click' });
    assert.equal(opened, 1);
    assert.equal(findAll(panel, 'button').every((button) => button.className.includes('min-h-11')), true);
});

test('MOCK: final panel stays usable while restore verifies and consumes inline preview without a second IPC', async (t) => {
    const calls = [];
    let resolveFinalRender;
    const pendingFinalRender = new Promise((resolve) => { resolveFinalRender = resolve; });
    const stitched = {
        ok: true, status: 'restored', revision: `handoff_${'a'.repeat(64)}`, staged: true,
        selected_count: 1, total_duration_seconds: 0.6,
        clips: [{ sequence: 1, label: '첫 장면', in_seconds: 0.2, out_seconds: 0.8 }],
        blockers: [], executed: false, rendered: false, generation_executed: false,
    };
    const bytes = Buffer.from('inline-mock-video');
    const rendered = {
        ok: true, status: 'already_current', can_render: false, rendered: true, selected_count: 1,
        selected_duration_seconds: 0.6, output_duration_seconds: 0.6, fresh_probe_verified: true,
        has_video: true, has_audio: true, preview_ready: true, executed: false,
        output_quality_approved: false, generation_executed: false,
        review_version: 'a'.repeat(64), review_decision: 'retry', review_ready: true,
        human_review_recorded: true, legacy_production_modified: false, canonical_delivery_modified: false,
        notice: '다시 만들기로 선택했습니다. 결과 검토에서 수정할 장면을 확인하세요.',
        preview: {
            ready: true, mime_type: 'video/mp4', byte_length: bytes.byteLength, base64: bytes.toString('base64'),
        },
    };
    const bridge = {
        async getNewProjectFinalStitch() { return structuredClone(stitched); },
        async getNewProjectFinalRender() {
            calls.push(['getRender']);
            return pendingFinalRender;
        },
        async getNewProjectFinalRenderPreview() {
            calls.push(['previewRender']);
            return { ready: false, mime_type: '', byte_length: 0, base64: '' };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'final' } });

    assert.match(studio.textContent, /검토용 영상을 확인하는 중입니다/);
    assert.equal(byText(studio, 'button', '검토용 영상 만들기'), null);
    assert.equal(calls.filter(([method]) => method === 'getRender').length, 1);

    resolveFinalRender(structuredClone(rendered));
    await flushRenderer();

    assert.ok(findAll(studio, 'video')[0]);
    assert.match(studio.textContent, /다시 만들기로 선택됨/);
    assert.equal(calls.filter(([method]) => method === 'previewRender').length, 0);
});

test('streamed final preview accepts only the exact pathless capability shape', async () => {
    const { createFinalRenderStreamPreview } = await import('../src/lib/pipeline/finalRenderStreamPreview.js');
    const token = 'd'.repeat(64);
    const valid = {
        ready: true,
        mime_type: 'video/mp4',
        byte_length: 32 * 1024 * 1024 + 1,
        stream_url: `film-preview://final-render/${token}/video.mp4`,
    };
    const prepared = createFinalRenderStreamPreview(valid);
    assert.equal(prepared.ok, true);
    assert.equal(prepared.url, valid.stream_url);
    assert.equal(typeof prepared.dispose, 'function');
    for (const candidate of [
        { ...valid, stream_url: `file:///private/${token}.mp4` },
        { ...valid, stream_url: `https://final-render/${token}/video.mp4` },
        { ...valid, stream_url: `${valid.stream_url}?path=/private` },
        { ...valid, stream_url: `${valid.stream_url}#private` },
        { ...valid, stream_url: `film-preview://user@final-render/${token}/video.mp4` },
        { ...valid, stream_url: `film-preview://final-render/${token}/other.mp4` },
        { ...valid, base64: 'private' },
        { ...valid, byte_length: 0 },
        { ...valid, mime_type: 'text/html' },
    ]) assert.equal(createFinalRenderStreamPreview(candidate).ok, false);
});

test('MOCK: final panel uses a validated stream capability without legacy preview IPC', async (t) => {
    const calls = [];
    const streamUrl = `film-preview://final-render/${'e'.repeat(64)}/video.mp4`;
    const stitched = {
        ok: true, status: 'restored', revision: `handoff_${'a'.repeat(64)}`, staged: true,
        selected_count: 1, total_duration_seconds: 0.6,
        clips: [{ sequence: 1, label: '첫 장면', in_seconds: 0.2, out_seconds: 0.8 }],
        blockers: [], executed: false, rendered: false, generation_executed: false,
    };
    const rendered = {
        ok: true, status: 'already_current', can_render: false, rendered: true, selected_count: 1,
        selected_duration_seconds: 0.6, output_duration_seconds: 0.6, fresh_probe_verified: true,
        has_video: true, has_audio: true, preview_ready: true, executed: false,
        output_quality_approved: false, generation_executed: false,
        review_version: 'a'.repeat(64), review_decision: 'pending', review_ready: true,
        human_review_recorded: false, legacy_production_modified: false, canonical_delivery_modified: false,
        notice: '검토용 영상이 준비되었습니다. 사용할지 직접 확인해 주세요.',
        preview: {
            ready: true, mime_type: 'video/mp4', byte_length: 32 * 1024 * 1024 + 1, stream_url: streamUrl,
        },
    };
    const bridge = {
        async getNewProjectFinalStitch() { return structuredClone(stitched); },
        async getNewProjectFinalRender() { calls.push(['getRender']); return structuredClone(rendered); },
        async getNewProjectFinalRenderPreview() {
            calls.push(['legacyPreview']);
            return { ready: false, mime_type: '', byte_length: 0, base64: '' };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'final' } });
    await flushRenderer();

    const video = findAll(studio, 'video')[0];
    assert.ok(video);
    assert.equal(video.attributes.get('src'), streamUrl);
    assert.equal(calls.filter(([method]) => method === 'getRender').length, 1);
    assert.equal(calls.filter(([method]) => method === 'legacyPreview').length, 0);
});

test('MOCK: a late initial final response cannot overwrite a newer user refresh', async (t) => {
    const calls = [];
    let resolveInitial;
    const pendingInitial = new Promise((resolve) => { resolveInitial = resolve; });
    const stitched = {
        ok: true, status: 'restored', revision: `handoff_${'a'.repeat(64)}`, staged: true,
        selected_count: 1, total_duration_seconds: 0.6,
        clips: [{ sequence: 1, label: '첫 장면', in_seconds: 0.2, out_seconds: 0.8 }],
        blockers: [], executed: false, rendered: false, generation_executed: false,
    };
    const staleReady = {
        ok: true, status: 'ready', can_render: true, rendered: false, selected_count: 1,
        selected_duration_seconds: 0.6, output_duration_seconds: 0, fresh_probe_verified: false,
        has_video: false, has_audio: false, preview_ready: false, executed: false,
        output_quality_approved: false, generation_executed: false,
        review_version: '', review_decision: 'pending', review_ready: false, human_review_recorded: false,
        legacy_production_modified: false, canonical_delivery_modified: false,
        notice: '선택한 구간으로 검토용 영상을 만들 수 있습니다.',
        preview: { ready: false, mime_type: '', byte_length: 0, base64: '' },
    };
    const bytes = Buffer.from('newer-inline-video');
    const refreshed = {
        ...staleReady, status: 'already_current', can_render: false, rendered: true,
        output_duration_seconds: 0.6, fresh_probe_verified: true, has_video: true, has_audio: true,
        preview_ready: true, review_version: 'b'.repeat(64), review_decision: 'retry',
        review_ready: true, human_review_recorded: true,
        notice: '다시 만들기로 선택했습니다. 결과 검토에서 수정할 장면을 확인하세요.',
        preview: {
            ready: true, mime_type: 'video/mp4', byte_length: bytes.byteLength, base64: bytes.toString('base64'),
        },
    };
    let getRenderCalls = 0;
    const bridge = {
        async getNewProjectFinalStitch() { return structuredClone(stitched); },
        async getNewProjectFinalRender() {
            getRenderCalls += 1;
            calls.push(['getRender', getRenderCalls]);
            return getRenderCalls === 1 ? pendingInitial : structuredClone(refreshed);
        },
        async getNewProjectFinalRenderPreview() {
            calls.push(['previewRender']);
            return { ready: false, mime_type: '', byte_length: 0, base64: '' };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'final' } });

    await byText(studio, 'button', '새로고침').dispatchEvent({ type: 'click' });
    await flushRenderer();
    const refreshedVideo = findAll(studio, 'video')[0];
    assert.ok(refreshedVideo);
    assert.match(studio.textContent, /다시 만들기로 선택됨/);

    resolveInitial(structuredClone(staleReady));
    await flushRenderer();

    assert.equal(findAll(studio, 'video')[0]?.attributes.get('src'), refreshedVideo.attributes.get('src'));
    assert.match(studio.textContent, /다시 만들기로 선택됨/);
    assert.equal(byText(studio, 'button', '검토용 영상 만들기'), null);
    assert.deepEqual(calls.filter(([method]) => method === 'getRender'), [['getRender', 1], ['getRender', 2]]);
    assert.equal(calls.filter(([method]) => method === 'previewRender').length, 0);
});

test('MOCK: rendered review video saves use or retry decisions and opens result review without internal data', async (t) => {
    const calls = [];
    const stitched = {
        ok: true, status: 'restored', revision: `handoff_${'a'.repeat(64)}`, staged: true,
        selected_count: 1, total_duration_seconds: 0.6,
        clips: [{ sequence: 1, label: '첫 장면', in_seconds: 0.2, out_seconds: 0.8 }],
        blockers: [], executed: false, rendered: false, generation_executed: false,
    };
    const ready = {
        ok: true, status: 'ready', can_render: true, rendered: false, selected_count: 1,
        selected_duration_seconds: 0.6, output_duration_seconds: 0, fresh_probe_verified: false,
        has_video: false, has_audio: false, preview_ready: false, executed: false,
        output_quality_approved: false, generation_executed: false,
        review_version: '', review_decision: 'pending', review_ready: false, human_review_recorded: false,
        legacy_production_modified: false, canonical_delivery_modified: false,
        notice: '선택한 구간으로 검토용 영상을 만들 수 있습니다.',
    };
    const rendered = {
        ...ready, status: 'already_current', can_render: false, rendered: true,
        output_duration_seconds: 0.6, fresh_probe_verified: true, has_video: true,
        has_audio: true, preview_ready: true, executed: true,
        review_version: 'a'.repeat(64), review_decision: 'pending', review_ready: true,
        human_review_recorded: false,
        notice: '검토용 영상이 준비되었습니다. 사용할지 직접 확인해 주세요.',
    };
    const bridge = {
        async getNewProjectDraftState() {
            return { status: 'saved', draft: { production_id: 'review-project-01', brief: '검토', script: '장면', route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 2 } };
        },
        async getNewProjectFinalStitch() { return structuredClone(stitched); },
        async getNewProjectFinalRender() { calls.push(['getRender']); return structuredClone(ready); },
        async planNewProjectFinalRender() {
            calls.push(['planRender']);
            return { ...structuredClone(ready), ready: true, plan_token: 'opaque-final-plan', expires_at: '2026-07-16T12:00:00Z' };
        },
        async executeNewProjectFinalRender(payload) {
            calls.push(['executeRender', structuredClone(payload)]);
            return structuredClone(rendered);
        },
        async getNewProjectFinalRenderPreview() {
            calls.push(['previewRender']);
            const bytes = Buffer.from('mock-video');
            return { ready: true, mime_type: 'video/mp4', byte_length: bytes.byteLength, base64: bytes.toString('base64') };
        },
        async saveNewProjectFinalReviewDecision(payload) {
            calls.push(['saveReview', structuredClone(payload)]);
            return {
                ...structuredClone(rendered),
                review_version: payload.decision === 'use' ? 'b'.repeat(64) : 'c'.repeat(64),
                review_decision: payload.decision,
                human_review_recorded: true,
                output_quality_approved: payload.decision === 'use',
            };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'final' } });
    assert.ok(byText(studio, 'button', '검토용 영상 만들기'));
    await byText(studio, 'button', '검토용 영상 만들기').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'executeRender'), [
        'executeRender', { planToken: 'opaque-final-plan', confirmed: true, projectId: 'review-project-01' },
    ]);
    const video = findAll(studio, 'video')[0];
    assert.ok(video);
    assert.equal(video.attributes.get('controls'), 'true');
    assert.match(video.attributes.get('src'), /^blob:/);
    assert.match(video.className, /max-h-\[46vh\]/);
    assert.match(video.className, /object-contain/);
    assert.match(video.parentNode.parentNode.className, /grid-cols-1/);
    assert.match(video.parentNode.parentNode.className, /lg:grid-cols-\[minmax\(0,1\.15fr\)_minmax\(260px,0\.85fr\)\]/);
    assert.match(video.parentNode.parentNode.className, /min-w-0/);
    assert.match(studio.textContent, /파일과 재생 길이만 확인했습니다\. 영상을 보고 사용할지 결정하세요/);
    assert.match(studio.textContent, /확인 필요/);
    assert.equal(byText(studio, 'button', '이 영상 사용').attributes.get('aria-pressed'), 'false');
    await byText(studio, 'button', '이 영상 사용').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.filter(([method]) => method === 'saveReview')[0], [
        'saveReview', { decision: 'use', expected_review_version: 'a'.repeat(64) },
    ]);
    assert.match(studio.textContent, /사용하기로 확인함/);
    assert.equal(byText(studio, 'button', '이 영상 사용').attributes.get('aria-pressed'), 'true');
    await byText(studio, 'button', '다시 만들기').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.filter(([method]) => method === 'saveReview')[1], [
        'saveReview', { decision: 'retry', expected_review_version: 'b'.repeat(64) },
    ]);
    assert.match(studio.textContent, /다시 만들기로 선택됨/);
    assert.equal(byText(studio, 'button', '다시 만들기').attributes.get('aria-pressed'), 'true');
    assert.equal(findAll(studio, 'button').filter((button) => ['이 영상 사용', '다시 만들기', '결과 검토 열기'].includes(button.textContent))
        .every((button) => button.className.includes('min-h-11')), true);
    assert.match(studio.textContent, /준비됨 · 검토용 영상 생성 완료/);
    assert.doesNotMatch(studio.textContent.split('기존 제작 마감 결과')[0],
        /opaque-final-plan|sha256|source_path|task_|result_|revision|run_id|payload|argv|FINAL_RENDER|ffmpeg|python/i);
    await byText(studio, 'button', '결과 검토 열기').dispatchEvent({ type: 'click' });
    assert.ok(byText(studio, 'h2', '스토리보드'));
});

test('PipelineStudio overview uses restored new-project clip selections instead of legacy accepted seconds', async (t) => {
    const approvedTask = (lane, taskToken) => ({
        task_token: taskToken,
        sequence: 1,
        label: lane === 'image' ? '첫 장면 이미지' : '첫 장면 영상',
        status: '결과연결',
        result_token: `${taskToken}-result`,
    });
    const bridge = {
        async getConfig() {
            return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } };
        },
        async getHarnessContractStatus() {
            return { ok: true, ready: true, readiness: 'available', entries: [] };
        },
        async getNewProjectDraftState() {
            return {
                ok: true,
                status: 'restored',
                draft: { production_id: 'restored-project', brief: '기획', script: '대본' },
            };
        },
        async getNewProjectDesignState() {
            return {
                ok: true,
                status: 'restored',
                board: { characters: [], locations: [], scenes: [{ title: '첫 장면' }] },
            };
        },
        async getNewProjectImagePlan() {
            const task = approvedTask('image', 'image-task');
            return { ok: true, status: 'restored', tasks: [task], review_decisions: [{ task_token: task.task_token, decision: 'use' }] };
        },
        async getNewProjectVideoPlan() {
            const task = approvedTask('video', 'video-task');
            return { ok: true, status: 'restored', tasks: [task], review_decisions: [{ task_token: task.task_token, decision: 'use' }] };
        },
        async getNewProjectClipSelection() {
            return {
                ok: true,
                status: 'restored',
                accepted_count: 1,
                total_count: 1,
                clips: [],
                blockers: [],
            };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();

    assert.match(studio.textContent, /선택한 구간으로 최종 편집을 준비하세요/);
    assert.match(studio.textContent, /채택1/);
    assert.ok(byText(studio, 'button', '최종 편집 열기'));
});

test('MOCK: PipelineStudio keeps production and new-project guide, title, and panel data in one workspace mode', async (t) => {
    const { default: samplePipelineState } = await import('../src/lib/pipeline/mockData.js');
    const production = structuredClone(samplePipelineState);
    production.project.title = '기존 제작 제목';
    production.project.root_path = '/tmp/existing-production';
    const bridge = {
        async getConfig() {
            return { config: { productionRoot: '/tmp/existing-production', productionParentRoot: '', dryRunMode: true } };
        },
        async readProductionState() { return { ok: true, state: production }; },
        async getNewProjectDraftState() {
            return {
                ok: true, status: 'saved',
                draft: { production_id: 'new-workspace-title', brief: '새 기획', script: '새 대본' },
            };
        },
        async getNewProjectDesignState() {
            return { ok: false, status: 'empty', board: { characters: [], locations: [], scenes: [] } };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const projectTitles = [];
    window.addEventListener('pipeline:project-title', (event) => projectTitles.push(event.detail?.title));
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();

    assert.equal(projectTitles.at(-1), '기존 제작 제목');
    assert.match(studio.textContent, /클립을 검토하고 사용할 구간을 선택하세요/);
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'intake' } });
    assert.ok(byText(studio, 'summary', '선택한 제작물 감사'));
    assert.equal(byAttribute(studio, 'input', 'id', 'new-project-production-id'), null);
    assert.equal(byAttribute(studio, 'textarea', 'id', 'new-project-brief'), null);
    assert.doesNotMatch(studio.textContent, /기획·대본 작업|에이전트 작업 시작/);
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'shot-designer' } });
    assert.doesNotMatch(studio.textContent, /새 프로젝트 샷 설계/);

    const newProject = findAll(studio, 'button').find((button) => /새 프로젝트/.test(button.textContent));
    assert.ok(newProject);
    await newProject.dispatchEvent({ type: 'click' });
    assert.equal(projectTitles.at(-1), 'new-workspace-title');
    assert.ok(byAttribute(studio, 'input', 'id', 'new-project-production-id'));
    assert.match(studio.textContent, /기획·대본 작업|에이전트 작업 시작/);
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'overview' } });
    assert.match(studio.textContent, /스토리보드와 모션 설계를 확인하세요/);
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'shot-designer' } });
    assert.match(studio.textContent, /새 프로젝트 샷 설계/);
});

test('MOCK: a saved draft wins over the late initial Promise.allSettled snapshot', async (t) => {
    let releaseInitial;
    const initialGate = new Promise((resolve) => { releaseInitial = resolve; });
    const staleDraft = {
        ok: true, status: 'restored',
        draft: { production_id: 'stale-project', brief: '오래된 기획', script: '오래된 대본', route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 3 },
    };
    const bridge = {
        async getConfig() { await initialGate; return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } }; },
        async getNewProjectDraftState() { return staleDraft; },
        async getNewProjectDesignState() {
            return { ok: true, status: 'restored', board: { characters: [], locations: [], scenes: [] }, revision_sha256: 'd'.repeat(64) };
        },
        async saveNewProjectDraft(draft) {
            return { ok: true, status: 'saved', revision_sha256: 'a'.repeat(64), draft: { ...draft } };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'intake' } });

    const productionId = byAttribute(studio, 'input', 'id', 'new-project-production-id');
    const brief = byAttribute(studio, 'textarea', 'id', 'new-project-brief');
    const script = byAttribute(studio, 'textarea', 'id', 'new-project-script');
    productionId.value = 'saved-project';
    brief.value = '최신 기획';
    script.value = '최신 대본';
    await productionId.dispatchEvent({ type: 'input' });
    await brief.dispatchEvent({ type: 'input' });
    await script.dispatchEvent({ type: 'input' });
    await findAll(studio, 'button').find((button) => button.textContent === '직접 저장').dispatchEvent({ type: 'click' });
    assert.equal(byAttribute(studio, 'textarea', 'id', 'new-project-brief').value, '최신 기획');

    releaseInitial();
    await flushRenderer();
    assert.equal(byAttribute(studio, 'input', 'id', 'new-project-production-id').value, 'saved-project');
    assert.equal(byAttribute(studio, 'textarea', 'id', 'new-project-brief').value, '최신 기획');
    assert.equal(byAttribute(studio, 'textarea', 'id', 'new-project-script').value, '최신 대본');
    assert.doesNotMatch(studio.textContent, /오래된 기획|오래된 대본/);
});

test('MOCK: a newer final stitch refresh wins over the late initial Promise.allSettled snapshot', async (t) => {
    let releaseInitial;
    const initialGate = new Promise((resolve) => { releaseInitial = resolve; });
    let stitchReads = 0;
    const stale = {
        ok: true, status: 'ready', revision: 'stale-final-stitch', staged: false,
        selected_count: 1, total_duration_seconds: 1,
        clips: [{ sequence: 1, label: '오래된 장면', in_seconds: 0, out_seconds: 1 }],
        blockers: [], executed: false, rendered: false, generation_executed: false,
    };
    const latest = {
        ...stale, revision: 'latest-final-stitch', selected_count: 2, total_duration_seconds: 2,
        clips: [
            { sequence: 1, label: '최신 장면 하나', in_seconds: 0, out_seconds: 1 },
            { sequence: 2, label: '최신 장면 둘', in_seconds: 0, out_seconds: 1 },
        ],
    };
    const bridge = {
        async getConfig() {
            await initialGate;
            return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } };
        },
        async getNewProjectFinalStitch() {
            stitchReads += 1;
            return structuredClone(stitchReads === 1 ? stale : latest);
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'final' } });

    await byText(studio, 'button', '새로고침').dispatchEvent({ type: 'click' });
    assert.match(studio.textContent, /선택 2개 · 총 2초/);
    assert.match(studio.textContent, /최신 장면 둘/);

    releaseInitial();
    await flushRenderer();
    assert.match(studio.textContent, /선택 2개 · 총 2초/);
    assert.match(studio.textContent, /최신 장면 둘/);
    assert.doesNotMatch(studio.textContent, /오래된 장면/);
    assert.equal(stitchReads, 2);
});

test('MOCK: reverse-completing final stitch refreshes keep the newest response', async (t) => {
    let resolveOlderRefresh;
    const pendingOlderRefresh = new Promise((resolve) => { resolveOlderRefresh = resolve; });
    let stitchReads = 0;
    const baseline = {
        ok: true, status: 'ready', revision: 'baseline-final-stitch', staged: false,
        selected_count: 1, total_duration_seconds: 1,
        clips: [{ sequence: 1, label: '기준 장면', in_seconds: 0, out_seconds: 1 }],
        blockers: [], executed: false, rendered: false, generation_executed: false,
    };
    const older = {
        ...baseline, revision: 'older-refresh', selected_count: 2, total_duration_seconds: 2,
        clips: [{ sequence: 1, label: '늦게 도착한 장면', in_seconds: 0, out_seconds: 2 }],
    };
    const newest = {
        ...baseline, revision: 'newest-refresh', selected_count: 3, total_duration_seconds: 3,
        clips: [{ sequence: 1, label: '가장 최신 장면', in_seconds: 0, out_seconds: 3 }],
    };
    const bridge = {
        async getConfig() {
            return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } };
        },
        async getNewProjectFinalStitch() {
            stitchReads += 1;
            if (stitchReads === 1) return structuredClone(baseline);
            if (stitchReads === 2) return pendingOlderRefresh;
            return structuredClone(newest);
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'final' } });

    const olderRefresh = byText(studio, 'button', '새로고침').dispatchEvent({ type: 'click' });
    const newestRefresh = byText(studio, 'button', '새로고침').dispatchEvent({ type: 'click' });
    await newestRefresh;
    assert.match(studio.textContent, /선택 3개 · 총 3초/);
    assert.match(studio.textContent, /가장 최신 장면/);

    resolveOlderRefresh(structuredClone(older));
    await olderRefresh;
    await flushRenderer();
    assert.match(studio.textContent, /선택 3개 · 총 3초/);
    assert.match(studio.textContent, /가장 최신 장면/);
    assert.doesNotMatch(studio.textContent, /늦게 도착한 장면/);
    assert.equal(stitchReads, 3);
});

test('MOCK: a stale clip save cannot replace newer edits or refresh final stitch', async (t) => {
    const clip = {
        task_token: 'clip-task', result_token: 'clip-result', sequence: 1, source_id: 'scene-1',
        label: '장면 영상 · 첫 장면', duration_seconds: 5,
        in_seconds: 0, out_seconds: 1, reason: '첫 선택', reviewer_confidence: 'medium',
    };
    const selectionState = {
        ok: true, status: 'restored', revision_sha256: 'clip-revision',
        design_revision_sha256: 'design-revision', image_plan_revision_sha256: 'image-revision',
        video_plan_revision_sha256: 'video-revision', accepted_count: 1, total_count: 1,
        clips: [clip], blockers: [],
    };
    const finalStitch = {
        ok: true, status: 'ready', revision: 'initial-stitch', staged: false,
        selected_count: 1, total_duration_seconds: 1,
        clips: [{ sequence: 1, label: clip.label, in_seconds: 0, out_seconds: 1 }],
        blockers: [], executed: false, rendered: false, generation_executed: false,
    };
    const saveRequests = [];
    let finalStitchReads = 0;
    const bridge = {
        async getConfig() {
            return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } };
        },
        async getNewProjectClipSelection() { return structuredClone(selectionState); },
        async getNewProjectFinalStitch() {
            finalStitchReads += 1;
            return structuredClone(finalStitch);
        },
        saveNewProjectClipSelection(payload) {
            return new Promise((resolve, reject) => saveRequests.push({
                payload: structuredClone(payload), resolve, reject,
            }));
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'qa' } });
    const stitchReadsBeforeSaves = finalStitchReads;
    const editEnd = async (value) => {
        const input = byAttribute(studio, 'input', 'aria-label', `${clip.label} 끝 초`);
        input.value = String(value);
        await input.dispatchEvent({ type: 'input' });
    };

    await editEnd(2);
    const firstSave = byText(studio, 'button', '선택 저장').dispatchEvent({ type: 'click' });
    assert.equal(saveRequests.length, 1);
    assert.equal(saveRequests[0].payload.selections[0].out_seconds, 2);
    await editEnd(3);
    saveRequests[0].resolve({
        ...structuredClone(selectionState), status: 'saved', revision_sha256: 'saved-a',
        clips: [{ ...clip, out_seconds: 2, reason: 'A' }],
    });
    await firstSave;
    await flushRenderer();

    assert.equal(Number(byAttribute(studio, 'input', 'aria-label', `${clip.label} 끝 초`).value), 3);
    assert.match(studio.textContent, /저장 안 됨/);
    assert.match(studio.textContent, /저장하지 않은 선택이 있습니다/);
    assert.doesNotMatch(studio.textContent, /구간 선택을 완료했습니다/);
    assert.equal(finalStitchReads, stitchReadsBeforeSaves);

    const secondSave = byText(studio, 'button', '선택 저장').dispatchEvent({ type: 'click' });
    assert.equal(saveRequests.length, 2);
    assert.equal(saveRequests[1].payload.selections[0].out_seconds, 3);
    await editEnd(4);
    saveRequests[1].reject(new Error('STALE_SAVE_FAILED'));
    await secondSave;
    await flushRenderer();

    assert.equal(Number(byAttribute(studio, 'input', 'aria-label', `${clip.label} 끝 초`).value), 4);
    assert.match(studio.textContent, /저장 안 됨/);
    assert.match(studio.textContent, /저장하지 않은 선택이 있습니다/);
    assert.doesNotMatch(studio.textContent, /선택을 저장하지 못했습니다/);
    assert.equal(finalStitchReads, stitchReadsBeforeSaves);
});

test('MOCK: a current clip save commits through an overlapping final stitch refresh and wins afterward', async (t) => {
    const clip = {
        task_token: 'clip-task-current', result_token: 'clip-result-current', sequence: 1, source_id: 'scene-current',
        label: '장면 영상 · 현재 장면', duration_seconds: 5,
        in_seconds: 0, out_seconds: 1, reason: '기존 선택', reviewer_confidence: 'high',
    };
    const selectionState = {
        ok: true, status: 'restored', revision_sha256: 'clip-before-save',
        design_revision_sha256: 'design-current', image_plan_revision_sha256: 'image-current',
        video_plan_revision_sha256: 'video-current', accepted_count: 1, total_count: 1,
        clips: [clip], blockers: [],
    };
    const stitch = (revision, label, duration) => ({
        ok: true, status: 'ready', revision, staged: false,
        selected_count: 1, total_duration_seconds: duration,
        clips: [{ sequence: 1, label, in_seconds: 0, out_seconds: duration }],
        blockers: [], executed: false, rendered: false, generation_executed: false,
    });
    let resolveSave;
    let resolveOverlappingRefresh;
    let stitchReads = 0;
    const bridge = {
        async getConfig() {
            return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } };
        },
        async getNewProjectClipSelection() { return structuredClone(selectionState); },
        async getNewProjectFinalStitch() {
            stitchReads += 1;
            if (stitchReads === 1) return stitch('stitch-initial', '초기 장면', 1);
            if (stitchReads === 2) {
                return new Promise((resolve) => { resolveOverlappingRefresh = resolve; });
            }
            return stitch('stitch-after-save', '저장 후 장면', 2);
        },
        saveNewProjectClipSelection() {
            return new Promise((resolve) => { resolveSave = resolve; });
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'qa' } });

    const end = byAttribute(studio, 'input', 'aria-label', `${clip.label} 끝 초`);
    end.value = '2';
    await end.dispatchEvent({ type: 'input' });
    const save = byText(studio, 'button', '선택 저장').dispatchEvent({ type: 'click' });

    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'final' } });
    const overlappingRefresh = byText(studio, 'button', '새로고침').dispatchEvent({ type: 'click' });
    assert.equal(stitchReads, 2);

    resolveSave({
        ...structuredClone(selectionState), status: 'saved', revision_sha256: 'clip-after-save',
        clips: [{ ...clip, out_seconds: 2, reason: '저장된 선택' }],
    });
    await save;
    await flushRenderer();
    assert.equal(stitchReads, 3);

    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'qa' } });
    assert.equal(Number(byAttribute(studio, 'input', 'aria-label', `${clip.label} 끝 초`).value), 2);
    assert.match(studio.textContent, /저장됨/);
    assert.match(studio.textContent, /구간 선택을 완료했습니다/);
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'final' } });
    assert.match(studio.textContent, /저장 후 장면/);
    assert.match(studio.textContent, /선택 1개 · 총 2초/);

    resolveOverlappingRefresh(stitch('stitch-overlap', '느리게 도착한 장면', 1.5));
    await overlappingRefresh;
    await flushRenderer();
    assert.match(studio.textContent, /저장 후 장면/);
    assert.doesNotMatch(studio.textContent, /느리게 도착한 장면/);
    assert.equal(stitchReads, 3);
});

test('MOCK: late video preview refresh disposes only its stale URLs and keeps the latest preview map', async (t) => {
    const priorPreviewApis = {
        atob: Object.getOwnPropertyDescriptor(globalThis, 'atob'),
        Blob: Object.getOwnPropertyDescriptor(globalThis, 'Blob'),
        URL: Object.getOwnPropertyDescriptor(globalThis, 'URL'),
    };
    const revoked = [];
    let nextUrl = 0;
    globalThis.atob = (value) => Buffer.from(value, 'base64').toString('latin1');
    globalThis.Blob = class {
        constructor(parts, options) { this.size = parts.reduce((sum, part) => sum + part.byteLength, 0); this.type = options.type; }
    };
    globalThis.URL = {
        createObjectURL: () => `blob:preview-${nextUrl += 1}`,
        revokeObjectURL: (value) => revoked.push(value),
    };
    t.after(() => {
        for (const [key, descriptor] of Object.entries(priorPreviewApis)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });

    let resolveOldPreview;
    let firstResultPreviewRead = true;
    let revision = 1;
    let videoState = {
        ok: true, status: 'restored', design_revision_sha256: 'd'.repeat(64),
        image_plan_revision_sha256: 'i'.repeat(64), revision_sha256: String(revision).repeat(64),
        review_decisions: [], blockers: [], tasks: [
            { task_token: 'video-race-1', kind: 'scene_video', sequence: 1, label: '첫 영상', provider: 'flow', prompt: '첫 프롬프트', status: '준비', result_token: '' },
            { task_token: 'video-race-2', kind: 'scene_video', sequence: 2, label: '둘째 영상', provider: 'flow', prompt: '둘째 프롬프트', status: '준비', result_token: '' },
        ],
    };
    const bridge = {
        async getConfig() { return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } }; },
        async getNewProjectVideoPlan() { return structuredClone(videoState); },
        async getNewProjectVideoResultWorkspace() {
            return { ok: true, status: 'ready', candidates: [
                { candidate_token: 'video-race-candidate', provider: 'flow', duration_seconds: 5, width: 720, height: 1280 },
            ], blockers: [] };
        },
        async connectNewProjectVideoResult(payload) {
            revision += 1;
            videoState = {
                ...videoState,
                revision_sha256: String(revision).repeat(64),
                tasks: videoState.tasks.map((task) => task.task_token === payload.task_token
                    ? { ...task, status: '결과연결', result_token: `result-${task.sequence}` }
                    : task),
            };
            return { ok: true, connected: true, state: structuredClone(videoState) };
        },
        getNewProjectVideoResultPreview({ result_token: resultToken }) {
            if (resultToken === 'result-1' && firstResultPreviewRead) {
                firstResultPreviewRead = false;
                return new Promise((resolve) => { resolveOldPreview = resolve; });
            }
            const bytes = Buffer.from(resultToken);
            return Promise.resolve({
                loaded: true, mime_type: 'video/mp4', byte_length: bytes.byteLength, base64: bytes.toString('base64'),
            });
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'videos' } });

    const firstCard = byAttribute(studio, 'article', 'data-sequence', '1');
    await byText(firstCard, 'button', '완료 영상 연결').dispatchEvent({ type: 'click' });
    const firstConnect = byText(firstCard, 'button', '이 영상 연결').dispatchEvent({ type: 'click' });
    await new Promise((resolve) => setImmediate(resolve));

    const secondCard = byAttribute(studio, 'article', 'data-sequence', '2');
    await byText(secondCard, 'button', '완료 영상 연결').dispatchEvent({ type: 'click' });
    await byText(secondCard, 'button', '이 영상 연결').dispatchEvent({ type: 'click' });
    await flushRenderer();
    const latestSources = findAll(studio, 'video').map((video) => video.attributes.get('src')).filter(Boolean);
    assert.equal(latestSources.length, 2);

    const staleBytes = Buffer.from('stale-result');
    resolveOldPreview({
        loaded: true, mime_type: 'video/mp4', byte_length: staleBytes.byteLength, base64: staleBytes.toString('base64'),
    });
    await firstConnect;
    await flushRenderer();

    const finalSources = findAll(studio, 'video').map((video) => video.attributes.get('src')).filter(Boolean);
    assert.deepEqual(finalSources, latestSources);
    assert.equal(revoked.length, 1);
    assert.equal(finalSources.includes(revoked[0]), false);
});

test('MOCK DST result import exposes only image retry targets and uses opaque plan confirmation', async (t) => {
    const calls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { MediaRetryPlanBand } = await import('../src/components/pipeline/MediaRetryPlanBand.js');
    const band = MediaRetryPlanBand({
        plan: {
            status: 'preview_ready',
            blockers: [],
            items: [{
                sequence: 1,
                media_id: 'dst-image-retry',
                target_id: 'clip_001',
                provider: 'dst',
                kind: 'scene_image',
                readiness: 'preview_ready',
                blockers: [],
                command_spec: {},
            }, {
                sequence: 2,
                media_id: 'dst-video-retry',
                target_id: 'clip_002',
                provider: 'dst',
                kind: 'scene_video',
                readiness: 'blocked_adapter_missing',
                blockers: ['MISSING_PROVIDER_ADAPTER'],
                command_spec: {},
            }, {
                sequence: 3,
                media_id: 'flow-image-retry',
                target_id: 'clip_003',
                provider: 'flow',
                kind: 'scene_image',
                readiness: 'blocked_adapter_missing',
                blockers: ['MISSING_PROVIDER_ADAPTER'],
                command_spec: {},
            }],
        },
        dstBundleImportWorkspace: {
            status: 'ready',
            blockers: [],
            candidates: [{
                candidate_token: 'opaque-candidate-token',
                bundle_id: '20260715_street_scene_1234',
                created_at: '2026-07-15T08:00:00Z',
                prompt_excerpt: '비 오는 골목의 주인공',
                mime_type: 'image/png',
                size_bytes: 2048,
                total_size_bytes: 6144,
                image_count: 3,
            }],
        },
        dstBundleImportPreview: {
            status: 'ready',
            ready: true,
            candidate_token: 'opaque-candidate-token',
            preview: { mime_type: 'image/png', base64: 'iVBORw0KGgo=', byte_length: 8 },
            blockers: [],
        },
        async onPlanDstBundleImport(payload) {
            calls.push(['plan', payload]);
            return {
                status: 'ready',
                ready: true,
                already_current: false,
                plan_token: 'opaque-plan-token',
                retry_media_id: payload.retryMediaId,
                target_id: 'clip_001',
                source_bundle_id: '20260715_street_scene_1234',
                image_count: 3,
                new_image_count: 3,
                already_current_count: 0,
                source_image_name: 'secret-source.png',
                target_relative_path: 'media/private-target.png',
                blockers: [],
                executed: false,
            };
        },
        async onConfirmDstBundleImport(payload) {
            calls.push(['confirm', payload]);
            return {
                ok: true,
                imported: true,
                already_current: false,
                imported_count: 3,
                media_id: 'dst-image-imported',
                target_id: 'clip_001',
                relative_path: 'media/private-target.png',
                executed: false,
            };
        },
    });

    const targetSelect = byAttribute(band, 'select', 'id', 'dst-import-retry-target');
    const candidateSelect = byAttribute(band, 'select', 'id', 'dst-import-candidate');
    assert.ok(targetSelect);
    assert.ok(candidateSelect);
    assert.deepEqual(findAll(targetSelect, 'option').map((option) => option.value), ['dst-image-retry']);
    assert.deepEqual(findAll(candidateSelect, 'option').map((option) => option.value), ['opaque-candidate-token']);
    const preview = byAttribute(band, 'img', 'alt', '20260715_street_scene_1234 결과 미리보기');
    assert.match(preview.attributes.get('src'), /^data:image\/png;base64,/);

    assert.match(candidateSelect.textContent, /3장/);
    await byText(band, 'button', '묶음 확인').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[0], ['plan', {
        candidateToken: 'opaque-candidate-token',
        retryMediaId: 'dst-image-retry',
    }]);
    assert.match(band.textContent, /3장을 clip_001에 연결합니다/);
    assert.doesNotMatch(band.textContent, /가져오기 준비|PASS|PREVIEW|BLOCK/);
    assert.equal(band.textContent.includes('secret-source.png'), false, 'source filenames stay in Electron main');
    assert.equal(band.textContent.includes('private-target.png'), false, 'target paths stay in Electron main');

    await byText(band, 'button', '3장 연결').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[1], ['confirm', { planToken: 'opaque-plan-token', confirmed: true }]);
    assert.match(band.textContent, /3장을 clip_001에 연결했습니다/);
    assert.match(band.textContent, /이미지 묶음을 작업대에 연결했습니다/);
    assert.equal(findAll(band, 'button').some((button) => /(?:생성|명령) 실행/.test(button.textContent)), false);
});

test('MOCK DST reference bundle shows every image and maps each once to the same saved kind', async (t) => {
    const calls = [];
    const previewCalls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { MediaRetryPlanBand } = await import('../src/components/pipeline/MediaRetryPlanBand.js');
    const band = MediaRetryPlanBand({
        plan: {
            status: 'preview_ready',
            blockers: [],
            items: [{
                sequence: 1,
                media_id: 'character-front-retry',
                target_id: 'character_front',
                provider: 'dst',
                kind: 'character_sheet',
                readiness: 'preview_ready',
                blockers: [],
                command_spec: {},
            }, {
                sequence: 2,
                media_id: 'character-side-retry',
                target_id: 'character_side',
                provider: 'dst',
                kind: 'character_sheet',
                readiness: 'preview_ready',
                blockers: [],
                command_spec: {},
            }, {
                sequence: 3,
                media_id: 'character-expression-retry',
                target_id: 'character_expression',
                provider: 'dst',
                kind: 'character_sheet',
                readiness: 'preview_ready',
                blockers: [],
                command_spec: {},
            }, {
                sequence: 4,
                media_id: 'location-retry',
                target_id: 'backstage_hall',
                provider: 'dst',
                kind: 'location_sheet',
                readiness: 'preview_ready',
                blockers: [],
                command_spec: {},
            }, {
                sequence: 5,
                media_id: 'scene-retry',
                target_id: 'clip_010',
                provider: 'dst',
                kind: 'scene_image',
                readiness: 'preview_ready',
                blockers: [],
                command_spec: {},
            }],
        },
        dstBundleImportWorkspace: {
            status: 'ready',
            blockers: [],
            candidates: [{
                candidate_token: 'opaque-reference-token',
                bundle_id: 'character-reference-bundle',
                created_at: '2026-07-15T08:00:00Z',
                prompt_excerpt: '주인공 캐릭터 시트 세 장',
                mime_type: 'image/png',
                size_bytes: 2048,
                total_size_bytes: 6144,
                image_count: 3,
            }],
        },
        dstBundleImportPreview: {
            status: 'ready',
            ready: true,
            candidate_token: 'opaque-reference-token',
            preview: { mime_type: 'image/png', base64: 'iVBORw0KGgo=', byte_length: 8 },
            blockers: [],
        },
        async onLoadDstBundleImportPreview(payload) {
            previewCalls.push(payload);
            return {
                status: 'ready',
                ready: true,
                candidate_token: payload.candidateToken,
                image_index: payload.imageIndex,
                preview: { mime_type: 'image/png', base64: `iVBORw0KGg${payload.imageIndex}=`, byte_length: 8 },
                blockers: [],
            };
        },
        async onPlanDstBundleImport(payload) {
            calls.push(['plan', payload]);
            return {
                status: 'ready',
                ready: true,
                already_current: false,
                plan_token: 'opaque-reference-plan',
                source_bundle_id: 'character-reference-bundle',
                image_count: 3,
                new_image_count: 3,
                blockers: [],
                executed: false,
            };
        },
        async onConfirmDstBundleImport(payload) {
            calls.push(['confirm', payload]);
            return {
                ok: true,
                imported: true,
                already_current: false,
                imported_count: 3,
                executed: true,
            };
        },
    });

    assert.match(band.textContent, /불러오는 중/, 'uncached reference thumbnails use short Korean loading text');
    await flushRenderer();
    assert.deepEqual(previewCalls, [
        { candidateToken: 'opaque-reference-token', imageIndex: 2 },
        { candidateToken: 'opaque-reference-token', imageIndex: 3 },
    ], 'the existing index-less preview is safely cached as image 1');
    for (let imageIndex = 1; imageIndex <= 3; imageIndex += 1) {
        const image = byAttribute(band, 'img', 'alt', `이미지 ${imageIndex} 미리보기`);
        const select = byAttribute(band, 'select', 'id', `dst-reference-target-${imageIndex}`);
        const label = byAttribute(band, 'label', 'for', `dst-reference-target-${imageIndex}`);
        assert.match(image.attributes.get('src'), /^data:image\/png;base64,/);
        assert.ok(select);
        assert.match(select.className, /min-h-11/);
        assert.equal(label.textContent, `이미지 ${imageIndex} 대상`);
        assert.equal(select.value, ['character-front-retry', 'character-side-retry', 'character-expression-retry'][imageIndex - 1]);
        assert.doesNotMatch(select.textContent, /backstage_hall|clip_010/, 'other reference kinds and scenes stay hidden');
    }
    assert.ok(descendants(band).some((node) => /sm:grid-cols-2/.test(node.className)), 'reference cards use a responsive grid');

    let second = byAttribute(band, 'select', 'id', 'dst-reference-target-2');
    second.value = '';
    await second.dispatchEvent({ type: 'change' });
    assert.equal(byText(band, 'button', '묶음 확인').disabled, true, 'every image needs a target before planning');

    let first = byAttribute(band, 'select', 'id', 'dst-reference-target-1');
    assert.deepEqual(findAll(first, 'option').map((option) => option.value), ['', 'character-front-retry', 'character-side-retry']);
    first.value = 'character-side-retry';
    await first.dispatchEvent({ type: 'change' });
    second = byAttribute(band, 'select', 'id', 'dst-reference-target-2');
    assert.deepEqual(findAll(second, 'option').map((option) => option.value), ['', 'character-front-retry']);
    second.value = 'character-front-retry';
    await second.dispatchEvent({ type: 'change' });
    assert.equal(byText(band, 'button', '묶음 확인').disabled, false);

    await byText(band, 'button', '묶음 확인').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[0], ['plan', {
        candidateToken: 'opaque-reference-token',
        mappings: [
            { imageIndex: 1, retryMediaId: 'character-side-retry' },
            { imageIndex: 2, retryMediaId: 'character-front-retry' },
            { imageIndex: 3, retryMediaId: 'character-expression-retry' },
        ],
    }]);
    assert.match(band.textContent, /3장의 연결을 확인했습니다/);
    assert.doesNotMatch(band.textContent, /PASS|PREVIEW|BLOCK|DST_/);

    await byText(band, 'button', '3장 연결').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[1], ['confirm', { planToken: 'opaque-reference-plan', confirmed: true }]);
    assert.match(band.textContent, /3장을 각각 연결했습니다/);
    assert.match(band.textContent, /이미지 묶음을 작업대에 연결했습니다/);
    assert.equal(previewCalls.length, 2, 'cached thumbnails are not fetched again after rerenders');
});

test('MOCK DST first import maps every image to an authoritative Korean-labeled target without a retry draft', async (t) => {
    const calls = [];
    const previewCalls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { MediaRetryPlanBand } = await import('../src/components/pipeline/MediaRetryPlanBand.js');
    const band = MediaRetryPlanBand({
        plan: { status: 'empty', blockers: [], items: [] },
        dstBundleImportWorkspace: {
            status: 'ready',
            blockers: [],
            candidates: [{
                candidate_token: 'opaque-first-bundle',
                bundle_id: 'first-character-sheets',
                created_at: '2026-07-15T08:00:00Z',
                prompt_excerpt: '주인공 첫 캐릭터 시트',
                image_count: 3,
                total_size_bytes: 6144,
            }],
            initial_targets: [{
                target_token: 'opaque-character-one',
                kind: 'character_sheet',
                target_id: 'character_zhixia',
                target_label: '지아',
                sequence: 1,
            }, {
                target_token: 'opaque-character-two',
                kind: 'character_sheet',
                target_id: 'character_mother',
                target_label: '엄마',
                sequence: 2,
            }, {
                target_token: 'opaque-character-three',
                kind: 'character_sheet',
                target_id: 'character_teacher',
                target_label: '담임 선생님',
                sequence: 3,
            }, {
                target_token: 'opaque-location-one',
                kind: 'location_sheet',
                target_id: 'location_classroom',
                target_label: '교실',
                sequence: 1,
            }, {
                target_token: 'opaque-scene-one',
                kind: 'scene_image',
                target_id: 'clip_001',
                target_label: '첫 장면',
                sequence: 1,
            }],
        },
        dstBundleImportPreview: {
            status: 'ready',
            ready: true,
            candidate_token: 'opaque-first-bundle',
            image_index: 1,
            preview: { mime_type: 'image/png', base64: 'iVBORw0KGgo=', byte_length: 8 },
            blockers: [],
        },
        async onLoadDstBundleImportPreview(payload) {
            previewCalls.push(payload);
            return {
                status: 'ready',
                ready: true,
                candidate_token: payload.candidateToken,
                image_index: payload.imageIndex,
                preview: { mime_type: 'image/png', base64: `iVBORw0KGg${payload.imageIndex}=`, byte_length: 8 },
                blockers: [],
            };
        },
        async onPlanDstBundleImport(payload) {
            calls.push(['plan', payload]);
            return {
                status: 'ready',
                ready: true,
                mapping_mode: 'initial_targets',
                plan_token: 'opaque-first-plan',
                source_bundle_id: 'first-character-sheets',
                image_count: 3,
                new_image_count: 3,
                blockers: [],
                executed: false,
            };
        },
        async onConfirmDstBundleImport(payload) {
            calls.push(['confirm', payload]);
            return { ok: true, imported: true, imported_count: 3, executed: true };
        },
    });

    assert.match(band.textContent, /첫 이미지 연결/);
    assert.doesNotMatch(band.textContent, /제공자별 다시 만들기 계획|검토 초안을 저장한 뒤/);
    assert.equal(byAttribute(band, 'select', 'id', 'dst-import-mode'), null, 'mode choice stays hidden when only first import is available');

    const kindSelect = byAttribute(band, 'select', 'id', 'dst-import-initial-kind');
    const kindLabel = byAttribute(band, 'label', 'for', 'dst-import-initial-kind');
    assert.equal(kindLabel.textContent, '이미지 종류');
    assert.match(kindSelect.className, /min-h-11/);
    assert.deepEqual(findAll(kindSelect, 'option').map((option) => [option.value, option.textContent]), [
        ['character_sheet', '캐릭터'],
        ['location_sheet', '장소'],
        ['scene_image', '장면'],
    ]);

    await flushRenderer();
    assert.deepEqual(previewCalls, [
        { candidateToken: 'opaque-first-bundle', imageIndex: 2 },
        { candidateToken: 'opaque-first-bundle', imageIndex: 3 },
    ]);
    for (let imageIndex = 1; imageIndex <= 3; imageIndex += 1) {
        const select = byAttribute(band, 'select', 'id', `dst-reference-target-${imageIndex}`);
        const label = byAttribute(band, 'label', 'for', `dst-reference-target-${imageIndex}`);
        assert.ok(byAttribute(band, 'img', 'alt', `이미지 ${imageIndex} 미리보기`));
        assert.equal(label.textContent, `이미지 ${imageIndex} 대상`);
        assert.match(select.className, /min-h-11/);
        assert.equal(select.value, ['opaque-character-one', 'opaque-character-two', 'opaque-character-three'][imageIndex - 1]);
    }
    assert.match(band.textContent, /1\. 지아 · 캐릭터/);
    assert.match(band.textContent, /2\. 엄마 · 캐릭터/);
    assert.match(band.textContent, /3\. 담임 선생님 · 캐릭터/);
    assert.equal(band.textContent.includes('character_zhixia'), false, 'Korean labels replace internal target ids');
    assert.equal(band.textContent.includes('opaque-character-one'), false, 'opaque target tokens stay out of copy');
    assert.ok(descendants(band).some((node) => /grid-cols-1/.test(node.className)
        && /sm:grid-cols-2/.test(node.className) && /xl:grid-cols-3/.test(node.className)));

    let second = byAttribute(band, 'select', 'id', 'dst-reference-target-2');
    second.value = '';
    await second.dispatchEvent({ type: 'change' });
    assert.equal(byText(band, 'button', '연결 확인').disabled, true);

    let first = byAttribute(band, 'select', 'id', 'dst-reference-target-1');
    assert.deepEqual(findAll(first, 'option').map((option) => option.value), [
        '', 'opaque-character-one', 'opaque-character-two',
    ]);
    first.value = 'opaque-character-two';
    await first.dispatchEvent({ type: 'change' });
    second = byAttribute(band, 'select', 'id', 'dst-reference-target-2');
    assert.deepEqual(findAll(second, 'option').map((option) => option.value), ['', 'opaque-character-one']);
    second.value = 'opaque-character-one';
    await second.dispatchEvent({ type: 'change' });

    await byText(band, 'button', '연결 확인').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[0], ['plan', {
        candidateToken: 'opaque-first-bundle',
        initialMappings: [
            { imageIndex: 1, targetToken: 'opaque-character-two' },
            { imageIndex: 2, targetToken: 'opaque-character-one' },
            { imageIndex: 3, targetToken: 'opaque-character-three' },
        ],
    }]);
    assert.match(band.textContent, /3장의 연결을 확인했습니다/);
    assert.doesNotMatch(band.textContent, /PASS|PREVIEW|BLOCK|DST_/);

    await byText(band, 'button', '3장 연결').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[1], ['confirm', { planToken: 'opaque-first-plan', confirmed: true }]);
    assert.match(band.textContent, /3장을 각각 연결했습니다/);
    assert.match(band.textContent, /이미지 묶음을 작업대에 연결했습니다/);
});

test('MOCK DST connection mode choice appears only when first and retry targets both exist', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { MediaRetryPlanBand } = await import('../src/components/pipeline/MediaRetryPlanBand.js');
    const band = MediaRetryPlanBand({
        plan: {
            status: 'preview_ready',
            blockers: [],
            items: [{
                sequence: 1,
                media_id: 'saved-retry',
                target_id: 'clip_002',
                provider: 'dst',
                kind: 'scene_image',
                readiness: 'preview_ready',
                blockers: [],
                command_spec: {},
            }],
        },
        dstBundleImportWorkspace: {
            status: 'ready',
            candidates: [{
                candidate_token: 'opaque-both-bundle',
                bundle_id: 'both-modes',
                image_count: 1,
                created_at: '2026-07-15T08:00:00Z',
            }],
            initial_targets: [{
                target_token: 'opaque-first-scene',
                kind: 'scene_image',
                target_id: 'clip_001',
                target_label: '첫 장면',
                sequence: 1,
            }],
        },
        dstBundleImportPreview: {
            ready: true,
            candidate_token: 'opaque-both-bundle',
            preview: { mime_type: 'image/png', base64: 'iVBORw0KGgo=' },
        },
        async onLoadDstBundleImportPreview(payload) {
            return {
                ready: true,
                candidate_token: payload.candidateToken,
                image_index: payload.imageIndex,
                preview: { mime_type: 'image/png', base64: 'iVBORw0KGgo=' },
            };
        },
        async onPlanDstBundleImport() {
            return { status: 'blocked', ready: false };
        },
    });

    let mode = byAttribute(band, 'select', 'id', 'dst-import-mode');
    assert.equal(byAttribute(band, 'label', 'for', 'dst-import-mode').textContent, '연결 방식');
    assert.deepEqual(findAll(mode, 'option').map((option) => [option.value, option.textContent]), [
        ['initial', '처음 연결'],
        ['retry', '다시 연결'],
    ]);
    assert.ok(byAttribute(band, 'select', 'id', 'dst-import-initial-kind'));
    assert.ok(byText(band, 'button', '연결 확인'));

    mode.value = 'retry';
    await mode.dispatchEvent({ type: 'change' });
    mode = byAttribute(band, 'select', 'id', 'dst-import-mode');
    assert.equal(mode.value, 'retry');
    assert.ok(byAttribute(band, 'select', 'id', 'dst-import-retry-target'));
    assert.equal(byAttribute(band, 'select', 'id', 'dst-import-initial-kind'), null);
    assert.ok(byText(band, 'button', '묶음 확인'));
});

test('MOCK first video import shows every provider and connects a completed video without a retry draft', async (t) => {
    const calls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { MediaRetryPlanBand } = await import('../src/components/pipeline/MediaRetryPlanBand.js');
    const band = MediaRetryPlanBand({
        plan: { status: 'empty', blockers: [], items: [] },
        dstBundleImportWorkspace: {
            status: 'ready',
            candidates: [],
            initial_targets: [{
                target_token: 'opaque-image-target',
                kind: 'character_sheet',
                target_id: 'character_private_id',
                target_label: '주인공',
                sequence: 1,
            }],
        },
        videoResultImportWorkspace: {
            status: 'ready',
            ready: true,
            blockers: [],
            initial_targets: [{
                target_token: 'opaque-video-one',
                kind: 'video',
                target_id: 'clip_private_001',
                target_label: '비 오는 교실',
                sequence: 1,
            }, {
                target_token: 'opaque-video-two',
                kind: 'video',
                target_id: 'clip_private_002',
                target_label: '오래된 차 안',
                sequence: 2,
            }],
            candidates: [{
                candidate_token: 'flow-first-opaque',
                provider: 'flow',
                result_id: 'flow-finished-one',
                size_bytes: 2673934,
                duration_seconds: 10.006,
                width: 1280,
                height: 720,
                preview_allowed: true,
            }, {
                candidate_token: 'grok-first-opaque',
                provider: 'grok',
                result_id: 'grok-finished-one',
                size_bytes: 4417147,
                duration_seconds: 6.042,
                width: 464,
                height: 688,
                preview_allowed: true,
            }, {
                candidate_token: 'replicate-first-opaque',
                provider: 'replicate',
                result_id: 'replicate-finished-one',
                size_bytes: 6349367,
                duration_seconds: 5.042,
                width: 1088,
                height: 1920,
                preview_allowed: true,
            }],
        },
        async onPlanVideoResultImport(payload) {
            calls.push(['plan', payload]);
            return {
                status: 'ready',
                ready: true,
                import_mode: 'initial',
                plan_token: 'opaque-first-video-plan',
                target_label: '오래된 차 안',
                source_result_id: 'grok-finished-one',
                blockers: [],
            };
        },
        async onConfirmVideoResultImport(payload) {
            calls.push(['confirm', payload]);
            return { ok: true, imported: true, already_current: false, media_id: 'video-imported' };
        },
    });

    assert.match(band.textContent, /첫 영상 연결/);
    assert.doesNotMatch(band.textContent, /제공자별 다시 만들기 계획|저장된 실행 계획 없음/);
    assert.equal(byAttribute(band, 'select', 'id', 'video-import-mode'), null);
    const target = byAttribute(band, 'select', 'id', 'video-import-initial-target');
    const candidate = byAttribute(band, 'select', 'id', 'video-import-candidate');
    assert.equal(byAttribute(band, 'label', 'for', 'video-import-initial-target').textContent, '연결할 장면');
    assert.equal(byAttribute(band, 'label', 'for', 'video-import-candidate').textContent, '완료된 영상');
    assert.match(target.className, /min-h-11/);
    assert.match(candidate.className, /min-h-11/);
    assert.deepEqual(findAll(target, 'option').map((option) => [option.value, option.textContent]), [
        ['opaque-video-one', '1. 비 오는 교실'],
        ['opaque-video-two', '2. 오래된 차 안'],
    ]);
    assert.equal(band.textContent.includes('clip_private_001'), false);
    assert.equal(band.textContent.includes('opaque-video-one'), false);
    assert.deepEqual(findAll(candidate, 'option').map((option) => option.value), [
        '', 'flow-first-opaque', 'grok-first-opaque', 'replicate-first-opaque',
    ]);
    assert.match(candidate.textContent, /Flow/);
    assert.match(candidate.textContent, /Grok/);
    assert.match(candidate.textContent, /Replicate/);
    assert.ok(descendants(band).some((node) => /grid-cols-1/.test(node.className) && /lg:grid-cols-2/.test(node.className)));

    target.value = 'opaque-video-two';
    await target.dispatchEvent({ type: 'change' });
    const rerenderedCandidate = byAttribute(band, 'select', 'id', 'video-import-candidate');
    rerenderedCandidate.value = 'grok-first-opaque';
    await rerenderedCandidate.dispatchEvent({ type: 'change' });
    assert.ok(byText(band, 'button', '영상 미리보기'));
    await byText(band, 'button', '연결 확인').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[0], ['plan', {
        candidateToken: 'grok-first-opaque',
        initialTargetToken: 'opaque-video-two',
    }]);
    assert.match(band.textContent, /가져올 영상과 장면을 확인했습니다/);
    assert.doesNotMatch(band.textContent, /PASS|PREVIEW|BLOCK|VIDEO_IMPORT_/);

    await byText(band, 'button', '이 영상 연결').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[1], ['confirm', { planToken: 'opaque-first-video-plan', confirmed: true }]);
    assert.match(band.textContent, /장면 검토 보드에 연결했습니다/);
});

test('MOCK video connection mode appears only when first and retry targets both exist', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { VideoResultImportBand } = await import('../src/components/pipeline/VideoResultImportBand.js');
    const band = VideoResultImportBand({
        retryItems: [{
            sequence: 1,
            media_id: 'flow-video-retry',
            target_id: 'clip_private_retry',
            target_label: '다시 만들 장면',
            provider: 'flow',
            kind: 'video',
        }],
        workspace: {
            status: 'ready',
            initial_targets: [{
                target_token: 'opaque-first-video',
                kind: 'video',
                target_id: 'clip_private_first',
                target_label: '첫 장면',
                sequence: 1,
            }],
            candidates: [{
                candidate_token: 'flow-both-opaque',
                provider: 'flow',
                result_id: 'flow-both',
                size_bytes: 1024,
                duration_seconds: 5,
                preview_allowed: false,
            }, {
                candidate_token: 'grok-both-opaque',
                provider: 'grok',
                result_id: 'grok-both',
                size_bytes: 1024,
                duration_seconds: 5,
                preview_allowed: false,
            }],
        },
        async onPlan() {
            return { status: 'blocked', ready: false };
        },
    });

    let mode = byAttribute(band, 'select', 'id', 'video-import-mode');
    assert.equal(byAttribute(band, 'label', 'for', 'video-import-mode').textContent, '연결 방식');
    assert.deepEqual(findAll(mode, 'option').map((option) => [option.value, option.textContent]), [
        ['initial', '처음 연결'],
        ['retry', '다시 연결'],
    ]);
    assert.deepEqual(findAll(byAttribute(band, 'select', 'id', 'video-import-candidate'), 'option').map((option) => option.value), [
        '', 'flow-both-opaque', 'grok-both-opaque',
    ]);

    mode.value = 'retry';
    await mode.dispatchEvent({ type: 'change' });
    mode = byAttribute(band, 'select', 'id', 'video-import-mode');
    assert.equal(mode.value, 'retry');
    assert.ok(byAttribute(band, 'select', 'id', 'video-import-retry-target'));
    assert.equal(byAttribute(band, 'select', 'id', 'video-import-initial-target'), null);
    assert.deepEqual(findAll(byAttribute(band, 'select', 'id', 'video-import-candidate'), 'option').map((option) => option.value), [
        '', 'flow-both-opaque',
    ]);
});

test('MOCK video result import binds Flow candidates to the exact saved video retry', async (t) => {
    const calls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { MediaRetryPlanBand } = await import('../src/components/pipeline/MediaRetryPlanBand.js');
    const band = MediaRetryPlanBand({
        plan: {
            status: 'blocked',
            blockers: ['MISSING_FLOW_RUNTIME_CONTEXT'],
            items: [{
                sequence: 1,
                media_id: 'flow-video-retry',
                target_id: 'clip_010',
                provider: 'flow',
                kind: 'video',
                readiness: 'blocked_runtime_context',
                blockers: ['MISSING_FLOW_RUNTIME_CONTEXT'],
                command_spec: {},
            }, {
                sequence: 2,
                media_id: 'grok-video-retry',
                target_id: 'clip_002',
                provider: 'grok',
                kind: 'video',
                readiness: 'blocked_runtime_unverified',
                blockers: ['GROK_RUNTIME_UNVERIFIED'],
                command_spec: {},
            }, {
                sequence: 3,
                media_id: 'replicate-video-retry',
                target_id: 'clip_003',
                provider: 'replicate',
                kind: 'video',
                readiness: 'blocked_adapter_missing',
                blockers: ['MISSING_PROVIDER_ADAPTER'],
                command_spec: {},
            }, {
                sequence: 4,
                media_id: 'bytedance-video-retry',
                target_id: 'clip_004',
                provider: 'bytedance',
                kind: 'video',
                readiness: 'blocked_adapter_missing',
                blockers: ['MISSING_PROVIDER_ADAPTER'],
                command_spec: {},
            }],
        },
        videoResultImportWorkspace: {
            status: 'ready',
            ready: true,
            blockers: [],
            candidates: [{
                candidate_token: 'flow-opaque',
                provider: 'flow',
                result_id: 'H1_ancient_campfire',
                size_bytes: 2673934,
                duration_seconds: 10.006,
                width: 1280,
                height: 720,
                preview_allowed: true,
            }, {
                candidate_token: 'grok-opaque',
                provider: 'grok',
                result_id: 'smoke_valid',
                size_bytes: 4417147,
                duration_seconds: 6.042,
                width: 464,
                height: 688,
                preview_allowed: true,
            }, {
                candidate_token: 'replicate-opaque',
                provider: 'replicate',
                result_id: 'seedance_1',
                size_bytes: 6349367,
                duration_seconds: 5.042,
                width: 1088,
                height: 1920,
                preview_allowed: true,
            }],
        },
        async onPlanVideoResultImport(payload) {
            calls.push(['plan', payload]);
            return {
                status: 'ready',
                ready: true,
                plan_token: 'video-plan-opaque',
                retry_media_id: payload.retryMediaId,
                target_id: 'clip_010',
                source_result_id: 'H1_ancient_campfire',
                blockers: [],
            };
        },
        async onConfirmVideoResultImport(payload) {
            calls.push(['confirm', payload]);
            return { ok: true, imported: true, already_current: false, media_id: 'flow-imported' };
        },
    });

    const targetSelect = byAttribute(band, 'select', 'id', 'video-import-retry-target');
    const candidateSelect = byAttribute(band, 'select', 'id', 'video-import-candidate');
    assert.deepEqual(findAll(targetSelect, 'option').map((option) => option.value), [
        'flow-video-retry', 'grok-video-retry', 'replicate-video-retry', 'bytedance-video-retry',
    ]);
    assert.deepEqual(findAll(candidateSelect, 'option').map((option) => option.value), ['', 'flow-opaque']);
    candidateSelect.value = 'flow-opaque';
    await candidateSelect.dispatchEvent({ type: 'change' });

    await byText(band, 'button', '가져오기 계획').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[0], ['plan', { candidateToken: 'flow-opaque', retryMediaId: 'flow-video-retry' }]);
    assert.match(band.textContent, /가져올 영상과 장면을 확인했습니다/);
    assert.doesNotMatch(band.textContent, /Users\/jessiek|sourcePath|targetPath/);

    await byText(band, 'button', '이 영상 연결').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls[1], ['confirm', { planToken: 'video-plan-opaque', confirmed: true }]);
    assert.match(band.textContent, /장면 검토 보드에 연결했습니다/);
    assert.equal(findAll(band, 'button').some((button) => /생성 실행/.test(button.textContent)), false);

    const replicateTarget = byAttribute(band, 'select', 'id', 'video-import-retry-target');
    replicateTarget.value = 'replicate-video-retry';
    await replicateTarget.dispatchEvent({ type: 'change' });
    assert.deepEqual(
        findAll(byAttribute(band, 'select', 'id', 'video-import-candidate'), 'option').map((option) => option.value),
        ['', 'replicate-opaque'],
    );
    assert.match(band.textContent, /Replicate/);

    const bytedanceTarget = byAttribute(band, 'select', 'id', 'video-import-retry-target');
    bytedanceTarget.value = 'bytedance-video-retry';
    await bytedanceTarget.dispatchEvent({ type: 'change' });
    const emptyOptions = findAll(byAttribute(band, 'select', 'id', 'video-import-candidate'), 'option');
    assert.deepEqual(emptyOptions.map((option) => option.value), ['']);
    assert.equal(emptyOptions[0].textContent, '이 도구의 완료 영상 없음');
    assert.match(band.textContent, /ByteDance/);
});

test('MOCK media attempt cards keep Korean labels and semantic review colors', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { MediaAttemptCard } = await import('../src/components/pipeline/MediaReviewBoardParts.js');
    const tones = [
        ['accepted', '채택', 'emerald'],
        ['needs_changes', '수정 필요', 'yellow'],
        ['retry_requested', '다시 만들기', 'orange'],
        ['unreviewed', '미검토', 'zinc'],
    ];
    const actions = { onNote() {}, onReview() {}, onRetry() {} };

    for (const [reviewStatus, label, classToken] of tones) {
        const card = MediaAttemptCard({
            media_id: `media-${reviewStatus}`,
            kind: 'scene_image',
            target_id: 'clip_001',
            target_label: '첫 장면',
            provider: 'dst',
            attempt: 1,
            generation_status: 'downloaded',
            review_status: reviewStatus,
            selected_for_retry: reviewStatus === 'retry_requested',
        }, actions);
        const badge = findAll(card, 'span').find((span) => span.textContent.trim() === label);
        assert.ok(badge, `${reviewStatus} must keep its Korean label`);
        assert.match(badge.className, new RegExp(classToken), `${reviewStatus} must use its semantic badge tone`);
        assert.match(card.textContent, /첫 장면/);
        assert.equal(card.textContent.includes('clip_001'), false, 'the review card shows the user-facing target label');
    }
});

test('new-project intake keeps direct edits and local agent handoffs distinct without leaking errors', async (t) => {
    const calls = [];
    const alerts = [];
    let rejectSave = false;
    const draft = {
        production_id: 'restored-project',
        brief: '복원된 한글 브리프',
        script: '복원된 한글 스크립트',
        route: 'both',
        aspect_ratio: '9:16',
        scene_duration: 5,
        max_scenes: 3,
    };
    const readyState = (value = draft) => ({
        ok: true,
        status: 'restored',
        draft: structuredClone(value),
        savedAt: '2026-07-13T12:00:00.000Z',
        readiness: 'ready_to_copy',
        blockers: [],
        parentRoot: '/tmp/main-owned-parent',
        targetPath: `/tmp/main-owned-parent/${value.production_id}`,
        harnessReady: true,
        executed: false,
        revision_sha256: 'a'.repeat(64),
        collaboration: {
            status: 'empty', total_request_count: 0, recent_requests: [], truncated: false, blockers: [],
        },
        preview: {
            ready: true,
            copyAllowed: true,
            previewOnly: true,
            executed: false,
            shellSafeCommand: `cd /fixed/harness && python3 /fixed/builder.py --production-id ${value.production_id}`,
        },
    });
    const bridge = {
        async getConfig() {
            return { config: { productionRoot: '', productionParentRoot: '/tmp/main-owned-parent' } };
        },
        async getNewProjectDraftState(...args) {
            calls.push(['getNewProjectDraftState', args]);
            return readyState();
        },
        async saveNewProjectDraft(payload) {
            calls.push(['saveNewProjectDraft', structuredClone(payload)]);
            if (rejectSave) throw new Error('SECRET_DRAFT_CONTENT_AND_PATH');
            return { ...readyState(payload), status: 'saved' };
        },
        async copyNewProjectBuildCommand(...args) {
            calls.push(['copyNewProjectBuildCommand', args]);
            return { ok: true, copied: true, verified: true, executed: false, state: readyState() };
        },
        async enqueuePlanningAgentRequest(payload) {
            calls.push(['enqueuePlanningAgentRequest', structuredClone(payload)]);
            return {
                ok: true,
                queued: true,
                already_queued: false,
                request_id: 'hidden-request-id',
                status: 'queued_local_handoff',
                executed: false,
                model_called: false,
                state: {
                    ...readyState(),
                    collaboration: {
                        status: 'queued',
                        total_request_count: 1,
                        truncated: false,
                        blockers: [],
                        recent_requests: [{
                            request_id: 'hidden-request-id',
                            stage: payload.stage,
                            instruction: payload.instruction,
                            status: 'queued_local_handoff',
                            requested_at: '2026-07-16T00:00:00.000Z',
                            executed: false,
                            model_called: false,
                        }],
                    },
                },
            };
        },
        async runPlanningAgentRequest(payload) {
            calls.push(['runPlanningAgentRequest', structuredClone(payload)]);
            return {
                ok: false,
                status: 'failed',
                state: {
                    ...readyState(),
                    collaboration: {
                        status: 'queued', total_request_count: 1, truncated: false, blockers: [],
                        recent_requests: [{
                            request_id: 'hidden-request-id', stage: payload.stage,
                            status: 'queued_local_handoff', executed: false, model_called: false,
                        }],
                    },
                },
            };
        },
        async previewCommand(command) {
            calls.push(['previewCommand', command]);
        },
        async copyCommandPreview(command) {
            calls.push(['copyCommandPreview', command]);
        },
        async runSafeCommand(command) {
            calls.push(['runSafeCommand', command]);
        },
    };
    const { restore } = installDeterministicDom(bridge, { alerts });
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await byAttribute(studio, 'button', 'aria-label', '1 기획·대본').dispatchEvent({ type: 'click' });

    assert.ok(byText(studio, 'h2', '기획·대본'));
    assert.ok(byText(studio, 'h3', '기획·대본 작업'));
    assert.ok(byText(studio, 'h4', '1. 기획'));
    assert.ok(byText(studio, 'h4', '2. 스크립트'));
    const form = byAttribute(studio, 'form', 'aria-label', '새 프로젝트 초안');
    assert.ok(form, 'new-project fields must be grouped in a native form');
    assert.match(form.className, /flex/);
    assert.match(form.className, /min-w-0/);
    for (const [id, label] of [
        ['new-project-production-id', '제작 ID'],
        ['new-project-brief', '브리프'],
        ['new-project-script', '스크립트'],
        ['new-project-route', '생성 경로'],
        ['new-project-aspect', '화면 비율'],
        ['new-project-duration', '씬 길이(초)'],
        ['new-project-scenes', '최대 씬 수'],
    ]) {
        assert.equal(byAttribute(studio, 'label', 'for', id)?.textContent.trim(), label);
        const control = byAttribute(studio, 'input', 'id', id)
            || byAttribute(studio, 'textarea', 'id', id)
            || byAttribute(studio, 'select', 'id', id);
        assert.ok(control, `${id} must have a native control`);
        assert.equal(control.attributes.get('required'), 'true');
        assert.match(control.className, /min-h-11|min-h-\[/, `${id} must keep a 44px-class touch target`);
    }
    for (const [id, label] of [
        ['planning-brief-agent-request', '어떻게 바꿀까요?'],
        ['planning-script-agent-request', '어떻게 바꿀까요?'],
    ]) {
        assert.equal(byAttribute(studio, 'label', 'for', id)?.textContent.trim(), label);
        assert.ok(byAttribute(studio, 'textarea', 'id', id));
    }
    assert.equal(findAll(studio, 'button').filter((button) => button.textContent.trim() === '직접 저장').length, 2);
    assert.equal(findAll(studio, 'button').filter((button) => button.textContent.trim() === '에이전트 작업 시작').length, 2);
    assert.equal(findAll(studio, 'h5').filter((heading) => heading.textContent.trim() === '직접 수정').length, 2);
    assert.equal(findAll(studio, 'h5').filter((heading) => heading.textContent.trim() === '에이전트에게 요청').length, 2);
    assert.match(studio.textContent, /에이전트는 기획과 대본만 다듬으며 제작·생성은 시작하지 않습니다/);
    assert.match(studio.textContent, /고급: 빌드 명령/);
    assert.ok(byText(studio, 'button', '새 프로젝트 초안'), 'project bar must expose direct intake navigation');

    const productionId = byAttribute(studio, 'input', 'id', 'new-project-production-id');
    productionId.value = 'edited-project';
    await productionId.dispatchEvent({ type: 'input' });
    const briefInput = byAttribute(studio, 'textarea', 'id', 'new-project-brief');
    briefInput.value = '편집한 한글 브리프';
    await briefInput.dispatchEvent({ type: 'input' });
    const duration = byAttribute(studio, 'input', 'id', 'new-project-duration');
    duration.value = '8';
    await duration.dispatchEvent({ type: 'input' });
    await findAll(studio, 'button').find((button) => button.textContent.trim() === '직접 저장').dispatchEvent({ type: 'click' });
    await flushRenderer();
    const saveCall = calls.find(([method]) => method === 'saveNewProjectDraft');
    assert.equal(saveCall[1].production_id, 'edited-project');
    assert.equal(saveCall[1].brief, '편집한 한글 브리프');
    assert.equal(saveCall[1].scene_duration, 8);
    assert.equal(Object.hasOwn(saveCall[1], 'output_root'), false);
    assert.equal(Object.hasOwn(saveCall[1], 'cwd'), false);
    assert.equal(Object.hasOwn(saveCall[1], 'command'), false);

    const requestInput = byAttribute(studio, 'textarea', 'id', 'planning-brief-agent-request');
    requestInput.value = '핵심 갈등을 더 선명하게 다듬어줘';
    const requestButtons = findAll(studio, 'button').filter((button) => button.textContent.trim() === '에이전트 작업 시작');
    await requestButtons[0].dispatchEvent({ type: 'click' });
    await flushRenderer();
    const enqueueCall = calls.find(([method]) => method === 'enqueuePlanningAgentRequest');
    assert.deepEqual(enqueueCall[1], {
        stage: 'brief',
        instruction: '핵심 갈등을 더 선명하게 다듬어줘',
        expected_revision_sha256: 'a'.repeat(64),
    });
    assert.equal(calls.at(calls.indexOf(enqueueCall) - 1)[0], 'saveNewProjectDraft', 'request must save the full draft first');
    assert.deepEqual(calls.find(([method]) => method === 'runPlanningAgentRequest')[1], { stage: 'brief' });
    assert.match(studio.textContent, /수정안을 만들지 못했습니다|수정안이 도착했습니다/);
    assert.doesNotMatch(studio.textContent, /hidden-request-id|queued_local_handoff|실행 완료|작업 완료/);

    await byText(studio, 'button', '빌드 명령 복사').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'copyNewProjectBuildCommand')[1], []);
    assert.equal(calls.filter(([method]) => method === 'previewCommand').length, 0);
    assert.equal(calls.filter(([method]) => method === 'copyCommandPreview').length, 0);
    assert.equal(calls.filter(([method]) => method === 'runSafeCommand').length, 0);
    assert.match(studio.textContent, /빌드 명령을 복사했습니다/);

    rejectSave = true;
    await findAll(studio, 'button').find((button) => button.textContent.trim() === '직접 저장').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(studio.textContent, /저장하지 못했습니다/);
    assert.deepEqual(alerts, []);
    assert.doesNotMatch(`${studio.textContent}\n${alerts.join('\n')}`, /SECRET_DRAFT_CONTENT_AND_PATH/);
    assert.deepEqual(calls.find(([method]) => method === 'getNewProjectDraftState')[1], []);
});

test('new-project collaboration hides raw provider blockers behind one short Korean state', async (t) => {
    const providerSource = await readFile(new URL('../electron/lib/newProjectDraftProvider.js', import.meta.url), 'utf8');
    const providerCodes = [...new Set(providerSource.match(/NEW_PROJECT_[A-Z0-9_]+/g) || [])].sort();
    assert.ok(providerCodes.length > 0, 'provider must expose a non-empty blocker-code contract');

    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectDraftForm } = await import('../src/components/pipeline/NewProjectDraftForm.js');
    const form = NewProjectDraftForm({
        draftState: {
            status: 'error',
            blockers: providerCodes,
            preview: { copyAllowed: false, shellSafeCommand: '' },
        },
        draftValue: {
            production_id: '', brief: '', script: '', route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 10,
        },
    });

    assert.doesNotMatch(form.textContent, /NEW_PROJECT_[A-Z0-9_]+/);
    assert.match(form.textContent, /저장하지 못했습니다/);
    assert.match(form.textContent, /초안 폴더가 안전한 비공개 폴더가 아닙니다/);
    assert.match(form.textContent, /저장된 초안의 무결성 정보를 확인하지 못했습니다/);
    assert.match(form.textContent, /시스템 클립보드를 사용할 수 없습니다/);
    assert.doesNotMatch(form.textContent, /블로커|차단 항목|request_id|revision_sha256/);
});

test('settings renders partial and blocked fixed-root harness readiness in Korean', async (t) => {
    const picked = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { default: samplePipelineState } = await import('../src/lib/pipeline/mockData.js');
    const { PipelineSettingsPanel } = await import('../src/components/pipeline/PipelineSettingsPanel.js');
    const config = {
        productionRoot: '/tmp/production', productionParentRoot: '',
        externalMediaRoots: { dst: '/tmp/dst-images' },
    };

    for (const [readiness, expected] of [['partial', '일부만 준비됨'], ['blocked', '연결 확인 필요']]) {
        const panel = PipelineSettingsPanel({
            state: samplePipelineState,
            config,
            harnessStatus: { readiness, rootPath: '/fixed/happyVideoFactory' },
            onPickMediaRoot: (provider) => picked.push(provider),
        });
        assert.match(panel.textContent, new RegExp(`로컬 하네스${expected}`));
        assert.match(panel.textContent, /외부 이미지·영상 생성꺼짐/);
        assert.match(panel.textContent, /외부 업로드꺼짐/);
        assert.match(panel.textContent, /고급: 로컬 경로/);
        assert.match(panel.textContent, /결과 폴더.*이미지 결과연결됨.*Flow 영상선택 필요/s);
        assert.equal(byAttribute(panel, 'button', 'aria-label', 'Grok 영상 폴더 선택').textContent, '선택');
        await byAttribute(panel, 'button', 'aria-label', 'Grok 영상 폴더 선택').dispatchEvent({ type: 'click' });
    }
    assert.deepEqual(picked, ['grok', 'grok']);
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
        async selectExternalMediaRoot(request) {
            calls.push(['selectExternalMediaRoot', structuredClone(request)]);
            config = {
                ...config,
                externalMediaRoots: { ...(config.externalMediaRoots || {}), [request.provider]: '/tmp/grok-results' },
            };
            return {
                ok: true, canceled: false, provider: request.provider,
                rootPath: '/tmp/grok-results', config: structuredClone(config),
            };
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

    const projectTitles = [];
    window.addEventListener('pipeline:project-title', (event) => projectTitles.push(event.detail?.title));
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'settings' } });
    await byAttribute(studio, 'button', 'aria-label', 'Grok 영상 폴더 선택').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'selectExternalMediaRoot')[1], { provider: 'grok' });
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
    assert.equal(projectTitles.at(-1), 'Main Owned Child Production');
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
    await byAttribute(studio, 'button', 'aria-label', '1 기획·대본').dispatchEvent({ type: 'click' });
    const saveButton = byText(studio, 'button', '계획 파일 저장');
    assert.ok(saveButton, 'intake planning save button must be available');
    await saveButton.dispatchEvent({ type: 'click' });
    await flushRenderer();

    assert.deepEqual(alerts, ['저장이 차단되었습니다: 안전한 계획 파일 경로와 내용인지 확인하세요.']);
    assert.doesNotMatch(alerts[0], /SECRET_PAYLOAD/);
    assert.deepEqual(unhandled, []);
});

test('PipelineSidebar keeps five-stage navigation ahead of a collapsed Korean production list', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { PipelineSidebar } = await import('../src/components/pipeline/PipelineSidebar.js');

    const sidebar = PipelineSidebar({
        stages: [{ id: 'start', number: 1, label: '기획·대본', status: 'current', tabs: [{ id: 'intake', label: '기획·대본' }] }],
        activeStageId: 'start',
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
        onSelectStage() {},
        onSelectProduction() {},
        onOpenSettings() {},
        onRefreshProductions() {},
    });

    assert.match(sidebar.textContent, /sanitized-production/);
    assert.match(sidebar.textContent, /파일 3개/);
    assert.ok(
        sidebar.textContent.indexOf('기획·대본') < sidebar.textContent.indexOf('제작 목록'),
        'primary workflow navigation must remain ahead of the production list',
    );
    assert.ok(byAttribute(sidebar, 'nav', 'aria-label', '파이프라인 작업 단계'));
    assert.equal(byAttribute(sidebar, 'button', 'aria-label', '1 기획·대본').attributes.get('aria-current'), 'step');
    assert.equal(byText(sidebar, 'button', '기획·대본').attributes.get('aria-current'), 'page');
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
        delivery_manifest_path: '/tmp/synthetic-finishing/final/delivery_manifest.json',
        delivery_verified: true,
        delivery_master_key: 'master_sub',
        delivery_master_path: '/tmp/synthetic-finishing/final/master_sub.mp4',
        delivery_sha256_verified: true,
        persisted_probe_verified: true,
        fresh_probe_verified: false,
        finishing_inconsistencies: [],
        final_ready: false,
    };
    state.fileEvidence = {
        '/tmp/synthetic-finishing/takes/SH01.mp4': true,
        '/tmp/synthetic-finishing/final/master_sub.mp4': true,
        '/tmp/synthetic-finishing/final/delivery_manifest.json': true,
    };
    state.files = Object.keys(state.fileEvidence);
    state.blockers = ['OUTPUT_QUALITY_NOT_PROVEN'];
    state.finalReport = {
        ...state.finalReport,
        final_video_path: '/tmp/synthetic-finishing/final/master_sub.mp4',
        concat_list_path: '/tmp/synthetic-finishing/final/concat_list.txt',
        report_path: '/tmp/synthetic-finishing/final/report.md',
        ffprobe_verified: false,
        ffprobe_path: '',
        fresh_probe_verified: false,
        delivery_manifest_path: '/tmp/synthetic-finishing/final/delivery_manifest.json',
        delivery_verified: true,
        delivery_master_key: 'master_sub',
        delivery_sha256: 'a'.repeat(64),
        delivery_sha256_verified: true,
        persisted_probe: { duration_seconds: 5.25, has_video: true, has_audio: true },
        persisted_probe_verified: true,
        stitch_evidence: 'canonical_delivery_manifest',
        blockers: ['OUTPUT_QUALITY_NOT_PROVEN'],
    };

    const qa = QAPanel({ state });
    const final = FinalReportPanel({ state });
    assert.match(qa.textContent, /정식 QC는 구조 증거일 뿐임/);
    assert.match(qa.textContent, /사람의 최종 판정은 미검토/);
    assert.match(qa.textContent, /원본 증거가 있는 채택 구간: 1/);
    assert.match(final.textContent, /정식 최종 준비 상태 미입증/);
    assert.match(final.textContent, /정식 delivery 증거 검증됨/);
    assert.match(final.textContent, /저장된 생산자 probe/);
    assert.match(final.textContent, /새 ffprobe 실행 안 함/);
    assert.match(final.textContent, /선택 구간 마감 작업대/);
    assert.match(final.textContent, /렌더 실행 성공 ≠ 영상 품질 승인/);
    assert.match(final.textContent, /source 경로·명령·실행 파일은 화면에 노출되지 않습니다/);
    assert.doesNotMatch(final.textContent, /새 ffprobe 검증됨/);
    const buttons = findAll(final, 'button');
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, '작업대 상태 새로 확인');
    for (const button of buttons) await button.dispatchEvent({ type: 'click' });
    assert.equal(copyCalls, 0);
    assert.equal(buttons.some((button) => /명령 복사|command/i.test(button.textContent)), false);
});

test('G3 review workspace is Korean-first, keyboard-native, responsive, and separates machine QC from human decisions', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const priorPreviewApis = {
        atob: Object.getOwnPropertyDescriptor(globalThis, 'atob'),
        Blob: Object.getOwnPropertyDescriptor(globalThis, 'Blob'),
        URL: Object.getOwnPropertyDescriptor(globalThis, 'URL'),
        MutationObserver: Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver'),
    };
    const revoked = [];
    const observers = [];
    let nextUrl = 0;
    globalThis.atob = (value) => Buffer.from(value, 'base64').toString('latin1');
    globalThis.Blob = class {
        constructor(parts, options) {
            this.size = parts.reduce((sum, part) => sum + part.byteLength, 0);
            this.type = options.type;
        }
    };
    globalThis.URL = {
        createObjectURL: () => `blob:fixture-${nextUrl += 1}`,
        revokeObjectURL: (value) => revoked.push(value),
    };
    globalThis.MutationObserver = class {
        constructor(callback) {
            this.callback = callback;
            this.disconnected = false;
            observers.push(this);
        }

        observe() {}

        disconnect() {
            this.disconnected = true;
        }
    };
    t.after(() => {
        for (const [key, descriptor] of Object.entries(priorPreviewApis)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    const { G3ReviewWorkspace } = await import('../src/components/pipeline/G3ReviewWorkspace.js');
    const changes = [];
    const workspace = {
        ok: true,
        status: 'restored',
        draft_id: 'g3_fixture',
        project_id: 'project_01',
        episode_id: 'episode_01',
        promotion_ready: false,
        label: '초안/비승격',
        shots: [{ shot_id: 'SH01' }],
        beats: [{ beat_id: 'BEAT01' }],
        canonical_beat_list_available: true,
        candidates: [{
            candidate_token: 'opaque-token',
            display_path: 'generated/downloads/SH01.mp4',
            file_name: 'SH01.mp4',
            size_bytes: 1024,
            duration_sec: 5,
            duration_authoritative: true,
            preview_allowed: true,
        }],
        machine_qc_contract: 'short-drama-room-qc-report-v1',
        machine_qc_read_only: true,
        machine_qc: [{
            shot_id: 'SH01', provider: 'seedance', deterministic_checks_passed: true,
            dialogue_intelligibility_score: 0.96, pronunciation_risk_flag: false,
            decision: 'accept', external_review_state: 'recorded_without_verdict', external_finding_count: 1,
        }],
        selections: [{
            shot_id: 'SH01', candidate_token: 'opaque-token', chosen_provider: 'seedance',
            dialogue_source: 'native_video_lipsync', beat_id: 'BEAT01', take_id: 'SH01_take_01',
            source_in_sec: 0, source_out_sec: 4.5, transition_in: null,
            selection_reason: '사람이 직접 확인함', notes: '',
        }],
        overall_notes: '',
        blockers: [],
        validation_blockers: [],
        authoring_ready: true,
        export_ready: true,
    };
    const node = G3ReviewWorkspace({
        workspace,
        activeShotId: 'SH01',
        onActiveShotChange: (value) => changes.push(['shot', value]),
        onSelectionChange: (shotId, field, value) => changes.push([shotId, field, value]),
        onOverallNotesChange: (value) => changes.push(['notes', value]),
        onPreview: async () => ({ loaded: true, mime_type: 'video/mp4', byte_length: 7, base64: 'Zml4dHVyZQ==' }),
        onSave: () => changes.push(['save']),
        onExport: () => changes.push(['export']),
    });
    const text = node.textContent;

    assert.match(text, /G3 인간 검토 작업대/);
    assert.match(text, /초안\/비승격/);
    assert.match(text, /기계 QC · 읽기 전용/);
    assert.match(text, /인간 선택 기록/);
    assert.match(text, /자동 승인하지 않습니다/);
    assert.equal(text.includes('/tmp/'), false);
    assert.match(node.className, /border-t/);
    assert.ok(descendants(node).some((item) => item.className.includes('md:grid-cols-[')));

    const provider = byAttribute(node, 'select', 'id', 'g3-provider');
    const candidate = byAttribute(node, 'select', 'id', 'g3-candidate-select');
    const reason = byAttribute(node, 'textarea', 'id', 'g3-selection-reason');
    const shotButton = byAttribute(node, 'button', 'aria-pressed', 'true');
    assert.ok(provider && candidate && reason && shotButton);
    assert.match(provider.className, /min-h-11/);
    assert.match(candidate.className, /min-h-11/);
    provider.value = 'flow';
    await provider.dispatchEvent({ type: 'change' });
    assert.deepEqual(changes.at(-1), ['SH01', 'chosen_provider', 'flow']);

    const previewButton = byText(node, 'button', '선택 후보 미리보기');
    document.body.appendChild(node);
    await previewButton.dispatchEvent({ type: 'click' });
    let video = findAll(node, 'video')[0];
    assert.ok(video);
    assert.match(video.attributes.get('src'), /^blob:/);
    assert.doesNotMatch(node.textContent, /data:video|Zml4dHVyZQ/);
    await video.dispatchEvent({ type: 'error' });
    assert.deepEqual(revoked, ['blob:fixture-1']);
    assert.match(node.textContent, /미리보기를 재생할 수 없습니다/);

    await previewButton.dispatchEvent({ type: 'click' });
    video = findAll(node, 'video')[0];
    assert.equal(video.attributes.get('src'), 'blob:fixture-2');
    candidate.value = '';
    await candidate.dispatchEvent({ type: 'change' });
    assert.deepEqual(revoked, ['blob:fixture-1', 'blob:fixture-2']);
    assert.match(node.textContent, /후보를 선택한 뒤/);

    candidate.value = 'opaque-token';
    await candidate.dispatchEvent({ type: 'change' });
    await previewButton.dispatchEvent({ type: 'click' });
    assert.equal(findAll(node, 'video')[0].attributes.get('src'), 'blob:fixture-3');
    document.body.removeChild(node);
    observers.forEach((observer) => observer.callback());
    assert.deepEqual(revoked, ['blob:fixture-1', 'blob:fixture-2', 'blob:fixture-3']);
    assert.equal(observers.every((observer) => observer.disconnected), true);
    assert.equal(byText(node, 'button', 'canonical 형태로 초안 내보내기').disabled, false);

    const loading = G3ReviewWorkspace({ workspace: { ...workspace, status: 'loading' } });
    const empty = G3ReviewWorkspace({ workspace: { ...workspace, status: 'empty', shots: [], blockers: [] } });
    const error = G3ReviewWorkspace({ workspace: { ...workspace, status: 'error', shots: [], blockers: ['G3_WORKSPACE_UNAVAILABLE'] } });
    assert.match(loading.textContent, /불러오는 중/);
    assert.match(empty.textContent, /shot_manifest\.json/);
    assert.match(error.textContent, /안전하게 불러오지 못했습니다/);
});

test('planning suggestions compare each stage independently and keep decisions explicit', async (t) => {
    const decisions = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectDraftForm } = await import('../src/components/pipeline/NewProjectDraftForm.js');
    const draftValue = {
        production_id: 'planning-compare', brief: '현재 기획 원문', script: '현재 스크립트 원문',
        route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 3,
    };
    const request = (stage, reviewStatus, token, proposedText, applyAllowed = true) => ({
        stage,
        status: 'suggestion_ready',
        suggestion: {
            suggestion_token: token,
            review_status: reviewStatus,
            summary: stage === 'brief' ? '핵심 갈등을 선명하게 정리했습니다.' : '첫 문장을 짧게 다듬었습니다.',
            proposed_text: proposedText,
            published_at: '2026-07-16T00:00:00.000Z',
            apply_allowed: applyAllowed,
        },
    });
    const form = NewProjectDraftForm({
        draftState: {
            status: 'restored', revision_sha256: 'a'.repeat(64), blockers: [],
            collaboration: {
                status: 'suggestion_ready', blockers: [], truncated: false, total_request_count: 3,
                recent_requests: [
                    request('brief', 'ready', 'private-brief-token', '새 기획 수정안'),
                    request('script', 'held', 'private-script-token', '새 스크립트 수정안'),
                    request('brief', 'ready', 'old-private-token', '오래된 수정안'),
                ],
            },
            preview: { copyAllowed: false, shellSafeCommand: '' },
        },
        draftValue,
        draftDirty: { brief: false, script: false, settings: false },
        onDraftChange() {},
        onDecidePlanningAgentSuggestion: (payload) => decisions.push(payload),
    });

    assert.equal(byAttribute(form, 'label', 'for', 'new-project-brief').textContent.trim(), '현재 내용');
    assert.equal(byAttribute(form, 'label', 'for', 'new-project-script').textContent.trim(), '스크립트');
    const briefSuggestion = byAttribute(form, 'textarea', 'id', 'planning-brief-agent-suggestion');
    const scriptSuggestion = byAttribute(form, 'textarea', 'id', 'planning-script-agent-suggestion');
    assert.equal(briefSuggestion.value, '새 기획 수정안', 'newest-first projection must select the first stage request');
    assert.equal(briefSuggestion.readOnly, true);
    assert.equal(scriptSuggestion.value, '새 스크립트 수정안');
    assert.match(form.textContent, /수정안이 도착했습니다/);
    assert.match(form.textContent, /보류함 · 원문은 그대로/);
    assert.match(form.textContent, /다른 요청 남기기/);
    assert.match(form.textContent, /지난 수정안 보기/);
    assert.doesNotMatch(form.textContent, /private-brief-token|private-script-token|suggestion_ready|review_status/);

    const sections = findAll(form, 'section');
    assert.match(sections.find((section) => section.attributes.get('aria-labelledby') === 'planning-brief-title').className, /lg:grid-cols-2/);
    const applyButtons = findAll(form, 'button').filter((button) => button.textContent.trim() === '수정안 적용');
    assert.equal(applyButtons.length, 2, 'ready and held suggestions both expose an apply action');
    assert.ok(applyButtons.every((button) => button.className.includes('min-h-11')));
    await applyButtons[0].dispatchEvent({ type: 'click' });
    await applyButtons[1].dispatchEvent({ type: 'click' });
    assert.deepEqual(decisions, [
        { stage: 'brief', suggestion_token: 'private-brief-token', action: 'apply' },
        { stage: 'script', suggestion_token: 'private-script-token', action: 'apply' },
    ]);

    const dirtyForm = NewProjectDraftForm({
        draftState: {
            status: 'restored', blockers: [],
            collaboration: {
                status: 'suggestion_ready', blockers: [], truncated: false, total_request_count: 2,
                recent_requests: [
                    request('brief', 'ready', 'brief-dirty-token', '기획 수정안'),
                    request('script', 'held', 'script-clean-token', '스크립트 수정안'),
                ],
            },
            preview: { copyAllowed: false, shellSafeCommand: '' },
        },
        draftValue,
        draftDirty: { brief: true, script: false, settings: false },
        onDraftChange() {},
    });
    assert.match(dirtyForm.textContent, /원문이 바뀌어 바로 적용할 수 없습니다/);
    const dirtyApplyButtons = findAll(dirtyForm, 'button').filter((button) => button.textContent.trim() === '수정안 적용');
    assert.equal(dirtyApplyButtons[0].disabled, true, 'brief edit must stale only the brief suggestion');
    assert.equal(dirtyApplyButtons[1].disabled, false, 'brief edit must not stale a held script suggestion');
});

test('PipelineStudio refreshes design authority immediately after applying a planning suggestion', async (t) => {
    const planningBefore = 'a'.repeat(64);
    const planningAfter = 'b'.repeat(64);
    const designBefore = 'd'.repeat(64);
    const designAfter = 'e'.repeat(64);
    const proposedBrief = '목표와 갈등이 선명한 새 기획';
    const draft = {
        production_id: 'planning-design-refresh', brief: '기존 기획', script: '기존 대본',
        route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 4,
    };
    let designReads = 0;
    let designSavePayload;
    const suggestion = {
        suggestion_token: 'private-planning-refresh-token', review_status: 'ready',
        summary: '목표와 갈등을 앞에 배치했습니다.', proposed_text: proposedBrief,
        apply_allowed: true, published_at: '2026-07-16T00:00:00.000Z',
    };
    const bridge = {
        async getConfig() { return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } }; },
        async getHarnessContractStatus() { return { ok: true, ready: true, readiness: 'available', entries: [] }; },
        async getVideoResultImportWorkspace() { return { status: 'empty', candidates: [], blockers: [] }; },
        async getNewProjectDraftState() {
            return {
                ok: true, status: 'restored', draft, revision_sha256: planningBefore, blockers: [],
                preview: { copyAllowed: false, shellSafeCommand: '' },
                collaboration: { status: 'suggestion_ready', blockers: [], recent_requests: [{ stage: 'brief', status: 'queued_local_handoff', suggestion }] },
            };
        },
        async decidePlanningAgentSuggestion() {
            return {
                ok: true, applied: true,
                state: {
                    ok: true, status: 'saved', draft: { ...draft, brief: proposedBrief }, revision_sha256: planningAfter, blockers: [],
                    preview: { copyAllowed: false, shellSafeCommand: '' },
                    collaboration: { status: 'applied', blockers: [], recent_requests: [{ stage: 'brief', status: 'queued_local_handoff', suggestion: { ...suggestion, review_status: 'applied' } }] },
                },
            };
        },
        async getNewProjectDesignState() {
            designReads += 1;
            return {
                ok: true, status: 'empty', board: { characters: [], locations: [], scenes: [] }, blockers: [],
                planning_revision_sha256: designReads === 1 ? planningBefore : planningAfter,
                revision_sha256: designReads === 1 ? designBefore : designAfter,
                collaboration: { recent_requests: [], blockers: [] },
            };
        },
        async saveNewProjectDesignBoard(payload) {
            designSavePayload = structuredClone(payload);
            return { ok: true, state: { ok: true, status: 'saved', board: payload.board, blockers: [], planning_revision_sha256: planningAfter, revision_sha256: 'f'.repeat(64), collaboration: { recent_requests: [], blockers: [] } } };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await byAttribute(studio, 'button', 'aria-label', '1 기획·대본').dispatchEvent({ type: 'click' });
    await byText(studio, 'button', '수정안 적용').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.equal(designReads, 2, 'planning apply must refresh the design revision immediately');
    await byAttribute(studio, 'button', 'aria-label', '2 설계').dispatchEvent({ type: 'click' });
    for (const [id, value] of [
        ['design-character-1-name', '지아'], ['design-location-1-name', '사진관'],
        ['design-scene-1-title', '재회'], ['design-scene-1-dramatic_beat', '두 사람이 마주친다'],
        ['design-scene-1-action', '걸음을 멈춘다'],
    ]) {
        const input = byAttribute(studio, 'input', 'id', id) || byAttribute(studio, 'textarea', 'id', id);
        input.value = value; await input.dispatchEvent({ type: 'input' });
    }
    const location = byAttribute(studio, 'select', 'id', 'design-scene-1-location');
    location.value = 'location_01'; await location.dispatchEvent({ type: 'change' });
    await byText(studio, 'button', '직접 저장').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.equal(designSavePayload.expected_planning_revision_sha256, planningAfter);
    assert.equal(designSavePayload.expected_design_revision_sha256, designAfter);
});

test('new project design board stays compact while supporting direct full-board edits', async (t) => {
    const changes = [];
    const saves = [];
    const requests = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectDesignBoard } = await import('../src/components/pipeline/NewProjectDesignBoard.js');
    const board = {
        characters: [{ id: 'character_01', name: '지아', role: '주인공', appearance: '짧은 머리', wardrobe: '회색 코트', continuity: '코트 유지' }],
        locations: [{ id: 'location_01', name: '상담실', space: '낡은 상담실', lighting: '창가 역광', props: '낡은 책상', continuity: '책상 위치 유지' }],
        scenes: [{
            id: 'scene_01', title: '문 앞의 지아', dramatic_beat: '지아가 문 앞에서 멈춘다.', characters: ['character_01'],
            location_id: 'location_01', duration: 5, first_frame: '문 앞 전신', action: '손잡이를 잡는다', camera: '느린 전진',
            lighting: '차가운 저녁빛', audio_sfx_dialogue: '빗소리',
        }],
    };
    const node = NewProjectDesignBoard({
        designState: { status: 'restored', board, collaboration: { recent_requests: [] } },
        boardValue: board,
        imagePlanTasks: [
            { kind: 'character_sheet', source_id: 'character_01', result_token: 'character-result' },
            { kind: 'location_sheet', source_id: 'location_01', result_token: 'location-result' },
            { kind: 'scene_image', source_id: 'scene_01', result_token: 'scene-result' },
        ],
        imageResultPreviews: {
            'character-result': { preview: { mime_type: 'image/png', base64: 'AA==' } },
            'location-result': { preview: { mime_type: 'image/png', base64: 'AQ==' } },
            'scene-result': { preview: { mime_type: 'image/png', base64: 'Ag==' } },
        },
        onBoardChange: (value) => changes.push(structuredClone(value)),
        onSave: (value) => saves.push(structuredClone(value)),
        onEnqueue: (value) => requests.push(structuredClone(value)),
    });

    assert.match(node.textContent, /1\. 인물 시트.*2\. 장소 시트.*3\. 장면 카드/s);
    assert.match(node.textContent, /지아.*주인공.*상담실.*낡은 상담실.*문 앞의 지아.*지아가 문 앞에서 멈춘다/s);
    assert.equal(findAll(node, 'details').filter((item) => item.attributes.has('open')).length, 0, 'saved cards start compact');
    assert.ok(byText(node, 'button', '인물').className.includes('min-h-11'));
    assert.ok(byText(node, 'button', '장소').className.includes('min-h-11'));
    assert.ok(byText(node, 'button', '장면').className.includes('min-h-11'));
    assert.ok(descendants(node).some((item) => item.className.includes('md:grid-cols-2')));
    assert.ok(descendants(node).some((item) => item.className.includes('xl:grid-cols-3')));
    assert.deepEqual(findAll(node, 'img').map((image) => image.attributes.get('alt')), [
        '지아 결과', '상담실 결과', '문 앞의 지아 결과',
    ]);
    assert.equal(findAll(node, 'img').every((image) => image.attributes.get('src').startsWith('data:image/png;base64,')), true);

    const name = byAttribute(node, 'input', 'id', 'design-character-1-name');
    name.value = '지아 수정';
    await name.dispatchEvent({ type: 'input' });
    assert.equal(changes.at(-1).characters[0].name, '지아 수정');
    assert.match(node.textContent, /저장하지 않은 변경이 있습니다/);
    await byText(node, 'button', '인물 추가').dispatchEvent({ type: 'click' });
    assert.equal(changes.at(-1).characters[1].id, 'character_02');
    assert.ok(byAttribute(node, 'input', 'id', 'design-character-2-name'));

    await byText(node, 'button', '직접 저장').dispatchEvent({ type: 'click' });
    assert.equal(saves.length, 1);
    assert.equal(saves[0].characters[1].id, 'character_02');
    assert.equal(saves[0].scenes[0].location_id, 'location_01');
    const request = byAttribute(node, 'textarea', 'id', 'design-agent-request');
    request.value = '장면 전환을 더 선명하게';
    await byText(node, 'button', '에이전트 작업 시작').dispatchEvent({ type: 'click' });
    assert.equal(requests[0].instruction, '장면 전환을 더 선명하게');
    assert.deepEqual(requests[0].board, saves[0]);

    const empty = NewProjectDesignBoard({
        designState: { status: 'empty', board: { characters: [], locations: [], scenes: [] }, collaboration: { recent_requests: [] } },
        boardValue: { characters: [], locations: [], scenes: [] },
    });
    assert.equal(findAll(empty, 'details').filter((item) => item.attributes.has('open')).length, 3, 'one empty row per section starts open');
    assert.ok(byAttribute(empty, 'input', 'id', 'design-character-1-name'));
    assert.ok(byAttribute(empty, 'input', 'id', 'design-location-1-name'));
    assert.ok(byAttribute(empty, 'input', 'id', 'design-scene-1-title'));
    assert.equal(findAll(empty, 'img').length, 0);
    assert.equal(findAll(empty, 'div').filter((item) => item.attributes.get('role') === 'img').length, 3);

    const limitedBoard = {
        characters: Array.from({ length: 12 }, (_, index) => ({ id: `character_${String(index + 1).padStart(2, '0')}`, name: `인물 ${index + 1}`, role: '', appearance: '', wardrobe: '', continuity: '' })),
        locations: Array.from({ length: 12 }, (_, index) => ({ id: `location_${String(index + 1).padStart(2, '0')}`, name: `장소 ${index + 1}`, space: '', lighting: '', props: '', continuity: '' })),
        scenes: Array.from({ length: 20 }, (_, index) => ({ id: `scene_${String(index + 1).padStart(2, '0')}`, title: `장면 ${index + 1}`, dramatic_beat: '', characters: [], location_id: '', duration: 5, first_frame: '', action: '', camera: '', lighting: '', audio_sfx_dialogue: '' })),
    };
    const limited = NewProjectDesignBoard({ designState: { board: limitedBoard, collaboration: { recent_requests: [] } }, boardValue: limitedBoard });
    assert.equal(byText(limited, 'button', '인물 추가').disabled, true);
    assert.equal(byText(limited, 'button', '장소 추가').disabled, true);
    assert.equal(byText(limited, 'button', '장면 추가').disabled, true);
});

test('design agent state uses newest request and exposes queued, compare, stale, and history without raw metadata', async (t) => {
    const decisions = [];
    const refreshes = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { NewProjectDesignBoard } = await import('../src/components/pipeline/NewProjectDesignBoard.js');
    const board = {
        characters: [{ id: 'character_01', name: '현재 지아', role: '주인공', appearance: '', wardrobe: '', continuity: '' }],
        locations: [{ id: 'location_01', name: '현재 상담실', space: '', lighting: '', props: '', continuity: '' }],
        scenes: [{ id: 'scene_01', title: '현재 장면', dramatic_beat: '현재 핵심', characters: ['character_01'], location_id: 'location_01', duration: 5, first_frame: '', action: '', camera: '', lighting: '', audio_sfx_dialogue: '' }],
    };
    const proposed = structuredClone(board);
    proposed.characters[0].name = '수정안 지아';
    proposed.scenes[0].dramatic_beat = '수정안 핵심';
    const suggestion = (token, proposedBoard, reviewStatus = 'ready') => ({
        status: 'suggestion_ready',
        suggestion: {
            suggestion_token: token, review_status: reviewStatus, summary: '연속성과 전환을 다듬었습니다.',
            proposed_board: proposedBoard, published_at: '2026-07-16T00:00:00.000Z', apply_allowed: true,
        },
    });
    const ready = NewProjectDesignBoard({
        designState: {
            status: 'restored', board,
            collaboration: { recent_requests: [suggestion('private-new-token', proposed), suggestion('private-old-token', board)] },
        },
        boardValue: board,
        onDecide: (value) => decisions.push(value),
    });
    assert.match(ready.textContent, /현재 설계.*에이전트 수정안/s);
    assert.match(ready.textContent, /수정안 지아.*수정안 핵심/s, 'newest-first request supplies the visible suggestion');
    assert.match(ready.textContent, /수정안이 도착했습니다/);
    assert.doesNotMatch(ready.textContent, /private-new-token|private-old-token|suggestion_ready|review_status|location_01/);
    assert.ok(descendants(ready).some((item) => item.className.includes('xl:grid-cols-2')));
    const apply = byText(ready, 'button', '수정안 적용');
    const hold = byText(ready, 'button', '현재 내용 유지');
    assert.ok(apply.className.includes('min-h-11'));
    await apply.dispatchEvent({ type: 'click' });
    await hold.dispatchEvent({ type: 'click' });
    assert.deepEqual(decisions, [
        { suggestion_token: 'private-new-token', action: 'apply' },
        { suggestion_token: 'private-new-token', action: 'hold' },
    ]);
    const currentName = byAttribute(ready, 'input', 'id', 'design-character-1-name');
    currentName.value = '직접 고친 지아';
    await currentName.dispatchEvent({ type: 'input' });
    assert.equal(apply.disabled, true, 'editing the current board disables an already visible apply action');
    assert.match(ready.textContent, /원문이 바뀌어 적용할 수 없습니다/);

    const stale = NewProjectDesignBoard({
        designState: { status: 'restored', board, collaboration: { recent_requests: [suggestion('private-stale-token', proposed)] } },
        boardValue: board,
        dirty: true,
    });
    assert.match(stale.textContent, /원문이 바뀌어 적용할 수 없습니다/);
    assert.equal(byText(stale, 'button', '수정안 적용').disabled, true);

    const held = NewProjectDesignBoard({
        designState: { status: 'restored', board, collaboration: { recent_requests: [suggestion('private-held-token', proposed, 'held')] } },
        boardValue: board,
    });
    assert.match(held.textContent, /보류함 · 현재 설계는 그대로/);
    assert.ok(byText(held, 'summary', '지난 수정안 보기'));
    assert.doesNotMatch(held.textContent, /private-held-token/);
    const heldApply = byText(held, 'button', '수정안 적용');
    const heldName = byAttribute(held, 'input', 'id', 'design-character-1-name');
    heldName.value = '보류 후 직접 수정';
    await heldName.dispatchEvent({ type: 'input' });
    assert.equal(heldApply.disabled, true, 'editing after hold disables the historical apply action');
    assert.match(held.textContent, /원문이 바뀌어 적용할 수 없습니다/);

    const queued = NewProjectDesignBoard({
        designState: { status: 'restored', board, collaboration: { recent_requests: [{ status: 'queued_local_handoff' }] } },
        boardValue: board,
        onRefresh: () => refreshes.push(true),
    });
    assert.match(queued.textContent, /요청이 저장됐습니다/);
    await byText(queued, 'button', '수정안 확인').dispatchEvent({ type: 'click' });
    assert.equal(refreshes.length, 1);
});

test('PipelineStudio sends exact design revisions for save, enqueue, and suggestion decisions', async (t) => {
    const calls = [];
    const planningRevision = 'p'.repeat(64);
    let designRevision = 'd'.repeat(64);
    const board = {
        characters: [{ id: 'character_01', name: '지아', role: '주인공', appearance: '', wardrobe: '', continuity: '' }],
        locations: [{ id: 'location_01', name: '상담실', space: '', lighting: '', props: '', continuity: '' }],
        scenes: [{ id: 'scene_01', title: '첫 장면', dramatic_beat: '문 앞에 선다', characters: ['character_01'], location_id: 'location_01', duration: 5, first_frame: '', action: '', camera: '', lighting: '', audio_sfx_dialogue: '' }],
    };
    let state = {
        ok: true, status: 'restored', board, revision_sha256: designRevision,
        planning_revision_sha256: planningRevision, blockers: [], collaboration: { recent_requests: [], blockers: [] },
    };
    const bridge = {
        async getConfig() { return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } }; },
        async getHarnessContractStatus() { return { ok: true, ready: true, readiness: 'available', entries: [] }; },
        async getNewProjectDraftState() { return { status: 'restored', draft: {}, collaboration: { recent_requests: [] }, blockers: [] }; },
        async getNewProjectDesignState() { calls.push(['get']); return structuredClone(state); },
        async getVideoResultImportWorkspace() { return { status: 'empty', candidates: [], blockers: [] }; },
        async saveNewProjectDesignBoard(payload) {
            calls.push(['save', structuredClone(payload)]);
            designRevision = 'e'.repeat(64);
            state = { ...state, status: 'saved', board: structuredClone(payload.board), revision_sha256: designRevision };
            return structuredClone(state);
        },
        async enqueueDesignAgentRequest(payload) {
            calls.push(['enqueue', structuredClone(payload)]);
            state = { ...state, collaboration: { recent_requests: [{ status: 'queued_local_handoff' }], blockers: [] } };
            return { ok: true, queued: true, state: structuredClone(state) };
        },
        async runDesignAgentRequest() {
            calls.push(['run']);
            return { ok: false, status: 'failed', state: structuredClone(state) };
        },
        async decideDesignAgentSuggestion(payload) {
            calls.push(['decide', structuredClone(payload)]);
            return { ok: true, applied: true, state: { ...structuredClone(state), collaboration: { recent_requests: [], blockers: [] } } };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await byAttribute(studio, 'button', 'aria-label', '2 설계').dispatchEvent({ type: 'click' });

    const name = byAttribute(studio, 'input', 'id', 'design-character-1-name');
    name.value = '지아 수정';
    await name.dispatchEvent({ type: 'input' });
    await byText(studio, 'button', '직접 저장').dispatchEvent({ type: 'click' });
    await flushRenderer();
    const firstSave = calls.find(([method]) => method === 'save')[1];
    assert.deepEqual(firstSave, {
        board: { ...structuredClone(board), characters: [{ ...board.characters[0], name: '지아 수정' }] },
        expected_planning_revision_sha256: planningRevision,
        expected_design_revision_sha256: 'd'.repeat(64),
    });

    const instruction = byAttribute(studio, 'textarea', 'id', 'design-agent-request');
    instruction.value = '장면 전환을 다듬어줘';
    await byText(studio, 'button', '에이전트 작업 시작').dispatchEvent({ type: 'click' });
    await flushRenderer();
    const enqueue = calls.find(([method]) => method === 'enqueue')[1];
    assert.deepEqual(enqueue, {
        instruction: '장면 전환을 다듬어줘',
        expected_planning_revision_sha256: planningRevision,
        expected_design_revision_sha256: 'e'.repeat(64),
    });
    assert.equal(calls.filter(([method]) => method === 'run').length, 1);

    const proposed = structuredClone(state.board);
    proposed.scenes[0].dramatic_beat = '더 선명한 전환';
    state = {
        ...state,
        collaboration: { recent_requests: [{ status: 'suggestion_ready', suggestion: {
            suggestion_token: 'private-decision-token', review_status: 'ready', summary: '전환 개선',
            proposed_board: proposed, apply_allowed: true, published_at: '2026-07-16T00:00:00.000Z',
        } }], blockers: [] },
    };
    await byText(studio, 'button', '수정안 확인').dispatchEvent({ type: 'click' });
    await flushRenderer();
    await byText(studio, 'button', '수정안 적용').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'decide')[1], {
        suggestion_token: 'private-decision-token', action: 'apply', expected_design_revision_sha256: 'e'.repeat(64),
    });
    assert.doesNotMatch(studio.textContent, /private-decision-token/);
});

test('PipelineStudio queues the first design request from a clean empty board without an invalid save', async (t) => {
    const calls = [];
    const planningRevision = 'a'.repeat(64);
    const designRevision = 'b'.repeat(64);
    const emptyState = {
        ok: true, status: 'empty', board: { characters: [], locations: [], scenes: [] },
        revision_sha256: designRevision, planning_revision_sha256: planningRevision,
        collaboration: { recent_requests: [], blockers: [] }, blockers: [],
    };
    const bridge = {
        async getConfig() { return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } }; },
        async getHarnessContractStatus() { return { ok: true, ready: true, readiness: 'available', entries: [] }; },
        async getNewProjectDraftState() { return { status: 'restored', draft: {}, collaboration: { recent_requests: [] }, blockers: [] }; },
        async getNewProjectDesignState() { return structuredClone(emptyState); },
        async getVideoResultImportWorkspace() { return { status: 'empty', candidates: [], blockers: [] }; },
        async saveNewProjectDesignBoard(payload) { calls.push(['save', payload]); throw new Error('EMPTY_SAVE_MUST_NOT_RUN'); },
        async enqueueDesignAgentRequest(payload) {
            calls.push(['enqueue', structuredClone(payload)]);
            return { ok: true, queued: true, state: { ...structuredClone(emptyState), collaboration: { recent_requests: [{ status: 'queued_local_handoff' }], blockers: [] } } };
        },
        async runDesignAgentRequest() {
            calls.push(['run']);
            return { ok: false, status: 'failed', state: { ...structuredClone(emptyState), collaboration: { recent_requests: [{ status: 'queued_local_handoff' }], blockers: [] } } };
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await byAttribute(studio, 'button', 'aria-label', '2 설계').dispatchEvent({ type: 'click' });
    const instruction = byAttribute(studio, 'textarea', 'id', 'design-agent-request');
    instruction.value = '기획과 대본을 바탕으로 첫 설계를 만들어줘';
    await byText(studio, 'button', '에이전트 작업 시작').dispatchEvent({ type: 'click' });
    await flushRenderer();

    assert.equal(calls.filter(([method]) => method === 'save').length, 0);
    assert.deepEqual(calls.find(([method]) => method === 'enqueue')[1], {
        instruction: '기획과 대본을 바탕으로 첫 설계를 만들어줘',
        expected_planning_revision_sha256: planningRevision,
        expected_design_revision_sha256: designRevision,
    });
    assert.equal(calls.filter(([method]) => method === 'run').length, 1);
    assert.match(studio.textContent, /수정안을 만들지 못했습니다|수정안이 도착했습니다/);
});

test('image preparation workbench keeps the ordered DST flow compact and editable without exposing internal metadata', async (t) => {
    const calls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { GenerationPreparationPanel } = await import('../src/components/pipeline/GenerationPreparationPanel.js');
    const tasks = [
        {
            task_token: 'opaque-scene', kind: 'scene_image', source_id: 'scene-secret', sequence: 3,
            label: '문의 32통, 사장 몱 0원', prompt: '장면 프롬프트', reference_task_ids: ['opaque-character', 'opaque-location'],
            status: '준비', result_token: '',
        },
        {
            task_token: 'opaque-character', kind: 'character_sheet', source_id: 'owner-secret', sequence: 1,
            label: '포장이사 사장', prompt: '인물 프롬프트', reference_task_ids: [],
            status: '결과연결', result_token: 'opaque-result',
        },
        {
            task_token: 'opaque-location', kind: 'location_sheet', source_id: 'location-secret', sequence: 2,
            label: '비 오는 고층 아파트', prompt: '장소 프롬프트', reference_task_ids: [],
            status: '재제작', result_token: 'opaque-location-result',
        },
    ];
    const panel = GenerationPreparationPanel({
        state: { imageDashboard: { assets: [], parsed: true } },
        config: { productionRoot: '' },
        imagePlanState: { status: 'ready', tasks },
        imagePlanTasks: tasks,
        imagePlanDirty: true,
        imageResultWorkspace: {
            candidates: [{
                candidate_token: 'opaque-candidate', created_at: '2026-07-16T05:30:00.000Z', image_count: 2,
                source_path: '/private/hidden/candidate',
            }],
        },
        imageResultPreviews: {
            'opaque-result': { preview: { mime_type: 'image/png', base64: 'iVBORw0KGgo=' } },
        },
        onImagePromptChange: (...args) => calls.push(['prompt', ...args]),
        onSaveImagePlan: (...args) => calls.push(['save', ...args]),
        onPrepareImagePlan: (...args) => calls.push(['prepare', ...args]),
        onToggleImageRetry: (...args) => calls.push(['retry', ...args]),
        onRefreshImageResults: (...args) => calls.push(['refresh', ...args]),
        onLoadImageCandidatePreview: async (payload) => {
            calls.push(['preview', payload]);
            return {
                ready: true, candidate_token: payload.candidateToken, image_index: payload.imageIndex,
                preview: { mime_type: 'image/png', base64: 'iVBORw0KGgo=' },
            };
        },
        onConnectImageResult: async (payload) => {
            calls.push(['connect', payload]);
            return { ok: true };
        },
        onOpenImageResultReview: () => calls.push(['openReview']),
    });

    assert.ok(byText(panel, 'h2', '이미지 작업'));
    assert.match(panel.textContent, /완료 1\/3 · 다시 만들기 1 · 다음: 2\. 비 오는 고층 아파트/);
    assert.deepEqual(findAll(panel, 'article').map((card) => byText(card, 'h3', card.textContent.includes('포장이사 사장') ? '포장이사 사장' : card.textContent.includes('비 오는') ? '비 오는 고층 아파트' : '문의 32통, 사장 몱 0원').textContent), [
        '포장이사 사장', '비 오는 고층 아파트', '문의 32통, 사장 몱 0원',
    ]);
    assert.match(panel.textContent, /DST 작업 준비는 .* 이미지 생성은 시작하지 않습니다/);
    assert.ok(findAll(panel, 'details').some((details) => byText(details, 'summary', '기존 제작 자료')));
    assert.match(panel.textContent, /연결된 기존 제작 폴더가 없습니다/);
    assert.doesNotMatch(panel.textContent, /기존 이미지 현황/);
    assert.deepEqual(findAll(panel, 'span').filter((node) => node.className.includes('text-[11px]')), [], 'new workbench must not use badges');
    assert.doesNotMatch(panel.textContent, /opaque-|scene-secret|owner-secret|location-secret|\/private\/hidden/);

    const prompt = byAttribute(panel, 'textarea', 'aria-label', '문의 32통, 사장 몱 0원 프롬프트');
    prompt.value = '수정한 장면 프롬프트';
    await prompt.dispatchEvent({ type: 'input' });
    assert.deepEqual(calls.at(-1), ['prompt', 'opaque-scene', '수정한 장면 프롬프트']);

    await byText(panel, 'button', '프롬프트 저장').dispatchEvent({ type: 'click' });
    await byText(panel, 'button', 'DST 작업 준비').dispatchEvent({ type: 'click' });
    assert.ok(calls.some(([method]) => method === 'save'));
    assert.ok(calls.some(([method]) => method === 'prepare'));

    const retry = byAttribute(panel, 'input', 'aria-label', '포장이사 사장 다시 만들기');
    retry.checked = true;
    await retry.dispatchEvent({ type: 'change' });
    assert.ok(calls.some((call) => call[0] === 'retry' && call[1] === 'opaque-character' && call[2] === true));

    await byText(panel, 'button', 'DST 결과 연결').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(panel.textContent, /\d{2}\/\d{2} \d{2}:\d{2} · 이미지 2장/);
    assert.deepEqual(calls.filter(([method]) => method === 'preview').map(([, payload]) => payload), [
        { candidateToken: 'opaque-candidate', imageIndex: 1 },
        { candidateToken: 'opaque-candidate', imageIndex: 2 },
    ]);
    assert.ok(byAttribute(panel, 'img', 'alt', '후보 1 미리보기'));
    assert.ok(byAttribute(panel, 'img', 'alt', '후보 2 미리보기'));
    assert.equal(byAttribute(panel, 'select', 'aria-label', '문의 32통, 사장 몱 0원 이미지 선택'), null);
    await byAttribute(panel, 'button', 'aria-label', '후보 2 이 이미지 선택').dispatchEvent({ type: 'click' });
    assert.ok(calls.some(([method, payload]) => method === 'connect' && payload.taskToken === 'opaque-scene' && payload.imageIndex === 2));
    await byText(panel, 'button', '결과 검토로 이동').dispatchEvent({ type: 'click' });
    assert.ok(calls.some(([method]) => method === 'openReview'));
});

test('MOCK: DST connector loads a three-image bundle together and connects the exact chosen index', async (t) => {
    const calls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { ImageResultConnector } = await import('../src/components/pipeline/ImageResultConnector.js');
    const connector = ImageResultConnector({
        task: { task_token: 'private-task', sequence: 1, label: '첫 장면' },
        workspace: {
            candidates: [{
                candidate_token: 'private-bundle', created_at: '2026-07-17T08:00:00Z', image_count: 3,
                source_path: '/private/result', provider: 'dst-secret',
            }],
        },
        onLoadPreview: async ({ candidateToken, imageIndex }) => {
            calls.push(['preview', { candidateToken, imageIndex }]);
            return {
                ready: true, candidate_token: candidateToken, image_index: imageIndex,
                preview: { mime_type: 'image/png', base64: Buffer.from(`image-${imageIndex}`).toString('base64') },
            };
        },
        onConnect: async (payload) => { calls.push(['connect', payload]); return { ok: true }; },
    });
    await flushRenderer();

    assert.deepEqual(calls.filter(([method]) => method === 'preview').map(([, payload]) => payload), [
        { candidateToken: 'private-bundle', imageIndex: 1 },
        { candidateToken: 'private-bundle', imageIndex: 2 },
        { candidateToken: 'private-bundle', imageIndex: 3 },
    ]);
    assert.deepEqual(findAll(connector, 'img').map((image) => image.attributes.get('alt')), [
        '후보 1 미리보기', '후보 2 미리보기', '후보 3 미리보기',
    ]);
    await byAttribute(connector, 'button', 'aria-label', '후보 2 이 이미지 선택').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls.find(([method]) => method === 'connect'), ['connect', {
        taskToken: 'private-task', candidateToken: 'private-bundle', imageIndex: 2,
    }]);
    assert.equal(findAll(connector, 'button').filter((button) => button.textContent === '이 이미지 선택')
        .every((button) => button.className.includes('min-h-11')), true);
    assert.doesNotMatch(connector.textContent, /private-|\/private\/|dst-secret|provider|sha|token|명령/i);
    assert.deepEqual(findAll(connector, 'span').filter((node) => node.className.includes('text-[11px]')), []);
});

test('MOCK: changing DST bundles ignores three late old previews and connects the new sibling', async (t) => {
    const pending = new Map();
    const calls = [];
    const connections = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { ImageResultConnector } = await import('../src/components/pipeline/ImageResultConnector.js');
    const connector = ImageResultConnector({
        task: { task_token: 'task-hidden', sequence: 2, label: '둘째 장면' },
        workspace: { candidates: [
            { candidate_token: 'old-hidden', created_at: '2026-07-17T08:00:00Z', image_count: 3 },
            { candidate_token: 'new-hidden', created_at: '2026-07-17T09:00:00Z', image_count: 3 },
        ] },
        onLoadPreview: ({ candidateToken, imageIndex }) => {
            calls.push({ candidateToken, imageIndex });
            if (candidateToken === 'old-hidden') return new Promise((resolve) => pending.set(imageIndex, resolve));
            return Promise.resolve({
                ready: true, candidate_token: candidateToken, image_index: imageIndex,
                preview: { mime_type: 'image/png', base64: Buffer.from(`new-${imageIndex}`).toString('base64') },
            });
        },
        onConnect: async (payload) => { connections.push(payload); return { ok: true }; },
    });
    assert.deepEqual(calls, [
        { candidateToken: 'old-hidden', imageIndex: 1 },
        { candidateToken: 'old-hidden', imageIndex: 2 },
        { candidateToken: 'old-hidden', imageIndex: 3 },
    ]);
    const select = byAttribute(connector, 'select', 'aria-label', '둘째 장면 DST 결과');
    select.value = 'new-hidden';
    await select.dispatchEvent({ type: 'change' });
    await flushRenderer();

    assert.equal(findAll(connector, 'img').length, 3);
    assert.deepEqual(calls.slice(3), [
        { candidateToken: 'new-hidden', imageIndex: 1 },
        { candidateToken: 'new-hidden', imageIndex: 2 },
        { candidateToken: 'new-hidden', imageIndex: 3 },
    ]);
    for (const [index, resolve] of pending) resolve({
        ready: true, candidate_token: 'old-hidden', image_index: index,
        preview: { mime_type: 'image/png', base64: Buffer.from(`old-${index}`).toString('base64') },
    });
    await flushRenderer();

    assert.equal(findAll(connector, 'img').length, 3);
    assert.equal(byAttribute(connector, 'select', 'aria-label', '둘째 장면 DST 결과').value, 'new-hidden');
    await byAttribute(connector, 'button', 'aria-label', '후보 3 이 이미지 선택').dispatchEvent({ type: 'click' });
    assert.deepEqual(connections, [{ taskToken: 'task-hidden', candidateToken: 'new-hidden', imageIndex: 3 }]);
    assert.doesNotMatch(connector.textContent, /old-hidden|new-hidden/);
});

test('MOCK: a failed DST gallery tile shows only a short Korean state', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { ImageResultConnector } = await import('../src/components/pipeline/ImageResultConnector.js');
    const connector = ImageResultConnector({
        task: { task_token: 'failed-task', sequence: 3, label: '실패 장면' },
        workspace: { candidates: [{ candidate_token: 'failed-result', created_at: '2026-07-17T09:00:00Z', image_count: 1 }] },
        onLoadPreview: async () => { throw new Error('PRIVATE_PREVIEW_FAILURE'); },
    });
    await flushRenderer();
    assert.ok(byText(connector, 'div', '불러오지 못했습니다.'));
    assert.doesNotMatch(connector.textContent, /PRIVATE_PREVIEW_FAILURE|failed-task|failed-result/);
});

test('MOCK: workbench result handoff marks the preferred image but keeps every sibling selectable', async (t) => {
    const calls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { ImageTaskCard } = await import('../src/components/pipeline/ImageTaskCard.js');
    const card = ImageTaskCard({
        task: {
            task_token: 'task-private', kind: 'scene_image', sequence: 4, label: '선호 장면',
            prompt: 'prompt', status: '준비', result_token: '', reference_task_ids: [],
        },
        resultWorkspace: { candidates: [{
            candidate_token: 'preferred-private', created_at: '2026-07-17T10:00:00Z', image_count: 3,
        }] },
        onLoadCandidatePreview: async ({ candidateToken, imageIndex }) => {
            calls.push(['preview', imageIndex]);
            return {
                ready: true, candidate_token: candidateToken, image_index: imageIndex,
                preview: { mime_type: 'image/png', base64: Buffer.from(`preferred-${imageIndex}`).toString('base64') },
            };
        },
        onConnectResult: async (payload) => { calls.push(['connect', payload]); return { ok: true }; },
    });
    await card.dispatchEvent({
        type: 'workbench:show-result',
        detail: { candidateToken: 'preferred-private', imageIndex: 2 },
    });
    await flushRenderer();

    assert.deepEqual(calls.filter(([method]) => method === 'preview'), [
        ['preview', 1], ['preview', 2], ['preview', 3],
    ]);
    assert.ok(byText(card, 'p', '후보 2 · 이번 결과'));
    assert.ok(byText(card, 'p', '후보 1'));
    assert.ok(byText(card, 'p', '후보 3'));
    await byAttribute(card, 'button', 'aria-label', '후보 3 이 이미지 선택').dispatchEvent({ type: 'click' });
    assert.deepEqual(calls.find(([method]) => method === 'connect'), ['connect', {
        taskToken: 'task-private', candidateToken: 'preferred-private', imageIndex: 3,
    }]);
    assert.doesNotMatch(card.textContent, /task-private|preferred-private|prompt/);
});

test('image result connector expands only its open task card and composes with suggestion expansion', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { ImageTaskCard } = await import('../src/components/pipeline/ImageTaskCard.js');
    const task = {
        task_token: 'layout-task', kind: 'scene_image', sequence: 6, label: '레이아웃 장면',
        prompt: 'prompt', status: '준비', result_token: '', reference_task_ids: [],
    };
    const props = {
        task,
        resultWorkspace: { candidates: [{
            candidate_token: 'layout-result', created_at: '2026-07-17T12:00:00Z', image_count: 3,
        }] },
        onLoadCandidatePreview: async ({ candidateToken, imageIndex }) => ({
            ready: true, candidate_token: candidateToken, image_index: imageIndex,
            preview: { mime_type: 'image/png', base64: Buffer.from(`layout-${imageIndex}`).toString('base64') },
        }),
    };
    const card = ImageTaskCard(props);
    assert.doesNotMatch(card.className, /lg:col-span-2|xl:col-span-3/);
    await byText(card, 'button', 'DST 결과 연결').dispatchEvent({ type: 'click' });
    assert.match(card.className, /lg:col-span-2/);
    assert.match(card.className, /xl:col-span-3/);
    await byText(card, 'button', '결과 연결 닫기').dispatchEvent({ type: 'click' });
    assert.doesNotMatch(card.className, /lg:col-span-2|xl:col-span-3/);

    const suggestionCard = ImageTaskCard({ ...props, agentRequest: { status: 'suggestion_ready' } });
    assert.match(suggestionCard.className, /lg:col-span-2/);
    assert.match(suggestionCard.className, /xl:col-span-3/);
});

test('MOCK: pending DST connect is single-flight and restores controls without stale bundle feedback', async (t) => {
    const calls = [];
    let resolveConnect;
    const connectResult = new Promise((resolve) => { resolveConnect = resolve; });
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { ImageResultConnector } = await import('../src/components/pipeline/ImageResultConnector.js');
    const connector = ImageResultConnector({
        task: { task_token: 'pending-task', sequence: 7, label: '대기 장면' },
        workspace: { candidates: [
            { candidate_token: 'bundle-a', created_at: '2026-07-17T12:00:00Z', image_count: 2 },
            { candidate_token: 'bundle-b', created_at: '2026-07-17T13:00:00Z', image_count: 1 },
        ] },
        onLoadPreview: async ({ candidateToken, imageIndex }) => ({
            ready: true, candidate_token: candidateToken, image_index: imageIndex,
            preview: { mime_type: 'image/png', base64: Buffer.from(`${candidateToken}-${imageIndex}`).toString('base64') },
        }),
        onRefresh: () => calls.push(['refresh']),
        onConnect: async (payload) => { calls.push(['connect', payload]); return connectResult; },
    });
    await flushRenderer();
    const oldSelect = byAttribute(connector, 'select', 'aria-label', '대기 장면 DST 결과');
    const pendingClick = byAttribute(connector, 'button', 'aria-label', '후보 1 이 이미지 선택')
        .dispatchEvent({ type: 'click' });
    await flushRenderer();

    const pendingSelect = byAttribute(connector, 'select', 'aria-label', '대기 장면 DST 결과');
    assert.equal(pendingSelect.disabled, true);
    assert.equal(byText(connector, 'button', '결과 새로고침').disabled, true);
    assert.equal(findAll(connector, 'button').filter((button) => button.textContent === '이 이미지 선택')
        .every((button) => button.disabled), true);
    await byAttribute(connector, 'button', 'aria-label', '후보 2 이 이미지 선택').dispatchEvent({ type: 'click' });
    oldSelect.value = 'bundle-b';
    await oldSelect.dispatchEvent({ type: 'change' });
    await byText(connector, 'button', '결과 새로고침').dispatchEvent({ type: 'click' });
    assert.equal(calls.filter(([method]) => method === 'connect').length, 1);
    assert.equal(calls.filter(([method]) => method === 'refresh').length, 0);
    assert.equal(byAttribute(connector, 'select', 'aria-label', '대기 장면 DST 결과').value, 'bundle-a');

    resolveConnect({ ok: true });
    await pendingClick;
    await flushRenderer();
    assert.equal(byAttribute(connector, 'select', 'aria-label', '대기 장면 DST 결과').disabled, false);
    assert.equal(byText(connector, 'button', '결과 새로고침').disabled, false);
    assert.equal(findAll(connector, 'button').filter((button) => button.textContent === '이 이미지 선택')
        .every((button) => !button.disabled), true);
    assert.match(connector.textContent, /작업에 연결했습니다/);
    assert.doesNotMatch(connector.textContent, /연결하지 못했습니다|bundle-b/);
});

test('MOCK: a single-image DST bundle uses the same gallery choice flow', async (t) => {
    const calls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { ImageResultConnector } = await import('../src/components/pipeline/ImageResultConnector.js');
    const connector = ImageResultConnector({
        task: { task_token: 'single-task', sequence: 5, label: '한 장면' },
        workspace: { candidates: [{ candidate_token: 'single-result', created_at: '2026-07-17T11:00:00Z', image_count: 1 }] },
        onLoadPreview: async ({ candidateToken, imageIndex }) => {
            calls.push({ candidateToken, imageIndex });
            return {
                ready: true, candidate_token: candidateToken, image_index: imageIndex,
                preview: { mime_type: 'image/png', base64: Buffer.from('single').toString('base64') },
            };
        },
    });
    await flushRenderer();
    assert.deepEqual(calls, [{ candidateToken: 'single-result', imageIndex: 1 }]);
    assert.ok(byAttribute(connector, 'img', 'alt', '후보 1 미리보기'));
    assert.equal(findAll(connector, 'button').filter((button) => button.textContent === '이 이미지 선택').length, 1);
});

test('video preparation workbench keeps scene order, direct controls, local result review, and retry selection simple', async (t) => {
    const calls = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { VideoPreparationPanel } = await import('../src/components/pipeline/VideoPreparationPanel.js');
    const tasks = [
        {
            task_token: 'video-task-2', kind: 'scene_video', source_id: 'secret-scene-2', sequence: 2,
            label: '전화가 쏟아지는 사무실', provider: 'flow', prompt: '장면 2 프롬프트',
            status: '준비', result_token: '',
        },
        {
            task_token: 'video-task-1', kind: 'scene_video', source_id: 'secret-scene-1', sequence: 1,
            label: '비 오는 아침', provider: 'grok', prompt: '장면 1 프롬프트',
            status: '결과연결', result_token: 'private-result-1',
        },
        {
            task_token: 'video-task-3', kind: 'scene_video', source_id: 'secret-scene-3', sequence: 3,
            label: '밝아진 저녁', provider: 'replicate', prompt: '장면 3 프롬프트',
            status: '재제작', result_token: 'private-result-3',
        },
    ];
    const panel = VideoPreparationPanel({
        videoPlanState: { status: 'ready', tasks }, videoPlanTasks: tasks,
        videoResultWorkspace: {
            candidates: [
                { candidate_token: 'hidden-flow-result', provider: 'flow', result_id: 'internal-id', duration_seconds: 6, width: 1080, height: 1920 },
                { candidate_token: 'hidden-grok-result', provider: 'grok', duration_seconds: 5, width: 720, height: 1280 },
            ],
        },
        videoResultPreviews: { 'private-result-1': { source: 'blob:connected-video' } },
        onVideoPromptChange: (...args) => calls.push(['prompt', ...args]),
        onVideoProviderChange: (...args) => calls.push(['provider', ...args]),
        onSaveVideoPlan: (...args) => calls.push(['save', ...args]),
        onPrepareVideoPlan: (...args) => calls.push(['prepare', ...args]),
        onToggleVideoRetry: (...args) => calls.push(['retry', ...args]),
        onRefreshVideoResults: (...args) => calls.push(['refresh', ...args]),
        onLoadVideoCandidatePreview: async (payload) => {
            calls.push(['preview', payload]);
            return { loaded: true, mime_type: 'video/mp4', byte_length: 4, base64: 'AAAAAA==' };
        },
        onConnectVideoResult: async (payload) => {
            calls.push(['connect', payload]);
            return { ok: true, connected: true };
        },
        onOpenVideoResultReview: () => calls.push(['review']),
    });

    assert.ok(byText(panel, 'h2', '영상 작업'));
    assert.match(panel.textContent, /완료 1\/3 · 다시 만들기 1 · 다음: 2\. 전화가 쏟아지는 사무실/);
    assert.deepEqual(findAll(panel, 'article').map((card) => findAll(card, 'h3')[0].textContent), [
        '비 오는 아침', '전화가 쏟아지는 사무실', '밝아진 저녁',
    ]);
    assert.match(panel.textContent, /영상 작업 준비는 .* 영상 생성은 시작하지 않습니다/);
    assert.match(panel.textContent, /현재 참조 이미지 1장으로는 준비할 수 없습니다\. 완료 영상을 연결하거나 다른 도구를 선택하세요/);
    assert.match(panel.textContent, /6초, 10초 또는 15초를 지원합니다\. 완료 영상을 연결하거나 다른 도구를 선택하세요/);
    assert.match(panel.textContent, /요청 미리보기를 준비할 수 있습니다\. 위의 영상 작업 준비를 누르세요/);
    assert.doesNotMatch(panel.textContent, /video-task|secret-scene|private-result|hidden-|internal-id|\/private\//);
    assert.deepEqual(findAll(panel, 'span').filter((node) => node.className.includes('text-[11px]')), []);

    const prompt = byAttribute(panel, 'textarea', 'aria-label', '전화가 쏟아지는 사무실 프롬프트');
    prompt.value = '수정한 장면 2 프롬프트';
    await prompt.dispatchEvent({ type: 'input' });
    const provider = byAttribute(panel, 'select', 'aria-label', '전화가 쏟아지는 사무실 생성 도구');
    provider.value = 'bytedance';
    await provider.dispatchEvent({ type: 'change' });
    const flowCard = findAll(panel, 'article').find((card) => card.textContent.includes('전화가 쏟아지는 사무실'));
    assert.match(flowCard.textContent, /이 작업대에서는 완료 영상만 연결할 수 있습니다/);
    assert.match(provider.className, /min-h-11/);
    assert.deepEqual(calls.at(-2), ['prompt', 'video-task-2', '수정한 장면 2 프롬프트']);
    assert.deepEqual(calls.at(-1), ['provider', 'video-task-2', 'bytedance']);

    await byText(panel, 'button', '프롬프트 저장').dispatchEvent({ type: 'click' });
    await byText(panel, 'button', '영상 작업 준비').dispatchEvent({ type: 'click' });
    assert.ok(calls.some(([method]) => method === 'save'));
    assert.ok(calls.some(([method]) => method === 'prepare'));

    const retry = byAttribute(panel, 'input', 'aria-label', '비 오는 아침 다시 만들기');
    retry.checked = true;
    await retry.dispatchEvent({ type: 'change' });
    assert.ok(calls.some((call) => call[0] === 'retry' && call[1] === 'video-task-1' && call[2] === true));

    await byText(panel, 'button', '완료 영상 연결').dispatchEvent({ type: 'click' });
    assert.match(panel.textContent, /Flow · 6\.0초 · 1080×1920/);
    assert.doesNotMatch(panel.textContent, /internal-id|hidden-flow-result/);
    await byText(panel, 'button', '영상 미리보기').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.ok(calls.some(([method, payload]) => method === 'preview' && payload.candidateToken === 'hidden-flow-result'));
    await byText(panel, 'button', '이 영상 연결').dispatchEvent({ type: 'click' });
    assert.ok(calls.some(([method, payload]) => method === 'connect' && payload.taskToken === 'video-task-2'));
});

test('MOCK: changing video candidates ignores a late old preview and connects only the latest choice', async (t) => {
    let resolveOld;
    const previewCalls = [];
    const connections = [];
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { VideoResultConnector } = await import('../src/components/pipeline/VideoResultConnector.js');
    const connector = VideoResultConnector({
        task: { task_token: 'private-video-task', sequence: 4, label: '교차 장면', provider: 'flow' },
        workspace: { candidates: [
            { candidate_token: 'private-video-a', provider: 'flow', duration_seconds: 5, width: 720, height: 1280 },
            { candidate_token: 'private-video-b', provider: 'flow', duration_seconds: 6, width: 1080, height: 1920 },
        ] },
        onLoadPreview: ({ candidateToken }) => {
            previewCalls.push(candidateToken);
            if (candidateToken === 'private-video-a') {
                return new Promise((resolve) => { resolveOld = resolve; });
            }
            const bytes = Buffer.from('new-video');
            return Promise.resolve({
                loaded: true, mime_type: 'video/mp4', byte_length: bytes.byteLength, base64: bytes.toString('base64'),
            });
        },
        onConnect: async (payload) => { connections.push(payload); return { ok: true, connected: true }; },
    });

    const oldPreviewClick = byText(connector, 'button', '영상 미리보기').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(connector.textContent, /불러오는 중입니다/);
    const select = byAttribute(connector, 'select', 'aria-label', '교차 장면 완료 영상');
    select.value = 'private-video-b';
    await select.dispatchEvent({ type: 'change' });
    await byText(connector, 'button', '영상 미리보기').dispatchEvent({ type: 'click' });
    await flushRenderer();
    const latestSource = byAttribute(connector, 'video', 'aria-label', '교차 장면 미리보기').attributes.get('src');
    assert.match(latestSource, /^blob:/);

    const oldBytes = Buffer.from('old-video');
    resolveOld({
        loaded: true, mime_type: 'video/mp4', byte_length: oldBytes.byteLength, base64: oldBytes.toString('base64'),
    });
    await oldPreviewClick;
    await flushRenderer();

    assert.deepEqual(previewCalls, ['private-video-a', 'private-video-b']);
    assert.equal(byAttribute(connector, 'video', 'aria-label', '교차 장면 미리보기').attributes.get('src'), latestSource);
    assert.equal(byAttribute(connector, 'select', 'aria-label', '교차 장면 완료 영상').value, 'private-video-b');
    await byText(connector, 'button', '이 영상 연결').dispatchEvent({ type: 'click' });
    assert.deepEqual(connections, [{ taskToken: 'private-video-task', candidateToken: 'private-video-b' }]);
    assert.doesNotMatch(connector.textContent, /private-video|token|sha|경로|명령/i);
});

test('MOCK: starting video connection invalidates an in-flight preview loading state', async (t) => {
    let resolvePreview;
    let resolveConnect;
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { VideoResultConnector } = await import('../src/components/pipeline/VideoResultConnector.js');
    const connector = VideoResultConnector({
        task: { task_token: 'loading-video-task', sequence: 1, label: '연결 전환 장면', provider: 'flow' },
        workspace: { candidates: [
            { candidate_token: 'loading-video-result', provider: 'flow', duration_seconds: 5, width: 720, height: 1280 },
        ] },
        onLoadPreview: () => new Promise((resolve) => { resolvePreview = resolve; }),
        onConnect: () => new Promise((resolve) => { resolveConnect = resolve; }),
    });

    const previewClick = byText(connector, 'button', '영상 미리보기').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(connector.textContent, /불러오는 중입니다/);

    const connectClick = byText(connector, 'button', '이 영상 연결').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(connector.textContent, /연결 중/);
    assert.doesNotMatch(connector.textContent, /불러오는 중입니다/);
    assert.match(connector.textContent, /미리보기를 누르면 여기에 영상이 나옵니다/);

    resolveConnect({ ok: false, connected: false });
    await connectClick;
    resolvePreview({ loaded: false });
    await previewClick;
    assert.doesNotMatch(connector.textContent, /불러오는 중입니다/);
});

test('MOCK: pending video connect is single-flight and locks candidate controls', async (t) => {
    const calls = [];
    let resolveConnect;
    const connectResult = new Promise((resolve) => { resolveConnect = resolve; });
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { VideoResultConnector } = await import('../src/components/pipeline/VideoResultConnector.js');
    const connector = VideoResultConnector({
        task: { task_token: 'pending-video-task', sequence: 5, label: '대기 영상', provider: 'flow' },
        workspace: { candidates: [
            { candidate_token: 'video-a', provider: 'flow', duration_seconds: 5, width: 720, height: 1280 },
            { candidate_token: 'video-b', provider: 'flow', duration_seconds: 6, width: 1080, height: 1920 },
        ] },
        onRefresh: () => calls.push(['refresh']),
        onLoadPreview: async ({ candidateToken }) => {
            calls.push(['preview', candidateToken]);
            const bytes = Buffer.from(candidateToken);
            return { loaded: true, mime_type: 'video/mp4', byte_length: bytes.byteLength, base64: bytes.toString('base64') };
        },
        onConnect: async (payload) => { calls.push(['connect', payload]); return connectResult; },
    });
    const oldSelect = byAttribute(connector, 'select', 'aria-label', '대기 영상 완료 영상');
    const oldRefresh = byText(connector, 'button', '결과 새로고침');
    const oldPreview = byText(connector, 'button', '영상 미리보기');
    const oldConnect = byText(connector, 'button', '이 영상 연결');
    const pendingClick = oldConnect.dispatchEvent({ type: 'click' });
    await flushRenderer();

    assert.equal(byAttribute(connector, 'select', 'aria-label', '대기 영상 완료 영상').disabled, true);
    assert.equal(byText(connector, 'button', '결과 새로고침').disabled, true);
    assert.equal(byText(connector, 'button', '영상 미리보기').disabled, true);
    assert.equal(byText(connector, 'button', '이 영상 연결').disabled, true);
    oldSelect.value = 'video-b';
    await oldSelect.dispatchEvent({ type: 'change' });
    await oldRefresh.dispatchEvent({ type: 'click' });
    await oldPreview.dispatchEvent({ type: 'click' });
    await oldConnect.dispatchEvent({ type: 'click' });
    assert.equal(calls.filter(([method]) => method === 'connect').length, 1);
    assert.equal(calls.filter(([method]) => method === 'refresh').length, 0);
    assert.equal(calls.filter(([method]) => method === 'preview').length, 0);
    assert.equal(byAttribute(connector, 'select', 'aria-label', '대기 영상 완료 영상').value, 'video-a');

    resolveConnect({ connected: true });
    await pendingClick;
    await flushRenderer();
    assert.equal(byAttribute(connector, 'select', 'aria-label', '대기 영상 완료 영상').disabled, false);
    assert.equal(byText(connector, 'button', '결과 새로고침').disabled, false);
    assert.match(connector.textContent, /작업에 연결했습니다/);
    assert.doesNotMatch(connector.textContent, /video-a|video-b|pending-video-task/);
});

test('video connector errors stay short and private while its task card expands only when needed', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { VideoResultConnector } = await import('../src/components/pipeline/VideoResultConnector.js');
    const { VideoTaskCard } = await import('../src/components/pipeline/VideoTaskCard.js');
    const task = {
        task_token: 'layout-video-task', kind: 'scene_video', sequence: 6, label: '레이아웃 영상',
        provider: 'flow', prompt: 'private prompt', status: '준비', result_token: '',
    };
    const workspace = { candidates: [{
        candidate_token: 'private-failed-video', provider: 'flow', duration_seconds: 5, width: 720, height: 1280,
    }] };
    const connector = VideoResultConnector({
        task, workspace,
        onLoadPreview: async () => { throw new Error('PRIVATE_VIDEO_PREVIEW_FAILURE'); },
        onConnect: async () => { throw new Error('PRIVATE_VIDEO_CONNECT_FAILURE'); },
    });
    await byText(connector, 'button', '영상 미리보기').dispatchEvent({ type: 'click' });
    assert.match(connector.textContent, /불러오지 못했습니다/);
    await byText(connector, 'button', '이 영상 연결').dispatchEvent({ type: 'click' });
    assert.match(connector.textContent, /연결하지 못했습니다/);
    assert.doesNotMatch(connector.textContent, /PRIVATE_|private-failed-video|layout-video-task/);

    const props = { task, resultWorkspace: workspace };
    const card = VideoTaskCard(props);
    assert.doesNotMatch(card.className, /lg:col-span-2|xl:col-span-3/);
    await byText(card, 'button', '완료 영상 연결').dispatchEvent({ type: 'click' });
    assert.match(card.className, /lg:col-span-2/);
    assert.match(card.className, /xl:col-span-3/);
    await byText(card, 'button', '영상 연결 닫기').dispatchEvent({ type: 'click' });
    assert.doesNotMatch(card.className, /lg:col-span-2|xl:col-span-3/);

    const suggestionCard = VideoTaskCard({ ...props, agentRequest: { status: 'suggestion_ready' } });
    assert.match(suggestionCard.className, /lg:col-span-2/);
    assert.match(suggestionCard.className, /xl:col-span-3/);
    await byText(suggestionCard, 'button', '완료 영상 연결').dispatchEvent({ type: 'click' });
    await byText(suggestionCard, 'button', '영상 연결 닫기').dispatchEvent({ type: 'click' });
    assert.match(suggestionCard.className, /lg:col-span-2/);
    assert.match(suggestionCard.className, /xl:col-span-3/);
});

test('PipelineStudio saves, prepares, connects, and retries image tasks with exact revision-bound payloads', async (t) => {
    const calls = [];
    const designRevision = 'd'.repeat(64);
    let planRevision = '1'.repeat(64);
    let failRetrySave = false;
    let failReviewSave = false;
    let imageReviewDecision = 'pending';
    let tasks = [{
        task_token: 'task_'.concat('a'.repeat(64)), kind: 'scene_image', source_id: 'scene_01', sequence: 1,
        label: '첫 장면', prompt: '초기 프롬프트', reference_task_ids: [], status: '준비', result_token: '',
    }];
    const state = (status = 'restored') => ({
        ok: true, status, design_revision_sha256: designRevision, revision_sha256: planRevision,
        tasks: structuredClone(tasks), preparation: { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false },
        review_decisions: tasks.filter((task) => task.result_token).map((task) => ({
            task_token: task.task_token, result_token: task.result_token, decision: imageReviewDecision,
        })),
        blockers: [], executed: false, generation_executed: false, model_called: false,
    });
    const bridge = {
        async getConfig() { return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } }; },
        async getHarnessContractStatus() { return { ok: true, ready: true, readiness: 'available', entries: [] }; },
        async getNewProjectDraftState() { return { status: 'restored', draft: {}, collaboration: { recent_requests: [] }, blockers: [] }; },
        async getNewProjectDesignState() {
            return { ok: true, status: 'restored', board: { characters: [], locations: [], scenes: [] }, revision_sha256: designRevision, planning_revision_sha256: 'p'.repeat(64), collaboration: { recent_requests: [] }, blockers: [] };
        },
        async getNewProjectImagePlan() { calls.push(['getPlan']); return state(); },
        async getNewProjectVideoPlan() {
            calls.push(['getVideoPlan']);
            return { ok: true, status: 'restored', tasks: [], blockers: [] };
        },
        async getNewProjectImageResultWorkspace() {
            calls.push(['getResults']);
            return { ok: true, status: 'ready', candidates: [{ candidate_token: 'candidate-safe', created_at: '2026-07-16T06:00:00.000Z', image_count: 1 }], blockers: [] };
        },
        async getVideoResultImportWorkspace() { return { status: 'empty', candidates: [], initial_targets: [], blockers: [] }; },
        async saveNewProjectImagePlan(payload) {
            calls.push(['save', structuredClone(payload)]);
            tasks = structuredClone(payload.tasks);
            planRevision = '2'.repeat(64);
            return state('saved');
        },
        async prepareNewProjectImagePlan(payload) {
            calls.push(['prepare', structuredClone(payload)]);
            return { ok: true, queued: true, executed: false, model_called: false, generation_executed: false, state: state('restored') };
        },
        async loadDstBundleImportPreview(payload) {
            calls.push(['candidatePreview', structuredClone(payload)]);
            return { ready: true, candidate_token: payload.candidateToken, image_index: payload.imageIndex, preview: { mime_type: 'image/png', byte_length: 8, base64: 'iVBORw0KGgo=' } };
        },
        async connectNewProjectImageResult(payload) {
            calls.push(['connect', structuredClone(payload)]);
            tasks = tasks.map((task) => ({ ...task, status: '결과연결', result_token: 'result_'.concat('b'.repeat(64)) }));
            planRevision = '3'.repeat(64);
            return { ok: true, connected: true, result_token: tasks[0].result_token, state: state('restored') };
        },
        async getNewProjectImageResultPreview(payload) {
            calls.push(['resultPreview', structuredClone(payload)]);
            return { ok: true, ready: true, result_token: payload.result_token, preview: { mime_type: 'image/png', byte_length: 8, base64: 'iVBORw0KGgo=' }, blockers: [] };
        },
        async saveNewProjectImageRetrySelection(payload) {
            calls.push(['retry', structuredClone(payload)]);
            if (failRetrySave) throw new Error('private-image-retry-failure');
            tasks = tasks.map((task) => ({ ...task, status: payload.task_tokens.includes(task.task_token) ? '재제작' : '결과연결' }));
            planRevision = '4'.repeat(64);
            return state('saved');
        },
        async saveNewProjectImageReviewDecision(payload) {
            calls.push(['reviewImage', structuredClone(payload)]);
            if (failReviewSave) throw new Error('private-image-review-failure');
            imageReviewDecision = payload.decision;
            tasks = tasks.map((task) => ({ ...task, status: payload.decision === 'retry' ? '재제작' : '결과연결' }));
            planRevision = '5'.repeat(64);
            return state('saved');
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'assets' } });

    const prompt = byAttribute(studio, 'textarea', 'aria-label', '첫 장면 프롬프트');
    prompt.value = '직접 수정한 프롬프트';
    await prompt.dispatchEvent({ type: 'input' });
    await byText(studio, 'button', '프롬프트 저장').dispatchEvent({ type: 'click' });
    await flushRenderer();
    const savePayload = calls.find(([method]) => method === 'save')[1];
    assert.equal(savePayload.tasks[0].prompt, '직접 수정한 프롬프트');
    assert.equal(Object.hasOwn(savePayload.tasks[0], 'review_decision'), false);
    assert.equal(savePayload.expected_design_revision_sha256, designRevision);
    assert.equal(savePayload.expected_image_plan_revision_sha256, '1'.repeat(64));

    await byText(studio, 'button', 'DST 작업 준비').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'prepare')[1], {
        expected_design_revision_sha256: designRevision,
        expected_image_plan_revision_sha256: '2'.repeat(64),
    });
    assert.match(studio.textContent, /생성은 시작하지 않았습니다/);

    await byText(studio, 'button', 'DST 결과 연결').dispatchEvent({ type: 'click' });
    await flushRenderer();
    await byText(studio, 'button', '이 이미지 선택').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'connect')[1], {
        task_token: 'task_'.concat('a'.repeat(64)), candidate_token: 'candidate-safe', image_index: 1,
        expected_design_revision_sha256: designRevision,
        expected_image_plan_revision_sha256: '2'.repeat(64),
    });
    assert.ok(byAttribute(studio, 'img', 'alt', '첫 장면 연결 결과'));

    const retry = byAttribute(studio, 'input', 'aria-label', '첫 장면 다시 만들기');
    const videoPlanReadsBeforeRetry = calls.filter(([method]) => method === 'getVideoPlan').length;
    retry.checked = true;
    await retry.dispatchEvent({ type: 'change' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'retry')[1], {
        task_tokens: ['task_'.concat('a'.repeat(64))],
        expected_design_revision_sha256: designRevision,
        expected_image_plan_revision_sha256: '3'.repeat(64),
    });
    assert.equal(calls.filter(([method]) => method === 'getVideoPlan').length, videoPlanReadsBeforeRetry + 1);
    assert.match(studio.textContent, /다시 만들기로 선택했습니다/);
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'storyboard' } });
    assert.ok(byText(studio, 'h2', '새 프로젝트 결과 검토'));
    assert.ok(byAttribute(studio, 'img', 'alt', '첫 장면 결과'));
    assert.match(studio.textContent, /다음 할 일: 이미지 1개 다시 만들기 준비/);
    assert.match(studio.textContent, /이미지를 다시 만든 뒤 영상 검토를 이어가세요/);
    await byText(studio, 'button', '이미지 작업 열기').dispatchEvent({ type: 'click' });
    assert.ok(byText(studio, 'h2', '이미지 작업'));
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'storyboard' } });
    failReviewSave = true;
    await byText(studio, 'button', '이 결과 사용').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(studio.textContent, /결과 선택을 저장하지 못했습니다\. 다시 선택하세요/);
    assert.doesNotMatch(studio.textContent, /private-image-review-failure|task_[a-f0-9]+/);
    failReviewSave = false;
    await byText(studio, 'button', '이 결과 사용').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.filter(([method]) => method === 'reviewImage').at(-1)[1], {
        task_token: 'task_'.concat('a'.repeat(64)),
        decision: 'use',
        expected_design_revision_sha256: designRevision,
        expected_image_plan_revision_sha256: '4'.repeat(64),
    });
    assert.match(studio.textContent, /이 결과를 사용하기로 저장했습니다/);
});

test('PipelineStudio saves, prepares, connects, and retries video tasks with exact revision-bound payloads', async (t) => {
    const calls = [];
    const designRevision = 'd'.repeat(64);
    const imageRevision = 'i'.repeat(64);
    let planRevision = '1'.repeat(64);
    let videoReviewDecision = 'pending';
    let tasks = [{
        task_token: 'task_'.concat('v'.repeat(64)), kind: 'scene_video', source_id: 'scene_01', sequence: 1,
        label: '첫 장면', provider: 'flow', prompt: '초기 영상 프롬프트', status: '준비', result_token: '',
    }];
    const state = (status = 'restored') => ({
        ok: true, status, design_revision_sha256: designRevision, image_plan_revision_sha256: imageRevision,
        revision_sha256: planRevision, tasks: structuredClone(tasks),
        review_decisions: tasks.filter((task) => task.result_token).map((task) => ({
            task_token: task.task_token, result_token: task.result_token, decision: videoReviewDecision,
        })),
        preparation: { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false },
        blockers: [], executed: false, generation_executed: false, model_called: false,
    });
    const bridge = {
        async getConfig() { return { config: { productionRoot: '', productionParentRoot: '', dryRunMode: true } }; },
        async getHarnessContractStatus() { return { ok: true, ready: true, readiness: 'available', entries: [] }; },
        async getNewProjectDraftState() { return { status: 'restored', draft: {}, collaboration: { recent_requests: [] }, blockers: [] }; },
        async getNewProjectDesignState() {
            return { ok: true, status: 'restored', board: { characters: [], locations: [], scenes: [] }, revision_sha256: designRevision, planning_revision_sha256: 'p'.repeat(64), collaboration: { recent_requests: [] }, blockers: [] };
        },
        async getNewProjectImagePlan() { return { ok: true, status: 'restored', design_revision_sha256: designRevision, revision_sha256: imageRevision, tasks: [], blockers: [] }; },
        async getNewProjectImageResultWorkspace() { return { ok: true, status: 'empty', candidates: [], blockers: [] }; },
        async getNewProjectVideoPlan() { calls.push(['getVideoPlan']); return state(); },
        async getNewProjectVideoResultWorkspace() {
            calls.push(['getVideoResults']);
            return { ok: true, status: 'ready', candidates: [{ candidate_token: 'candidate-safe', provider: 'bytedance', duration_seconds: 5, width: 1080, height: 1920 }], blockers: [] };
        },
        async getVideoResultImportWorkspace() { return { status: 'empty', candidates: [], initial_targets: [], blockers: [] }; },
        async saveNewProjectVideoPlan(payload) {
            calls.push(['saveVideo', structuredClone(payload)]);
            tasks = structuredClone(payload.tasks);
            planRevision = '2'.repeat(64);
            return state('saved');
        },
        async prepareNewProjectVideoPlan(payload) {
            calls.push(['prepareVideo', structuredClone(payload)]);
            return { ok: true, queued: true, executed: false, model_called: false, generation_executed: false, state: state() };
        },
        async loadVideoResultImportPreview(payload) {
            calls.push(['candidateVideoPreview', structuredClone(payload)]);
            return { ok: true, loaded: true, mime_type: 'video/mp4', byte_length: 4, base64: 'AAAAAA==' };
        },
        async connectNewProjectVideoResult(payload) {
            calls.push(['connectVideo', structuredClone(payload)]);
            tasks = tasks.map((task) => ({ ...task, status: '결과연결', result_token: 'result_'.concat('r'.repeat(64)) }));
            planRevision = '3'.repeat(64);
            return { ok: true, connected: true, result_token: tasks[0].result_token, state: state() };
        },
        async getNewProjectVideoResultPreview(payload) {
            calls.push(['resultVideoPreview', structuredClone(payload)]);
            return { ok: true, loaded: true, result_token: payload.result_token, mime_type: 'video/mp4', byte_length: 4, base64: 'AAAAAA==' };
        },
        async saveNewProjectVideoRetrySelection(payload) {
            calls.push(['retryVideo', structuredClone(payload)]);
            tasks = tasks.map((task) => ({ ...task, status: payload.task_tokens.includes(task.task_token) ? '재제작' : '결과연결' }));
            planRevision = '4'.repeat(64);
            return state('saved');
        },
        async saveNewProjectVideoReviewDecision(payload) {
            calls.push(['reviewVideo', structuredClone(payload)]);
            videoReviewDecision = payload.decision;
            tasks = tasks.map((task) => ({ ...task, status: payload.decision === 'retry' ? '재제작' : '결과연결' }));
            planRevision = '5'.repeat(64);
            return state('saved');
        },
    };
    const { restore } = installDeterministicDom(bridge);
    t.after(restore);
    const { PipelineStudio } = await import('../src/components/pipeline/PipelineStudio.js');
    const studio = PipelineStudio();
    await flushRenderer();
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'videos' } });

    const prompt = byAttribute(studio, 'textarea', 'aria-label', '첫 장면 프롬프트');
    prompt.value = '직접 수정한 영상 프롬프트';
    await prompt.dispatchEvent({ type: 'input' });
    const provider = byAttribute(studio, 'select', 'aria-label', '첫 장면 생성 도구');
    provider.value = 'bytedance';
    await provider.dispatchEvent({ type: 'change' });
    await byText(studio, 'button', '프롬프트 저장').dispatchEvent({ type: 'click' });
    await flushRenderer();
    const saved = calls.find(([method]) => method === 'saveVideo')[1];
    assert.equal(saved.tasks[0].prompt, '직접 수정한 영상 프롬프트');
    assert.equal(saved.tasks[0].provider, 'bytedance');
    assert.equal(Object.hasOwn(saved.tasks[0], 'review_decision'), false);
    assert.equal(saved.expected_design_revision_sha256, designRevision);
    assert.equal(saved.expected_image_plan_revision_sha256, imageRevision);
    assert.equal(saved.expected_video_plan_revision_sha256, '1'.repeat(64));

    await byText(studio, 'button', '영상 작업 준비').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'prepareVideo')[1], {
        expected_design_revision_sha256: designRevision,
        expected_image_plan_revision_sha256: imageRevision,
        expected_video_plan_revision_sha256: '2'.repeat(64),
    });
    assert.match(studio.textContent, /생성은 시작하지 않았습니다/);

    await byText(studio, 'button', '완료 영상 연결').dispatchEvent({ type: 'click' });
    await byText(studio, 'button', '이 영상 연결').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'connectVideo')[1], {
        task_token: tasks[0].task_token,
        candidate_token: 'candidate-safe',
        expected_design_revision_sha256: designRevision,
        expected_image_plan_revision_sha256: imageRevision,
        expected_video_plan_revision_sha256: '2'.repeat(64),
    });
    assert.ok(findAll(studio, 'video').some((video) => video.attributes.get('src')?.startsWith('blob:')));

    const retry = byAttribute(studio, 'input', 'aria-label', '첫 장면 다시 만들기');
    retry.checked = true;
    await retry.dispatchEvent({ type: 'change' });
    await flushRenderer();
    assert.equal(calls.find(([method]) => method === 'retryVideo')[1].expected_video_plan_revision_sha256, '3'.repeat(64));
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'storyboard' } });
    assert.ok(byText(studio, 'h2', '새 프로젝트 결과 검토'));
    assert.ok(findAll(studio, 'video').some((video) => video.attributes.get('src')?.startsWith('blob:')));
    assert.match(studio.textContent, /다음 할 일: 영상 1개 다시 만들기 준비/);
    await byText(studio, 'button', '영상 작업 열기').dispatchEvent({ type: 'click' });
    assert.ok(byText(studio, 'h2', '영상 작업'));
    await studio.dispatchEvent({ type: 'pipeline:navigate', detail: { tab: 'storyboard' } });
    const retryFilter = byText(studio, 'button', '다시 만들기');
    await retryFilter.dispatchEvent({ type: 'click' });
    const retryCard = findAll(studio, 'article').find((card) => card.textContent.includes('첫 장면'));
    await byText(retryCard, 'button', '이 결과 사용').dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.deepEqual(calls.find(([method]) => method === 'reviewVideo')[1], {
        task_token: 'task_'.concat('v'.repeat(64)),
        decision: 'use',
        expected_design_revision_sha256: designRevision,
        expected_image_plan_revision_sha256: imageRevision,
        expected_video_plan_revision_sha256: '4'.repeat(64),
    });
    assert.equal(byText(studio, 'button', '다시 만들기').attributes.get('aria-pressed'), 'true');
    assert.equal(findAll(studio, 'article').some((card) => card.textContent.includes('첫 장면')), false);
});
