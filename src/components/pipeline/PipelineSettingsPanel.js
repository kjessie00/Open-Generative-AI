import { card, el, infoGrid, panelShell, statusBadge } from './ui.js';
import { p } from './copy.js';

export function PipelineSettingsPanel({ state, config, onPickParent, onRefresh }) {
    const settings = state.settings || {};
    const productionRoot = config?.productionRoot || state.project?.root_path;
    const productionParentRoot = config?.productionParentRoot || '';

    return panelShell(p('Pipeline Settings'), p('Local pipeline paths and dry-run controls. Dry-run mode is locked on by default.'), [
        card([
            el('div', { className: 'flex flex-wrap items-end justify-between gap-3' }, [
                el('div', { className: 'flex-1' }, [
                    el('div', { text: p('Production parent'), className: 'text-xs font-semibold text-secondary' }),
                    el('input', {
                        type: 'text',
                        value: productionParentRoot,
                        readOnly: true,
                        attrs: { placeholder: '/Users/jessiek/StudioProjects/happyVideoFactory/production', tabindex: '-1', 'aria-label': p('Production parent') },
                        className: 'mt-2 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-secondary focus:outline-none',
                    }),
                    el('p', { text: p('The folder that contains all productions (immediate subdirs are listed in the sidebar).'), className: 'mt-2 text-xs leading-6 text-secondary' }),
                ]),
                el('div', { className: 'flex flex-wrap gap-2' }, [
                    el('button', {
                        text: p('Browse parent'),
                        onClick: () => onPickParent && onPickParent(),
                        className: 'ui-action-button rounded-md border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-white/10',
                        attrs: { type: 'button' },
                    }),
                    el('button', {
                        text: p('Refresh'),
                        onClick: () => onRefresh && onRefresh(),
                        className: 'ui-action-button rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-secondary hover:bg-white/[0.07] hover:text-white',
                        attrs: { type: 'button' },
                    }),
                ]),
            ]),
        ]),
        infoGrid([
            { label: p('Production root'), value: productionRoot },
            { label: p('Shorts harness doc'), value: settings.harnessDocs?.shorts || 'docs/harness/shorts-SKILL.md' },
            { label: p('Seedance harness doc'), value: settings.harnessDocs?.seedance || 'docs/harness/Seedance2-SKILL.md' },
            { label: p('Dreamina CLI path'), value: settings.dreaminaCliPath },
            { label: p('Flow/Omni setting'), value: settings.flowOmniSetting || p('placeholder only') },
            { label: p('ffmpeg path'), value: settings.ffmpegPath },
            { label: p('ffprobe path'), value: settings.ffprobePath },
            { label: p('Model directories'), value: (settings.modelDirectories || []).join(', ') },
        ], 'lg:grid-cols-2'),
        card([
            el('div', { className: 'flex flex-wrap items-center justify-between gap-4' }, [
                el('div', {}, [
                    el('div', { text: p('Dry-run mode'), className: 'text-sm font-bold text-white' }),
                    el('p', { text: p('Locked ON. Live generation, external review, submit, and upload paths are not available in this UI shell.'), className: 'mt-1 text-sm leading-6 text-secondary' }),
                ]),
                el('label', { className: 'inline-flex cursor-not-allowed items-center gap-3 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-100' }, [
                    el('input', { type: 'checkbox', attrs: { checked: 'checked', disabled: 'disabled' }, className: 'h-4 w-4 accent-cyan-300' }),
                    el('span', { text: p('ON') }),
                ]),
            ]),
            el('div', { className: 'mt-4 flex flex-wrap gap-2' }, [
                statusBadge(p('planning files allowed'), 'ALLOWED'),
                statusBadge(p('status commands preview only'), 'PREVIEW'),
                statusBadge(p('generation blocked'), 'BLOCK'),
                statusBadge(p('external upload blocked'), 'BLOCK'),
            ]),
        ]),
    ]);
}
