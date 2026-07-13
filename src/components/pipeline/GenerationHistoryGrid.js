import { actionButton, card, el, emptyState, statusBadge } from './ui.js';
import { p } from './copy.js';

function isVideo(path = '') {
    return /\.(mp4|mov|webm)$/i.test(path);
}

function isImage(path = '') {
    return /\.(png|jpe?g|webp|gif|avif|apng)$/i.test(path);
}

function deriveHistoryItems(state = {}, payload = {}) {
    const explicit = state.generationHistory || state.generation_history || [];
    const items = explicit.map((item, index) => ({
        id: item.id || `history_${index + 1}`,
        label: item.label || item.clip_id || `History ${index + 1}`,
        path: item.url || item.path || item.file_path || '',
        type: item.type || (isVideo(item.url || item.path || '') ? 'video' : 'image'),
        status: item.status || 'preview',
        source: 'history',
    }));

    (state.heartbeatRecords || []).forEach((record) => {
        (record.downloaded_files || []).forEach((path, index) => {
            items.push({
                id: `${record.clip_id || 'clip'}_download_${index + 1}`,
                label: p('{clip} downloaded file', { clip: record.clip_id || 'clip' }),
                path,
                type: isVideo(path) ? 'video' : 'asset',
                status: record.gen_status || 'downloaded',
                source: 'heartbeat_log',
            });
        });
    });

    (state.assets || []).forEach((asset) => {
        if (!asset.path) return;
        items.push({
            id: asset.asset_id || asset.path,
            label: asset.asset_id || asset.type || p('reference asset'),
            path: asset.path,
            type: isImage(asset.path) ? 'image' : asset.type || 'asset',
            status: asset.review_verdict || 'UNREVIEWED',
            source: 'asset_dashboard',
        });
    });

    if (payload?.clip_id) {
        items.unshift({
            id: `${payload.clip_id}_payload_preview`,
            label: p('Current ShotPayload'),
            path: '',
            type: 'json',
            status: 'draft',
            source: 'shot_designer',
            payload,
        });
    }

    return items;
}

function previewBody(item) {
    if (item.type === 'json') {
        return el('pre', { className: 'max-h-[70vh] overflow-auto rounded-xl border border-white/10 bg-black/50 p-4 text-xs leading-6 text-secondary' }, [
            el('code', { text: JSON.stringify(item.payload || {}, null, 2) }),
        ]);
    }

    if (isVideo(item.path)) {
        const video = el('video', {
            className: 'max-h-[75vh] max-w-full rounded-xl border border-white/10 bg-black object-contain',
            attrs: {
                src: item.path,
                controls: 'true',
                playsinline: 'true',
            },
        });
        video.muted = true;
        return video;
    }

    if (isImage(item.path)) {
        return el('img', {
            className: 'max-h-[75vh] max-w-full rounded-xl border border-white/10 bg-black object-contain',
            attrs: {
                src: item.path,
                alt: item.label || p('reference preview'),
            },
        });
    }

    return el('div', { className: 'rounded-xl border border-white/10 bg-black/40 p-5' }, [
        el('div', { text: item.path || p('No previewable media path recorded.'), className: 'break-all font-mono text-sm text-secondary' }),
    ]);
}

function openFullscreenPreview(item) {
    const previousFocus = document.activeElement;
    const overlay = el('div', {
        className: 'fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-xl',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': p('Shot preview') },
    });

    const close = () => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        previousFocus?.focus?.();
    };
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    const onKeyDown = (event) => {
        if (event.key === 'Escape') {
            close();
            document.removeEventListener('keydown', onKeyDown);
        }
    };
    document.addEventListener('keydown', onKeyDown);

    overlay.appendChild(el('div', { className: 'flex max-h-full w-full max-w-6xl flex-col gap-4' }, [
        el('div', { className: 'flex items-center justify-between gap-3' }, [
            el('div', {}, [
                el('div', { text: item.label || item.id, className: 'text-sm font-black uppercase tracking-widest text-white' }),
                el('div', { text: item.path || item.source || 'payload draft', className: 'mt-1 break-all text-xs text-secondary' }),
            ]),
            actionButton(p('Close preview'), { variant: 'muted', onClick: close }),
        ]),
        previewBody(item),
    ]));

    document.body.appendChild(overlay);
    overlay.querySelector('button')?.focus?.();
}

export function GenerationHistoryGrid({ state = {}, payload = {} }) {
    const items = deriveHistoryItems(state, payload);

    return el('section', { className: 'flex flex-col gap-4' }, [
        el('div', { className: 'mb-4 flex flex-wrap items-center justify-between gap-2' }, [
            el('div', {}, [
                el('h3', { text: p('History And Preview Grid'), className: 'text-sm font-bold text-white' }),
                el('p', { text: p('Preview-only grid for local references, downloaded evidence, and current payload JSON.'), className: 'mt-1 text-xs text-secondary' }),
            ]),
            statusBadge(p('no run controls'), 'BLOCK'),
        ]),
        items.length ? el('div', { className: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4' }, items.map((item) => card([
            el('div', { className: 'mb-3 flex items-start justify-between gap-2' }, [
                el('div', { className: 'min-w-0' }, [
                    el('div', { text: item.label, className: 'truncate text-sm font-bold text-white' }),
                    el('div', { text: item.path || item.source, className: 'mt-1 line-clamp-2 break-all text-xs text-secondary' }),
                ]),
                statusBadge(item.status, item.status),
            ]),
            el('button', {
                onClick: () => openFullscreenPreview(item),
                className: 'flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30 text-xs font-bold uppercase tracking-widest text-secondary transition hover:border-cyan-400/40 hover:text-cyan-100',
                attrs: { type: 'button', 'aria-label': `${p('Open Preview')}: ${item.label}` },
            }, [
                item.type === 'json'
                    ? el('span', { text: p('{ } Payload') })
                    : isImage(item.path)
                        ? el('img', { className: 'h-full w-full object-cover opacity-80', attrs: { src: item.path, alt: item.label } })
                        : isVideo(item.path)
                            ? el('span', { text: p('Video Preview') })
                            : el('span', { text: p('Open Preview') }),
            ]),
            el('div', { className: 'mt-3 flex flex-wrap gap-2' }, [
                statusBadge(item.type, 'PREVIEW'),
                statusBadge(item.source, 'UNREVIEWED'),
            ]),
        ], 'p-4'))) : emptyState(p('No preview or history items recorded yet.')),
    ]);
}

export default GenerationHistoryGrid;
