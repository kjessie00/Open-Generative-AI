import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { installNavigationPolicy } = require('../electron/lib/navigationPolicy');

async function source(relativePath) {
    return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Electron denies all popup URLs and renderer navigation', () => {
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

    for (const url of [
        'javascript:alert(1)',
        'file:///etc/passwd',
        'https://unknown.example/',
        'https://api.muapi.ai/',
    ]) {
        assert.deepEqual(popupHandler({ url }), { action: 'deny' });
    }

    let prevented = false;
    navigationHandler({ preventDefault() { prevented = true; } }, 'https://unknown.example/');
    assert.equal(prevented, true);
});

test('Electron web preferences preserve the isolated preload boundary', async () => {
    const main = await source('electron/main.js');
    const preload = await source('electron/preload.js');

    assert.match(main, /contextIsolation:\s*true/);
    assert.match(main, /nodeIntegration:\s*false/);
    assert.match(main, /sandbox:\s*true/);
    assert.doesNotMatch(main, /webSecurity:\s*false/);
    assert.doesNotMatch(main, /shell\.openExternal/);
    assert.match(preload, /exposeInMainWorld\(['"]filmPipeline['"]/);
});

test('active Vite and settings surfaces contain no hosted API credentials', async () => {
    const vite = await source('vite.config.mjs');
    const settings = await source('src/components/SettingsModal.js');
    const i18n = await source('src/lib/i18n.js');

    for (const [name, text] of Object.entries({ vite, settings, i18n })) {
        assert.doesNotMatch(text, /muapi/i, `${name} must not reference MuAPI`);
    }
    assert.doesNotMatch(vite, /proxy\s*:/);
    assert.doesNotMatch(settings, /localStorage|type=["']password["']/);
    assert.match(settings, /settings\.pipelineNote/);
});
