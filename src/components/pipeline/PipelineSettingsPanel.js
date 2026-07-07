import { card, el, infoGrid, panelShell, statusBadge } from './ui.js';

export function PipelineSettingsPanel({ state, config }) {
    const settings = state.settings || {};
    const productionRoot = config?.productionRoot || state.project?.root_path;

    return panelShell('Settings', 'Local pipeline paths and dry-run controls. Dry-run mode is locked on by default.', [
        infoGrid([
            { label: 'Production root', value: productionRoot },
            { label: 'Shorts harness doc', value: settings.harnessDocs?.shorts || 'docs/harness/shorts-SKILL.md' },
            { label: 'Seedance harness doc', value: settings.harnessDocs?.seedance || 'docs/harness/Seedance2-SKILL.md' },
            { label: 'Dreamina CLI path', value: settings.dreaminaCliPath },
            { label: 'Flow/Omni setting', value: settings.flowOmniSetting || 'placeholder only' },
            { label: 'ffmpeg path', value: settings.ffmpegPath },
            { label: 'ffprobe path', value: settings.ffprobePath },
            { label: 'Model directories', value: (settings.modelDirectories || []).join(', ') },
        ], 'lg:grid-cols-2'),
        card([
            el('div', { className: 'flex flex-wrap items-center justify-between gap-4' }, [
                el('div', {}, [
                    el('div', { text: 'Dry-run mode', className: 'text-sm font-bold text-white' }),
                    el('p', { text: 'Locked ON. Live generation, external review, submit, and upload paths are not available in this UI shell.', className: 'mt-1 text-sm leading-6 text-secondary' }),
                ]),
                el('label', { className: 'inline-flex cursor-not-allowed items-center gap-3 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-bold text-cyan-100' }, [
                    el('input', { type: 'checkbox', attrs: { checked: 'checked', disabled: 'disabled' }, className: 'h-4 w-4 accent-cyan-300' }),
                    el('span', { text: 'ON' }),
                ]),
            ]),
            el('div', { className: 'mt-4 flex flex-wrap gap-2' }, [
                statusBadge('planning files allowed', 'ALLOWED'),
                statusBadge('status commands preview only', 'PREVIEW'),
                statusBadge('generation blocked', 'BLOCK'),
                statusBadge('external upload blocked', 'BLOCK'),
            ]),
        ]),
    ]);
}
