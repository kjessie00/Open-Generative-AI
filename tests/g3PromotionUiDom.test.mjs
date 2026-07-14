import assert from 'node:assert/strict';
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

test('promotion panel requires exact typed project id plus native explicit confirmation before exact payload', async (t) => {
    const restore = installDom();
    t.after(restore);
    const { G3PromotionPanel } = await import('../src/components/pipeline/G3PromotionPanel.js');
    const calls = [];
    const plan = {
        status: 'ready',
        ready: true,
        already_current: false,
        plan_token: 'A'.repeat(43),
        project_id: 'project_01',
        episode_id: 'episode_01',
        shot_count: 2,
        target_state: '새 canonical 파일 생성 예정',
        selected_takes_sha256: 'a'.repeat(64),
        current_target_sha256: '',
        safety_summary: ['경로를 renderer에 노출하지 않습니다.'],
        blockers: [],
    };
    const panel = G3PromotionPanel({
        plan,
        onRefresh: () => calls.push(['refresh']),
        onPromote: (payload) => calls.push(['promote', structuredClone(payload)]),
    });
    const input = byId(panel, 'g3-promotion-project-confirmation');
    const checkbox = byId(panel, 'g3-promotion-explicit-confirmation');
    const button = buttonByText(panel, '확인한 선택을 production에 반영');
    assert.equal(input.tagName, 'INPUT');
    assert.equal(input.attributes.get('type'), 'text');
    assert.equal(checkbox.tagName, 'INPUT');
    assert.equal(checkbox.attributes.get('type'), 'checkbox');
    assert.equal(button.disabled, true);

    input.value = 'project_01';
    await input.dispatchEvent({ type: 'input' });
    assert.equal(button.disabled, true, 'typed id alone must not enable promotion');
    checkbox.checked = true;
    await checkbox.dispatchEvent({ type: 'change' });
    assert.equal(button.disabled, false);
    input.value = ' project_01 ';
    await input.dispatchEvent({ type: 'input' });
    assert.equal(button.disabled, true, 'surrounding whitespace is not an exact project id');
    input.value = 'project_01';
    await input.dispatchEvent({ type: 'input' });
    assert.equal(button.disabled, false);
    await button.dispatchEvent({ type: 'click' });
    assert.deepEqual(calls, [[
        'promote',
        { planToken: 'A'.repeat(43), projectIdConfirmation: 'project_01', confirmed: true },
    ]]);
    assert.equal(JSON.stringify(calls).includes('/'), false, 'renderer payload must contain no filesystem path');
});

test('already-current and blocked plans expose status without a promotion button', async (t) => {
    const restore = installDom();
    t.after(restore);
    const { G3PromotionPanel } = await import('../src/components/pipeline/G3PromotionPanel.js');
    const current = G3PromotionPanel({
        plan: {
            status: 'already_current', ready: false, already_current: true, target_state: '이미 최신',
            safety_summary: [], blockers: [],
        },
        onRefresh() {},
        onPromote() { assert.fail('already-current plan must not render promotion action'); },
    });
    assert.match(current.textContent, /이미 production과 동일/);
    assert.equal(buttonByText(current, '확인한 선택을 production에 반영'), undefined);

    const blocked = G3PromotionPanel({
        plan: { status: 'blocked', ready: false, blockers: ['G3_PROMOTION_EXPORT_REQUIRED'], safety_summary: [] },
        onRefresh() {},
        onPromote() { assert.fail('blocked plan must not render promotion action'); },
    });
    assert.match(blocked.textContent, /현재 승격 차단 항목/);
    assert.equal(buttonByText(blocked, '확인한 선택을 production에 반영'), undefined);
});
