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
    /api[-_ ]?key/i,
    /private[-_ ]?key/i,
    /^\.env(?:\.|$)/i,
    /^id_rsa(?:\.|$)/i,
];

function isSensitiveName(name) {
    return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(name)) || name.toLowerCase().endsWith('.zip');
}

function assertDirectory(rootPath) {
    if (typeof rootPath !== 'string' || !rootPath.trim()) {
        throw new Error('rootPath must be a non-empty string');
    }
    const absolute = path.resolve(rootPath);
    let stats;
    try {
        stats = fs.lstatSync(absolute);
    } catch {
        stats = null;
    }
    if (!stats?.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`Production folder does not exist: ${absolute}`);
    }
    if (isSensitiveName(path.basename(absolute))) {
        throw new Error('Production folder rejected by safety policy');
    }
    return absolute;
}

function existsFile(filePath) {
    try {
        const stats = fs.lstatSync(filePath);
        return stats.isFile() && !stats.isSymbolicLink();
    } catch {
        return false;
    }
}

function existsDir(dirPath) {
    try {
        const stats = fs.lstatSync(dirPath);
        return stats.isDirectory() && !stats.isSymbolicLink();
    } catch {
        return false;
    }
}

function safeRelative(root, filePath) {
    return path.relative(root, filePath);
}

function isWithinRoot(root, filePath) {
    const relative = safeRelative(root, filePath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeReadText(filePath) {
    const stats = fs.statSync(filePath);
    if (stats.size > MAX_TEXT_BYTES) {
        return { ok: false, error: `file too large: ${stats.size} bytes` };
    }
    return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
}

function markdownRecord(root, filePath, label) {
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
        return null;
    }
    const stats = fs.statSync(filePath);
    const read = safeReadText(filePath);
    const lines = read.ok ? read.content.split(/\r?\n/) : [];
    const heading = lines.find((line) => /^#{1,3}\s+/.test(line.trim()))?.replace(/^#{1,3}\s+/, '').trim() || '';
    const metadata = {};
    for (const line of lines) {
        const match = line.match(/^\s*(concept|logline)\s*:\s*(.+?)\s*$/i);
        if (match) metadata[match[1].toLowerCase()] = match[2];
    }
    return {
        label,
        path: filePath,
        relative_path: safeRelative(root, filePath),
        exists: true,
        parsed: read.ok,
        heading,
        metadata,
        line_count: read.ok ? read.content.split(/\r?\n/).length : 0,
        updated_at: stats.mtime.toISOString(),
        error: read.ok ? '' : read.error,
    };
}

function walkFiles(root, options = {}) {
    const files = [];
    const maxDepth = options.maxDepth ?? MAX_WALK_DEPTH;
    const maxFiles = options.maxFiles ?? MAX_WALK_FILES;
    const skipped = {
        sensitive_name: 0,
        ignored_directory: 0,
        symlink: 0,
        unsupported_entry: 0,
        root_escape: 0,
        depth_limit: 0,
        file_limit: 0,
        read_error: 0,
    };
    const errors = [];
    let truncated = false;

    function walk(dir, depth) {
        if (files.length >= maxFiles) {
            truncated = true;
            skipped.file_limit += 1;
            return;
        }
        if (depth > maxDepth) {
            truncated = true;
            skipped.depth_limit += 1;
            return;
        }
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            skipped.read_error += 1;
            errors.push({ relative_path: safeRelative(root, dir), code: error.code || 'READ_ERROR' });
            return;
        }
        for (const entry of entries) {
            if (files.length >= maxFiles) {
                truncated = true;
                skipped.file_limit += 1;
                break;
            }
            if (entry.name === '.git' || entry.name === 'node_modules') {
                skipped.ignored_directory += 1;
                continue;
            }
            if (isSensitiveName(entry.name)) {
                skipped.sensitive_name += 1;
                continue;
            }
            const fullPath = path.join(dir, entry.name);
            if (!isWithinRoot(root, fullPath)) {
                skipped.root_escape += 1;
                continue;
            }
            if (entry.isSymbolicLink()) {
                skipped.symlink += 1;
                continue;
            }
            if (entry.isDirectory()) {
                walk(fullPath, depth + 1);
                continue;
            }
            if (!entry.isFile()) {
                skipped.unsupported_entry += 1;
                continue;
            }
            let stats;
            try {
                stats = fs.lstatSync(fullPath);
            } catch (error) {
                skipped.read_error += 1;
                errors.push({ relative_path: safeRelative(root, fullPath), code: error.code || 'READ_ERROR' });
                continue;
            }
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
    return { files, skipped, truncated, errors, maxDepth, maxFiles };
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
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
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
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
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
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
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
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
        return { label, path: '', exists: false, parsed: false, records: [], errors: ['missing'] };
    }
    const read = safeReadText(filePath);
    if (!read.ok) {
        return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, records: [], errors: [read.error] };
    }
    const lines = read.content.split(/\r?\n/).filter((line) => line.trim());
    const headers = splitCsvLine(lines[0] || '').filter(Boolean);
    const records = lines.slice(1).map((line) => {
        const cells = splitCsvLine(line);
        return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
    });
    const errors = headers.length ? [] : ['missing CSV header'];
    return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: errors.length === 0, records, errors };
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
    const normalizedHeader = (header || []).map((value) => value.toLowerCase().replace(/\s+/g, '_'));
    const required = ['clip_id', 'source_file', 'in_time', 'out_time'];
    const missingHeaders = required.filter((name) => !normalizedHeader.includes(name));
    const records = header ? body.map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] || '']))) : [];

    return {
        ...record,
        parsed: Boolean(header) && missingHeaders.length === 0,
        records: missingHeaders.length ? [] : records,
        error: missingHeaders.length ? `missing required table headers: ${missingHeaders.join(', ')}` : '',
    };
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

function readProductionFolder(rootPath, options = {}) {
    const selectedRoot = assertDirectory(rootPath);
    const detected = detectLayout(selectedRoot);
    const root = detected.root;
    const walkResult = walkFiles(root, options);
    const files = walkResult.files;
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
            max_walk_files: walkResult.maxFiles,
            max_walk_depth: walkResult.maxDepth,
            skipped: walkResult.skipped,
            skipped_total: Object.values(walkResult.skipped).reduce((sum, value) => sum + value, 0),
            walk_truncated: walkResult.truncated,
            walk_errors: walkResult.errors,
        },
    };
}

module.exports = {
    readProductionFolder,
    detectLayout,
    isSensitiveName,
    MAX_WALK_FILES,
    MAX_WALK_DEPTH,
};
