import { actionButton, card, el } from './ui.js';
import { normalizeDesignBoard } from './DesignBoardEditor.js';

const REVIEW_STATUSES = new Set(['ready', 'held', 'applied', 'stale', 'applied_then_edited']);

export function designCollaborationView(collaboration, dirty) {
    const recent = Array.isArray(collaboration?.recent_requests) ? collaboration.recent_requests : [];
    const request = recent[0] || null;
    const suggestion = request?.suggestion && typeof request.suggestion === 'object' ? request.suggestion : null;
    let reviewStatus = REVIEW_STATUSES.has(suggestion?.review_status) ? suggestion.review_status : '';
    if (reviewStatus === 'ready' && (dirty || suggestion?.apply_allowed !== true)) reviewStatus = 'stale';
    return {
        request, suggestion, reviewStatus,
        queued: request?.status === 'queued_local_handoff' && !suggestion,
        compare: reviewStatus === 'ready' || reviewStatus === 'stale',
        history: ['held', 'applied', 'applied_then_edited'].includes(reviewStatus),
    };
}

export function designReviewStatusText(status) {
    if (status === 'ready') return '수정안이 도착했습니다';
    if (status === 'stale') return '원문이 바뀌어 적용할 수 없습니다';
    if (status === 'held') return '보류함 · 현재 설계는 그대로';
    if (status === 'applied') return '수정안을 적용했습니다';
    if (status === 'applied_then_edited') return '적용 후 직접 수정됨';
    return '';
}

function placeholder(label) {
    return el('div', {
        className: 'flex aspect-[16/10] w-full items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 text-xs text-secondary',
        attrs: { role: 'img', 'aria-label': `${label} 이미지 없음` },
    }, [el('span', { text: '이미지 없음' })]);
}

function value(label, content) {
    if (!content && content !== 0) return null;
    return el('div', { className: 'flex min-w-0 flex-col gap-1' }, [
        el('dt', { text: label, className: 'text-xs font-semibold text-secondary' }),
        el('dd', { text: Array.isArray(content) ? content.join(', ') : content, className: 'm-0 break-words text-xs leading-5 text-white' }),
    ]);
}

function group(number, title, items, fields) {
    return el('section', { className: 'flex min-w-0 flex-col gap-3', attrs: { 'aria-labelledby': `suggested-design-${number}` } }, [
        el('h4', { text: `${number}. ${title}`, className: 'text-sm font-bold text-white', attrs: { id: `suggested-design-${number}` } }),
        items.length
            ? el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2' }, items.map((item, index) => card([
                placeholder(item.name || item.title || `${title} ${index + 1}`),
                el('dl', { className: 'm-0 flex min-w-0 flex-col gap-2' }, fields(item).map(([label, content]) => value(label, content)).filter(Boolean)),
            ], 'flex min-w-0 flex-col gap-3')))
            : el('p', { text: '제안된 항목이 없습니다.', className: 'text-xs text-secondary', attrs: { role: 'status' } }),
    ]);
}

export function ReadonlyDesignBoard({ board: input }) {
    const board = normalizeDesignBoard(input, false);
    const names = new Map(board.characters.map((item) => [item.id, item.name]));
    const locations = new Map(board.locations.map((item) => [item.id, item.name]));
    return el('div', { className: 'flex min-w-0 flex-col gap-5' }, [
        group(1, '인물 시트', board.characters, (item) => [
            ['이름', item.name], ['역할', item.role], ['외형', item.appearance], ['의상', item.wardrobe], ['연속성', item.continuity],
        ]),
        group(2, '장소 시트', board.locations, (item) => [
            ['이름', item.name], ['공간', item.space], ['조명', item.lighting], ['소품', item.props], ['연속성', item.continuity],
        ]),
        group(3, '장면 카드', board.scenes, (item) => [
            ['제목', item.title], ['핵심 장면', item.dramatic_beat], ['등장인물', item.characters.map((id) => names.get(id) || '').filter(Boolean)],
            ['장소', locations.get(item.location_id) || ''], ['길이', `${item.duration}초`], ['첫 화면', item.first_frame],
            ['행동', item.action], ['카메라', item.camera], ['조명', item.lighting], ['소리', item.audio_sfx_dialogue],
        ]),
    ]);
}

export function DesignSuggestionPanel({ view, currentBoard, onDecide, registerDirty }) {
    const status = el('p', {
        text: designReviewStatusText(view.reviewStatus),
        className: `text-xs leading-5 ${view.reviewStatus === 'stale' ? 'text-amber-100' : 'text-secondary'}`,
        attrs: { role: 'status', 'aria-live': 'polite' },
    });
    const apply = actionButton('수정안 적용', {
        disabled: view.reviewStatus !== 'ready' || view.suggestion?.apply_allowed !== true,
        onClick: () => onDecide?.({ suggestion_token: view.suggestion?.suggestion_token, action: 'apply' }),
    });
    registerDirty?.(() => {
        apply.disabled = true;
        status.textContent = designReviewStatusText('stale');
        status.className = 'text-xs leading-5 text-amber-100';
    });
    return el('div', { className: 'grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2' }, [
        el('section', { className: 'flex min-w-0 flex-col gap-3', attrs: { 'aria-labelledby': 'current-design-title' } }, [
            el('h3', { text: '현재 설계', className: 'text-base font-bold text-white', attrs: { id: 'current-design-title' } }), currentBoard,
        ]),
        el('section', { className: 'flex min-w-0 flex-col gap-3 rounded-md border border-cyan-400/20 bg-black/20 p-3', attrs: { 'aria-labelledby': 'agent-design-title' } }, [
            el('div', {}, [
                el('h3', { text: '에이전트 수정안', className: 'text-base font-bold text-white', attrs: { id: 'agent-design-title' } }),
                view.suggestion?.summary ? el('p', { text: view.suggestion.summary, className: 'mt-1 text-xs leading-5 text-secondary' }) : null,
            ]),
            ReadonlyDesignBoard({ board: view.suggestion?.proposed_board }),
            status,
            el('div', { className: 'flex flex-wrap gap-2' }, [
                apply,
                actionButton('보류', { variant: 'muted', onClick: () => onDecide?.({ suggestion_token: view.suggestion?.suggestion_token, action: 'hold' }) }),
            ]),
        ]),
    ]);
}

export function DesignSuggestionHistory({ view, dirty, onDecide, registerDirty }) {
    const status = el('p', { text: designReviewStatusText(view.reviewStatus), className: 'text-xs text-secondary', attrs: { role: 'status', 'aria-live': 'polite' } });
    const apply = view.reviewStatus === 'held' ? actionButton('수정안 적용', {
        disabled: dirty || view.suggestion?.apply_allowed !== true,
        onClick: () => onDecide?.({ suggestion_token: view.suggestion?.suggestion_token, action: 'apply' }),
    }) : null;
    registerDirty?.(() => {
        if (apply) apply.disabled = true;
        status.textContent = designReviewStatusText('stale');
        status.className = 'text-xs text-amber-100';
    });
    return el('div', { className: 'flex min-w-0 flex-col gap-2' }, [
        status,
        el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
            el('summary', { text: '지난 수정안 보기', className: 'min-h-11 cursor-pointer py-3 text-xs font-semibold text-white' }),
            el('div', { className: 'flex min-w-0 flex-col gap-3 pb-3' }, [
                ReadonlyDesignBoard({ board: view.suggestion?.proposed_board }),
                apply,
            ].filter(Boolean)),
        ]),
    ]);
}
