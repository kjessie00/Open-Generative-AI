import { CommandPreviewCard } from './CommandPreviewCard.js';
import { DstBundleImportBand } from './DstBundleImportBand.js';
import { VideoResultImportBand } from './VideoResultImportBand.js';
import { actionButton, card, el, emptyState, statusBadge } from './ui.js';

const READINESS_LABELS = Object.freeze({
    preview_ready: '미리보기 준비',
    blocked_missing_prompt: '프롬프트 없음',
    blocked_runtime_context: 'Flow 실행 문맥 없음',
    blocked_runtime_unverified: 'Grok 런타임 미검증',
    blocked_reference_contract: '참조 파일 계약 차단',
    blocked_adapter_missing: '어댑터 없음',
    blocked_record_mismatch: '원본 시도 불일치',
});

function retryPlanItem(item) {
    const commandSpec = item.command_spec || {};
    const hasCommand = Boolean(commandSpec.command && Array.isArray(commandSpec.args));
    return el('article', { className: 'flex flex-col gap-3' }, [
        card([
            el('div', { className: 'flex flex-wrap items-start justify-between gap-3' }, [
                el('div', {}, [
                    el('span', { text: `${item.sequence}번`, className: 'media-review-kicker' }),
                    el('h4', { text: item.target_id || item.media_id, className: 'mt-1 font-bold text-white' }),
                    el('p', { text: `${item.provider || '제공자 미상'} · ${item.kind}`, className: 'mt-1 text-xs text-secondary' }),
                ]),
                statusBadge(
                    READINESS_LABELS[item.readiness] || '차단',
                    item.readiness === 'preview_ready' ? 'PREVIEW' : 'BLOCK',
                ),
            ]),
            item.blockers?.length
                ? el('p', { text: item.blockers.join(' · '), className: 'mt-3 break-words text-xs text-secondary' })
                : el('p', { text: '명령 미리보기만 준비됐으며 실제 생성은 실행되지 않습니다.', className: 'mt-3 text-xs text-secondary' }),
        ]),
        hasCommand ? el('details', { className: 'media-retry-command-details' }, [
            el('summary', { text: '명령 미리보기', className: 'cursor-pointer text-sm font-semibold text-cyan' }),
            CommandPreviewCard({ commandSpec }),
        ]) : null,
    ]);
}

export function MediaRetryPlanBand({
    plan,
    onRefresh,
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
}) {
    const items = Array.isArray(plan?.items) ? plan.items : [];
    const dstImageItems = items.filter((item) => (
        String(item.provider || '').toLowerCase() === 'dst'
        && !/(?:video|clip)/i.test(String(item.kind || ''))
    ));
    const videoItems = items.filter((item) => item.kind === 'video'
        && ['flow', 'grok', 'replicate', 'bytedance'].includes(String(item.provider || '').toLowerCase()));
    const loading = plan?.status === 'loading';
    return el('section', { className: 'media-review-band' }, [
        el('header', { className: 'media-review-band-head' }, [
            el('div', {}, [
                el('h3', { text: '제공자별 다시 만들기 계획' }),
                el('p', { text: '저장된 검토 초안을 Electron main이 다시 읽어 만든 순서 고정·실행 안 함 계획입니다.' }),
            ]),
            actionButton(loading ? '확인 중…' : '실행 계획 확인', {
                variant: 'muted',
                disabled: loading || typeof onRefresh !== 'function',
                onClick: () => onRefresh?.(),
            }),
        ]),
        el('div', { className: 'media-review-queue-status' }, [
            statusBadge('실행 안 함', 'BLOCK'),
            el('strong', { text: items.length ? `저장된 순서 ${items.length}개` : '저장된 실행 계획 없음' }),
            plan?.blockers?.length ? el('span', { text: plan.blockers.join(' · ') }) : null,
        ]),
        items.length
            ? el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, items.map(retryPlanItem))
            : emptyState('검토 초안을 저장한 뒤 실행 계획을 확인하세요.'),
        DstBundleImportBand({
            retryItems: dstImageItems,
            workspace: dstBundleImportWorkspace,
            preview: dstBundleImportPreview,
            plan: dstBundleImportPlan,
            onRefresh: onRefreshDstBundleImportWorkspace,
            onLoadPreview: onLoadDstBundleImportPreview,
            onPlan: onPlanDstBundleImport,
            onConfirm: onConfirmDstBundleImport,
        }),
        VideoResultImportBand({
            retryItems: videoItems,
            workspace: videoResultImportWorkspace,
            plan: videoResultImportPlan,
            onRefresh: onRefreshVideoResultImportWorkspace,
            onLoadPreview: onLoadVideoResultImportPreview,
            onPlan: onPlanVideoResultImport,
            onConfirm: onConfirmVideoResultImport,
        }),
    ]);
}
