import { actionButton, el, emptyState, panelShell } from './ui.js';
import { VideoTaskCard } from './VideoTaskCard.js';
import { normalizeVideoTasks, videoProgress } from './videoPreparationUi.js';

export function VideoPreparationPanel({
    videoPlanState, videoPlanTasks, videoPlanNotice = '', videoResultWorkspace, videoResultPreviews = {},
    onVideoPromptChange, onVideoProviderChange, onSaveVideoPlan, onPrepareVideoPlan, onToggleVideoRetry,
    onRefreshVideoResults, onLoadVideoCandidatePreview, onConnectVideoResult, onOpenVideoResultReview, onOpenVideoNext,
    onRequestVideoAgentEdit, onDecideVideoAgentEdit,
}) {
    let tasks = normalizeVideoTasks(videoPlanTasks || videoPlanState?.tasks, videoPlanState?.review_decisions);
    const progress = videoProgress(tasks);
    const allApproved = tasks.length > 0 && tasks.every((task) => (
        task.status === '결과연결' && Boolean(task.result_token) && task.review_decision === 'use'
    ));
    const nextText = progress.next ? `${progress.next.sequence}. ${progress.next.label}`
        : allApproved ? '클립 선택으로 이동' : tasks.length ? '결과 검토' : '장면 설계 먼저 완성';
    const busy = ['saving', 'preparing'].includes(videoPlanState?.status);

    const content = el('section', { className: 'flex min-w-0 flex-col gap-4', attrs: { 'aria-labelledby': 'video-workbench-title' } }, [
        el('header', { className: 'rounded-lg border border-white/10 bg-white/[0.035] p-4' }, [
            el('h3', { text: '지금 할 영상', className: 'text-lg font-bold text-white', attrs: { id: 'video-workbench-title' } }),
            el('p', {
                text: `완료 ${progress.complete}/${progress.total} · 다시 만들기 ${progress.retry} · 다음: ${nextText}`,
                className: 'text-sm font-semibold leading-6 text-white', attrs: { role: 'status', 'aria-live': 'polite' },
            }),
            el('p', { text: '장면 순서대로 위에서부터 확인하세요.', className: 'mt-1 text-xs leading-5 text-secondary' }),
            el('div', { className: 'mt-3 flex flex-wrap gap-2' }, [
                actionButton('프롬프트 저장', { disabled: busy || !tasks.length, onClick: () => onSaveVideoPlan?.(tasks) }),
                actionButton('영상 작업 준비', { variant: 'muted', disabled: busy || !tasks.length, onClick: () => onPrepareVideoPlan?.(tasks) }),
                allApproved && typeof onOpenVideoNext === 'function'
                    ? actionButton('클립 선택으로', { variant: 'muted', onClick: onOpenVideoNext })
                    : null,
            ]),
            el('p', {
                text: videoPlanNotice || '영상 작업 준비는 순서와 프롬프트만 저장합니다. 영상 생성은 시작하지 않습니다.',
                className: 'mt-2 text-xs leading-5 text-secondary', attrs: { role: 'status', 'aria-live': 'polite' },
            }),
        ]),
        tasks.length
            ? el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3' }, tasks.map((task) => VideoTaskCard({
                task, resultPreview: videoResultPreviews[task.result_token] || null, resultWorkspace: videoResultWorkspace,
                agentRequest: videoPlanState?.collaboration?.recent_requests?.find((request) => (
                    request.target_task_token === task.task_token && ['queued_local_handoff', 'suggestion_ready'].includes(request.status)
                )),
                onPromptChange: (taskToken, prompt) => {
                    tasks = tasks.map((item) => item.task_token === taskToken ? { ...item, prompt } : item);
                    onVideoPromptChange?.(taskToken, prompt);
                },
                onProviderChange: (taskToken, provider) => {
                    tasks = tasks.map((item) => item.task_token === taskToken ? { ...item, provider } : item);
                    onVideoProviderChange?.(taskToken, provider);
                },
                onToggleRetry: onToggleVideoRetry, onRefreshResults: onRefreshVideoResults,
                onLoadCandidatePreview: onLoadVideoCandidatePreview, onConnectResult: onConnectVideoResult,
                onRequestAgentEdit: onRequestVideoAgentEdit, onDecideAgentEdit: onDecideVideoAgentEdit,
            })))
            : emptyState('장면 설계와 참조 이미지를 준비하면 영상 작업이 순서대로 나옵니다.'),
        el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
            el('summary', { text: '기존 영상 검토', className: 'min-h-11 cursor-pointer py-3 text-sm font-semibold text-white' }),
            el('div', { className: 'flex flex-col gap-3 pb-3 pt-1' }, [
                el('p', { text: '연결한 영상의 사용 구간은 클립 검토 화면에서 고릅니다.', className: 'text-sm leading-6 text-secondary' }),
                actionButton('결과 검토로 이동', { variant: 'muted', onClick: () => onOpenVideoResultReview?.() }),
            ]),
        ]),
    ]);
    return panelShell('영상 작업', '장면별 완료 영상을 연결하고 다시 만들 항목만 고릅니다.', [content]);
}

export default VideoPreparationPanel;
