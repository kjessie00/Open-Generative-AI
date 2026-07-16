const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function createFinalRenderStreamPreview(preview) {
    const empty = { ok: false, url: '', dispose() {} };
    if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return empty;
    if (Object.keys(preview).sort().join(',') !== 'byte_length,mime_type,ready,stream_url') return empty;
    if (preview.ready !== true || preview.mime_type !== 'video/mp4'
        || !Number.isSafeInteger(preview.byte_length) || preview.byte_length <= 0
        || typeof preview.stream_url !== 'string') return empty;
    let parsed;
    try { parsed = new URL(preview.stream_url); } catch { return empty; }
    const parts = parsed.pathname.match(/^\/([a-f0-9]{64})\/video\.mp4$/);
    if (parsed.protocol !== 'film-preview:' || parsed.hostname !== 'final-render' || parsed.port
        || parsed.username || parsed.password || parsed.search || parsed.hash
        || !parts || !TOKEN_PATTERN.test(parts[1])
        || parsed.href !== preview.stream_url) return empty;
    return { ok: true, url: preview.stream_url, dispose() {} };
}

export default createFinalRenderStreamPreview;
