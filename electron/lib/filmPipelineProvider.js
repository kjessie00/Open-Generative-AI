const { app, BrowserWindow, clipboard, dialog, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readProductionFolder } = require('./productionReader');
const newProjectDraftProvider = require('./newProjectDraftProvider');
const g3ReviewDraftProvider = require('./g3ReviewDraftProvider');
const g3ProductionPromotionProvider = require('./g3ProductionPromotionProvider');
const { createFinishingWorkbenchProvider } = require('./finishingWorkbenchProvider');
const { buildMediaRetryPlan } = require('./mediaRetryPlanProvider');

const CONFIG_FILE = 'film-pipeline-config.json';
const MAX_JSONL_BYTES = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 600;
const MAX_WALK_DEPTH = 8;
const MAX_PLANNING_FILE_BYTES = 1024 * 1024;
const MAX_PLANNING_FILE_ID_LENGTH = 128;
const PLANNING_TEMP_PREFIX = '.film-pipeline-planning-';
const PATH_PROVENANCE_VERSION = 1;
const HAPPY_VIDEO_FACTORY_ROOT = '/Users/jessiek/StudioProjects/happyVideoFactory';
const MAX_HARNESS_CONTRACT_FILE_BYTES = 2 * 1024 * 1024;
const HARNESS_CONTRACT_ALLOWLIST = Object.freeze([
    Object.freeze({
        id: 'pack_builder',
        relativePath: 'scripts/build_short_drama_pipeline_pack.py',
        requiredMarkers: ['--brief', '--script', '--production-id', '--output-root', '--target-generator'],
        liveSideEffect: false,
    }),
    Object.freeze({
        id: 'pack_validator',
        relativePath: 'scripts/validate_short_drama_pipeline_pack.py',
        requiredMarkers: ['validate_pipeline_pack', 'production_dir', '--json'],
        liveSideEffect: false,
    }),
    Object.freeze({
        id: 'room_plan_builder',
        relativePath: 'scripts/build_short_drama_room_pipeline_plan.py',
        requiredMarkers: ['build_drama_selection_plan', '--package-dir', '--ledger-output'],
        liveSideEffect: false,
    }),
    Object.freeze({
        id: 'room_verifier',
        relativePath: 'scripts/verify_short_drama_room_pipeline.py',
        requiredMarkers: ['run_drama_room_pipeline_verification', 'selected_takes_contract_matches_edit_render_consumer'],
        liveSideEffect: false,
    }),
    Object.freeze({
        id: 'canonical_pack_contract',
        relativePath: 'video_core/short_drama_pipeline/validator.py',
        requiredMarkers: ['PACK_CONTRACT_VERSION', 'actual_generation_submitted', 'canonical_production_id_mismatch'],
        liveSideEffect: false,
    }),
]);

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
        pathProvenanceVersion: PATH_PROVENANCE_VERSION,
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
    const hasMainOwnedPathProvenance = config.pathProvenanceVersion === PATH_PROVENANCE_VERSION;
    const recent = hasMainOwnedPathProvenance && Array.isArray(config.recentProductionRoots)
        ? config.recentProductionRoots.filter((item) => typeof item === 'string').slice(0, 10)
        : base.recentProductionRoots;

    return {
        ...base,
        ...config,
        productionRoot: hasMainOwnedPathProvenance && typeof config.productionRoot === 'string'
            ? config.productionRoot
            : base.productionRoot,
        productionParentRoot: hasMainOwnedPathProvenance && typeof config.productionParentRoot === 'string'
            ? config.productionParentRoot
            : base.productionParentRoot,
        recentProductionRoots: recent,
        pathProvenanceVersion: PATH_PROVENANCE_VERSION,
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

function planningWriteError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function assertPlanningRoot(rootPath, configuredRoot) {
    if (typeof rootPath !== 'string' || rootPath.length === 0 || rootPath.includes('\0')) {
        throw planningWriteError('PLANNING_ROOT_INVALID', 'Planning root must be a non-empty path');
    }
    if (typeof configuredRoot !== 'string' || configuredRoot.length === 0 || configuredRoot.includes('\0')) {
        throw planningWriteError('PLANNING_ROOT_NOT_CONFIGURED', 'A production root must be configured before saving');
    }
    if (rootPath !== configuredRoot) {
        throw planningWriteError('PLANNING_ROOT_MISMATCH', 'Planning root does not match the configured production root');
    }
    if (!path.isAbsolute(rootPath) || path.normalize(rootPath) !== rootPath) {
        throw planningWriteError('PLANNING_ROOT_INVALID', 'Planning root must be an absolute normalized path');
    }

    let stats;
    try {
        stats = fs.lstatSync(rootPath);
    } catch {
        throw planningWriteError('PLANNING_ROOT_INVALID', 'Configured production root does not exist');
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw planningWriteError('PLANNING_ROOT_INVALID', 'Configured production root must be a non-symlink directory');
    }

    return {
        root: rootPath,
        realRoot: fs.realpathSync.native(rootPath),
    };
}

function parsePlanningRelativePath(relativePath) {
    if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0')) {
        throw planningWriteError('PLANNING_PATH_NOT_ALLOWED', 'Planning path is not allowed');
    }
    if (relativePath === 'docs/ui_integration/intake_snapshot.json') {
        return {
            relativePath,
            components: ['docs', 'ui_integration', 'intake_snapshot.json'],
        };
    }
    if (relativePath === 'reviews/media_review_draft.json') {
        return {
            relativePath,
            components: ['reviews', 'media_review_draft.json'],
        };
    }

    const safeId = `(?![A-Za-z0-9._-]*\\.\\.)[A-Za-z0-9][A-Za-z0-9._-]{0,${MAX_PLANNING_FILE_ID_LENGTH - 1}}`;
    const patterns = [
        new RegExp(`^storyboard/drafts/(${safeId})_shot_payload\\.json$`),
        new RegExp(`^image_generation/prompts/(${safeId})_deepsearch_scene_image\\.md$`),
    ];
    const match = patterns.map((pattern) => relativePath.match(pattern)).find(Boolean);
    if (!match) {
        throw planningWriteError('PLANNING_PATH_NOT_ALLOWED', 'Planning path is not allowed');
    }

    return {
        relativePath,
        components: relativePath.split('/'),
    };
}

function assertDirectoryInsideRoot(directoryPath, realRoot) {
    const stats = fs.lstatSync(directoryPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw planningWriteError('PLANNING_PARENT_UNSAFE', 'Planning parent must be a non-symlink directory');
    }
    const realDirectory = fs.realpathSync.native(directoryPath);
    if (realDirectory !== realRoot && !realDirectory.startsWith(realRoot + path.sep)) {
        throw planningWriteError('PLANNING_ROOT_ESCAPE', 'Planning parent escapes the production root');
    }
    return { dev: stats.dev, ino: stats.ino, realDirectory };
}

function ensurePlanningParent(root, realRoot, components) {
    let current = root;
    for (const component of components.slice(0, -1)) {
        current = path.join(current, component);
        try {
            const stats = fs.lstatSync(current);
            if (stats.isSymbolicLink() || !stats.isDirectory()) {
                throw planningWriteError('PLANNING_PARENT_UNSAFE', 'Planning parent must be a non-symlink directory');
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            try {
                fs.mkdirSync(current, { mode: 0o700 });
            } catch (mkdirError) {
                if (mkdirError.code !== 'EEXIST') throw mkdirError;
            }
        }
        assertDirectoryInsideRoot(current, realRoot);
    }
    return current;
}

function assertRegularTargetOrMissing(targetPath) {
    try {
        const stats = fs.lstatSync(targetPath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            throw planningWriteError('PLANNING_TARGET_UNSAFE', 'Planning target must be a regular file or not exist');
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

function isWellFormedUnicode(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF) {
            if (index + 1 >= value.length) return false;
            const next = value.charCodeAt(index + 1);
            if (next < 0xDC00 || next > 0xDFFF) return false;
            index += 1;
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            return false;
        }
    }
    return true;
}

function writePlanningFile(payload, options = {}) {
    const { rootPath, relativePath, content } = payload || {};
    const configuredRoot = options.configuredRoot ?? readConfig().productionRoot;
    const { root, realRoot } = assertPlanningRoot(rootPath, configuredRoot);
    const parsed = parsePlanningRelativePath(relativePath);
    if (typeof content !== 'string') {
        throw planningWriteError('PLANNING_CONTENT_INVALID', 'Planning content must be a string');
    }
    if (content.includes('\0') || !isWellFormedUnicode(content)) {
        throw planningWriteError('PLANNING_CONTENT_INVALID', 'Planning content contains invalid characters');
    }
    const contentBuffer = Buffer.from(content, 'utf8');
    if (contentBuffer.byteLength > MAX_PLANNING_FILE_BYTES) {
        throw planningWriteError('PLANNING_CONTENT_TOO_LARGE', 'Planning content exceeds the 1 MiB limit');
    }

    const parentPath = ensurePlanningParent(root, realRoot, parsed.components);
    const parentIdentity = assertDirectoryInsideRoot(parentPath, realRoot);
    const targetPath = path.join(parentPath, parsed.components.at(-1));
    assertRegularTargetOrMissing(targetPath);

    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw planningWriteError('PLANNING_NOFOLLOW_UNAVAILABLE', 'No-follow file creation is unavailable');
    }
    const tempPath = path.join(parentPath, `${PLANNING_TEMP_PREFIX}${process.pid}-${crypto.randomBytes(12).toString('hex')}`);
    const openFlags = fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | fs.constants.O_NOFOLLOW;
    let fileDescriptor;
    let renamed = false;
    try {
        fileDescriptor = fs.openSync(tempPath, openFlags, 0o600);
        fs.writeFileSync(fileDescriptor, contentBuffer);
        fs.fsyncSync(fileDescriptor);
        fs.closeSync(fileDescriptor);
        fileDescriptor = undefined;

        const currentParent = assertDirectoryInsideRoot(parentPath, realRoot);
        if (currentParent.dev !== parentIdentity.dev || currentParent.ino !== parentIdentity.ino) {
            throw planningWriteError('PLANNING_PARENT_CHANGED', 'Planning parent changed during the write');
        }
        assertRegularTargetOrMissing(targetPath);
        const tempStats = fs.lstatSync(tempPath);
        if (tempStats.isSymbolicLink() || !tempStats.isFile()) {
            throw planningWriteError('PLANNING_TEMP_UNSAFE', 'Planning temporary file is unsafe');
        }

        const renameFile = options.renameFile || fs.renameSync;
        renameFile(tempPath, targetPath);
        renamed = true;
    } finally {
        if (fileDescriptor !== undefined) {
            try {
                fs.closeSync(fileDescriptor);
            } catch {}
        }
        if (!renamed) {
            try {
                fs.unlinkSync(tempPath);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    }

    sendProgress({
        phase: 'planning-file-written',
        rootPath: root,
        relativePath: parsed.relativePath,
        sideEffectType: 'local_planning_write',
        planningWrite: true,
        executed: false,
    });
    return {
        ok: true,
        written: true,
        executed: false,
        sideEffectType: 'local_planning_write',
        rootPath: root,
        relativePath: parsed.relativePath,
        bytes: contentBuffer.byteLength,
    };
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

function getConfig(options = {}) {
    const readConfigFn = options.readConfigFn || readConfig;
    return sanitizeConfig(readConfigFn());
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

function pathProvenanceError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function assertTrustedDirectory(directoryPath, code = 'PATH_PROVENANCE_INVALID_DIRECTORY') {
    if (typeof directoryPath !== 'string' || directoryPath.length === 0 || directoryPath.includes('\0')) {
        throw pathProvenanceError(code, 'Selected path must be a non-empty directory path');
    }
    if (!path.isAbsolute(directoryPath) || path.normalize(directoryPath) !== directoryPath) {
        throw pathProvenanceError(code, 'Selected path must be absolute and normalized');
    }
    let stats;
    try {
        stats = fs.lstatSync(directoryPath);
    } catch {
        throw pathProvenanceError(code, 'Selected directory does not exist');
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw pathProvenanceError(code, 'Selected path must be a non-symlink directory');
    }
    return {
        path: directoryPath,
        realPath: fs.realpathSync.native(directoryPath),
        dev: stats.dev,
        ino: stats.ino,
    };
}

function assertSelectionRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw pathProvenanceError('PATH_SELECTION_INVALID', 'Path selection request is invalid');
    }
    const mode = request.mode;
    const expectedKeys = mode === 'child' ? ['mode', 'rootPath'] : ['mode'];
    if (!['production', 'parent', 'child'].includes(mode)
        || Object.keys(request).sort().join(',') !== expectedKeys.sort().join(',')) {
        throw pathProvenanceError('PATH_SELECTION_INVALID', 'Path selection request is invalid');
    }
    return mode;
}

function assertConfiguredChild(rootPath, config) {
    const parent = assertTrustedDirectory(
        config.productionParentRoot,
        'PRODUCTION_PARENT_NOT_CONFIGURED',
    );
    const child = assertTrustedDirectory(rootPath, 'PRODUCTION_CHILD_INVALID');
    if (path.basename(child.path).startsWith('.')
        || path.dirname(child.path) !== parent.path
        || path.dirname(child.realPath) !== parent.realPath) {
        throw pathProvenanceError(
            'PRODUCTION_CHILD_NOT_IMMEDIATE',
            'Selected production must be an immediate real child of the configured parent',
        );
    }
    return child.path;
}

async function selectProductionRoot(request, options = {}) {
    const mode = assertSelectionRequest(request);
    const readConfigFn = options.readConfigFn || readConfig;
    const writeConfigFn = options.writeConfigFn || writeConfig;
    const dialogApi = options.dialogApi || dialog;
    const mainWindow = options.mainWindow === undefined ? getMainWindow() : options.mainWindow;
    const config = sanitizeConfig(readConfigFn());

    let selectedPath;
    if (mode === 'child') {
        selectedPath = assertConfiguredChild(request.rootPath, config);
    } else {
        const defaultPath = resolveProductionDialogDefaultPath(config);
        const result = await dialogApi.showOpenDialog(mainWindow, {
            title: mode === 'parent' ? 'Open Production Parent Folder' : 'Open Production Folder',
            properties: ['openDirectory'],
            ...(defaultPath ? { defaultPath } : {}),
        });
        if (result.canceled || !result.filePaths?.[0]) {
            return { ok: false, canceled: true, mode, rootPath: '', config };
        }
        selectedPath = result.filePaths[0];
        assertTrustedDirectory(selectedPath, 'NATIVE_SELECTION_INVALID');
    }

    const nextValues = mode === 'parent'
        ? { productionParentRoot: selectedPath }
        : {
            productionRoot: selectedPath,
            recentProductionRoots: [
                selectedPath,
                ...config.recentProductionRoots.filter((item) => item !== selectedPath),
            ].slice(0, 10),
        };
    const nextConfig = writeConfigFn({
        ...config,
        ...nextValues,
        pathProvenanceVersion: PATH_PROVENANCE_VERSION,
    });
    return { ok: true, canceled: false, mode, rootPath: selectedPath, config: nextConfig };
}

function readProductionState(rootPath, options = {}) {
    const root = assertDirectory(rootPath);
    const readProductionFolderFn = options.readProductionFolderFn || readProductionFolder;
    const readerState = readProductionFolderFn(root);

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

function listAssets(rootPath) {
    const root = assertDirectory(rootPath);
    return {
        ok: true,
        rootPath: root,
        assets: listFiles(root, { extensions: ASSET_EXTENSIONS }),
    };
}

function assertReadableFileInsideRoot(root, resolved) {
    const realRoot = fs.realpathSync.native(root);
    const components = path.relative(root, resolved).split(path.sep);
    let current = root;
    let stats;
    for (const [index, component] of components.entries()) {
        current = path.join(current, component);
        try {
            stats = fs.lstatSync(current);
        } catch {
            throw pathProvenanceError('READ_PATH_INVALID', 'Read path does not exist');
        }
        if (stats.isSymbolicLink()) {
            throw pathProvenanceError('READ_PATH_SYMLINK', 'Read path must not contain symlinks');
        }
        const isLeaf = index === components.length - 1;
        if ((!isLeaf && !stats.isDirectory()) || (isLeaf && !stats.isFile())) {
            throw pathProvenanceError('READ_PATH_INVALID', 'Read path has an invalid file type');
        }
        const realCurrent = fs.realpathSync.native(current);
        if (realCurrent !== realRoot && !realCurrent.startsWith(realRoot + path.sep)) {
            throw pathProvenanceError('READ_ROOT_ESCAPE', 'Read path escapes the configured production root');
        }
    }
    return stats;
}

function readJsonl(payload) {
    const { rootPath, relativePath } = payload || {};
    const root = assertTrustedDirectory(rootPath, 'READ_ROOT_INVALID').path;
    const { resolved, relativePath: safeRelativePath } = resolveInsideRoot(root, relativePath);
    const stats = assertReadableFileInsideRoot(root, resolved);
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

function configuredPath(options, field, code) {
    const config = getConfig(options);
    return assertTrustedDirectory(config[field], code).path;
}

function assertNoRendererPathArgument(value) {
    if (value !== undefined) {
        throw pathProvenanceError(
            'RENDERER_PATH_ARGUMENT_FORBIDDEN',
            'Renderer path arguments are not allowed for this operation',
        );
    }
}

function harnessContractEntry(rootPath, realRoot, contract) {
    const components = contract.relativePath.split('/');
    const absolutePath = path.join(rootPath, ...components);
    const base = {
        id: contract.id,
        path: absolutePath,
        relativePath: contract.relativePath,
        exists: false,
        size: 0,
        sha256: '',
        ready: false,
        reason: 'missing',
        liveSideEffect: contract.liveSideEffect === true,
    };

    let parent = rootPath;
    for (const component of components.slice(0, -1)) {
        parent = path.join(parent, component);
        try {
            const parentStats = fs.lstatSync(parent);
            if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
                return { ...base, reason: 'parent_not_directory' };
            }
        } catch {
            return base;
        }
    }

    let stats;
    try {
        stats = fs.lstatSync(absolutePath);
    } catch {
        return base;
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
        return { ...base, exists: true, size: stats.size, reason: 'not_regular_file' };
    }
    if (stats.size > MAX_HARNESS_CONTRACT_FILE_BYTES) {
        return { ...base, exists: true, size: stats.size, reason: 'file_too_large' };
    }

    let realPath;
    try {
        realPath = fs.realpathSync.native(absolutePath);
    } catch {
        return { ...base, exists: true, size: stats.size, reason: 'realpath_failed' };
    }
    if (!realPath.startsWith(realRoot + path.sep)) {
        return { ...base, exists: true, size: stats.size, reason: 'root_escape' };
    }
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        return { ...base, exists: true, size: stats.size, reason: 'nofollow_unavailable' };
    }

    let descriptor;
    try {
        descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const openedStats = fs.fstatSync(descriptor);
        if (!openedStats.isFile() || openedStats.size !== stats.size
            || openedStats.dev !== stats.dev || openedStats.ino !== stats.ino) {
            return { ...base, exists: true, size: openedStats.size, reason: 'file_changed' };
        }
        const content = fs.readFileSync(descriptor);
        if (content.byteLength > MAX_HARNESS_CONTRACT_FILE_BYTES) {
            return { ...base, exists: true, size: content.byteLength, reason: 'file_too_large' };
        }
        const text = content.toString('utf8');
        const malformed = text.includes('\0') || contract.requiredMarkers.some((marker) => !text.includes(marker));
        if (malformed) {
            return { ...base, exists: true, size: content.byteLength, reason: 'contract_markers_missing' };
        }
        return {
            ...base,
            exists: true,
            size: content.byteLength,
            sha256: crypto.createHash('sha256').update(content).digest('hex'),
            ready: true,
            reason: '',
        };
    } catch (error) {
        return { ...base, exists: true, size: stats.size, reason: error.code || 'read_failed' };
    } finally {
        if (descriptor !== undefined) {
            try {
                fs.closeSync(descriptor);
            } catch {}
        }
    }
}

function getHarnessContractStatus(options = {}) {
    const requestedRoot = options.harnessRoot === undefined ? HAPPY_VIDEO_FACTORY_ROOT : options.harnessRoot;
    const rootPath = typeof requestedRoot === 'string' ? requestedRoot : '';
    const blocked = (reason) => ({
        ok: false,
        readOnly: true,
        source: 'main_fixed_allowlist',
        rootPath,
        readiness: 'blocked',
        ready: false,
        reason,
        entries: HARNESS_CONTRACT_ALLOWLIST.map((contract) => ({
            id: contract.id,
            path: path.join(rootPath, ...contract.relativePath.split('/')),
            relativePath: contract.relativePath,
            exists: false,
            size: 0,
            sha256: '',
            ready: false,
            reason,
            liveSideEffect: contract.liveSideEffect === true,
        })),
    });

    if (typeof requestedRoot !== 'string' || !path.isAbsolute(rootPath) || path.normalize(rootPath) !== rootPath) {
        return blocked('root_invalid');
    }
    let rootStats;
    try {
        rootStats = fs.lstatSync(rootPath);
    } catch {
        return blocked('root_missing');
    }
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        return blocked('root_not_directory');
    }

    let realRoot;
    try {
        realRoot = fs.realpathSync.native(rootPath);
    } catch {
        return blocked('root_realpath_failed');
    }
    const entries = HARNESS_CONTRACT_ALLOWLIST.map((contract) => harnessContractEntry(rootPath, realRoot, contract));
    const readyCount = entries.filter((entry) => entry.ready).length;
    const readiness = readyCount === entries.length ? 'available' : readyCount > 0 ? 'partial' : 'blocked';
    return {
        ok: readiness === 'available',
        readOnly: true,
        source: 'main_fixed_allowlist',
        rootPath,
        readiness,
        ready: readiness === 'available',
        reason: readiness === 'available' ? '' : 'required_contract_unavailable',
        entries,
    };
}

function newProjectContext(options = {}) {
    return {
        userDataPath: options.userDataPath === undefined ? app.getPath('userData') : options.userDataPath,
        config: getConfig(options),
        harnessStatus: getHarnessContractStatus(options),
        clipboardApi: options.clipboardApi || clipboard,
        renameFile: options.renameFile,
        randomBytes: options.randomBytes,
    };
}

function getNewProjectDraftState(options = {}) {
    return newProjectDraftProvider.getNewProjectDraftState(newProjectContext(options));
}

function saveNewProjectDraft(payload, options = {}) {
    const result = newProjectDraftProvider.saveNewProjectDraft(payload, newProjectContext(options));
    sendProgress({
        phase: 'new-project-draft-saved',
        status: result.status,
        readiness: result.readiness,
        blockerCount: result.blockers.length,
        executed: false,
    });
    return result;
}

function copyNewProjectBuildCommand(options = {}) {
    const result = newProjectDraftProvider.copyNewProjectBuildCommand(newProjectContext(options));
    sendProgress({
        phase: result.copied ? 'new-project-command-copied' : 'new-project-command-copy-blocked',
        copied: result.copied,
        verified: result.verified,
        executed: false,
        length: result.length,
        byteLength: result.byteLength,
        sha256: result.sha256,
        error: result.error,
    });
    return result;
}

function listConfiguredProductionChildren(options = {}) {
    const parentRoot = configuredPath(options, 'productionParentRoot', 'PRODUCTION_PARENT_NOT_CONFIGURED');
    return listProductionChildren(parentRoot);
}

function readConfiguredProductionState(options = {}) {
    const productionRoot = configuredPath(options, 'productionRoot', 'PRODUCTION_ROOT_NOT_CONFIGURED');
    return readProductionState(productionRoot, options);
}

function getMediaRetryPlan(options = {}) {
    const productionRoot = configuredPath(options, 'productionRoot', 'PRODUCTION_ROOT_NOT_CONFIGURED');
    const result = buildMediaRetryPlan(productionRoot, {
        readProductionFolderFn: options.readProductionFolderFn,
    });
    sendProgress({
        phase: 'media-retry-plan-read',
        status: result.status,
        itemCount: result.items.length,
        blockerCount: result.blockers.length,
        executed: false,
    });
    return result;
}

function listConfiguredAssets(options = {}) {
    const productionRoot = configuredPath(options, 'productionRoot', 'PRODUCTION_ROOT_NOT_CONFIGURED');
    return listAssets(productionRoot);
}

function readConfiguredJsonl(payload, options = {}) {
    const productionRoot = configuredPath(options, 'productionRoot', 'PRODUCTION_ROOT_NOT_CONFIGURED');
    if (payload?.rootPath !== undefined && payload.rootPath !== productionRoot) {
        throw pathProvenanceError('READ_ROOT_MISMATCH', 'Read root does not match the configured production root');
    }
    return readJsonl({
        ...(payload || {}),
        rootPath: productionRoot,
    });
}

function writeConfiguredPlanningFile(payload, options = {}) {
    const productionRoot = configuredPath(options, 'productionRoot', 'PRODUCTION_ROOT_NOT_CONFIGURED');
    return writePlanningFile(payload, {
        ...options,
        configuredRoot: productionRoot,
    });
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

function copyCommandPreview(commandSpec = {}, clipboardApi = clipboard) {
    void commandSpec;
    void clipboardApi;
    return {
        ok: false,
        copied: false,
        verified: false,
        executed: false,
        error: 'COMMAND_COPY_REQUIRES_MAIN_OWNED_PLAN',
        length: 0,
        byteLength: 0,
        sha256: '',
    };
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

function g3ReviewContext(options = {}) {
    const appApi = options.appApi || app;
    return {
        config: getConfig(options),
        userDataPath: options.userDataPath || appApi.getPath('userData'),
        readProductionFolderFn: options.readProductionFolderFn,
        tokenSecret: options.g3TokenSecret,
        durationByRelativePath: options.g3DurationByRelativePath,
        now: options.g3Now,
        randomBytes: options.g3RandomBytes,
        renameFile: options.g3RenameFile,
        promotionPlanStore: options.g3PromotionPlanStore,
        promotionNowMs: options.g3PromotionNowMs,
        promotionPlanTtlMs: options.g3PromotionPlanTtlMs,
        promotionRandomBytes: options.g3PromotionRandomBytes,
        promotionPrivateRenameFile: options.g3PromotionPrivateRenameFile,
        promotionRenameFile: options.g3PromotionRenameFile,
    };
}

function getG3ReviewWorkspace(options = {}) {
    return g3ReviewDraftProvider.getG3ReviewWorkspace(g3ReviewContext(options));
}

function loadG3CandidatePreview(payload, options = {}) {
    const result = g3ReviewDraftProvider.loadG3CandidatePreview(payload, g3ReviewContext(options));
    sendProgress({ phase: result.loaded ? 'g3-preview-loaded' : 'g3-preview-blocked', executed: false });
    return result;
}

function saveG3ReviewDraft(payload, options = {}) {
    const result = g3ReviewDraftProvider.saveG3ReviewDraft(payload, g3ReviewContext(options));
    sendProgress({ phase: 'g3-draft-saved', shotCount: result.state?.selections?.length || 0, executed: false });
    return result;
}

function exportG3ReviewPacket(payload, options = {}) {
    const result = g3ReviewDraftProvider.exportG3ReviewPacket(payload, g3ReviewContext(options));
    sendProgress({ phase: 'g3-draft-exported', promotionReady: false, executed: false });
    return result;
}

function planG3ProductionPromotion(options = {}) {
    const result = g3ProductionPromotionProvider.planG3ProductionPromotion(g3ReviewContext(options));
    sendProgress({
        phase: result.ok ? 'g3-promotion-plan-ready' : 'g3-promotion-plan-blocked',
        alreadyCurrent: result.already_current === true,
        executed: false,
    });
    return result;
}

function promoteG3ProductionSelection(payload, options = {}) {
    const result = g3ProductionPromotionProvider.promoteG3ProductionSelection(payload, g3ReviewContext(options));
    sendProgress({
        phase: result.already_current ? 'g3-promotion-already-current' : 'g3-production-promoted',
        promoted: result.promoted === true,
        executed: result.executed === true,
    });
    return result;
}

function finishingWorkbench(options = {}) {
    return createFinishingWorkbenchProvider({
        config: getConfig(options),
        harnessRoot: options.finishingHarnessRoot,
        adapterPath: options.finishingAdapterPath,
        runtimeResolver: options.finishingRuntimeResolver,
        mediaProbe: options.finishingMediaProbe,
        render: options.finishingRender,
        now: options.finishingNow,
        nowMs: options.finishingNowMs,
        randomBytes: options.finishingRandomBytes,
        planStore: options.finishingPlanStore,
        planTtlMs: options.finishingPlanTtlMs,
        currentGraphLinkSync: options.finishingCurrentGraphLinkSync,
        currentGraphBeforeCommitPublish: options.finishingCurrentGraphBeforeCommitPublish,
        currentCacheRenameSync: options.finishingCurrentCacheRenameSync,
    });
}

async function getFinishingWorkspace(options = {}) {
    return finishingWorkbench(options).getWorkspace();
}

async function planFinishingRun(options = {}) {
    const result = await finishingWorkbench(options).plan();
    sendProgress({
        phase: result.ready ? 'finishing-plan-ready' : result.already_current ? 'finishing-already-current' : 'finishing-plan-blocked',
        ready: result.ready === true,
        alreadyCurrent: result.already_current === true,
        executed: false,
    });
    return result;
}

async function executeFinishingRun(payload, options = {}) {
    sendProgress({ phase: 'finishing-executing', executed: false });
    try {
        const result = await finishingWorkbench(options).execute(payload);
        sendProgress({
            phase: result.already_current ? 'finishing-already-current' : 'finishing-execution-succeeded',
            executed: result.executed === true,
            freshProbeVerified: result.fresh_probe_verified === true,
            outputQualityApproved: false,
        });
        return result;
    } catch (error) {
        sendProgress({ phase: 'finishing-execution-failed', executed: false, error: error.code || 'FINISHING_EXECUTION_FAILED' });
        throw error;
    }
}

function register(ipcApi = ipcMain, options = {}) {
    ipcApi.handle('film-pipeline:get-config', () => getConfig(options));
    ipcApi.handle('film-pipeline:get-harness-contract-status', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return getHarnessContractStatus(options);
    });
    ipcApi.handle('film-pipeline:get-new-project-draft-state', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return getNewProjectDraftState(options);
    });
    ipcApi.handle('film-pipeline:save-new-project-draft', (_, payload) => saveNewProjectDraft(payload, options));
    ipcApi.handle('film-pipeline:copy-new-project-build-command', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return copyNewProjectBuildCommand(options);
    });
    ipcApi.handle('film-pipeline:select-production-root', (_, request) => selectProductionRoot(request, options));
    ipcApi.handle('film-pipeline:read-production-state', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return readConfiguredProductionState(options);
    });
    ipcApi.handle('film-pipeline:get-media-retry-plan', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return getMediaRetryPlan(options);
    });
    ipcApi.handle('film-pipeline:list-production-children', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return listConfiguredProductionChildren(options);
    });
    ipcApi.handle('film-pipeline:write-planning-file', (_, payload) => writeConfiguredPlanningFile(payload, options));
    ipcApi.handle('film-pipeline:list-assets', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return listConfiguredAssets(options);
    });
    ipcApi.handle('film-pipeline:read-jsonl', (_, payload) => readConfiguredJsonl(payload, options));
    ipcApi.handle('film-pipeline:preview-command', (_, commandSpec) => previewCommand(commandSpec));
    ipcApi.handle('film-pipeline:copy-command-preview', (_, commandSpec) => copyCommandPreview(commandSpec));
    ipcApi.handle('film-pipeline:run-safe-command', (_, commandSpec) => runSafeCommand(commandSpec));
    ipcApi.handle('film-pipeline:get-g3-review-workspace', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return getG3ReviewWorkspace(options);
    });
    ipcApi.handle('film-pipeline:load-g3-candidate-preview', (_, payload) => loadG3CandidatePreview(payload, options));
    ipcApi.handle('film-pipeline:save-g3-review-draft', (_, payload) => saveG3ReviewDraft(payload, options));
    ipcApi.handle('film-pipeline:export-g3-review-packet', (_, payload) => exportG3ReviewPacket(payload, options));
    ipcApi.handle('film-pipeline:plan-g3-production-promotion', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return planG3ProductionPromotion(options);
    });
    ipcApi.handle('film-pipeline:promote-g3-production-selection', (_, payload) => promoteG3ProductionSelection(payload, options));
    ipcApi.handle('film-pipeline:get-finishing-workspace', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return getFinishingWorkspace(options);
    });
    ipcApi.handle('film-pipeline:plan-finishing-run', (_, pathArgument) => {
        assertNoRendererPathArgument(pathArgument);
        return planFinishingRun(options);
    });
    ipcApi.handle('film-pipeline:execute-finishing-run', (_, payload) => executeFinishingRun(payload, options));
}

module.exports = {
    register,
    sanitizeConfig,
    selectProductionRoot,
    writePlanningFile,
    writeConfiguredPlanningFile,
    sideEffectClassifier,
    previewCommand,
    copyCommandPreview,
    runSafeCommand,
    listProductionChildren,
    listConfiguredProductionChildren,
    readConfiguredProductionState,
    getMediaRetryPlan,
    listConfiguredAssets,
    readConfiguredJsonl,
    resolveProductionDialogDefaultPath,
    getHarnessContractStatus,
    getNewProjectDraftState,
    saveNewProjectDraft,
    copyNewProjectBuildCommand,
    getG3ReviewWorkspace,
    loadG3CandidatePreview,
    saveG3ReviewDraft,
    exportG3ReviewPacket,
    planG3ProductionPromotion,
    promoteG3ProductionSelection,
    getFinishingWorkspace,
    planFinishingRun,
    executeFinishingRun,
    HARNESS_CONTRACT_ALLOWLIST,
    HAPPY_VIDEO_FACTORY_ROOT,
};
