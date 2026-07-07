import { classifySideEffect, allowedStatusLabel } from '../../lib/pipeline/sideEffects.js';
import { el, statusBadge } from './ui.js';

export function SideEffectGate({ commandSpec }) {
    const classification = classifySideEffect(commandSpec);
    const status = classification.mode === 'blocked'
        ? 'BLOCK'
        : classification.mode === 'preview_only'
            ? 'PREVIEW'
            : 'PASS';

    return el('div', { className: 'flex flex-wrap items-center gap-2' }, [
        statusBadge(allowedStatusLabel(classification), status),
        statusBadge(classification.type, status),
        classification.blocker ? statusBadge(classification.blocker, 'BLOCK') : null,
    ].filter(Boolean));
}
