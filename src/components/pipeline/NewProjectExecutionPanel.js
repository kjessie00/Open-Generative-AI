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
            el('div', { className: 'flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1' }, [
                el('strong', { text: `${task.sequence}. ${task.label}`, className: 'break-words text-sm text-white' }),
                task.provider_label ? el('span', { text: task.provider_label, className: 'text-xs text-secondary' }) : null,
            ]),
            task.provider_status_label ? el('p', {
                text: task.provider_status_label,
                className: 'mt-1 text-xs leading-5 text-secondary',
            }) : null,
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

export function NewProjectExecutionPanel({
    executionState, executionNotice = '', executionRefreshing = false,
    hasProductionRoot = false, onRefreshExecution, onOpenWorkItem, onOpenLegacyQueue,
}) {
    const tasks = Array.isArray(executionState?.tasks) ? executionState.tasks : [];
    const summary = executionState?.summary || {};
    const imageTasks = tasks.filter((task) => task.lane === 'image');
    const videoTasks = tasks.filter((task) => task.lane === 'video');
    const next = tasks.find((task) => task.status === 'failed')
        || tasks.find((task) => task.status === 'running')
        || tasks.find((task) => task.status === 'queued');
    const nextText = next ? `${laneTitle(next.lane)} ${next.sequence}. ${shortLabel(next.label)}` : tasks.length ? '도착한 결과 확인' : '이미지 작업 준비';

    return panelShell('작업 진행', '이미지와 영상이 어디까지 왔는지 순서대로 확인합니다.', [
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
                el('div', { className: 'mt-3 flex flex-wrap items-center gap-3' }, [
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
