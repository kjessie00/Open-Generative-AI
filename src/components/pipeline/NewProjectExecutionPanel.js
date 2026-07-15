import { actionButton, el, emptyState, panelShell } from './ui.js';

const STATUS_TEXT = Object.freeze({
    queued: '대기',
    running: '진행 중',
    succeeded: '결과 도착',
    failed: '문제 발생',
});

function laneTitle(lane) {
    return lane === 'video' ? '영상' : '이미지';
}

function shortLabel(label) {
    const parts = String(label || '').split(' · ');
    return parts.length > 1 ? parts.slice(1).join(' · ') : String(label || '');
}

const EXECUTION_PREVIEW_TEXT = Object.freeze({
    preview_ready: '내용 확인 가능 · 작업 내용이 준비되었습니다.',
    runnable: '실행 가능 · 필요한 자료가 준비되었습니다.',
    setup_required: '준비 필요 · 먼저 필요한 자료를 확인하세요.',
    review_required: '확인 필요 · 작업 조건을 확인하세요.',
    result_only: '결과만 연결 · 이 작업대에서는 생성을 시작하지 않습니다.',
});

function executionPreviewDetails(task) {
    const preview = task.execution_preview;
    if (!preview || !EXECUTION_PREVIEW_TEXT[preview.mode]) return null;
    const output = preview.output_kind === 'video' ? '영상 1개' : '이미지 1장';
    const reviewRequired = preview.mode === 'review_required';
    return el('div', { className: 'mt-2' }, [
        !reviewRequired ? el('p', {
            text: EXECUTION_PREVIEW_TEXT[preview.mode],
            className: 'text-xs font-semibold leading-5 text-secondary',
        }) : null,
        el('details', { className: 'mt-1 max-w-xl' }, [
            el('summary', {
                text: '실행 전 확인',
                className: 'min-h-11 cursor-pointer py-3 text-xs font-semibold text-cyan-100',
            }),
            el('div', { className: 'space-y-1 border-l border-white/10 pb-2 pl-3 text-xs leading-5 text-secondary' }, [
                reviewRequired ? el('p', {
                    text: EXECUTION_PREVIEW_TEXT[preview.mode],
                    className: 'font-semibold',
                }) : null,
                el('p', { text: preview.user_status }),
                preview.next_action ? el('p', { text: `다음 행동: ${preview.next_action}` }) : null,
                el('p', { text: `예상 결과: ${output}` }),
                el('p', { text: '이 내용을 펼쳐도 실행은 시작되지 않습니다.' }),
            ]),
        ]),
    ]);
}

function taskRow(task, onOpenWorkItem) {
    const lane = task.lane === 'video' ? 'video' : 'image';
    const status = STATUS_TEXT[task.status] || task.status_label || '대기';
    const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
    const stateClass = task.status === 'failed'
        ? 'text-amber-100'
        : task.status === 'succeeded' ? 'text-emerald-200' : 'text-white';

    return el('li', {
        className: 'grid min-w-0 gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
        attrs: {
            'data-work-kind': lane,
            'data-sequence': task.sequence,
            'data-work-state': task.status || 'queued',
        },
    }, [
        el('div', { className: 'min-w-0' }, [
            el('strong', { text: `${task.sequence}. ${task.label}`, className: 'break-words text-sm text-white' }),
            el('p', {
                text: task.status === 'running' ? `${status} ${progress}%`
                    : task.result_match_status === 'connected' ? `${status} · 작업대에 연결됨`
                        : task.result_match_status === 'ready' ? `${status} · 연결 준비됨` : status,
                className: `mt-1 text-sm font-semibold ${stateClass}`,
            }),
            task.status === 'running'
                ? el('progress', {
                    className: 'mt-2 h-2 w-full max-w-md accent-cyan-400',
                    attrs: { value: progress, max: 100, 'aria-label': `${task.label} 진행률` },
                })
                : null,
            executionPreviewDetails(task),
        ]),
        actionButton(task.result_match_status === 'ready' ? '결과 확인' : `${laneTitle(lane)} 작업 열기`, {
            variant: task.result_received ? 'primary' : 'muted',
            onClick: () => onOpenWorkItem?.({
                kind: lane,
                sequence: task.sequence,
                candidateToken: task.result_candidate_token || '',
                imageIndex: task.result_image_index || 0,
            }),
        }),
    ]);
}

function laneSection(lane, tasks, onOpenWorkItem) {
    return el('section', {
        className: 'flex min-w-0 flex-col gap-3',
        attrs: { 'data-work-lane': lane, 'aria-labelledby': `work-lane-${lane}` },
    }, [
        el('h3', { text: `${laneTitle(lane)} 작업`, className: 'text-base font-bold text-white', attrs: { id: `work-lane-${lane}` } }),
        tasks.length
            ? el('ol', { className: 'flex min-w-0 flex-col gap-2' }, tasks.map((task) => taskRow(task, onOpenWorkItem)))
            : emptyState(`${laneTitle(lane)} 작업 준비를 누르면 여기에 순서대로 표시됩니다.`),
    ]);
}

function stageGuide(imageTasks, videoTasks, prepared) {
    const count = (tasks, status) => tasks.filter((task) => task.result_match_status === status).length;
    const rows = [
        ['1', '이미지 목록', imageTasks.length ? `${imageTasks.length}개 ${prepared ? '준비됨' : '확인됨'}` : '준비 전'],
        ['2', '이미지 결과', `${count(imageTasks, 'connected')}/${imageTasks.length}개 연결`],
        ['3', '영상 목록', videoTasks.length ? `${videoTasks.length}개 ${prepared ? '준비됨' : '확인됨'}` : '이미지 다음'],
        ['4', '영상 결과', `${count(videoTasks, 'connected')}/${videoTasks.length}개 연결`],
    ];
    return el('ol', {
        className: 'grid min-w-0 gap-2 sm:grid-cols-2',
        attrs: { 'aria-label': '이미지부터 영상까지 작업 순서' },
    }, rows.map(([number, title, status]) => el('li', {
        className: 'flex min-w-0 items-center gap-3 rounded-md border border-white/10 bg-black/15 px-3 py-3',
    }, [
        el('span', { text: number, className: 'text-sm font-bold text-cyan-200', attrs: { 'aria-hidden': 'true' } }),
        el('span', { className: 'min-w-0' }, [
            el('strong', { text: title, className: 'block text-sm text-white' }),
            el('span', { text: status, className: 'block text-xs leading-5 text-secondary' }),
        ]),
    ])));
}

export function NewProjectExecutionPanel({
    executionState, executionNotice = '', executionRefreshing = false,
    hasProductionRoot = false, onRefreshExecution, onStageExecution, onOpenWorkItem, onOpenLegacyQueue,
}) {
    const tasks = Array.isArray(executionState?.tasks) ? executionState.tasks : [];
    const summary = executionState?.summary || {};
    const imageTasks = tasks.filter((task) => task.lane === 'image');
    const videoTasks = tasks.filter((task) => task.lane === 'video');
    const next = tasks.find((task) => task.status === 'failed')
        || tasks.find((task) => task.status === 'running')
        || tasks.find((task) => task.status === 'queued');
    const nextText = next ? `${laneTitle(next.lane)} ${next.sequence}. ${shortLabel(next.label)}` : tasks.length ? '도착한 결과 확인' : '이미지 작업 준비';

    return panelShell('작업 진행', '이미지를 먼저 완성한 뒤 영상을 만듭니다.', [
        el('section', {
            className: 'flex min-w-0 flex-col gap-4',
            attrs: { 'data-work-progress': '', 'aria-label': '새 프로젝트 작업 진행' },
        }, [
            el('div', { className: 'rounded-lg border border-white/10 bg-white/[0.035] p-4' }, [
                el('p', {
                    text: `대기 ${summary.queued || 0} · 진행 ${summary.running || 0} · 결과 ${summary.succeeded || 0} · 문제 ${summary.failed || 0}`,
                    className: 'text-sm font-semibold leading-6 text-white', attrs: { role: 'status', 'aria-live': 'polite' },
                }),
                el('p', { text: `다음 할 일: ${nextText}`, className: 'mt-1 text-sm leading-6 text-secondary' }),
                el('p', {
                    text: '작업 목록 준비는 프롬프트와 순서만 저장합니다. 이미지나 영상 생성은 시작하지 않습니다.',
                    className: 'mt-1 text-xs leading-5 text-secondary',
                }),
                el('div', { className: 'mt-3' }, [stageGuide(imageTasks, videoTasks, executionState?.prepared === true)]),
                el('div', { className: 'mt-3 flex flex-wrap items-center gap-3' }, [
                    tasks.length && !executionState?.prepared
                        ? actionButton(executionRefreshing ? '준비 중…' : '실행 목록 준비', {
                            variant: 'primary', disabled: executionRefreshing,
                            onClick: () => onStageExecution?.(),
                        })
                        : tasks.length ? el('span', {
                            text: '실행 목록 준비됨 · 생성은 아직 시작하지 않음',
                            className: 'text-sm font-semibold text-emerald-200',
                        }) : null,
                    el('button', {
                        text: executionRefreshing ? '확인 중…' : '새로고침',
                        disabled: executionRefreshing,
                        onClick: () => onRefreshExecution?.(),
                        className: 'ui-action-button min-h-11 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-secondary hover:bg-white/10 disabled:opacity-45',
                        attrs: { type: 'button', 'aria-label': '작업 상태 새로고침' },
                    }),
                    el('span', {
                        text: executionNotice || '외부 실행기가 남긴 로컬 상태만 읽습니다. 이 화면에서 생성은 시작하지 않습니다.',
                        className: 'text-xs leading-5 text-secondary', attrs: { role: 'status', 'aria-live': 'polite' },
                    }),
                ]),
            ]),
            laneSection('image', imageTasks, onOpenWorkItem),
            laneSection('video', videoTasks, onOpenWorkItem),
            hasProductionRoot
                ? el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
                    el('summary', { text: '기존 제작 자료', className: 'min-h-11 cursor-pointer py-3 text-sm font-semibold text-white' }),
                    el('div', { className: 'pb-3' }, [
                        actionButton('기존 제작 대기열 열기', { variant: 'muted', onClick: () => onOpenLegacyQueue?.() }),
                    ]),
                ])
                : null,
        ]),
    ]);
}

export default NewProjectExecutionPanel;
