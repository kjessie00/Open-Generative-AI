import { actionButton, card, dataTable, el, panelShell } from './ui.js';
import { p } from './copy.js';
import { blockerLabel, gateLabel, plainStatus } from './generationUi.js';
import { normalizeImageTasks } from './imagePreparationUi.js';
import { normalizeVideoTasks } from './videoPreparationUi.js';

const GATE_ORDER = [
    'image_prompt',
    'image_qa',
    'dashboard',
    'prompt_media',
    'preflight',
    'submit_confirmation',
    'frame_qa',
    'accepted_seconds',
];

function mediaSummary(tasks) {
    const total = tasks.length;
    const use = tasks.filter((task) => (
        task.status === '결과연결' && Boolean(task.result_token) && task.review_decision === 'use'
    )).length;
    const retry = tasks.filter((task) => task.review_decision === 'retry').length;
    const pending = Math.max(0, total - use - retry);
    return { total, use, retry, pending, state: total > 0 && use === total ? 'ready' : retry ? 'retry' : 'pending' };
}

const STATE_TEXT = Object.freeze({ pending: '확인 필요', use: '사용', retry: '다시 만들기', ready: '준비됨' });

function reviewRow(title, detail, state, actionLabel, onOpen) {
    return card([
        el('div', { className: 'flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between' }, [
            el('div', { className: 'min-w-0' }, [
                el('h3', { text: title, className: 'text-base font-bold text-white' }),
                el('p', { text: detail, className: 'mt-1 text-sm leading-6 text-secondary' }),
                el('p', {
                    text: STATE_TEXT[state] || STATE_TEXT.pending,
                    className: 'mt-1 text-sm font-semibold text-white',
                    attrs: { role: 'status', 'data-review-state': state },
                }),
            ]),
            typeof onOpen === 'function' ? actionButton(actionLabel, { variant: 'muted', onClick: onOpen }) : null,
        ]),
    ], 'min-w-0');
}

function newProjectReviewGates(props) {
    const images = mediaSummary(normalizeImageTasks(
        props.imagePlanTasks || props.imagePlanState?.tasks,
        props.imageReviewDecisions || props.imagePlanState?.review_decisions,
    ));
    const videos = mediaSummary(normalizeVideoTasks(
        props.videoPlanTasks || props.videoPlanState?.tasks,
        props.videoReviewDecisions || props.videoPlanState?.review_decisions,
    ));
    const selection = props.newProjectClipSelectionState || {};
    const selected = Number(selection.accepted_count) || 0;
    const selectionTotal = Number(selection.total_count) || 0;
    const selectionState = selectionTotal > 0 && selected === selectionTotal ? 'ready' : 'pending';
    const final = props.newProjectFinalRenderState || {};
    const finalState = final.review_decision === 'use' ? 'use'
        : final.review_decision === 'retry' ? 'retry'
            : final.rendered ? 'pending'
                : props.newProjectFinalStitchState?.staged ? 'ready' : 'pending';

    return panelShell('검토 게이트', '결과 연결, 사람 검토, 구간 선택, 최종 확인을 섞지 않고 보여줍니다.', [
        el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2' }, [
            reviewRow('이미지 결과', `사용 ${images.use}/${images.total} · 확인 ${images.pending} · 다시 ${images.retry}`,
                images.state, '스토리보드 검토 열기', props.onOpenNewProjectResultReview),
            reviewRow('영상 결과', `사용 ${videos.use}/${videos.total} · 확인 ${videos.pending} · 다시 ${videos.retry}`,
                videos.state, '스토리보드 검토 열기', props.onOpenNewProjectResultReview),
            reviewRow('클립 구간', `선택 ${selected}/${selectionTotal}`,
                selectionState, '클립 선택 열기', props.onOpenNewProjectClipSelection),
            reviewRow('최종 검토', final.rendered ? '검토용 영상을 재생하고 사용 여부를 선택하세요.' : '모든 구간을 선택한 뒤 검토용 영상을 만듭니다.',
                finalState, '최종 편집 열기', props.onOpenNewProjectFinal),
        ]),
    ]);
}

export function ReviewGatesPanel(props) {
    const { state } = props;
    if (props.imagePlanState || props.videoPlanState || props.newProjectClipSelectionState
        || props.newProjectFinalStitchState || props.newProjectFinalRenderState) {
        return newProjectReviewGates(props);
    }
    const gates = state.reviewGates || [];
    const ordered = [
        ...GATE_ORDER.map((type) => gates.find((gate) => gate.type === type) || {
            gate_id: `missing_${type}`,
            clip_id: '',
            type,
            status: 'UNREVIEWED',
            evidence_path: '',
            blocker: '',
            notes: p('No gate record loaded.'),
        }),
        ...gates.filter((gate) => !GATE_ORDER.includes(gate.type)),
    ];

    return panelShell(p('Review Gates'), p('Every gate status must stay separate: pipeline pass is not output-quality acceptance.'), [
        el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, ordered.map((gate) => (
            el('article', { className: 'rounded-lg border border-white/10 bg-white/[0.035] p-4' }, [
                el('div', { className: 'flex items-center justify-between gap-3' }, [
                    el('h3', { text: gateLabel(gate.type), className: 'text-base font-bold text-white' }),
                    plainStatus(gate.status),
                ]),
                gate.blocker ? el('p', { text: blockerLabel(gate.blocker), className: 'mt-3 text-sm text-amber-100', title: gate.blocker }) : null,
                gate.notes ? el('p', { text: gate.notes, className: 'mt-2 text-sm leading-6 text-secondary' }) : null,
                el('details', { className: 'mt-4' }, [
                    el('summary', { text: '세부 기록', className: 'cursor-pointer text-xs font-semibold text-secondary' }),
                    el('div', { className: 'mt-3' }, [dataTable([
                        { label: '항목', key: 'field' },
                        { label: '내용', key: 'value' },
                    ], [
                        { field: '게이트 ID', value: gate.gate_id },
                        { field: '클립', value: gate.clip_id },
                        { field: '근거 파일', value: gate.evidence_path },
                    ])]),
                ]),
            ])
        ))),
    ]);
}
