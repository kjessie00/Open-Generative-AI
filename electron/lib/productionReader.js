const fs = require('fs');
const path = require('path');

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_WALK_FILES = 1200;
const MAX_WALK_DEPTH = 8;

const BLOCKERS = Object.freeze({
    MISSING_PRODUCTION_BRIEF: 'MISSING_PRODUCTION_BRIEF',
    MISSING_STORYBOARD_CONTINUITY_PACKET: 'MISSING_STORYBOARD_CONTINUITY_PACKET',
    MISSING_MOTION_BOARD: 'MISSING_MOTION_BOARD',
    MISSING_IMAGE_DASHBOARD: 'MISSING_IMAGE_DASHBOARD',
    MISSING_ACCEPTED_SECONDS: 'MISSING_ACCEPTED_SECONDS',
    OUTPUT_QUALITY_NOT_PROVEN: 'OUTPUT_QUALITY_NOT_PROVEN',
});

const SENSITIVE_NAME_PATTERNS = [
    /cookie/i,
    /browser[-_ ]?profile/i,
    /auth[-_ ]?bundle/i,
    /session[-_ ]?(zip|bundle|profile)?/i,
    /token/i,
    /secret/i,
    /credential/i,
];

function isSensitiveName(name) {
    return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(name)) || name.toLowerCase().endsWith('.zip');
}

function assertDirectory(rootPath) {
    if (typeof rootPath !== 'string' || !rootPath.trim()) {
        throw new Error('rootPath must be a non-empty string');
    }
    const absolute = path.resolve(rootPath);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
        throw new Error(`Production folder does not exist: ${absolute}`);
    }
    return absolute;
}

function existsFile(filePath) {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function existsDir(dirPath) {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function safeRelative(root, filePath) {
    return path.relative(root, filePath);
}

function safeReadText(filePath) {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_TEXT_BYTES) {
        return { ok: false, error: `file too large: ${stats.size} bytes` };
    }
    return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
}

function markdownRecord(root, filePath, label) {
    if (!filePath || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
        return null;
    }
    const stats = fs.statSync(filePath);
    const read = safeReadText(filePath);
    const heading = read.ok
        ? read.content.split(/\r?\n/).find((line) => /^#{1,3}\s+/.test(line.trim()))?.replace(/^#{1,3}\s+/, '').trim() || ''
        : '';
    return {
        label,
        path: filePath,
        relative_path: safeRelative(root, filePath),
        exists: true,
        parsed: read.ok,
        heading,
        line_count: read.ok ? read.content.split(/\r?\n/).length : 0,
        updated_at: stats.mtime.toISOString(),
        error: read.ok ? '' : read.error,
    };
}

function walkFiles(root, options = {}) {
    const files = [];
    const maxDepth = options.maxDepth ?? MAX_WALK_DEPTH;
    const maxFiles = options.maxFiles ?? MAX_WALK_FILES;

    function walk(dir, depth) {
        if (files.length >= maxFiles || depth > maxDepth) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (files.length >= maxFiles) break;
            if (entry.name === '.git' || entry.name === 'node_modules' || isSensitiveName(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath, depth + 1);
                continue;
            }
            if (isSensitiveName(entry.name)) continue;
            const stats = fs.statSync(fullPath);
            files.push({
                path: fullPath,
                relative_path: safeRelative(root, fullPath),
                name: entry.name,
                extension: path.extname(entry.name).toLowerCase(),
                size: stats.size,
                updated_at: stats.mtime.toISOString(),
            });
        }
    }

    walk(root, 0);
    return files;
}

function findFirst(root, relativeCandidates) {
    for (const relativePath of relativeCandidates) {
        const filePath = path.join(root, relativePath);
        if (existsFile(filePath) && !isSensitiveName(path.basename(filePath))) return filePath;
    }
    return null;
}

function findByName(files, names) {
    const wanted = new Set(names);
    return files.find((file) => wanted.has(file.name))?.path || null;
}

function parseJsonFile(root, filePath, label) {
    if (!filePath || !existsFile(filePath)) {
        return { label, path: '', exists: false, parsed: false, value: null, error: 'missing' };
    }
    const read = safeReadText(filePath);
    const stats = fs.statSync(filePath);
    if (!read.ok) {
        return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, value: null, updated_at: stats.mtime.toISOString(), error: read.error };
    }
    try {
        return {
            label,
            path: filePath,
            relative_path: safeRelative(root, filePath),
            exists: true,
            parsed: true,
            value: JSON.parse(read.content),
            updated_at: stats.mtime.toISOString(),
            error: '',
        };
    } catch (error) {
        return {
            label,
            path: filePath,
            relative_path: safeRelative(root, filePath),
            exists: true,
            parsed: false,
            value: null,
            updated_at: stats.mtime.toISOString(),
            error: error.message,
        };
    }
}

function parseImageDashboardJs(root, filePath) {
    if (!filePath || !existsFile(filePath)) {
        return { label: 'image-dashboard-data.js', path: '', exists: false, parsed: false, value: null, error: 'missing' };
    }
    const stats = fs.statSync(filePath);
    const read = safeReadText(filePath);
    if (!read.ok) {
        return { label: 'image-dashboard-data.js', path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, value: null, updated_at: stats.mtime.toISOString(), error: read.error };
    }

    const withoutExport = read.content
        .replace(/^\s*export\s+default\s+/, '')
        .replace(/^\s*module\.exports\s*=\s*/, '')
        .replace(/^\s*(const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*/, '');
    const firstObject = withoutExport.search(/[\[{]/);
    const lastObject = Math.max(withoutExport.lastIndexOf('}'), withoutExport.lastIndexOf(']'));

    if (firstObject < 0 || lastObject < firstObject) {
        return { label: 'image-dashboard-data.js', path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, value: null, updated_at: stats.mtime.toISOString(), error: 'no JSON object found' };
    }

    const jsonSlice = withoutExport.slice(firstObject, lastObject + 1);
    try {
        return {
            label: 'image-dashboard-data.js',
            path: filePath,
            relative_path: safeRelative(root, filePath),
            exists: true,
            parsed: true,
            value: JSON.parse(jsonSlice),
            updated_at: stats.mtime.toISOString(),
            error: '',
        };
    } catch (error) {
        return {
            label: 'image-dashboard-data.js',
            path: filePath,
            relative_path: safeRelative(root, filePath),
            exists: true,
            parsed: false,
            value: null,
            updated_at: stats.mtime.toISOString(),
            error: error.message,
        };
    }
}

function parseJsonl(root, filePath, label) {
    if (!filePath || !existsFile(filePath)) {
        return { label, path: '', exists: false, parsed: false, records: [], errors: ['missing'] };
    }
    const read = safeReadText(filePath);
    if (!read.ok) {
        return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, records: [], errors: [read.error] };
    }

    const records = [];
    const errors = [];
    read.content.split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        try {
            records.push(JSON.parse(line));
        } catch (error) {
            errors.push(`line ${index + 1}: ${error.message}`);
        }
    });

    return {
        label,
        path: filePath,
        relative_path: safeRelative(root, filePath),
        exists: true,
        parsed: errors.length === 0,
        records,
        errors,
    };
}

function parseCsv(root, filePath, label) {
    if (!filePath || !existsFile(filePath)) {
        return { label, path: '', exists: false, parsed: false, records: [], errors: ['missing'] };
    }
    const read = safeReadText(filePath);
    if (!read.ok) {
        return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, records: [], errors: [read.error] };
    }
    const lines = read.content.split(/\r?\n/).filter((line) => line.trim());
    const headers = splitCsvLine(lines[0] || '');
    const records = lines.slice(1).map((line) => {
        const cells = splitCsvLine(line);
        return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
    });
    return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: headers.length > 0, records, errors: [] };
}

function splitCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"' && next === '"') {
            current += '"';
            i += 1;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells.map((cell) => cell.trim());
}

function parseAcceptedSeconds(root, filePath) {
    const record = markdownRecord(root, filePath, 'accepted_seconds.md');
    if (!record) return { exists: false, parsed: false, records: [], path: '', relative_path: '', error: 'missing' };
    const read = safeReadText(filePath);
    if (!read.ok) return { ...record, records: [], error: read.error };

    const rows = read.content.split(/\r?\n/)
        .filter((line) => /^\|/.test(line.trim()) && !/^\|\s*-/.test(line.trim()))
        .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
        .filter((cells) => cells.length >= 4);
    const [header, ...body] = rows;
    const records = header ? body.map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] || '']))) : [];

    return { ...record, parsed: true, records, error: '' };
}

function parseBlockers(root, filePath) {
    const record = markdownRecord(root, filePath, 'blockers.md');
    if (!record) return { exists: false, parsed: false, blockers: [], path: '', relative_path: '', error: 'missing' };
    const read = safeReadText(filePath);
    if (!read.ok) return { ...record, blockers: [], error: read.error };
    const blockers = Array.from(new Set(read.content.match(/[A-Z][A-Z0-9_]{4,}/g) || []));
    return { ...record, parsed: true, blockers, error: '' };
}

function detectLayout(root) {
    const base = path.basename(root);
    const parent = path.basename(path.dirname(root));
    const looksLikeRun = /^\d{8}-.+/.test(base) || parent === 'short_drama_pipeline_runs';
    const hasLayoutADirs = ['intake', 'storyboard', 'prompts', 'generated', 'final', 'qa'].filter((name) => existsDir(path.join(root, name))).length >= 3;
    const hasLayoutBMarkers = existsFile(path.join(root, 'brief.md')) || existsDir(path.join(root, 'assets')) || existsDir(path.join(root, 'dreamina_outputs'));
    const nestedProduction = path.join(root, 'production');

    if (!hasLayoutBMarkers && existsDir(nestedProduction) && (existsFile(path.join(nestedProduction, 'brief.md')) || existsDir(path.join(nestedProduction, 'assets')))) {
        return { layout: 'B', root: nestedProduction, selectedRoot: root };
    }
    if (hasLayoutBMarkers) return { layout: 'B', root, selectedRoot: root };
    if (looksLikeRun || hasLayoutADirs) return { layout: 'A', root, selectedRoot: root };
    return { layout: 'unknown', root, selectedRoot: root };
}

function deriveMarkdown(root, layout, files) {
    const markdown = {};
    if (layout === 'A') {
        markdown.intake = markdownRecord(root, findFirst(root, ['intake/brief.md', 'intake/intake.md', 'brief.md']), 'intake');
        markdown.script = markdownRecord(root, findFirst(root, ['intake/script.md', 'script.md']), 'script');
        markdown.report = markdownRecord(root, findFirst(root, ['report.md', 'final/report.md']), 'report');
    } else {
        markdown.brief = markdownRecord(root, findFirst(root, ['brief.md']), 'brief');
        markdown.script = markdownRecord(root, findFirst(root, ['script.md']), 'script');
        markdown.report = markdownRecord(root, findFirst(root, ['report.md', 'final/report.md', 'edit/report.md']), 'report');
    }

    for (const file of files.filter((item) => item.extension === '.md')) {
        if (!Object.values(markdown).some((record) => record?.path === file.path)) {
            markdown[file.relative_path] = markdownRecord(root, file.path, file.relative_path);
        }
    }
    return Object.fromEntries(Object.entries(markdown).filter(([, value]) => Boolean(value)));
}

function readProductionFolder(rootPath) {
    const selectedRoot = assertDirectory(rootPath);
    const detected = detectLayout(selectedRoot);
    const root = detected.root;
    const files = walkFiles(root);
    const markdown = deriveMarkdown(root, detected.layout, files);

    const storyboardJson = parseJsonFile(root, findFirst(root, [
        'storyboard/storyboard.json',
        'storyboard/clips.json',
        'storyboard.json',
    ]) || findByName(files, ['storyboard.json']), 'storyboard JSON');
    const motionBoardJson = parseJsonFile(root, findFirst(root, [
        'motion_board/motion_board.json',
        'motion_board/shots.json',
        'motion_board.json',
    ]) || findByName(files, ['motion_board.json']), 'motion board JSON');
    const imageDashboard = parseImageDashboardJs(root, findFirst(root, [
        'image_dashboard/image-dashboard-data.js',
        'image_dashboard/image_dashboard_data.js',
        'image-dashboard-data.js',
    ]) || findByName(files, ['image-dashboard-data.js', 'image_dashboard_data.js']));
    const submitRecords = parseJsonl(root, findByName(files, ['submit_records.jsonl']), 'submit_records.jsonl');
    const heartbeatLog = parseJsonl(root, findByName(files, ['heartbeat_log.jsonl']), 'heartbeat_log.jsonl');
    const costLedgerJsonl = parseJsonl(root, findByName(files, ['cost_ledger.jsonl']), 'cost_ledger.jsonl');
    const ledgerCsv = parseCsv(root, findFirst(root, ['ledger.csv']) || findByName(files, ['ledger.csv']), 'ledger.csv');
    const acceptedSeconds = parseAcceptedSeconds(root, findFirst(root, ['edit/accepted_seconds.md', 'qa/accepted_seconds.md', 'accepted_seconds.md']) || findByName(files, ['accepted_seconds.md']));
    const blockersMd = parseBlockers(root, findFirst(root, ['blockers.md', 'qa/blockers.md', 'reviews/blockers.md']) || findByName(files, ['blockers.md']));
    const report = markdownRecord(root, findFirst(root, ['report.md', 'final/report.md', 'edit/report.md']) || findByName(files, ['report.md']), 'report.md');

    const blockers = [];
    if (!markdown.brief && !markdown.intake) blockers.push(BLOCKERS.MISSING_PRODUCTION_BRIEF);
    if (!storyboardJson.parsed) blockers.push(BLOCKERS.MISSING_STORYBOARD_CONTINUITY_PACKET);
    if (!motionBoardJson.parsed) blockers.push(BLOCKERS.MISSING_MOTION_BOARD);
    if (!imageDashboard.parsed) blockers.push(BLOCKERS.MISSING_IMAGE_DASHBOARD);
    if (!acceptedSeconds.records?.length) blockers.push(BLOCKERS.MISSING_ACCEPTED_SECONDS);
    if (!report?.exists) blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
    blockers.push(...(blockersMd.blockers || []));

    return {
        ok: true,
        rootPath: root,
        selectedRoot: detected.selectedRoot,
        layout: detected.layout,
        readAt: new Date().toISOString(),
        files,
        markdown,
        parsed: {
            storyboardJson,
            motionBoardJson,
            imageDashboard,
            submitRecords,
            heartbeatLog,
            costLedgerJsonl,
            ledgerCsv,
            acceptedSeconds,
            blockersMd,
            report,
        },
        blockers: Array.from(new Set(blockers)),
        security: {
            skipped_sensitive_patterns: SENSITIVE_NAME_PATTERNS.map((pattern) => pattern.toString()),
            max_text_bytes: MAX_TEXT_BYTES,
        },
    };
}

module.exports = {
    readProductionFolder,
    detectLayout,
    isSensitiveName,
};
