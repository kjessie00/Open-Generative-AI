import { classifySideEffect, renderShellCommand, allowedStatusLabel } from '../../lib/pipeline/sideEffects.js';
import { actionButton, card, codeBlock, el, statusBadge } from './ui.js';
import { SideEffectGate } from './SideEffectGate.js';
import { p } from './copy.js';
import { blockerLabel, simpleStatusLabel } from './generationUi.js';

function commandLabel(commandSpec) {
    const label = commandSpec.label || commandSpec.id || 'Command preview';
    const dynamicPatterns = [
        ['Dreamina list_task · ', 'Dreamina list_task', ' · '],
        ['Dreamina query_result · ', 'Dreamina query_result', ' · '],
        ['DeepSearchTeam scene image - ', 'DeepSearchTeam scene image', ' · '],
        ['ffprobe validation ', 'ffprobe validation', ' '],
    ];
    for (const [prefix, copyKey, separator] of dynamicPatterns) {
        if (label.startsWith(prefix)) return `${p(copyKey)}${separator}${label.slice(prefix.length)}`;
    }
    return p(label);
}

export function CommandPreviewCard({ commandSpec, compact = false }) {
    const command = renderShellCommand(commandSpec);
    const classification = classifySideEffect(commandSpec);
    const copyButton = actionButton(p('Copy unavailable'), {
        variant: 'muted',
        disabled: true,
    });

    const blocked = classification.mode === 'blocked';
    const status = blocked ? 'BLOCK' : classification.mode === 'preview_only' ? 'PREVIEW' : 'PASS';

    if (compact) {
        const blockers = classification.blockers.map(blockerLabel);
        return card([
            el('div', { className: 'flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between' }, [
                el('div', {}, [
                    el('h3', { text: commandLabel(commandSpec), className: 'text-sm font-bold text-white' }),
                    el('p', { text: `${simpleStatusLabel(status)} · 앱에서 실행 안 함`, className: 'mt-1 text-xs text-secondary' }),
                ]),
                copyButton,
            ]),
            el('details', { className: 'mt-3 text-xs text-secondary' }, [
                el('summary', { text: '명령 내용 보기', className: 'cursor-pointer font-semibold' }),
                el('div', { className: 'mt-3' }, [codeBlock(command)]),
                el('dl', { className: 'mt-3 grid grid-cols-1 gap-2 md:grid-cols-2' }, [
                    el('div', {}, [el('dt', { text: '결과 위치', className: 'font-semibold' }), el('dd', { text: commandSpec.evidence_output_path || '없음', className: 'mt-1 break-all font-mono' })]),
                    el('div', {}, [el('dt', { text: '필요한 확인', className: 'font-semibold' }), el('dd', { text: blockers.join(', ') || '없음', className: 'mt-1' })]),
                ]),
            ]),
        ], blocked ? 'border-red-400/20' : 'border-white/10');
    }

    return card([
        el('div', { className: 'mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between' }, [
            el('div', {}, [
                el('h3', { text: commandLabel(commandSpec), className: 'text-base font-bold text-white' }),
                el('p', { text: p('Preview card only. No run button is rendered.'), className: 'mt-1 text-xs text-secondary' }),
            ]),
            el('div', { className: 'flex flex-wrap gap-2' }, [
                statusBadge(p(allowedStatusLabel(classification)), status),
                copyButton,
            ]),
        ]),
        codeBlock(command),
        el('div', { className: 'mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2' }, [
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 p-3' }, [
                el('div', { text: 'side_effect_type', className: 'mb-2 text-[11px] font-bold uppercase tracking-widest text-secondary' }),
                SideEffectGate({ commandSpec }),
            ]),
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 p-3' }, [
                el('div', { text: p('required evidence output'), className: 'mb-2 text-xs font-semibold text-secondary' }),
                el('div', { text: commandSpec.evidence_output_path || '—', className: 'break-all font-mono text-xs text-secondary' }),
            ]),
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 p-3 md:col-span-2' }, [
                el('div', { text: p('blocker if disabled'), className: 'mb-2 text-xs font-semibold text-secondary' }),
                el('div', { className: 'flex flex-wrap gap-2' }, classification.blockers.length
                    ? classification.blockers.map((blocker) => statusBadge(blocker, 'BLOCK'))
                    : [statusBadge(p('None'), 'PASS')]),
                commandSpec.disabled_detail ? el('p', { text: p(commandSpec.disabled_detail), className: 'mt-3 break-words text-xs leading-5 text-secondary' }) : null,
            ]),
        ]),
    ], blocked ? 'border-red-400/20' : 'border-white/10');
}
