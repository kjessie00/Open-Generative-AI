import { actionButton, el, emptyState, panelShell } from './ui.js';
import { ImageTaskCard } from './ImageTaskCard.js';
import { imageProgress, normalizeImageTasks } from './imagePreparationUi.js';
import { AssetDashboardPanel } from './AssetDashboardPanel.js';

export function GenerationPreparationPanel({
    state, config, imagePlanState, imagePlanTasks, imagePlanNotice = '',
    imageResultWorkspace, imageResultPreviews = {},
    onImagePromptChange, onSaveImagePlan, onPrepareImagePlan, onToggleImageRetry,
    onRefreshImageResults, onLoadImageCandidatePreview, onConnectImageResult,
    onOpenImageResultReview, onOpenImageNext,
    onRequestImageAgentEdit, onDecideImageAgentEdit,
}) {
    let tasks = normalizeImageTasks(imagePlanTasks || imagePlanState?.tasks, imagePlanState?.review_decisions);
    const showExistingProduction = config === undefined || Boolean(config.productionRoot);
    const progress = imageProgress(tasks);
    const allApproved = tasks.length > 0 && tasks.every((task) => (
        task.status === '결과연결' && Boolean(task.result_token) && task.review_decision === 'use'
    ));
    const needsResultReview = tasks.some((task) => (
        Boolean(task.result_token) && task.review_decision !== 'use'
    ));
    const nextText = progress.next
        ? `${progress.next.sequence}. ${progress.next.label}`
        : allApproved ? '영상 작업으로 이동' : tasks.length ? '결과 검토' : '설계 먼저 완성';
    const busy = ['saving', 'preparing'].includes(imagePlanState?.status);

    const progressLine = el('p', {
        text: `완료 ${progress.complete}/${progress.total} · 다시 만들기 ${progress.retry} · 다음: ${nextText}`,
        className: 'text-sm font-semibold leading-6 text-white',
        attrs: { role: 'status', 'aria-live': 'polite' },
    });

    const workbench = el('section', {
        className: 'flex min-w-0 flex-col gap-4',
        attrs: { 'aria-labelledby': 'image-workbench-title' },
    }, [
        el('header', { className: 'rounded-lg border border-white/10 bg-white/[0.035] p-4' }, [
            el('h3', { text: '지금 할 이미지', className: 'text-lg font-bold text-white', attrs: { id: 'image-workbench-title' } }),
            progressLine,
            el('p', { text: '인물 → 장소 → 장면 순서로 위에서부터 확인하세요.', className: 'mt-1 text-xs leading-5 text-secondary' }),
            el('div', { className: 'mt-3 flex flex-wrap gap-2' }, [
                actionButton('프롬프트 저장', {
                    disabled: busy || !tasks.length,
                    onClick: () => onSaveImagePlan?.(tasks),
                }),
                actionButton('DST 작업 준비', {
                    variant: 'muted',
                    disabled: busy || !tasks.length,
                    onClick: () => onPrepareImagePlan?.(tasks),
                }),
                needsResultReview && typeof onOpenImageResultReview === 'function'
                    ? actionButton('결과 검토로', { variant: 'muted', onClick: onOpenImageResultReview })
                    : null,
                allApproved && typeof onOpenImageNext === 'function'
                    ? actionButton('영상 작업으로', { variant: 'muted', onClick: onOpenImageNext })
                    : null,
            ]),
            el('p', {
                text: imagePlanNotice || 'DST 작업 준비는 순서와 프롬프트만 저장합니다. 이미지 생성은 시작하지 않습니다.',
                className: 'mt-2 text-xs leading-5 text-secondary',
                attrs: { role: 'status', 'aria-live': 'polite' },
            }),
        ]),
        tasks.length
            ? el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3' }, tasks.map((task) => ImageTaskCard({
                task,
                agentRequest: imagePlanState?.collaboration?.recent_requests?.find((request) => (
                    request.target_task_token === task.task_token && ['queued_local_handoff', 'suggestion_ready'].includes(request.status)
                )),
                resultPreview: imageResultPreviews[task.result_token] || null,
                resultWorkspace: imageResultWorkspace,
                onPromptChange: (taskToken, prompt) => {
                    tasks = tasks.map((item) => item.task_token === taskToken ? { ...item, prompt } : item);
                    onImagePromptChange?.(taskToken, prompt);
                },
                onToggleRetry: onToggleImageRetry,
                onRefreshResults: onRefreshImageResults,
                onLoadCandidatePreview: onLoadImageCandidatePreview,
                onConnectResult: onConnectImageResult,
                onRequestAgentEdit: onRequestImageAgentEdit,
                onDecideAgentEdit: onDecideImageAgentEdit,
            })))
            : emptyState('인물·장소·장면 설계를 저장하면 이미지 작업이 순서대로 나옵니다.'),
        el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
            el('summary', { text: '기존 제작 자료', className: 'min-h-11 cursor-pointer py-3 text-sm font-semibold text-white' }),
            el('div', { className: 'flex flex-col gap-3 pb-3 pt-1' }, [
                showExistingProduction
                    ? AssetDashboardPanel({ state, compact: true })
                    : emptyState('연결된 기존 제작 폴더가 없습니다.'),
                el('p', { text: '연결한 이미지를 비교하고 다시 만들 항목을 고르는 화면은 설계와 분리해 열 수 있습니다.', className: 'text-sm leading-6 text-secondary' }),
                actionButton('결과 검토로 이동', {
                    variant: 'muted',
                    onClick: () => onOpenImageResultReview?.(),
                }),
            ]),
        ]),
    ]);

    return panelShell('이미지 작업', '설계에서 나온 인물·장소·장면 이미지를 순서대로 준비합니다.', [workbench]);
}

export default GenerationPreparationPanel;
