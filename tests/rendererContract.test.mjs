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

function installDeterministicDom(bridge) {
    const previous = {
        document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
        window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    };
    const document = {
        body: new TestNode(1, 'body'),
        createElement: (tagName) => new TestNode(1, tagName),
        createTextNode: (text) => {
            const node = new TestNode(3);
            node.textContent = text;
            return node;
        },
    };
    const window = {
        document,
        filmPipeline: bridge,
        alert() {},
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

test('PipelineStudio renderer preserves the production dry-run UI contract', async (t) => {
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
    assert.match(studio.textContent, /Dry-run locked/);
    assert.doesNotMatch(studio.textContent, /Dry-run disabled/);

    const openFolder = byText(studio, 'button', 'Open Production Folder');
    assert.ok(openFolder, 'folder-selection UI must be rendered');
    await openFolder.dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(studio.textContent, /Folder Selected Production/);
    assert.deepEqual(
        calls.filter(([method]) => method === 'selectProductionRoot').length,
        1,
        'folder selection must use the preload bridge exactly once',
    );
    assert.match(studio.textContent, /Dry-run locked/);

    const refresh = byText(studio, 'button', 'Refresh productions');
    assert.ok(refresh, 'production refresh control must be rendered');
    await refresh.dispatchEvent({ type: 'click' });
    await flushRenderer();
    assert.match(studio.textContent, /Cannot read parent: READ_PARENT_BLOCKED_FOR_TEST/);
    assert.ok(byText(studio, 'button', 'Open Settings'), 'reader error must expose a settings recovery action');

    const tabs = [
        ['Intake', 'Intake'],
        ['Storyboard', 'Storyboard'],
        ['Shot Designer', 'Shot Designer'],
        ['Motion Board', 'Motion Board'],
        ['Assets', 'Assets'],
        ['Prompt Packs', 'Prompt Packs'],
        ['Review Gates', 'Review Gates'],
        ['Queue', 'Queue'],
        ['QA', 'QA'],
        ['Final', 'Final'],
        ['Settings', 'Settings'],
    ];

    for (const [tabLabel, panelHeading] of tabs) {
        const tab = byText(studio, 'button', tabLabel);
        assert.ok(tab, `${tabLabel} tab must be rendered`);
        await tab.dispatchEvent({ type: 'click' });
        assert.ok(
            findAll(studio, 'h2').some((heading) => heading.textContent.trim() === panelHeading),
            `${tabLabel} must render the ${panelHeading} product panel`,
        );
    }

    await byText(studio, 'button', 'Assets').dispatchEvent({ type: 'click' });
    assert.match(studio.textContent, /Harness image dashboard mirror/);

    await byText(studio, 'button', 'Queue').dispatchEvent({ type: 'click' });
    const queueText = studio.textContent;
    assert.match(queueText, /Live submit is disabled/);
    assert.match(queueText, /Preview card only\. No run button is rendered\./);
    assert.match(queueText, /Copy command/);
    assert.match(queueText, /CREDIT_CONFIRMATION_REQUIRED/);
    assert.match(queueText, /image generationblocked/i);
    assert.ok(byText(studio, 'button', 'Submit disabled')?.disabled, 'submit control must be visibly disabled');

    const unsafeEnabledButtons = findAll(studio, 'button').filter((button) => (
        button.disabled !== true
        && /^(run|execute|generate|submit|upload)\b/i.test(button.textContent.trim())
    ));
    assert.deepEqual(
        unsafeEnabledButtons.map((button) => button.textContent.trim()),
        [],
        'renderer must not expose an enabled run, execute, generate, submit, or upload button',
    );
    assert.equal(calls.filter(([method]) => method === 'previewCommand').length, 0);
    assert.equal(calls.filter(([method]) => method === 'runSafeCommand').length, 0);
    assert.equal(calls.filter(([method]) => method === 'writePlanningFile').length, 0);
});

test('PipelineSidebar renders discovered production entries as DOM nodes', async (t) => {
    const { restore } = installDeterministicDom({});
    t.after(restore);
    const { PipelineSidebar } = await import('../src/components/pipeline/PipelineSidebar.js');

    const sidebar = PipelineSidebar({
        tabs: [{ id: 'intake', label: 'Intake' }],
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
    assert.match(sidebar.textContent, /3 files/);
    assert.ok(
        sidebar.textContent.indexOf('Intake') < sidebar.textContent.indexOf('Productions'),
        'primary pipeline navigation must remain ahead of the potentially long production list',
    );
});
