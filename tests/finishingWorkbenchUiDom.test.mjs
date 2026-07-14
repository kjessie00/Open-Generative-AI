import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class TestNode {
    constructor(nodeType, tagName = '') {
        this.nodeType = nodeType;
        this.tagName = tagName.toUpperCase();
        this.childNodes = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.className = '';
        this.disabled = false;
        this.value = '';
        this.checked = false;
        this._text = '';
        this.classList = { toggle() {} };
    }

    get textContent() { return this._text + this.childNodes.map((child) => child.textContent).join(''); }
    set textContent(value) { this._text = String(value ?? ''); this.childNodes = []; }
    appendChild(child) { this.childNodes.push(child); return child; }
    setAttribute(name, value) { this.attributes.set(String(name), String(value)); }
    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }
    async dispatchEvent(event) {
        await Promise.all((this.listeners.get(event.type) || []).map((listener) => listener({ target: this, ...event })));
        return true;
    }
}

function descendants(root) {
    return root.childNodes.flatMap((child) => [child, ...descendants(child)]);
}

function byId(root, id) {
    return descendants(root).find((node) => node.attributes.get('id') === id);
}

function byTag(root, tagName) {
    return descendants(root).filter((node) => node.tagName === tagName.toUpperCase());
}

function buttonByText(root, text) {
    return descendants(root).find((node) => node.tagName === 'BUTTON' && node.textContent === text);
}

function installDom() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = {
        createElement: (tagName) => new TestNode(1, tagName),
        createTextNode: (text) => {
            const node = new TestNode(3);
            node.textContent = text;
            return node;
        },
    };
    return () => {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else delete globalThis.document;
    };
}

function readyWorkspace() {
    return {
        ok: true,
        status: 'ready',
        ready: true,
        ready_to_plan: false,
        already_current: false,
        project_id: 'synthetic_project',
        selected_range_count: 2,
        selected_duration_seconds: 5,
        input_ready: true,
        qc_ready: true,
        harness_ready: true,
        runtime_ready: true,
        output_contract: {
            location: 'production/final/workbench_runs/<content-derived-run-id>',
            canonical_delivery_untouched: true,
        },
        tool_status: { python: 'Python 3.11.7', ffmpeg: 'ffmpeg 4.3.2', ffprobe: 'ffprobe 4.3.2' },
        current_run: null,
        current_blockers: [],
        blockers: [],
        plan_token: 'a'.repeat(64),
        expires_at: '2026-07-14T04:02:00.000Z',
        cooperative_lock_limit: '협조하지 않는 외부 writer에 대한 한계',
    };
}

test('finishing UI requires native checkbox plus exact project id and emits only the exact opaque envelope', async (t) => {
    const restore = installDom();
    t.after(restore);
    const { FinishingWorkbenchPanel } = await import('../src/components/pipeline/FinishingWorkbenchPanel.js');
    const calls = [];
    const panel = FinishingWorkbenchPanel({
        workspace: readyWorkspace(),
        execution: { status: 'idle', result: null, error: '' },
        onRefresh: () => calls.push(['refresh']),
        onPlan: () => calls.push(['plan']),
        onExecute: (payload) => calls.push(['execute', structuredClone(payload)]),
    });
    const input = byId(panel, 'finishing-project-confirmation');
    const checkbox = byId(panel, 'finishing-explicit-confirmation');
    const execute = buttonByText(panel, '확인한 선택 구간 렌더 실행');
    assert.equal(input.tagName, 'INPUT');
    assert.equal(input.attributes.get('type'), 'text');
    assert.equal(checkbox.attributes.get('type'), 'checkbox');
    assert.equal(execute.disabled, true);

    input.value = 'synthetic_project';
    await input.dispatchEvent({ type: 'input' });
    assert.equal(execute.disabled, true);
    checkbox.checked = true;
    await checkbox.dispatchEvent({ type: 'change' });
    assert.equal(execute.disabled, false);
    input.value = ' synthetic_project ';
    await input.dispatchEvent({ type: 'input' });
    assert.equal(execute.disabled, true);
    input.value = 'synthetic_project';
    await input.dispatchEvent({ type: 'input' });
    await execute.dispatchEvent({ type: 'click' });
    assert.deepEqual(calls, [[
        'execute',
        { planToken: 'a'.repeat(64), confirmed: true, projectId: 'synthetic_project' },
    ]]);
    const serialized = JSON.stringify(calls);
    assert.doesNotMatch(serialized, /\/tmp|ffmpeg|ffprobe|python|cwd|argv|command|outputPath|source/);
    assert.match(panel.textContent, /렌더 실행 성공 ≠ 영상 품질 승인/);
    assert.doesNotMatch(panel.textContent, /(?:^|\s)(?:ffmpeg|ffprobe)\s+-/);
});

test('finishing UI has explicit loading, executing, success, stale, blocked, and empty states', async (t) => {
    const restore = installDom();
    t.after(restore);
    const { FinishingWorkbenchPanel } = await import('../src/components/pipeline/FinishingWorkbenchPanel.js');
    const cases = [
        [{ status: 'loading', blockers: [] }, { status: 'idle' }, /작업대 확인 중/],
        [readyWorkspace(), { status: 'executing' }, /입력 재검증 → 정확한 구간 렌더/],
        [{ ...readyWorkspace(), status: 'success', ready: false, already_current: true }, { status: 'success', result: { executed: true, run_id: 'a'.repeat(24), output_duration_seconds: 5 } }, /새 ffprobe 검증을 완료/],
        [{ ...readyWorkspace(), status: 'stale', ready: false, current_blockers: ['FINISHING_CURRENT_INPUT_STALE'] }, { status: 'idle' }, /이전 실행본 stale/],
        [{ status: 'blocked', blockers: ['FINISHING_SOURCE_SYMLINK_FORBIDDEN'] }, { status: 'idle' }, /현재 실행 차단 항목/],
        [{ status: 'empty', blockers: [] }, { status: 'idle' }, /마감 실행 차단/],
    ];
    for (const [workspace, execution, expected] of cases) {
        const panel = FinishingWorkbenchPanel({ workspace, execution });
        assert.match(panel.textContent, expected);
        assert.match(panel.textContent, /렌더 실행 성공 ≠ 영상 품질 승인/);
    }
    const executing = FinishingWorkbenchPanel({ workspace: readyWorkspace(), execution: { status: 'executing' } });
    assert.equal(byTag(executing, 'progress').length, 1);
    assert.equal(buttonByText(executing, '확인한 선택 구간 렌더 실행'), undefined);
});

test('finishing source stays focused, responsive, semantic, and free of generic command surfaces', async () => {
    const [component, client, preload, provider] = await Promise.all([
        readFile(new URL('../src/components/pipeline/FinishingWorkbenchPanel.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/lib/pipeline/client.js', import.meta.url), 'utf8'),
        readFile(new URL('../electron/preload.js', import.meta.url), 'utf8'),
        readFile(new URL('../electron/lib/filmPipelineProvider.js', import.meta.url), 'utf8'),
    ]);
    assert.ok(component.split(/\r?\n/).length < 260);
    assert.match(component, /grid-cols-1/);
    assert.match(component, /sm:grid-cols-2/);
    assert.match(component, /xl:grid-cols-4/);
    assert.match(component, /min-h-11/);
    assert.match(component, /el\('(?:input|fieldset|label|progress|button)'/);
    assert.doesNotMatch(component, /innerHTML|runSafeCommand|previewCommand|copyCommand|child_process|fetch\(/);
    assert.match(preload, /getFinishingWorkspace:\s*\(\)\s*=>/);
    assert.match(preload, /planFinishingRun:\s*\(\)\s*=>/);
    assert.match(provider, /get-finishing-workspace'[\s\S]*assertNoRendererPathArgument/);
    assert.match(provider, /plan-finishing-run'[\s\S]*assertNoRendererPathArgument/);
    assert.match(`${client}\n${preload}`, /executeFinishingRun/);
    assert.doesNotMatch(`${preload}\n${provider}`, /film-pipeline:(?:generate|submit|upload|run-finishing-command)/i);
});
