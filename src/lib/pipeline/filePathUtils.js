export function normalizeSlashes(pathValue = '') {
    return String(pathValue || '').replace(/\\/g, '/');
}

export function basename(pathValue = '') {
    const normalized = normalizeSlashes(pathValue);
    return normalized.split('/').filter(Boolean).pop() || '';
}

export function dirname(pathValue = '') {
    const normalized = normalizeSlashes(pathValue);
    const parts = normalized.split('/').filter(Boolean);
    parts.pop();
    const prefix = normalized.startsWith('/') ? '/' : '';
    return prefix + parts.join('/');
}

export function joinPath(...parts) {
    const joined = parts
        .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
        .map((part) => normalizeSlashes(part).replace(/^\/+|\/+$/g, ''))
        .join('/');
    return parts[0] && String(parts[0]).startsWith('/') ? `/${joined}` : joined;
}

export function toDisplayPath(pathValue = '', rootPath = '') {
    const normalized = normalizeSlashes(pathValue);
    const root = normalizeSlashes(rootPath);
    if (root && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
    return normalized;
}

export function looksSensitivePath(pathValue = '') {
    const normalized = normalizeSlashes(pathValue).toLowerCase();
    return [
        'cookie',
        'browser_profile',
        'browser-profile',
        'auth_bundle',
        'auth-bundle',
        'session.zip',
        'token',
        'secret',
        'credential',
    ].some((needle) => normalized.includes(needle)) || normalized.endsWith('.zip');
}

export function fileExistsStatus(record) {
    if (!record) return { exists: false, parsed: false };
    return {
        exists: record.exists === true || Boolean(record.path),
        parsed: record.parsed === true,
        path: record.path || '',
        error: record.error || '',
    };
}
