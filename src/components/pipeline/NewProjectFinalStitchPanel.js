import { actionButton, card, el, emptyState } from './ui.js';

function duration(value) {
    const number = Number(value || 0);
    return Number.isInteger(number) ? `${number}` : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function NewProjectFinalStitchPanel({
    state,
    notice = '',
    renderState,
    renderNotice = '',
    previewSource = '',
    onStage,
    onRefresh,
    onRender,
    onOpenClipSelection,
}) {
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
    const renderArea = !state.staged ? null : renderState?.rendered ? card([
        el('p', {
            text: `검토용 영상 ${duration(renderState.output_duration_seconds)}초`,
            className: 'text-sm font-semibold text-white', attrs: { role: 'status' },
        }),
        previewSource ? el('video', {
            className: 'mt-3 w-full max-w-3xl rounded-lg bg-black',
            attrs: { src: previewSource, controls: true, preload: 'metadata', 'aria-label': '검토용 영상' },
        }) : el('p', { text: '영상을 불러오는 중입니다.', className: 'mt-2 text-sm text-secondary' }),
        el('p', {
            text: '파일과 재생 길이만 확인했습니다. 내용과 영상 품질은 아직 승인되지 않았습니다.',
            className: 'mt-3 text-sm leading-6 text-secondary',
        }),
    ]) : card([
        el('p', {
            text: renderState?.status === 'rendering'
                ? '검토용 영상을 만드는 중입니다.'
                : '선택한 구간을 이어 붙여 검토용 영상을 만듭니다.',
            className: 'text-sm leading-6 text-secondary', attrs: { role: 'status', 'aria-live': 'polite' },
        }),
        renderState?.status === 'rendering' ? null : actionButton('검토용 영상 만들기', { onClick: onRender }),
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
            el('p', {
                text: renderState?.rendered ? '준비됨 · 검토용 영상 생성 완료' : '준비됨 · 아직 영상으로 합치지 않음',
                className: 'text-sm font-semibold text-white', attrs: { role: 'status' },
            }),
        ]) : actionButton('최종 편집 준비 저장', { onClick: onStage }),
        renderArea,
        notice ? el('p', { text: notice, className: 'text-sm text-secondary', attrs: { role: 'status', 'aria-live': 'polite' } }) : null,
        renderNotice ? el('p', { text: renderNotice, className: 'text-sm text-secondary', attrs: { role: 'status', 'aria-live': 'polite' } }) : null,
    ]);
}

export default NewProjectFinalStitchPanel;
