const { app, BrowserWindow, clipboard, dialog, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readProductionFolder } = require('./productionReader');

const CONFIG_FILE = 'film-pipeline-config.json';
const MAX_JSONL_BYTES = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 600;
const MAX_WALK_DEPTH = 8;
const MAX_COMMAND_PREVIEW_BYTES = 256 * 1024;

const SIDE_EFFECT_TYPES = new Set([
    'local_planning_write',
    'local_read',
    'local_write',
    'non_consuming_status',
    'credit_consuming_generation',
    'external_review',
    'external_upload',
    'account_mutation',
    'vip_fallback_model',
]);

const ASSET_EXTENSIONS = new Set([
    '.apng',
    '.avif',
    '.gif',
    '.jpeg',
    '.jpg',
    '.m4a',
    '.md',
    '.mov',
    '.mp3',
    '.mp4',
    '.png',
    '.webm',
    '.webp',
    '.wav',
]);

const CREDIT_KEYWORDS = [
    'dreamina submit',
    'jimeng submit',
    'seedance submit',
    'generate',
    'txt2video',
    'img2video',
    'i2v',
    't2v',
];

const EXTERNAL_REVIEW_KEYWORDS = [
    'gemini',
    'deepsearch',
    'imagegen',
    'browser',
    'playwright',
    'chrome',
];

const EXTERNAL_UPLOAD_KEYWORDS = [
    'upload',
    'youtube',
    'tiktok',
    'instagram',
    'telegram',
    's3',
    'aws',
    'gcloud',
    'gsutil',
    'scp',
    'rsync',
    'curl',
    'wget',
];

const ACCOUNT_MUTATION_KEYWORDS = [
    'login',
    'logout',
    'auth',
    'token',
    'cookie',
    'vercel',
    'firebase',
    'supabase',
];

const VIP_FALLBACK_KEYWORDS = [
    'vip',
    'fallback',
    'benefit_type',
    'backend_benefit_type',
];

function getMainWindow() {
    if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') return null;
    return BrowserWindow.getAllWindows()[0] || null;
}

function sendProgress(payload) {
    getMainWindow()?.webContents.send('film-pipeline:progress', {
        ts: new Date().toISOString(),
        ...payload,
    });
}

function getDataDir() {
    return path.join(app.getPath('userData'), 'film-pipeline');
}

function getConfigPath() {
    return path.join(getDataDir(), CONFIG_FILE);
}

function defaultConfig() {
    return {
        productionRoot: '',
        productionParentRoot: '',
        recentProductionRoots: [],
        dryRunMode: true,
        allowSafeCommandExecution: false,
        updatedAt: null,
    };
}

function ensureDataDir() {
    fs.mkdirSync(getDataDir(), { recursive: true });
}

function readJsonIfExists(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function sanitizeConfig(config = {}) {
    const base = defaultConfig();
    const recent = Array.isArray(config.recentProductionRoots)
        ? config.recentProductionRoots.filter((item) => typeof item === 'string').slice(0, 10)
        : base.recentProductionRoots;

    return {
        ...base,
        ...config,
        productionRoot: typeof config.productionRoot === 'string' ? config.productionRoot : base.productionRoot,
        productionParentRoot: typeof config.productionParentRoot === 'string' ? config.productionParentRoot : base.productionParentRoot,
        recentProductionRoots: recent,
        dryRunMode: config.dryRunMode !== false,
        allowSafeCommandExecution: false,
        updatedAt: new Date().toISOString(),
    };
}

function readConfig() {
    return sanitizeConfig(readJsonIfExists(getConfigPath(), defaultConfig()));
}

function writeConfig(config) {
    ensureDataDir();
    const nextConfig = sanitizeConfig(config);
    fs.writeFileSync(getConfigPath(), JSON.stringify(nextConfig, null, 2));
    sendProgress({ phase: 'config-updated', productionRoot: nextConfig.productionRoot });
    return nextConfig;
}

function assertString(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value.trim();
}

function normalizeRootPath(rootPath) {
    return path.resolve(assertString(rootPath, 'rootPath'));
}

function resolveInsideRoot(rootPath, relativePath) {
    const root = normalizeRootPath(rootPath);
    const rel = assertString(relativePath, 'relativePath');
    if (path.isAbsolute(rel)) {
        throw new Error('relativePath must not be absolute');
    }
    const resolved = path.resolve(root, rel);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error('relativePath escapes production root');
    }
    return { root, resolved, relativePath: path.relative(root, resolved) };
}

function assertDirectory(rootPath) {
    const root = normalizeRootPath(rootPath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`Production root does not exist or is not a directory: ${root}`);
    }
    return root;
}

function fileTypeForExtension(ext) {
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.apng'].includes(ext)) return 'image';
    if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video';
    if (['.wav', '.mp3', '.m4a'].includes(ext)) return 'audio';
    if (ext === '.md') return 'markdown';
    return 'asset';
}

function listFiles(root, options = {}) {
    const extensions = options.extensions || null;
    const maxDepth = options.maxDepth ?? MAX_WALK_DEPTH;
    const maxFiles = options.maxFiles ?? MAX_FILE_COUNT;
    const files = [];

    function walk(dir, depth) {
        if (files.length >= maxFiles || depth > maxDepth) return;

        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (files.length >= maxFiles) break;
            if (entry.name === 'node_modules' || entry.name === '.git') continue;

            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath, depth + 1);
                continue;
            }

            const ext = path.extname(entry.name).toLowerCase();
            if (extensions && !extensions.has(ext)) continue;

            const stats = fs.statSync(fullPath);
            files.push({
                path: path.relative(root, fullPath),
                name: entry.name,
                type: fileTypeForExtension(ext),
                size: stats.size,
                updated_at: stats.mtime.toISOString(),
            });
        }
    }

    walk(root, 0);
    return files;
}

function readKnownJson(root, names) {
    for (const name of names) {
        const target = path.join(root, name);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
            return { path: name, value: readJsonIfExists(target, null) };
        }
    }
    return null;
}

function getConfig() {
    return readConfig();
}

function setConfig(config) {
    return { ok: true, config: writeConfig(config || {}) };
}

function resolveProductionDialogDefaultPath(config = {}, isDirectory = (candidate) => {
    try {
        return fs.statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}) {
    const candidates = [
        config.productionParentRoot,
        typeof config.productionRoot === 'string' && config.productionRoot.trim()
            ? path.dirname(config.productionRoot)
            : '',
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string' || !candidate.trim()) continue;
        const resolved = path.resolve(candidate);
        if (isDirectory(resolved)) return resolved;
    }
    return '';
}

async function selectProductionRoot(inputPath) {
    let selectedPath = inputPath;
    const config = readConfig();
    if (typeof selectedPath !== 'string' || !selectedPath.trim()) {
        const defaultPath = resolveProductionDialogDefaultPath(config);
        const result = await dialog.showOpenDialog(getMainWindow(), {
            title: 'Open Production Folder',
            properties: ['openDirectory'],
            ...(defaultPath ? { defaultPath } : {}),
        });
        if (result.canceled || !result.filePaths?.[0]) {
            return { ok: false, canceled: true, rootPath: '', config };
        }
        selectedPath = result.filePaths[0];
    }

    const root = assertDirectory(selectedPath);
    const recent = [root, ...config.recentProductionRoots.filter((item) => item !== root)].slice(0, 10);
    const nextConfig = writeConfig({
        ...config,
        productionRoot: root,
        recentProductionRoots: recent,
    });
    return { ok: true, rootPath: root, config: nextConfig };
}

function readProductionState(rootPath) {
    const root = assertDirectory(rootPath);
    const readerState = readProductionFolder(root);

    return {
        ok: true,
        rootPath: readerState.rootPath,
        state: readerState,
    };
}

const BRIEF_FILE_NAMES = new Set(['brief.md', 'master_plan.md']);
const LEDGER_FILE_SUFFIXES = ['.jsonl'];
const LEDGER_FILE_NAMES = new Set(['ledger.csv']);

function isMarkdownBrief(name) {
    return BRIEF_FILE_NAMES.has(name);
}

function isJsonlLedger(name) {
    if (LEDGER_FILE_NAMES.has(name)) return true;
    return LEDGER_FILE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function listProductionChildren(parentPath) {
    const root = assertDirectory(parentPath);
    const dirents = fs.readdirSync(root, { withFileTypes: true });
    const entries = [];

    for (const dirent of dirents) {
        if (!dirent.isDirectory()) continue;
        // Skip dotfiles / hidden directories (e.g. .DS_Store, .git)
        if (dirent.name.startsWith('.')) continue;

        const childPath = path.join(root, dirent.name);

        try {
            const stats = fs.statSync(childPath);
            const childDirents = fs.readdirSync(childPath, { withFileTypes: true });
            let fileCount = 0;
            let hasMarkdownBrief = false;
            let hasJsonlLedger = false;

            for (const child of childDirents) {
                if (!child.isFile()) continue;
                fileCount += 1;
                if (isMarkdownBrief(child.name)) hasMarkdownBrief = true;
                if (isJsonlLedger(child.name)) hasJsonlLedger = true;
            }

            entries.push({
                name: dirent.name,
                path: childPath,
                mtime: stats.mtime.toISOString(),
                fileCount,
                hasMarkdownBrief,
                hasJsonlLedger,
            });
        } catch {
            // statSync or readdirSync failure on this subdir — skip just this one
            continue;
        }
    }

    entries.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));

    return {
        ok: true,
        rootPath: root,
        entries,
    };
}

function writePlanningFile(payload) {
    const { rootPath, relativePath, content } = payload || {};
    const { root, resolved, relativePath: safeRelativePath } = resolveInsideRoot(rootPath, relativePath);
    const ext = path.extname(resolved).toLowerCase();
    const allowedExtensions = new Set(['.json', '.jsonl', '.md', '.txt']);

    if (!allowedExtensions.has(ext)) {
        throw new Error(`Planning files must use one of: ${Array.from(allowedExtensions).join(', ')}`);
    }
    if (typeof content !== 'string') {
        throw new Error('content must be a string');
    }

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');
    sendProgress({ phase: 'planning-file-written', rootPath: root, relativePath: safeRelativePath });

    return {
        ok: true,
        rootPath: root,
        relativePath: safeRelativePath,
        bytes: Buffer.byteLength(content, 'utf8'),
    };
}

function listAssets(rootPath) {
    const root = assertDirectory(rootPath);
    return {
        ok: true,
        rootPath: root,
        assets: listFiles(root, { extensions: ASSET_EXTENSIONS }),
    };
}

function readJsonl(payload) {
    const { rootPath, relativePath } = payload || {};
    const { root, resolved, relativePath: safeRelativePath } = resolveInsideRoot(rootPath, relativePath);
    const stats = fs.statSync(resolved);
    if (!stats.isFile()) {
        throw new Error('relativePath is not a file');
    }
    if (stats.size > MAX_JSONL_BYTES) {
        throw new Error(`JSONL file is too large to read safely: ${stats.size} bytes`);
    }

    const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
    const records = [];
    const errors = [];

    lines.forEach((line, index) => {
        if (!line.trim()) return;
        try {
            records.push({ line: index + 1, value: JSON.parse(line) });
        } catch (error) {
            errors.push({ line: index + 1, error: error.message });
        }
    });

    return {
        ok: errors.length === 0,
        rootPath: root,
        relativePath: safeRelativePath,
        records,
        errors,
    };
}

function commandText(commandSpec = {}) {
    const args = Array.isArray(commandSpec.args) ? commandSpec.args : [];
    return [commandSpec.command, ...args].filter(Boolean).join(' ').toLowerCase();
}

function includesAny(text, keywords) {
    return keywords.some((keyword) => text.includes(keyword));
}

function sideEffectClassifier(commandSpec = {}) {
    const declaredType = SIDE_EFFECT_TYPES.has(commandSpec.side_effect_type)
        ? commandSpec.side_effect_type
        : 'account_mutation';
    const text = commandText(commandSpec);
    let detectedType = declaredType;

    if (includesAny(text, VIP_FALLBACK_KEYWORDS)) detectedType = 'vip_fallback_model';
    else if (includesAny(text, CREDIT_KEYWORDS)) detectedType = 'credit_consuming_generation';
    else if (includesAny(text, EXTERNAL_REVIEW_KEYWORDS)) detectedType = 'external_review';
    else if (includesAny(text, EXTERNAL_UPLOAD_KEYWORDS)) detectedType = 'external_upload';
    else if (includesAny(text, ACCOUNT_MUTATION_KEYWORDS)) detectedType = 'account_mutation';

    const hardBlocked = [
        'credit_consuming_generation',
        'external_review',
        'external_upload',
        'account_mutation',
        'vip_fallback_model',
        'local_write',
    ].includes(detectedType);

    return {
        declaredType,
        detectedType,
        hardBlocked,
        previewOnly: detectedType === 'non_consuming_status' || detectedType === 'local_read',
        allowedLocalPlanning: detectedType === 'local_planning_write',
        executionEnabled: false,
        requiresConfirmation: commandSpec.requires_confirmation === true || hardBlocked,
        relatedClipId: commandSpec.related_clip_id || '',
        evidenceOutputPath: commandSpec.evidence_output_path || '',
    };
}

function shellQuote(value) {
    const stringValue = String(value ?? '');
    if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(stringValue)) return stringValue;
    return `'${stringValue.replace(/'/g, `'\\''`)}'`;
}

function previewCommand(commandSpec = {}) {
    const command = assertString(commandSpec.command, 'command');
    const args = Array.isArray(commandSpec.args) ? commandSpec.args : [];
    const rendered = [command, ...args].map(shellQuote).join(' ');
    const cwd = typeof commandSpec.cwd === 'string' && commandSpec.cwd.trim()
        ? path.resolve(commandSpec.cwd)
        : '';
    const shellSafeCommand = cwd ? `cd ${shellQuote(cwd)} && ${rendered}` : rendered;

    return {
        ok: true,
        executed: false,
        shellSafeCommand,
        classification: sideEffectClassifier(commandSpec),
    };
}

function fingerprintCommandPreview(text) {
    return {
        length: text.length,
        byteLength: Buffer.byteLength(text, 'utf8'),
        sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    };
}

function copyCommandPreview(commandSpec = {}, clipboardApi = clipboard) {
    const preview = previewCommand(commandSpec);
    const fingerprint = fingerprintCommandPreview(preview.shellSafeCommand);
    if (fingerprint.byteLength > MAX_COMMAND_PREVIEW_BYTES) {
        return {
            ok: false,
            copied: false,
            verified: false,
            executed: false,
            error: 'COMMAND_PREVIEW_TOO_LARGE',
            ...fingerprint,
        };
    }
    if (!clipboardApi || typeof clipboardApi.writeText !== 'function' || typeof clipboardApi.readText !== 'function') {
        return {
            ok: false,
            copied: false,
            verified: false,
            executed: false,
            error: 'CLIPBOARD_UNAVAILABLE',
            ...fingerprint,
        };
    }

    clipboardApi.writeText(preview.shellSafeCommand);
    const verified = clipboardApi.readText() === preview.shellSafeCommand;
    const result = {
        ok: verified,
        copied: verified,
        verified,
        executed: false,
        error: verified ? '' : 'CLIPBOARD_VERIFY_FAILED',
        ...fingerprint,
    };
    sendProgress({
        phase: verified ? 'command-copied' : 'command-copy-failed',
        sideEffectType: preview.classification.detectedType,
        copied: result.copied,
        verified: result.verified,
        executed: false,
        length: result.length,
        byteLength: result.byteLength,
        sha256: result.sha256,
    });
    return result;
}

function runSafeCommand(commandSpec = {}) {
    const preview = previewCommand(commandSpec);
    const classification = preview.classification;
    const reason = classification.hardBlocked
        ? `Blocked side effect type: ${classification.detectedType}`
        : 'Safe command execution is disabled; preview only is available';

    sendProgress({
        phase: 'command-blocked',
        commandId: commandSpec.id || '',
        sideEffectType: classification.detectedType,
        reason,
    });

    return {
        ok: false,
        executed: false,
        error: 'FILM_PIPELINE_COMMAND_BLOCKED',
        reason,
        preview,
    };
}

function register() {
    ipcMain.handle('film-pipeline:get-config', () => getConfig());
    ipcMain.handle('film-pipeline:set-config', (_, config) => setConfig(config));
    ipcMain.handle('film-pipeline:select-production-root', (_, rootPath) => selectProductionRoot(rootPath));
    ipcMain.handle('film-pipeline:read-production-state', (_, rootPath) => readProductionState(rootPath));
    ipcMain.handle('film-pipeline:list-production-children', (_, parentPath) => listProductionChildren(parentPath));
    ipcMain.handle('film-pipeline:write-planning-file', (_, payload) => writePlanningFile(payload));
    ipcMain.handle('film-pipeline:list-assets', (_, rootPath) => listAssets(rootPath));
    ipcMain.handle('film-pipeline:read-jsonl', (_, payload) => readJsonl(payload));
    ipcMain.handle('film-pipeline:preview-command', (_, commandSpec) => previewCommand(commandSpec));
    ipcMain.handle('film-pipeline:copy-command-preview', (_, commandSpec) => copyCommandPreview(commandSpec));
    ipcMain.handle('film-pipeline:run-safe-command', (_, commandSpec) => runSafeCommand(commandSpec));
}

module.exports = {
    register,
    sideEffectClassifier,
    previewCommand,
    copyCommandPreview,
    runSafeCommand,
    listProductionChildren,
    resolveProductionDialogDefaultPath,
};
