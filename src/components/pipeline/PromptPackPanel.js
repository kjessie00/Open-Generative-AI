import { validatePromptPack } from '../../lib/pipeline/validators.js';
import { actionButton, card, dataTable, el, emptyState, panelShell } from './ui.js';
import { p } from './copy.js';
import { issueList, plainStatus } from './generationUi.js';
import { PromptAgentEditor } from './PromptAgentEditor.js';
import { IMAGE_KIND_LABELS, normalizeImageTasks } from './imagePreparationUi.js';
import { normalizeVideoTasks, VIDEO_PROVIDER_LABELS } from './videoPreparationUi.js';

const REQUIRED_NEGATIVE_CONSTRAINTS = [
    'no subtitles',
    'no logo',
    'no watermark',
    'no extra characters',
    'no face morphing',
    'no warped hands',
];

const CONSTRAINT_LABELS = Object.freeze({
    'no subtitles': '자막 없음',
    'no logo': '로고 없음',
    'no watermark': '워터마크 없음',
    'no extra characters': '추가 인물 없음',
    'no face morphing': '얼굴 변형 없음',
    'no warped hands': '손 왜곡 없음',
});

function hasConstraint(promptPack, needle) {
    const text = (promptPack.negative_constraints || []).join(' ').toLowerCase();
    return text.includes(needle.replace('no ', '').toLowerCase()) || text.includes(needle.toLowerCase());
}

function agentRequestFor(planState, taskToken) {
    return planState?.collaboration?.recent_requests?.find((request) => (
        request.target_task_token === taskToken
        && ['queued_local_handoff', 'suggestion_ready'].includes(request.status)
    ));
}

function saveableTasks(tasks) {
    return tasks.map(({ review_decision: _reviewDecision, ...task }) => task);
}

function promptTaskCard({ task, lane, planState, onPromptChange, onRequest, onDecide }) {
    const accepted = Boolean(task.result_token) && task.status !== '재제작';
    const prompt = el('textarea', {
        value: task.prompt,
        disabled: accepted,
        className: 'min-h-36 w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/50 disabled:opacity-55',
        attrs: { maxlength: 12000, 'aria-label': `${task.label} 프롬프트` },
    });
    prompt.addEventListener('input', () => onPromptChange?.(task.task_token, prompt.value));
    const kind = lane === 'image'
        ? IMAGE_KIND_LABELS[task.kind] || '이미지'
        : VIDEO_PROVIDER_LABELS[task.provider] || '영상';
    return card([
        el('header', { className: 'mb-3' }, [
            el('p', { text: `${task.sequence}. ${kind}`, className: 'text-xs font-semibold text-secondary' }),
            el('h3', { text: task.label, className: 'mt-1 text-base font-bold text-white' }),
        ]),
        el('label', { className: 'block text-xs font-semibold text-white' }, [
            el('span', { text: '현재 프롬프트', className: 'mb-2 block' }),
            prompt,
        ]),
        accepted ? el('p', {
            text: '완료 결과를 바꾸려면 먼저 다시 만들기를 선택하세요.',
            className: 'mt-2 text-xs leading-5 text-secondary',
        }) : null,
        PromptAgentEditor({
            task, lane, request: agentRequestFor(planState, task.task_token), onRequest, onDecide,
        }),
    ].filter(Boolean), 'min-w-0');
}

function newProjectPromptPack(props) {
    let imageTasks = normalizeImageTasks(
        props.imagePlanTasks || props.imagePlanState?.tasks,
        props.imageReviewDecisions || props.imagePlanState?.review_decisions,
    );
    let videoTasks = normalizeVideoTasks(
        props.videoPlanTasks || props.videoPlanState?.tasks,
        props.videoReviewDecisions || props.videoPlanState?.review_decisions,
    );
    const imageBusy = ['saving', 'preparing'].includes(props.imagePlanState?.status);
    const videoBusy = ['saving', 'preparing'].includes(props.videoPlanState?.status);
    const lane = (title, subtitle, tasks, notice, busy, onSave, cardBuilder) => el('section', {
        className: 'flex min-w-0 flex-col gap-3', attrs: { 'aria-label': title },
    }, [
        el('header', { className: 'rounded-lg border border-white/10 bg-white/[0.035] p-4' }, [
            el('h3', { text: title, className: 'text-base font-bold text-white' }),
            el('p', { text: subtitle, className: 'mt-1 text-sm leading-6 text-secondary' }),
            el('div', { className: 'mt-3 flex flex-wrap items-center gap-3' }, [
                actionButton('전체 저장', {
                    disabled: busy || !tasks.length || typeof onSave !== 'function',
                    onClick: () => onSave?.(saveableTasks(tasks)),
                }),
                el('p', {
                    text: notice || '직접 고치거나 항목별로 에이전트에게 수정을 요청하세요.',
                    className: 'text-xs leading-5 text-secondary', attrs: { role: 'status', 'aria-live': 'polite' },
                }),
            ]),
        ]),
        tasks.length
            ? el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2' }, tasks.map(cardBuilder))
            : emptyState(`${title}에 표시할 작업이 아직 없습니다.`),
    ]);

    return panelShell('프롬프트 팩', '이미지와 영상 프롬프트를 한 화면에서 고치고 저장합니다.', [
        lane('이미지 프롬프트', '인물 → 장소 → 장면 순서입니다.', imageTasks,
            props.imagePlanNotice, imageBusy, props.onSaveImagePlan,
            (task) => promptTaskCard({
                task, lane: 'image', planState: props.imagePlanState,
                onPromptChange: (taskToken, prompt) => {
                    imageTasks = imageTasks.map((item) => item.task_token === taskToken ? { ...item, prompt } : item);
                    props.onImagePromptChange?.(taskToken, prompt);
                },
                onRequest: props.onRequestImageAgentEdit, onDecide: props.onDecideImageAgentEdit,
            })),
        lane('영상 프롬프트', '장면 순서대로 이미지 다음 움직임을 확인합니다.', videoTasks,
            props.videoPlanNotice, videoBusy, props.onSaveVideoPlan,
            (task) => promptTaskCard({
                task, lane: 'video', planState: props.videoPlanState,
                onPromptChange: (taskToken, prompt) => {
                    videoTasks = videoTasks.map((item) => item.task_token === taskToken ? { ...item, prompt } : item);
                    props.onVideoPromptChange?.(taskToken, prompt);
                },
                onRequest: props.onRequestVideoAgentEdit, onDecide: props.onDecideVideoAgentEdit,
            })),
    ]);
}

export function PromptPackPanel(props) {
    const { state } = props;
    if (props.imagePlanState || props.videoPlanState) return newProjectPromptPack(props);
    const packs = state.promptPacks || [];
    const blockers = packs.flatMap((pack) => validatePromptPack(pack).blockers);
    const musicRequired = state.brief?.music_required === true;

    return panelShell(p('Prompt Packs'), p('Seedance and Flow prompt files, attached assets, prompt/media review state, and negative constraints.'), [
        issueList(blockers),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Generator'), key: 'generator' },
            { label: p('Prompt file'), key: 'prompt_path' },
            { label: p('Model'), key: 'model' },
            { label: p('Duration'), render: (pack) => `${pack.duration || 0}s` },
            { label: p('Aspect'), key: 'aspect_ratio' },
            { label: p('Assets'), render: (pack) => (pack.attached_assets || []).join(', ') || '—' },
            { label: p('No BGM'), render: (pack) => pack.no_bgm_required ? '필수' : '확인 필요' },
            { label: p('Review'), render: (pack) => plainStatus(pack.review_status) },
        ], packs),
        el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, packs.map((pack) => (
            card([
                el('h3', { text: pack.generator || p('generator'), className: 'text-base font-bold text-white' }),
                el('p', {
                    text: `${!musicRequired && pack.no_bgm_required ? '배경음악 없음' : '배경음악 확인 필요'} · 카메라 움직임 1개`,
                    className: 'mt-1 text-sm text-secondary',
                }),
                el('div', { text: p('Negative Constraints'), className: 'mb-2 mt-4 text-xs font-semibold text-secondary' }),
                el('ul', { className: 'grid grid-cols-1 gap-1 text-sm text-secondary sm:grid-cols-2' }, REQUIRED_NEGATIVE_CONSTRAINTS.map((constraint) => (
                    el('li', { text: `${hasConstraint(pack, constraint) ? '완료' : '확인 필요'} · ${CONSTRAINT_LABELS[constraint]}` })
                ))),
                el('details', { className: 'mt-4 text-xs text-secondary' }, [
                    el('summary', { text: '원문 제약 보기', className: 'cursor-pointer font-semibold' }),
                    el('p', { text: (pack.negative_constraints || []).join(', ') || '—', className: 'mt-2 break-words leading-5' }),
                ]),
            ])
        ))),
    ]);
}
