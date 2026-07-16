import { actionButton, card, el, emptyState } from './ui.js';

function duration(value) {
    const number = Number(value || 0);
    return Number.isInteger(number) ? `${number}` : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function NewProjectFinalStitchPanel({ state, notice = '', onStage, onRefresh, onOpenClipSelection }) {
    const status = state?.status || 'loading';
    const heading = el('div', { className: 'flex flex-wrap items-start justify-between gap-3' }, [
        el('div', {}, [
            el('h3', { text: '최종 편집 준비', className: 'text-lg font-bold text-white' }),
            el('p', {
                text: '선택한 구간을 장면 순서대로 정리해 저장합니다. 아직 영상을 합치거나 완성하지 않습니다.',
                className: 'mt-1 max-w-3xl text-sm leading-6 text-secondary',
            }),
        ]),
        actionButton('새로고침', { variant: 'muted', onClick: onRefresh }),
    ]);
    if (status === 'loading') return el('section', { className: 'flex flex-col gap-3', attrs: { 'aria-label': '최종 편집 준비' } }, [
        heading, emptyState('최종 편집 준비를 확인하는 중입니다.'),
    ]);
    if (!state?.ok) return el('section', { className: 'flex flex-col gap-3', attrs: { 'aria-label': '최종 편집 준비' } }, [
        heading,
        emptyState('모든 장면에서 사용할 구간을 먼저 선택하세요.'),
        actionButton('클립 선택 열기', { variant: 'muted', onClick: onOpenClipSelection }),
    ]);
    return el('section', { className: 'flex flex-col gap-3', attrs: { 'aria-label': '최종 편집 준비' } }, [
        heading,
        el('p', {
            text: `선택 ${state.selected_count}개 · 총 ${duration(state.total_duration_seconds)}초`,
            className: 'text-sm font-semibold text-white', attrs: { role: 'status', 'aria-live': 'polite' },
        }),
        el('ol', { className: 'flex flex-col gap-2' }, (state.clips || []).map((clip) => (
            el('li', { className: 'rounded-md border border-white/10 bg-black/20 px-3 py-3' }, [
                el('p', { text: `${clip.sequence}. ${clip.label}`, className: 'text-sm font-semibold text-white' }),
                el('p', { text: `${duration(clip.in_seconds)}초 → ${duration(clip.out_seconds)}초`, className: 'mt-1 text-sm text-secondary' }),
            ])
        ))),
        state.staged ? card([
            el('p', { text: '준비됨 · 아직 영상으로 합치지 않음', className: 'text-sm font-semibold text-white', attrs: { role: 'status' } }),
        ]) : actionButton('최종 편집 준비 저장', { onClick: onStage }),
        notice ? el('p', { text: notice, className: 'text-sm text-secondary', attrs: { role: 'status', 'aria-live': 'polite' } }) : null,
    ]);
}

export default NewProjectFinalStitchPanel;
