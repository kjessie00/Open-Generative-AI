import { el } from './ui.js';

const STAGE_COPY = Object.freeze({
    design: '인물·장소·장면을 같은 연출 기준으로 설계합니다.',
    prepare: '프롬프트와 생성 결과를 이 기준으로 비교합니다.',
    select: '쓸 구간이 연출 의도와 맞는지 확인합니다.',
    finish: '최종 영상에서 지킬 점과 피할 점을 다시 확인합니다.',
});

const FIELD_LABELS = Object.freeze([
    ['director_intent', '연출 의도'],
    ['visual_thesis', '화면 핵심'],
    ['must_preserve', '꼭 지킬 점'],
    ['must_avoid', '피할 점'],
]);

export function CinematicTemplateSummary({ stageId, template = {} }) {
    if (template.mode !== 'cinematic' || !STAGE_COPY[stageId]) return null;

    return el('details', {
        className: 'cinematic-template-summary rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04]',
        attrs: { 'data-cinematic-stage': stageId },
    }, [
        el('summary', {
            className: 'min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-white',
        }, [
            el('span', { text: '시네마틱 기준' }),
            el('span', { text: ` · ${STAGE_COPY[stageId]}`, className: 'font-normal text-secondary' }),
        ]),
        el('dl', {
            className: 'grid grid-cols-1 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-2',
        }, FIELD_LABELS.map(([key, label]) => el('div', {
            className: 'min-w-0 bg-[#101010] px-4 py-3',
        }, [
            el('dt', { text: label, className: 'text-xs font-semibold text-secondary' }),
            el('dd', {
                text: String(template[key] || '').trim() || '아직 입력하지 않음',
                className: 'mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-white',
            }),
        ]))),
    ]);
}
