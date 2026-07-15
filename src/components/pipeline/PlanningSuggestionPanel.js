import { actionButton, el } from './ui.js';

const REVIEW_STATUSES = new Set(['ready', 'held', 'applied', 'stale', 'applied_then_edited']);

export function planningSuggestionView(collaboration, stage, draftDirty = false) {
    const requests = Array.isArray(collaboration?.recent_requests) ? collaboration.recent_requests : [];
    const request = requests.find((item) => item?.stage === stage) || null;
    const suggestion = request?.suggestion && typeof request.suggestion === 'object' ? request.suggestion : null;
    let reviewStatus = REVIEW_STATUSES.has(suggestion?.review_status) ? suggestion.review_status : '';
    if (reviewStatus === 'ready' && (draftDirty || suggestion?.apply_allowed !== true)) reviewStatus = 'stale';
    return {
        request,
        suggestion,
        reviewStatus,
        queued: request?.status === 'queued_local_handoff' && !suggestion,
        compareOpen: reviewStatus === 'ready' || reviewStatus === 'stale',
        history: ['held', 'applied', 'applied_then_edited'].includes(reviewStatus),
    };
}

export function suggestionStatusText(reviewStatus) {
    if (reviewStatus === 'ready') return '수정안이 도착했습니다';
    if (reviewStatus === 'held') return '보류함 · 원문은 그대로';
    if (reviewStatus === 'applied') return '수정안을 적용했습니다';
    if (reviewStatus === 'applied_then_edited') return '적용 후 직접 수정됨';
    if (reviewStatus === 'stale') return '원문이 바뀌어 바로 적용할 수 없습니다';
    return '';
}

function suggestionBody({ stage, suggestion }) {
    const id = `planning-${stage}-agent-suggestion`;
    return el('div', { className: 'flex min-w-0 flex-col gap-2' }, [
        el('label', { text: '에이전트 수정안', className: 'text-xs font-semibold text-white', attrs: { for: id } }),
        el('textarea', {
            value: suggestion?.proposed_text || '',
            readOnly: true,
            className: 'min-h-[180px] w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-white outline-none',
            attrs: { id, 'aria-describedby': `${id}-help` },
        }),
        el('p', {
            text: '원문은 자동으로 바뀌지 않습니다.',
            className: 'text-xs leading-5 text-secondary',
            attrs: { id: `${id}-help` },
        }),
    ]);
}

export function PlanningSuggestionPanel({
    stage, suggestion, reviewStatus, disabled = false, currentControl, onDecide,
}) {
    const status = el('p', {
        text: suggestionStatusText(reviewStatus),
        className: `text-xs leading-5 ${reviewStatus === 'stale' ? 'text-amber-100' : 'text-secondary'}`,
        attrs: { role: 'status', 'aria-live': 'polite' },
    });
    const applyDisabled = disabled || reviewStatus !== 'ready' || suggestion?.apply_allowed !== true;
    const applyButton = actionButton('수정안 적용', {
        disabled: applyDisabled,
        onClick: () => onDecide?.({ stage, suggestion_token: suggestion?.suggestion_token, action: 'apply' }),
    });
    const holdButton = actionButton('보류', {
        disabled,
        variant: 'muted',
        onClick: () => onDecide?.({ stage, suggestion_token: suggestion?.suggestion_token, action: 'hold' }),
    });

    if (reviewStatus === 'ready' && currentControl) {
        currentControl.addEventListener('input', () => {
            applyButton.disabled = true;
            status.textContent = suggestionStatusText('stale');
            status.className = 'text-xs leading-5 text-amber-100';
        });
    }

    return el('div', {
        className: 'flex min-w-0 flex-col gap-3 rounded-md border border-cyan-400/20 bg-black/20 p-3',
        attrs: { 'aria-labelledby': `planning-${stage}-suggestion-title` },
    }, [
        el('div', {}, [
            el('h5', {
                text: '에이전트 수정안',
                className: 'text-sm font-semibold text-white',
                attrs: { id: `planning-${stage}-suggestion-title` },
            }),
            suggestion?.summary ? el('p', { text: suggestion.summary, className: 'mt-1 text-xs leading-5 text-secondary' }) : null,
        ]),
        suggestionBody({ stage, suggestion }),
        status,
        el('div', { className: 'flex flex-wrap gap-2' }, [applyButton, holdButton]),
    ].filter(Boolean));
}

export function PlanningSuggestionHistory({ stage, suggestion, reviewStatus, disabled = false, draftDirty = false, onDecide }) {
    const canApply = reviewStatus === 'held' && suggestion?.apply_allowed === true && !draftDirty;
    return el('div', { className: 'flex min-w-0 flex-col gap-2' }, [
        el('p', {
            text: suggestionStatusText(reviewStatus),
            className: 'text-xs leading-5 text-secondary',
            attrs: { role: 'status', 'aria-live': 'polite' },
        }),
        el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
            el('summary', { text: '지난 수정안 보기', className: 'min-h-11 cursor-pointer py-3 text-xs font-semibold text-white' }),
            el('div', { className: 'flex flex-col gap-3 pb-3' }, [
                suggestionBody({ stage, suggestion }),
                reviewStatus === 'held' ? actionButton('수정안 적용', {
                    disabled: disabled || !canApply,
                    onClick: () => onDecide?.({ stage, suggestion_token: suggestion?.suggestion_token, action: 'apply' }),
                }) : null,
                reviewStatus === 'held' && draftDirty ? el('p', {
                    text: '현재 내용을 먼저 저장한 뒤 다시 확인하세요.',
                    className: 'text-xs leading-5 text-amber-100',
                }) : null,
            ].filter(Boolean)),
        ]),
    ]);
}
