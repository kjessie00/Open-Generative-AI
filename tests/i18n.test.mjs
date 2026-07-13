import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getLang,
    initLocale,
    normalizeLang,
    setLang,
    t,
} from '../src/lib/i18n.js';
import { p } from '../src/components/pipeline/copy.js';

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(String(key), String(value));
        },
        removeItem(key) {
            values.delete(String(key));
        },
    };
}

function installStorage(initial = {}) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: memoryStorage(initial),
    });
    return () => {
        if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
        else delete globalThis.localStorage;
    };
}

test('locale normalization recognizes Korean variants and keeps English and Chinese compatibility', () => {
    assert.equal(normalizeLang('ko'), 'ko-KR');
    assert.equal(normalizeLang('ko-KR'), 'ko-KR');
    assert.equal(normalizeLang('ko_KR'), 'ko-KR');
    assert.equal(normalizeLang('en-US'), 'en');
    assert.equal(normalizeLang('zh'), 'zh-CN');
    assert.equal(normalizeLang('zh_TW'), 'zh-CN');
    assert.equal(normalizeLang('unsupported-locale'), 'ko-KR');
});

test('first visit defaults to Korean while an explicit stored language is respected', (t) => {
    let restore = installStorage();
    t.after(() => restore());
    assert.equal(initLocale(), 'ko-KR');
    assert.equal(localStorage.getItem('og_lang'), 'ko-KR');

    restore();
    restore = installStorage({ og_lang: 'en' });
    assert.equal(getLang(), 'en');

    restore();
    restore = installStorage({ og_lang: 'zh' });
    assert.equal(getLang(), 'zh-CN');
    assert.equal(localStorage.getItem('og_lang'), 'zh-CN');
});

test('Korean UI copy can switch to English without mutating technical values', (context) => {
    const restore = installStorage();
    context.after(restore);

    setLang('ko_KR', { reload: false });
    assert.equal(t('nav.pipeline'), '시네마틱 파이프라인');
    assert.equal(p('Generation queue'), '생성 대기열');
    assert.equal(p('CREDIT_CONFIRMATION_REQUIRED'), 'CREDIT_CONFIRMATION_REQUIRED');
    assert.equal(p('/tmp/production/clip_001.mp4'), '/tmp/production/clip_001.mp4');

    setLang('en', { reload: false });
    assert.equal(t('nav.pipeline'), 'Pipeline Studio');
    assert.equal(p('Generation queue'), 'Generation queue');

    setLang('zh-CN', { reload: false });
    assert.equal(t('nav.pipeline'), '流水线工作室');
    assert.equal(p('Generation queue'), 'Generation queue');
    assert.equal(t('missing.translation.key'), 'missing.translation.key');
});
