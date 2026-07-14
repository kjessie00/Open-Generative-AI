const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const MAX_ENCODED_BYTES = Math.ceil(MAX_PREVIEW_BYTES / 3) * 4;
const DECODE_QUANTUM_CHARS = 32 * 1024;
const ALLOWED_MIME_TYPES = new Set([
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-m4v',
]);
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function failedPreview() {
    return { ok: false, url: '', mimeType: '', byteLength: 0, dispose() {} };
}

function canonicalBase64(value, byteLength) {
    if (typeof value !== 'string' || !value.length || value.length > MAX_ENCODED_BYTES
        || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
        || value.length !== Math.ceil(byteLength / 3) * 4) return false;
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    if (padding !== (3 - (byteLength % 3)) % 3) return false;
    const significantIndex = padding === 2 ? value.length - 3 : padding === 1 ? value.length - 2 : -1;
    if (significantIndex < 0) return true;
    const sextet = BASE64_ALPHABET.indexOf(value[significantIndex]);
    return sextet >= 0 && (padding === 2 ? (sextet & 15) === 0 : (sextet & 3) === 0);
}

export function createG3PreviewObjectUrl(preview, dependencies) {
    const runtime = dependencies ?? {
        atob: typeof globalThis.atob === 'function' ? globalThis.atob.bind(globalThis) : globalThis.atob,
        Blob: globalThis.Blob,
        URL: globalThis.URL,
    };
    const byteLength = preview?.byte_length;
    if (preview?.loaded !== true || !ALLOWED_MIME_TYPES.has(preview?.mime_type)
        || !Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > MAX_PREVIEW_BYTES
        || !canonicalBase64(preview?.base64, byteLength)
        || typeof runtime.atob !== 'function' || typeof runtime.Blob !== 'function'
        || typeof runtime.URL?.createObjectURL !== 'function' || typeof runtime.URL?.revokeObjectURL !== 'function') {
        return failedPreview();
    }

    let objectUrl = '';
    try {
        const chunks = [];
        let decodedLength = 0;
        for (let offset = 0; offset < preview.base64.length; offset += DECODE_QUANTUM_CHARS) {
            const binary = runtime.atob(preview.base64.slice(offset, offset + DECODE_QUANTUM_CHARS));
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            decodedLength += bytes.byteLength;
            if (decodedLength > byteLength) return failedPreview();
            chunks.push(bytes);
        }
        if (decodedLength !== byteLength) return failedPreview();
        const blob = new runtime.Blob(chunks, { type: preview.mime_type });
        if (blob.size !== byteLength || blob.type !== preview.mime_type) return failedPreview();
        objectUrl = runtime.URL.createObjectURL(blob);
        if (typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:')) {
            if (typeof objectUrl === 'string' && objectUrl) runtime.URL.revokeObjectURL(objectUrl);
            return failedPreview();
        }
        let disposed = false;
        return {
            ok: true,
            url: objectUrl,
            mimeType: preview.mime_type,
            byteLength,
            dispose() {
                if (disposed) return;
                disposed = true;
                runtime.URL.revokeObjectURL(objectUrl);
            },
        };
    } catch {
        if (objectUrl) {
            try {
                runtime.URL.revokeObjectURL(objectUrl);
            } catch {
                // Revocation is best-effort after a platform URL API failure.
            }
        }
        return failedPreview();
    }
}
