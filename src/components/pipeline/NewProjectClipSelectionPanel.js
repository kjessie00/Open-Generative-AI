import { actionButton, card, el, emptyState } from './ui.js';

const CONFIDENCE_LABELS = Object.freeze({ high: '높음', medium: '보통', low: '낮음' });

function numericValue(value) {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function timeInput(label, value, duration, onChange) {
    const input = el('input', {
        value: value ?? '',
        className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
        attrs: { type: 'number', min: 0, max: duration, step: 0.01, 'aria-label': label },
    });
    input.addEventListener('input', () => onChange(numericValue(input.value)));
    return input;
}

function clipCard({ clip, preview, onChange }) {
    const video = preview?.source ? el('video', {
        className: 'aspect-video max-h-[28rem] w-full rounded-md bg-black/40 object-contain',
        attrs: { src: preview.source, controls: '', preload: 'metadata', 'aria-label': `${clip.label} 구간 확인 영상` },
    }) : el('div', {
        text: '영상을 불러오는 중입니다.',
        className: 'flex aspect-video items-center justify-center rounded-md border border-dashed border-white/10 p-4 text-sm text-secondary',
        attrs: { role: 'status' },
    });
    const update = (patch) => onChange?.(clip.task_token, patch);
    const start = timeInput(`${clip.label} 시작 초`, clip.in_seconds, clip.duration_seconds, (value) => update({ in_seconds: value }));
    const end = timeInput(`${clip.label} 끝 초`, clip.out_seconds, clip.duration_seconds, (value) => update({ out_seconds: value }));
    const reason = el('textarea', {
        value: clip.reason || '',
        className: 'min-h-24 w-full resize-y rounded-md border border-white/10 bg-black/30 px-3 py-3 text-sm text-white',
        attrs: { maxlength: 2048, 'aria-label': `${clip.label} 선택 이유`, placeholder: '이 구간을 사용할 이유' },
    });
    reason.addEventListener('input', () => update({ reason: reason.value }));
    const confidence = el('select', {
        className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
        attrs: { 'aria-label': `${clip.label} 검토 확신도` },
    }, Object.entries(CONFIDENCE_LABELS).map(([value, text]) => el('option', { value, text })));
    confidence.value = clip.reviewer_confidence || 'medium';
    confidence.addEventListener('change', () => update({ reviewer_confidence: confidence.value }));
    const currentTime = () => Math.min(clip.duration_seconds, Math.max(0, Number(video.currentTime) || 0));
    return card([
        el('header', { className: 'mb-3' }, [
            el('p', { text: `${clip.sequence}. ${clip.label}`, className: 'text-base font-bold text-white' }),
            el('p', { text: `영상 길이 ${clip.duration_seconds}초`, className: 'mt-1 text-sm text-secondary' }),
        ]),
        el('div', { className: 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(14rem,0.7fr)_minmax(18rem,1.3fr)]' }, [
            video,
            el('div', { className: 'flex min-w-0 flex-col gap-3' }, [
                el('div', { className: 'grid grid-cols-1 gap-3 sm:grid-cols-2' }, [
                    el('label', { className: 'text-xs font-semibold text-secondary' }, [el('span', { text: '시작 초', className: 'mb-1 block' }), start]),
                    el('label', { className: 'text-xs font-semibold text-secondary' }, [el('span', { text: '끝 초', className: 'mb-1 block' }), end]),
                ]),
                el('div', { className: 'grid grid-cols-1 gap-2 sm:grid-cols-2' }, [
                    actionButton('여기를 시작으로', { variant: 'muted', disabled: !preview?.source, onClick: () => update({ in_seconds: currentTime() }) }),
                    actionButton('여기를 끝으로', { variant: 'muted', disabled: !preview?.source, onClick: () => update({ out_seconds: currentTime() }) }),
                ]),
                el('label', { className: 'text-xs font-semibold text-secondary' }, [el('span', { text: '선택 이유', className: 'mb-1 block' }), reason]),
                el('label', { className: 'text-xs font-semibold text-secondary' }, [el('span', { text: '확신도', className: 'mb-1 block' }), confidence]),
                el('div', { className: 'grid grid-cols-1 gap-2 sm:grid-cols-2' }, [
                    actionButton('선택 지우기', {
                        variant: 'muted', onClick: () => update({ in_seconds: null, out_seconds: null, reason: '' }),
                    }),
                    actionButton('전체 구간', {
                        variant: 'muted', onClick: () => update({
                            in_seconds: 0, out_seconds: clip.duration_seconds,
                            reason: clip.reason?.trim() || '전체 구간 사용',
                        }),
                    }),
                ]),
            ]),
        ]),
    ]);
}

export function NewProjectClipSelectionPanel({
    selectionState,
    clips = [],
    resultPreviews = {},
    dirty = false,
    notice = '',
    onChange,
    onSave,
    onRefresh,
    onOpenResultReview,
}) {
    const status = selectionState?.status || 'loading';
    const heading = el('div', { className: 'flex flex-wrap items-start justify-between gap-3' }, [
        el('div', {}, [
            el('h3', { text: '새 프로젝트 클립 선택', className: 'text-lg font-bold text-white' }),
            el('p', {
                text: '사용 승인한 영상에서 실제로 쓸 구간을 장면별로 고르세요. 영상 전체가 자동으로 선택되지는 않습니다.',
                className: 'mt-1 max-w-3xl text-sm leading-6 text-secondary',
            }),
        ]),
        actionButton('새로고침', { variant: 'muted', onClick: onRefresh }),
    ]);
    if (status === 'loading') return el('section', { className: 'flex flex-col gap-3', attrs: { 'aria-label': '새 프로젝트 클립 선택' } }, [heading, emptyState('클립을 불러오는 중입니다.')]);
    if (!selectionState?.ok) return el('section', { className: 'flex flex-col gap-3', attrs: { 'aria-label': '새 프로젝트 클립 선택' } }, [
        heading,
        emptyState(status === 'blocked' ? '사용 승인한 영상이 모두 준비되면 클립을 선택할 수 있습니다.' : '클립을 불러오지 못했습니다.'),
        actionButton('결과 검토 열기', { variant: 'muted', onClick: onOpenResultReview }),
    ]);
    if (!clips.length) return el('section', { className: 'flex flex-col gap-3', attrs: { 'aria-label': '새 프로젝트 클립 선택' } }, [heading, emptyState('선택할 영상이 없습니다.')]);
    const accepted = clips.filter((clip) => clip.in_seconds !== null && clip.out_seconds !== null).length;
    return el('section', { className: 'flex flex-col gap-3', attrs: { 'aria-label': '새 프로젝트 클립 선택' } }, [
        heading,
        el('p', {
            text: `선택 ${accepted}/${clips.length}${dirty ? ' · 저장 안 됨' : status === 'saved' || status === 'restored' ? ' · 저장됨' : ''}`,
            className: 'text-sm font-semibold text-white', attrs: { role: 'status', 'aria-live': 'polite' },
        }),
        notice ? el('p', { text: notice, className: 'text-sm text-secondary', attrs: { role: 'status', 'aria-live': 'polite' } }) : null,
        el('div', { className: 'grid grid-cols-1 gap-3 xl:grid-cols-2' }, clips.map((clip) => clipCard({
            clip, preview: resultPreviews[clip.result_token], onChange,
        }))),
        actionButton('선택 저장', { disabled: !dirty, onClick: onSave }),
    ]);
}

export default NewProjectClipSelectionPanel;
