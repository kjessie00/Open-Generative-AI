import { actionButton, el, emptyState, panelShell } from './ui.js';

const STATUS_TEXT = Object.freeze({
    queued: '시작 전',
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

function reviewDecisionMap(planState) {
    return new Map((Array.isArray(planState?.review_decisions) ? planState.review_decisions : [])
        .map((decision) => [decision?.task_token, decision?.decision]));
}

function displayPlanTasks(lane, tasks, planState) {
    const decisions = reviewDecisionMap(planState);
    return (Array.isArray(tasks) ? tasks : []).map((task) => {
        const connected = task?.status === '결과연결' && Boolean(task.result_token);
        const retry = task?.status === '재제작';
        const hasResult = (connected || retry) && Boolean(task.result_token);
        return {
            ...task,
            lane,
            sequence: Number(task.sequence) || 0,
            label: String(task.label || (lane === 'video' ? '이름 없는 영상' : '이름 없는 이미지')),
            status: hasResult ? 'succeeded' : 'queued',
            progress: hasResult ? 100 : 0,
            result_received: hasResult,
            result_match_status: hasResult ? 'connected' : '',
            quality_decision: retry ? 'retry' : decisions.get(task.task_token) || task.review_decision || 'pending',
        };
    });
}

function summarizeTasks(tasks) {
    return Object.freeze({
        queued: tasks.filter((task) => task.status === 'queued').length,
        running: tasks.filter((task) => task.status === 'running').length,
        succeeded: tasks.filter((task) => task.status === 'succeeded').length,
        failed: tasks.filter((task) => task.status === 'failed').length,
    });
}

function currentPlanLane(lane, tasks, planState) {
    const source = Array.isArray(tasks) ? tasks
        : Array.isArray(planState?.tasks) ? planState.tasks : null;
    return {
        authoritative: source !== null,
        tasks: source === null ? [] : displayPlanTasks(lane, source, planState),
    };
}

function validTaskToken(task) {
    return typeof task?.task_token === 'string' && task.task_token.length ? task.task_token : '';
}

function validSequence(task) {
    const sequence = Number(task?.sequence);
    return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

function laneSequenceKey(task) {
    if (!['image', 'video'].includes(task?.lane)) return '';
    const sequence = validSequence(task);
    return sequence === null ? '' : `${task.lane}\0${sequence}`;
}

function overlayExecutionTasks(receiptTasks, imagePlan, videoPlan) {
    if (!imagePlan.authoritative && !videoPlan.authoritative) return [...receiptTasks];
    const receiptByTask = new Map(receiptTasks
        .filter((task) => validTaskToken(task))
        .map((task) => [`${task.lane}\0${task.task_token}`, task]));
    const receiptSequenceCounts = new Map();
    const receiptBySequence = new Map();
    receiptTasks.forEach((task) => {
        const key = laneSequenceKey(task);
        if (!key) return;
        receiptSequenceCounts.set(key, (receiptSequenceCounts.get(key) || 0) + 1);
        receiptBySequence.set(key, task);
    });
    const mergeReceipt = (current, receipt) => {
        const receiptOverlay = {};
        [
            'status', 'status_label', 'progress', 'failure_label', 'result_received',
            'result_match_status', 'result_candidate_token', 'result_image_index', 'execution_preview',
        ].forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(receipt, field)) receiptOverlay[field] = receipt[field];
        });
        const connected = current.result_match_status === 'connected';
        const receiptMatch = ['ready', 'waiting'].includes(receipt.result_match_status)
            ? receipt.result_match_status : '';
        return {
            ...receiptOverlay,
            ...current,
            status: connected ? current.status : receipt.status || current.status,
            progress: connected ? current.progress
                : Number.isFinite(Number(receipt.progress)) ? Number(receipt.progress) : current.progress,
            result_received: connected ? current.result_received
                : typeof receipt.result_received === 'boolean'
                ? receipt.result_received : current.result_received,
            result_match_status: connected ? 'connected' : receiptMatch,
            quality_decision: current.quality_decision,
        };
    };
    const mergeLane = (lane, plan) => {
        if (!plan.authoritative) return receiptTasks.filter((task) => task.lane === lane);
        const planSequenceCounts = new Map();
        plan.tasks.forEach((task) => {
            const key = laneSequenceKey(task);
            if (key) planSequenceCounts.set(key, (planSequenceCounts.get(key) || 0) + 1);
        });
        return plan.tasks.map((current) => {
            const currentToken = validTaskToken(current);
            const exactReceipt = currentToken
                ? receiptByTask.get(`${lane}\0${currentToken}`) : null;
            if (exactReceipt) {
                const currentSequence = validSequence(current);
                const receiptSequence = validSequence(exactReceipt);
                return currentSequence !== null && receiptSequence !== null && currentSequence !== receiptSequence
                    ? current : mergeReceipt(current, exactReceipt);
            }

            const key = laneSequenceKey(current);
            if (!key || planSequenceCounts.get(key) !== 1 || receiptSequenceCounts.get(key) !== 1) return current;
            const receipt = receiptBySequence.get(key);
            return receipt && !validTaskToken(receipt) ? mergeReceipt(current, receipt) : current;
        });
    };
    return [
        ...mergeLane('image', imagePlan),
        ...mergeLane('video', videoPlan),
    ];
}

function nextExecutionAction(tasks) {
    const activeTask = (laneTasks) => laneTasks.find((task) => task.status === 'failed')
        || laneTasks.find((task) => task.status === 'running')
        || laneTasks.find((task) => task.status === 'queued')
        || laneTasks.find((task) => task.result_match_status !== 'connected');
    const workItem = (active) => {
        const kind = active.lane === 'video' ? 'video' : 'image';
        return Object.freeze({
            id: 'work-item',
            label: `${laneTitle(kind)} ${active.sequence}. ${shortLabel(active.label)}`,
            tab: kind === 'video' ? 'videos' : 'assets',
            kind,
            sequence: active.sequence,
        });
    };
    const imageTasks = tasks.filter((task) => task.lane === 'image');
    const videoTasks = tasks.filter((task) => task.lane === 'video');
    if (!imageTasks.length) return Object.freeze({ id: 'image-work', label: '이미지 작업 준비', tab: 'assets' });
    const activeImage = activeTask(imageTasks);
    if (activeImage) return workItem(activeImage);
    if (!imageTasks.every((task) => task.quality_decision === 'use')) {
        return Object.freeze({ id: 'result-review', label: '결과 검토', tab: 'storyboard' });
    }
    if (!videoTasks.length) return Object.freeze({ id: 'video-work', label: '영상 작업 준비', tab: 'videos' });
    const activeVideo = activeTask(videoTasks);
    if (activeVideo) return workItem(activeVideo);
    if (!videoTasks.every((task) => task.quality_decision === 'use')) {
        return Object.freeze({ id: 'result-review', label: '결과 검토', tab: 'storyboard' });
    }
    return Object.freeze({ id: 'clip-selection', label: '클립 선택', tab: 'qa' });
}

export function deriveExecutionDisplayState({
    executionState = {}, imagePlanState = {}, imagePlanTasks,
    videoPlanState = {}, videoPlanTasks,
} = {}) {
    const receiptTasks = Array.isArray(executionState.tasks) ? executionState.tasks : [];
    const imagePlan = currentPlanLane('image', imagePlanTasks, imagePlanState);
    const videoPlan = currentPlanLane('video', videoPlanTasks, videoPlanState);
    const tasks = overlayExecutionTasks(receiptTasks, imagePlan, videoPlan);
    const imageTasks = tasks.filter((task) => task.lane === 'image');
    const videoTasks = tasks.filter((task) => task.lane === 'video');
    const laneSummary = Object.freeze({
        image: Object.freeze({
            total: imageTasks.length,
            connected: imageTasks.filter((task) => task.result_match_status === 'connected').length,
        }),
        video: Object.freeze({
            total: videoTasks.length,
            connected: videoTasks.filter((task) => task.result_match_status === 'connected').length,
        }),
    });
    return Object.freeze({
        source: receiptTasks.length ? 'execution' : tasks.length ? 'plans' : 'empty',
        tasks: Object.freeze(tasks),
        summary: summarizeTasks(tasks),
        laneSummary,
        nextAction: nextExecutionAction(tasks),
        prepared: executionState.prepared === true,
    });
}

function executionPreviewDetails(task) {
    if (task.status !== 'queued') return null;
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
    const status = STATUS_TEXT[task.status] || task.status_label || '시작 전';
    const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));
    const waitingForConnection = task.status === 'succeeded' && task.result_match_status === 'waiting';
    const statusText = task.status === 'running' ? `${status} ${progress}%`
        : task.status === 'failed' && task.failure_label ? `${status} · ${task.failure_label}`
            : task.result_match_status === 'connected' ? `${status} · 작업대에 연결됨 · ${task.quality_decision === 'use'
                ? '사용 확인' : task.quality_decision === 'retry' ? '다시 만들기' : '확인 필요'}`
                : task.result_match_status === 'ready' ? `${status} · 연결 준비됨`
                    : waitingForConnection ? `${status} · 연결 확인 필요`
                        : task.status === 'queued'
                            && task.execution_preview?.reason === 'private_replicate_request_ready'
                            ? `${status} · 요청 준비됨` : status;
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
                text: statusText,
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
        actionButton(task.result_match_status === 'ready' ? '결과 확인'
            : waitingForConnection ? '결과 연결 확인' : `${laneTitle(lane)} 작업 열기`, {
            variant: task.result_received ? 'primary' : 'muted',
            onClick: () => onOpenWorkItem?.({
                kind: lane,
                sequence: task.sequence,
                candidateToken: task.result_candidate_token || '',
                imageIndex: task.result_image_index || 0,
                openConnector: waitingForConnection,
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
    imagePlanState, imagePlanTasks, videoPlanState, videoPlanTasks,
    hasProductionRoot = false, onRefreshExecution, onStageExecution, onOpenWorkItem,
    onOpenNextAction, onOpenLegacyQueue,
}) {
    const displayState = deriveExecutionDisplayState({
        executionState, imagePlanState, imagePlanTasks, videoPlanState, videoPlanTasks,
    });
    const tasks = displayState.tasks;
    const summary = displayState.summary;
    const imageTasks = tasks.filter((task) => task.lane === 'image');
    const videoTasks = tasks.filter((task) => task.lane === 'video');
    const nextText = displayState.nextAction.label;

    return panelShell('작업 진행', '이미지를 먼저 완성한 뒤 영상을 만듭니다.', [
        el('section', {
            className: 'flex min-w-0 flex-col gap-4',
            attrs: { 'data-work-progress': '', 'aria-label': '새 프로젝트 작업 진행' },
        }, [
            el('div', { className: 'rounded-lg border border-white/10 bg-white/[0.035] p-4' }, [
                el('p', {
                    text: `시작 전 ${summary.queued || 0} · 진행 ${summary.running || 0} · 결과 ${summary.succeeded || 0} · 문제 ${summary.failed || 0}`,
                    className: 'text-sm font-semibold leading-6 text-white', attrs: { role: 'status', 'aria-live': 'polite' },
                }),
                el('p', { text: `다음 할 일: ${nextText}`, className: 'mt-1 text-sm leading-6 text-secondary' }),
                el('p', {
                    text: '작업 목록 준비는 프롬프트와 순서만 저장합니다. 이미지나 영상 생성은 시작하지 않습니다.',
                    className: 'mt-1 text-xs leading-5 text-secondary',
                }),
                el('div', { className: 'mt-3' }, [stageGuide(imageTasks, videoTasks, displayState.prepared)]),
                el('div', { className: 'mt-3 flex flex-wrap items-center gap-3' }, [
                    tasks.length && !displayState.prepared
                        ? actionButton(executionRefreshing ? '준비 중…' : '실행 목록 준비', {
                            variant: 'primary', disabled: executionRefreshing,
                            onClick: () => onStageExecution?.(),
                        })
                        : tasks.length ? el('span', {
                            text: '실행 목록 준비됨 · 생성은 아직 시작하지 않음',
                            className: 'text-sm font-semibold text-emerald-200',
                        }) : null,
                    onOpenNextAction && ['image-work', 'video-work', 'result-review', 'clip-selection'].includes(displayState.nextAction.id)
                        ? actionButton(displayState.nextAction.label, {
                            variant: 'muted', onClick: () => onOpenNextAction(displayState.nextAction),
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
