import { actionButton, card, el, statusBadge, textOrDash } from './ui.js';

function normalizeReferences(references = []) {
    return references.map((reference) => (
        typeof reference === 'string'
            ? { path: reference, role: 'reference' }
            : reference
    )).filter((reference) => reference?.path || reference?.asset_id);
}

function uniqueReferenceOptions(state = {}) {
    const byKey = new Map();
    const assets = [
        ...(state.imageDashboard?.assets || []),
        ...(state.assets || []),
    ];

    assets.forEach((asset) => {
        const key = asset.asset_id || asset.path;
        if (!key || byKey.has(key)) return;
        byKey.set(key, {
            asset_id: asset.asset_id || '',
            path: asset.path || '',
            type: asset.type || 'asset',
            target_clip_id: asset.target_clip_id || '',
            video_use_status: asset.video_use_status || '',
            review_verdict: asset.review_verdict || 'UNREVIEWED',
        });
    });

    (state.referenceMediaPaths || []).forEach((path) => {
        if (!path || byKey.has(path)) return;
        byKey.set(path, {
            asset_id: '',
            path,
            type: path.match(/\.(mp4|mov|webm)$/i) ? 'video_reference' : 'reference',
            target_clip_id: '',
            video_use_status: 'local_path_only',
            review_verdict: 'UNREVIEWED',
        });
    });

    return Array.from(byKey.values());
}

function addReference(current, reference) {
    const references = normalizeReferences(current.references);
    const key = reference.asset_id || reference.path;
    if (!key) return references;
    if (references.some((item) => (item.asset_id || item.path) === key)) return references;
    return [
        ...references,
        {
            asset_id: reference.asset_id || '',
            path: reference.path || '',
            type: reference.type || 'reference',
            role: 'reference',
        },
    ];
}

export function MediaReferencePicker({ state = {}, value = {}, onChange }) {
    const options = uniqueReferenceOptions(state);
    const references = normalizeReferences(value.references);
    let localPathInput = null;

    const setPayload = (patch) => onChange?.({ ...value, ...patch });
    const setFirstFrame = (asset) => setPayload({ first_frame_asset_id: asset.asset_id || asset.path });
    const setEndFrame = (asset) => setPayload({ end_frame_asset_id: asset.asset_id || asset.path });
    const appendReference = (asset) => setPayload({ references: addReference(value, asset) });
    const removeReference = (key) => setPayload({
        references: references.filter((reference) => (reference.asset_id || reference.path) !== key),
    });

    const addLocalPath = () => {
        const path = localPathInput?.value?.trim();
        if (!path) return;
        appendReference({
            path,
            type: path.match(/\.(mp4|mov|webm)$/i) ? 'video_reference' : 'image_reference',
            video_use_status: 'not_read_or_uploaded',
            review_verdict: 'UNREVIEWED',
        });
    };

    localPathInput = el('input', {
        className: 'min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition placeholder:text-secondary focus:border-cyan-400/50',
        attrs: {
            type: 'text',
            placeholder: 'Paste local reference path only. No upload or read occurs.',
            'aria-label': 'Local reference path',
        },
    });

    return el('section', { className: 'flex flex-col gap-4' }, [
        el('div', { className: 'mb-4 flex flex-wrap items-center justify-between gap-2' }, [
            el('div', {}, [
                el('h3', { text: 'Media References', className: 'text-sm font-black uppercase tracking-widest text-white' }),
                el('p', { text: 'Displays existing local stills and references. There is no upload, generation, or external review.', className: 'mt-1 text-xs text-secondary' }),
            ]),
            statusBadge('local display only', 'PREVIEW'),
        ]),
        el('div', { className: 'mb-4 grid grid-cols-1 gap-3 md:grid-cols-3' }, [
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2' }, [
                el('div', { text: 'First frame', className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
                el('div', { text: textOrDash(value.first_frame_asset_id), className: 'mt-2 break-all text-sm font-semibold text-white' }),
            ]),
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2' }, [
                el('div', { text: 'End frame', className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
                el('div', { text: textOrDash(value.end_frame_asset_id), className: 'mt-2 break-all text-sm font-semibold text-white' }),
            ]),
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2' }, [
                el('div', { text: 'References', className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
                el('div', { text: `${references.length} selected`, className: 'mt-2 text-sm font-semibold text-white' }),
            ]),
        ]),
        el('div', { className: 'mb-4 flex flex-col gap-2 sm:flex-row' }, [
            localPathInput,
            actionButton('Add local path', { variant: 'muted', onClick: addLocalPath }),
        ]),
        el('div', { className: 'grid grid-cols-1 gap-3 lg:grid-cols-2' }, options.map((asset) => card([
            el('div', { className: 'flex flex-wrap items-start justify-between gap-3' }, [
                el('div', { className: 'min-w-0' }, [
                    el('div', { text: asset.asset_id || asset.type, className: 'break-all text-sm font-bold text-white' }),
                    el('div', { text: asset.path || 'No path recorded', className: 'mt-1 break-all font-mono text-xs text-secondary' }),
                ]),
                statusBadge(asset.review_verdict || 'UNREVIEWED', asset.review_verdict || 'UNREVIEWED'),
            ]),
            el('div', { className: 'mt-3 flex flex-wrap gap-2' }, [
                statusBadge(asset.type || 'asset', 'PREVIEW'),
                asset.target_clip_id ? statusBadge(asset.target_clip_id, 'UNREVIEWED') : null,
                asset.video_use_status ? statusBadge(asset.video_use_status, 'UNREVIEWED') : null,
            ].filter(Boolean)),
            el('div', { className: 'mt-4 flex flex-wrap gap-2' }, [
                actionButton('Set first frame', { variant: 'muted', onClick: () => setFirstFrame(asset) }),
                actionButton('Set end frame', { variant: 'muted', onClick: () => setEndFrame(asset) }),
                actionButton('Add reference', { onClick: () => appendReference(asset) }),
            ]),
        ], 'p-4'))),
        references.length ? card([
            el('div', { text: 'Selected References', className: 'mb-3 text-[11px] font-bold uppercase tracking-widest text-secondary' }),
            el('div', { className: 'flex flex-col gap-2' }, references.map((reference) => {
                const key = reference.asset_id || reference.path;
                return el('div', { className: 'flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between' }, [
                    el('span', { text: `${reference.asset_id || reference.path} · ${reference.type || 'reference'}`, className: 'break-all text-xs text-secondary' }),
                    actionButton('Remove', { variant: 'muted', onClick: () => removeReference(key) }),
                ]);
            })),
        ], 'mt-4') : null,
    ].filter(Boolean));
}

export default MediaReferencePicker;
