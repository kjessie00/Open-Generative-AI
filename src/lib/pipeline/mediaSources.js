const ABSOLUTE_MACOS_PATH = /^\/(?!\/)/;
const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpeg|webp|gif|avif|apng)(?:[;,])/i;
const SAFE_VIDEO_DATA = /^data:video\/(?:mp4|webm|quicktime)(?:[;,])/i;

function safeFileUrl(source) {
    try {
        const url = new URL(source);
        return url.protocol === 'file:' && (!url.hostname || url.hostname === 'localhost');
    } catch {
        return false;
    }
}

/**
 * Return a renderer-safe source without resolving or reading the recorded path.
 * Relative artifact paths remain metadata until the main process exposes a
 * deliberately scoped media protocol or another explicit local source.
 */
export function localMediaSource(source, kind = '') {
    if (typeof source !== 'string') return '';
    const value = source.trim();
    if (!value) return '';

    if (ABSOLUTE_MACOS_PATH.test(value)) return value;
    if (/^file:/i.test(value)) return safeFileUrl(value) ? value : '';
    if (/^blob:/i.test(value)) return value;
    if (/^data:/i.test(value)) {
        if (kind === 'image') return SAFE_IMAGE_DATA.test(value) ? value : '';
        if (kind === 'video') return SAFE_VIDEO_DATA.test(value) ? value : '';
        return SAFE_IMAGE_DATA.test(value) || SAFE_VIDEO_DATA.test(value) ? value : '';
    }

    return '';
}

export default localMediaSource;
