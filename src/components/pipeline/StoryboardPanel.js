import {
    MEDIA_REVIEW_FILTERS,
    buildMediaReviewDraft,
    buildRetryQueue,
    deriveMediaAttempts,
    filterMediaAttempts,
    groupMediaAttempts,
    setMediaReview,
    setMediaReviewNote,
    toggleRetrySelection,
} from '../../lib/pipeline/mediaReviewBoard.js';
import { ReferenceRail, SceneReviewRow } from './MediaReviewBoardParts.js';
import { MediaRetryPlanBand } from './MediaRetryPlanBand.js';
import { NewProjectDesignBoard } from './NewProjectDesignBoard.js';
import { actionButton, el, emptyState, panelShell } from './ui.js';
import { p } from './copy.js';

const FILTER_LABELS = Object.freeze({
    [MEDIA_REVIEW_FILTERS.ALL]: '전체',
    [MEDIA_REVIEW_FILTERS.NEEDS_REVIEW]: '검토 필요',
    [MEDIA_REVIEW_FILTERS.RETRY_SELECTED]: '다시 만들기 선택',
});

export function StoryboardPanel({
    state,
    mediaRetryPlan,
    mediaReviewSaveStatus = '',
    onMediaReviewSaveStatusChange,
    onSavePlanningFile,
    onRefreshMediaRetryPlan,
    dstBundleImportWorkspace,
    dstBundleImportPreview,
    dstBundleImportPlan,
    onRefreshDstBundleImportWorkspace,
    onLoadDstBundleImportPreview,
    onPlanDstBundleImport,
    onConfirmDstBundleImport,
    videoResultImportWorkspace,
    videoResultImportPlan,
    onRefreshVideoResultImportWorkspace,
    onLoadVideoResultImportPreview,
    onPlanVideoResultImport,
    onConfirmVideoResultImport,
    newProjectDesignState,
    newProjectDesignBoard,
    newProjectDesignDirty,
    newProjectDesignNotice,
    onNewProjectDesignChange,
    onSaveNewProjectDesign,
    onEnqueueDesignAgentRequest,
    onRunDesignAgentRequest,
    onRefreshNewProjectDesign,
    onDecideDesignAgentSuggestion,
}) {
    let attempts = deriveMediaAttempts(state).map((attempt) => ({
        ...attempt,
        review_status: attempt.review_status || 'unreviewed',
        selected_for_retry: attempt.selected_for_retry === true,
    }));
    let filter = MEDIA_REVIEW_FILTERS.ALL;
    let queued = [];
    let saveStatus = mediaReviewSaveStatus;
    const board = el('div', { className: 'media-review-workspace' });

    const renderBoard = () => {
        const visible = filterMediaAttempts(attempts, filter);
        const grouped = groupMediaAttempts(visible);
        const storyboard = state.storyboard || [];
        const clipById = new Map(storyboard.map((clip) => [clip.clip_id, clip]));
        const sceneById = new Map(grouped.scenes.map((group) => [group.target_id, group]));
        const sceneGroups = storyboard.map((clip) => sceneById.get(clip.clip_id) || {
            target_id: clip.clip_id,
            images: [],
            videos: [],
        });
        grouped.scenes.forEach((group) => {
            if (!clipById.has(group.target_id)) sceneGroups.push(group);
        });
        const selectedCount = buildRetryQueue(attempts).length;
        const actions = {
            onReview(mediaId, reviewStatus) {
                attempts = setMediaReview(attempts, mediaId, reviewStatus);
                queued = [];
                renderBoard();
            },
            onRetry(mediaId) {
                attempts = toggleRetrySelection(attempts, mediaId);
                queued = [];
                renderBoard();
            },
            onNote(mediaId, value) {
                attempts = setMediaReviewNote(attempts, mediaId, value);
            },
        };

        const filters = el('div', { className: 'media-review-filters', attrs: { role: 'group', 'aria-label': '미디어 검토 필터' } },
            Object.values(MEDIA_REVIEW_FILTERS).map((value) => actionButton(FILTER_LABELS[value], {
                variant: filter === value ? 'primary' : 'muted',
                onClick: () => {
                    filter = value;
                    renderBoard();
                },
            })),
        );
        [...filters.childNodes].forEach((button, index) => {
            const value = Object.values(MEDIA_REVIEW_FILTERS)[index];
            button.setAttribute('aria-pressed', String(filter === value));
        });

        const toolbar = el('div', { className: 'media-review-toolbar' }, [
            filters,
            el('div', { className: 'media-review-toolbar-actions' }, [
                el('span', { text: `다시 만들기 ${selectedCount}개 선택`, className: 'media-review-count', attrs: { 'aria-live': 'polite' } }),
                actionButton('선택 항목 순차 대기열에 담기', {
                    disabled: selectedCount === 0,
                    onClick: () => {
                        queued = buildRetryQueue(attempts);
                        renderBoard();
                    },
                }),
                actionButton('검토 초안 저장', {
                    variant: 'muted',
                    disabled: !state.project?.root_path || typeof onSavePlanningFile !== 'function',
                    onClick: async () => {
                        const content = `${JSON.stringify(buildMediaReviewDraft(attempts), null, 2)}\n`;
                        const result = await onSavePlanningFile({
                            rootPath: state.project.root_path,
                            relativePath: 'reviews/media_review_draft.json',
                            content,
                        });
                        saveStatus = result?.ok ? '검토 초안 저장됨' : '검토 초안 저장 차단됨';
                        onMediaReviewSaveStatusChange?.(saveStatus);
                        if (result?.ok && typeof onRefreshMediaRetryPlan === 'function') {
                            await onRefreshMediaRetryPlan();
                        }
                        renderBoard();
                    },
                }),
            ]),
        ]);

        const queueBand = el('div', { className: 'media-review-queue-status' }, [
            el('strong', { text: queued.length ? `실행 안 함 · 순차 대기열 ${queued.length}개` : '대기열 초안' }),
            el('span', { text: queued.length
                ? queued.map((item) => `${item.sequence}. ${item.target_id} (${item.provider || '제공자 미상'})`).join(' · ')
                : '선택 항목을 담아도 실제 이미지·영상 생성은 시작되지 않습니다.' }),
            saveStatus ? el('span', { text: saveStatus, attrs: { role: 'status', 'aria-live': 'polite' } }) : null,
        ]);

        const children = [
            toolbar,
            queueBand,
            el('div', { className: 'media-review-reference-grid' }, [
                ReferenceRail('캐릭터 시트', '등장인물의 정면·측면·표정 기준을 장면보다 먼저 확인합니다.', grouped.characterSheets, actions),
                ReferenceRail('장소 시트', '장면 전체에서 유지할 공간·조명·소품 기준입니다.', grouped.locationSheets, actions),
            ]),
            ...sceneGroups.map((group) => SceneReviewRow(group, clipById.get(group.target_id), actions)),
            MediaRetryPlanBand({
                plan: mediaRetryPlan,
                onRefresh: onRefreshMediaRetryPlan,
                dstBundleImportWorkspace,
                dstBundleImportPreview,
                dstBundleImportPlan,
                onRefreshDstBundleImportWorkspace,
                onLoadDstBundleImportPreview,
                onPlanDstBundleImport,
                onConfirmDstBundleImport,
                videoResultImportWorkspace,
                videoResultImportPlan,
                onRefreshVideoResultImportWorkspace,
                onLoadVideoResultImportPreview,
                onPlanVideoResultImport,
                onConfirmVideoResultImport,
            }),
        ];
        if (!attempts.length) children.push(emptyState('media_attempts.jsonl에 기록된 생성 시도가 없습니다.'));
        board.replaceChildren(...children);
    };

    renderBoard();
    return panelShell(
        p('Storyboard'),
        '인물과 장소를 먼저 정한 뒤 장면을 순서대로 설계합니다.',
        [
            NewProjectDesignBoard({
                designState: newProjectDesignState,
                boardValue: newProjectDesignBoard,
                dirty: newProjectDesignDirty,
                notice: newProjectDesignNotice,
                onBoardChange: onNewProjectDesignChange,
                onSave: onSaveNewProjectDesign,
                onEnqueue: onEnqueueDesignAgentRequest,
                onRun: onRunDesignAgentRequest,
                onRefresh: onRefreshNewProjectDesign,
                onDecide: onDecideDesignAgentSuggestion,
            }),
            el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
                el('summary', { text: '생성 결과 검토', className: 'min-h-11 cursor-pointer py-3 text-sm font-semibold text-white' }),
                el('div', { className: 'pb-3 pt-2' }, [
                    el('p', {
                        text: '생성된 캐릭터·장소 기준과 장면별 이미지·영상을 확인하고 필요한 결과만 다시 고릅니다.',
                        className: 'mb-3 text-xs leading-5 text-secondary',
                    }),
                    board,
                ]),
            ]),
        ],
    );
}
