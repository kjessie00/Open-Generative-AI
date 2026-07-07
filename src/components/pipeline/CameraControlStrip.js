import { card, el, statusBadge } from './ui.js';

export const CAMERA_OPTIONS = Object.freeze([
    'locked tripod',
    'slow dolly push-in',
    'controlled push-in',
    'medium over-the-shoulder',
    'handheld documentary drift',
    'over-the-shoulder follow',
    'crane rise',
    'lateral tracking',
]);

export const LENS_OPTIONS = Object.freeze([
    'anamorphic cinema',
    'spherical prime',
    'wide angle',
    'portrait telephoto',
    'macro detail',
]);

export const FOCAL_LENGTH_OPTIONS = Object.freeze([18, 24, 35, 50, 85, 100]);

export const APERTURE_OPTIONS = Object.freeze([
    'f/1.4',
    'f/2.0',
    'f/2.8',
    'f/4.0',
    'f/5.6',
]);

export const CAMERA_MOVEMENT_OPTIONS = Object.freeze([
    'one slow push-in',
    'slow push-in',
    'locked-off frame',
    'single lateral move',
    'subtle handheld sway',
    'one crane rise',
]);

function selectControl(label, value, options, onChange) {
    const id = `shot-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const optionList = value && !options.map(String).includes(String(value))
        ? [value, ...options]
        : options;
    const select = el('select', {
        className: 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none transition focus:border-cyan-400/50',
        attrs: { id },
    });
    optionList.forEach((option) => {
        select.appendChild(el('option', { text: option, value: option }));
    });
    select.value = String(value ?? optionList[0] ?? '');
    select.addEventListener('change', () => onChange(select.value));

    return el('label', { className: 'flex min-w-0 flex-col gap-2' }, [
        el('span', { text: label, className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
        select,
    ]);
}

export function CameraControlStrip({ value = {}, onChange }) {
    const current = {
        camera: value.camera || CAMERA_OPTIONS[0],
        lens: value.lens || LENS_OPTIONS[0],
        focal_length: value.focal_length || 35,
        aperture: value.aperture || APERTURE_OPTIONS[0],
        camera_movement: value.camera_movement || CAMERA_MOVEMENT_OPTIONS[0],
    };

    const update = (patch) => onChange?.({ ...current, ...patch });

    return card([
        el('div', { className: 'mb-4 flex flex-wrap items-center justify-between gap-2' }, [
            el('div', {}, [
                el('h3', { text: 'Camera Controls', className: 'text-sm font-black uppercase tracking-widest text-white' }),
                el('p', { text: 'Local shot metadata only. These controls never submit a render job.', className: 'mt-1 text-xs text-secondary' }),
            ]),
            statusBadge('payload only', 'PREVIEW'),
        ]),
        el('div', { className: 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5' }, [
            selectControl('Camera', current.camera, CAMERA_OPTIONS, (camera) => update({ camera })),
            selectControl('Lens', current.lens, LENS_OPTIONS, (lens) => update({ lens })),
            selectControl('Focal length', current.focal_length, FOCAL_LENGTH_OPTIONS.map(String), (focal) => update({ focal_length: Number(focal) })),
            selectControl('Aperture', current.aperture, APERTURE_OPTIONS, (aperture) => update({ aperture })),
            selectControl('Movement', current.camera_movement, CAMERA_MOVEMENT_OPTIONS, (camera_movement) => update({ camera_movement })),
        ]),
        el('div', { className: 'mt-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-secondary' }, [
            el('span', { text: `${current.camera} · ${current.lens} · ${current.focal_length}mm · ${current.aperture} · ${current.camera_movement}` }),
        ]),
    ]);
}

export default CameraControlStrip;
