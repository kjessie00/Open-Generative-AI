import { actionButton, blockerList, card, codeBlock, el, infoGrid, statusBadge } from './ui.js';
import { p } from './copy.js';

function fieldShell(label, id, control, help) {
    return el('div', { className: 'flex min-w-0 flex-col gap-2' }, [
        el('label', { text: label, className: 'text-xs font-semibold text-white', attrs: { for: id } }),
        control,
        el('p', { text: help, className: 'text-xs leading-5 text-secondary', attrs: { id: `${id}-help` } }),
    ]);
}

function textControl({ id, name, value, multiline = false, disabled, maxLength, help, onDraftChange }) {
    const control = el(multiline ? 'textarea' : 'input', {
        value,
        disabled,
        className: `w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50 ${multiline ? 'min-h-[132px] resize-y leading-6' : ''}`,
        attrs: {
            id, name, required: true, maxlength: maxLength, 'aria-describedby': `${id}-help`,
            ...(multiline ? {} : { type: 'text', autocomplete: 'off', spellcheck: 'false' }),
        },
    });
    control.addEventListener('input', (event) => onDraftChange?.(name, event.target.value));
    return fieldShell(p(name), id, control, help);
}

function selectControl({ id, name, value, options, disabled, help, onDraftChange }) {
    const control = el('select', {
        value,
        disabled,
        className: 'w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50',
        attrs: { id, name, required: true, 'aria-describedby': `${id}-help` },
    }, options.map((option) => el('option', { text: option.label, value: option.value, attrs: { value: option.value } })));
    control.addEventListener('change', (event) => onDraftChange?.(name, event.target.value));
    return fieldShell(p(name), id, control, help);
}

function numberControl({ id, name, value, min, max, disabled, help, onDraftChange }) {
    const control = el('input', {
        value,
        disabled,
        className: 'w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50',
        attrs: { id, name, type: 'number', min, max, step: 1, required: true, 'aria-describedby': `${id}-help` },
    });
    control.addEventListener('input', (event) => onDraftChange?.(name, Number(event.target.value)));
    return fieldShell(p(name), id, control, help);
}

function statusText(status) {
    if (status === 'restored' || status === 'saved') return p('Draft restored from this device.');
    if (status === 'saving') return p('Saving draft…');
    if (status === 'copying') return p('Checking and copying command…');
    if (status === 'error') return p('Draft could not be loaded safely.');
    return p('No saved new-project draft yet.');
}

export function NewProjectDraftForm({
    draftState, draftValue, onDraftChange, onSaveNewProjectDraft, onCopyNewProjectBuildCommand,
}) {
    const loading = ['loading', 'saving', 'copying'].includes(draftState?.status);
    const blockers = Array.isArray(draftState?.blockers) ? draftState.blockers.map((code) => p(code)) : [];
    const readyToCopy = draftState?.preview?.copyAllowed === true;
    return card([
        el('div', { className: 'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between' }, [
            el('div', {}, [
                el('h3', { text: p('Start a new project'), className: 'text-base font-bold text-white' }),
                el('p', {
                    text: p('Save the Korean brief and script as a local draft, then copy the fixed canonical builder command.'),
                    className: 'mt-1 max-w-3xl text-sm leading-6 text-secondary',
                }),
            ]),
            statusBadge(readyToCopy ? p('Command ready') : p('Draft only'), readyToCopy ? 'PASS' : 'PREVIEW'),
        ]),
        el('p', {
            text: statusText(draftState?.status),
            className: `rounded-md border px-3 py-2 text-xs ${draftState?.status === 'error' ? 'border-red-400/20 text-red-100' : 'border-white/10 text-secondary'}`,
            attrs: { role: draftState?.status === 'error' ? 'alert' : 'status', 'aria-live': 'polite' },
        }),
        el('form', { className: 'grid grid-cols-1 gap-4 md:grid-cols-2', attrs: { 'aria-label': p('New project draft') } }, [
            textControl({
                id: 'new-project-production-id', name: 'production_id', value: draftValue.production_id,
                disabled: loading, maxLength: 64, help: p('Use 3–64 lowercase letters, numbers, hyphens, or underscores.'), onDraftChange,
            }),
            selectControl({
                id: 'new-project-route', name: 'route', value: draftValue.route, disabled: loading,
                options: [
                    { value: 'seedance', label: p('Seedance') },
                    { value: 'flow_omni', label: p('Flow/Omni') },
                    { value: 'both', label: p('Both routes') },
                ],
                help: p('Choose which prompt package the canonical builder should prepare.'), onDraftChange,
            }),
            textControl({
                id: 'new-project-brief', name: 'brief', value: draftValue.brief, multiline: true,
                disabled: loading, maxLength: 65536, help: p('Describe the concept, audience, tone, and non-negotiable requirements in Korean.'), onDraftChange,
            }),
            textControl({
                id: 'new-project-script', name: 'script', value: draftValue.script, multiline: true,
                disabled: loading, maxLength: 262144, help: p('Paste the final narration or dialogue script. It remains only in the private local draft.'), onDraftChange,
            }),
            selectControl({
                id: 'new-project-aspect', name: 'aspect_ratio', value: draftValue.aspect_ratio, disabled: loading,
                options: [{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }],
                help: p('Choose the final video frame.'), onDraftChange,
            }),
            el('div', { className: 'grid grid-cols-1 gap-4 sm:grid-cols-2' }, [
                numberControl({
                    id: 'new-project-duration', name: 'scene_duration', value: draftValue.scene_duration,
                    min: 4, max: 15, disabled: loading, help: p('4–15 seconds per scene.'), onDraftChange,
                }),
                numberControl({
                    id: 'new-project-scenes', name: 'max_scenes', value: draftValue.max_scenes,
                    min: 1, max: 10, disabled: loading, help: p('Prepare 1–10 scenes.'), onDraftChange,
                }),
            ]),
        ]),
        el('div', { className: 'flex flex-wrap gap-2' }, [
            actionButton(draftState?.status === 'saving' ? p('Saving…') : p('Save local draft'), {
                disabled: loading, onClick: () => onSaveNewProjectDraft?.({ ...draftValue }),
            }),
            actionButton(p('Copy canonical build command'), {
                disabled: loading || !readyToCopy, variant: 'muted', onClick: () => onCopyNewProjectBuildCommand?.(),
            }),
        ]),
        el('p', {
            text: p('Saving does not create a production or run a command. Run the copied command yourself outside this app, then refresh the production list.'),
            className: 'text-xs leading-5 text-secondary',
        }),
        draftState?.targetPath ? infoGrid([
            { label: p('Configured production parent'), value: draftState.parentRoot },
            { label: p('Planned production folder'), value: draftState.targetPath },
        ], 'lg:grid-cols-2') : null,
        readyToCopy ? el('div', {}, [
            el('h4', { text: p('Canonical command preview'), className: 'mb-2 text-xs font-semibold text-white' }),
            codeBlock(draftState.preview.shellSafeCommand),
        ]) : blockerList(blockers),
    ].filter(Boolean), 'flex flex-col gap-4 border-cyan-400/20');
}
