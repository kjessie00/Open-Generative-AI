import { classifySideEffect, renderShellCommand, allowedStatusLabel } from '../../lib/pipeline/sideEffects.js';
import { pipelineClient } from '../../lib/pipeline/client.js';
import { actionButton, card, codeBlock, el, statusBadge } from './ui.js';
import { SideEffectGate } from './SideEffectGate.js';

async function copyCommand(commandSpec, button) {
    try {
        const result = await pipelineClient.copyCommandPreview(commandSpec);
        button.textContent = result?.copied && result?.verified ? 'Copied' : 'Copy failed';
    } catch {
        button.textContent = 'Copy failed';
    }
    setTimeout(() => {
        button.textContent = 'Copy command';
    }, 1200);
}

export function CommandPreviewCard({ commandSpec }) {
    const command = renderShellCommand(commandSpec);
    const classification = classifySideEffect(commandSpec);
    const copyButton = actionButton('Copy command', {
        variant: 'muted',
        onClick: () => copyCommand(commandSpec, copyButton),
    });

    const blocked = classification.mode === 'blocked';
    const status = blocked ? 'BLOCK' : classification.mode === 'preview_only' ? 'PREVIEW' : 'PASS';

    return card([
        el('div', { className: 'mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between' }, [
            el('div', {}, [
                el('h3', { text: commandSpec.label || commandSpec.id || 'Command preview', className: 'text-base font-bold text-white' }),
                el('p', { text: 'Preview card only. No run button is rendered.', className: 'mt-1 text-xs text-secondary' }),
            ]),
            el('div', { className: 'flex flex-wrap gap-2' }, [
                statusBadge(allowedStatusLabel(classification), status),
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
                el('div', { text: 'required evidence output', className: 'mb-2 text-[11px] font-bold uppercase tracking-widest text-secondary' }),
                el('div', { text: commandSpec.evidence_output_path || '—', className: 'break-all font-mono text-xs text-secondary' }),
            ]),
            el('div', { className: 'rounded-xl border border-white/10 bg-black/20 p-3 md:col-span-2' }, [
                el('div', { text: 'blocker if disabled', className: 'mb-2 text-[11px] font-bold uppercase tracking-widest text-secondary' }),
                el('div', { className: 'flex flex-wrap gap-2' }, classification.blockers.length
                    ? classification.blockers.map((blocker) => statusBadge(blocker, 'BLOCK'))
                    : [statusBadge('None', 'PASS')]),
                commandSpec.disabled_detail ? el('p', { text: commandSpec.disabled_detail, className: 'mt-3 break-words text-xs leading-5 text-secondary' }) : null,
            ]),
        ]),
    ], blocked ? 'border-red-400/20' : 'border-white/10');
}
