import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
