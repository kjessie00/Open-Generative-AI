import { actionButton, card, el, textOrDash } from './ui.js';
import { p } from './copy.js';
import { simpleStatusLabel } from './generationUi.js';

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
            placeholder: p('Paste local reference path only. No upload or read occurs.'),
            'aria-label': p('Local reference path'),
        },
    });

    return el('section', { className: 'flex flex-col gap-4' }, [
        el('div', { className: 'mb-4 flex flex-wrap items-center justify-between gap-2' }, [
            el('div', {}, [
                el('h3', { text: p('Media References'), className: 'text-sm font-bold text-white' }),
                el('p', { text: p('Displays existing local stills and references. There is no upload, generation, or external review.'), className: 'mt-1 text-xs text-secondary' }),
            ]),
        ]),
        el('div', { className: 'mb-4 grid grid-cols-1 gap-3 md:grid-cols-3' }, [
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2' }, [
                el('div', { text: p('First frame'), className: 'text-xs font-semibold text-secondary' }),
                el('div', { text: textOrDash(value.first_frame_asset_id), className: 'mt-2 break-all text-sm font-semibold text-white' }),
            ]),
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2' }, [
                el('div', { text: p('End frame'), className: 'text-xs font-semibold text-secondary' }),
                el('div', { text: textOrDash(value.end_frame_asset_id), className: 'mt-2 break-all text-sm font-semibold text-white' }),
            ]),
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2' }, [
                el('div', { text: p('References'), className: 'text-xs font-semibold text-secondary' }),
                el('div', { text: p('{count} selected', { count: references.length }), className: 'mt-2 text-sm font-semibold text-white' }),
            ]),
        ]),
        el('div', { className: 'mb-4 flex flex-col gap-2 sm:flex-row' }, [
            localPathInput,
            actionButton(p('Add local path'), { variant: 'muted', onClick: addLocalPath }),
        ]),
        el('div', { className: 'grid grid-cols-1 gap-3 lg:grid-cols-2' }, options.map((asset) => card([
            el('div', { className: 'flex flex-wrap items-start justify-between gap-3' }, [
                el('div', { className: 'min-w-0' }, [
                    el('div', { text: asset.asset_id || asset.type, className: 'break-all text-sm font-bold text-white' }),
                    el('div', { text: asset.path || p('No path recorded'), className: 'mt-1 break-all font-mono text-xs text-secondary' }),
                ]),
                el('span', { text: simpleStatusLabel(asset.review_verdict), className: 'text-xs text-secondary' }),
            ]),
            el('p', {
                text: [asset.type || '자료', asset.target_clip_id, asset.video_use_status].filter(Boolean).join(' · '),
                className: 'mt-3 text-xs text-secondary',
            }),
            el('div', { className: 'mt-4 flex flex-wrap gap-2' }, [
                actionButton(p('Set first frame'), { variant: 'muted', onClick: () => setFirstFrame(asset) }),
                actionButton(p('Set end frame'), { variant: 'muted', onClick: () => setEndFrame(asset) }),
                actionButton(p('Add reference'), { onClick: () => appendReference(asset) }),
            ]),
        ], 'p-4'))),
        references.length ? card([
            el('div', { text: p('Selected References'), className: 'mb-3 text-xs font-semibold text-secondary' }),
            el('div', { className: 'flex flex-col gap-2' }, references.map((reference) => {
                const key = reference.asset_id || reference.path;
                return el('div', { className: 'flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between' }, [
                    el('span', { text: `${reference.asset_id || reference.path} · ${reference.type || 'reference'}`, className: 'break-all text-xs text-secondary' }),
                    actionButton(p('Remove'), { variant: 'muted', onClick: () => removeReference(key) }),
                ]);
            })),
        ], 'mt-4') : null,
    ].filter(Boolean));
}

export default MediaReferencePicker;
