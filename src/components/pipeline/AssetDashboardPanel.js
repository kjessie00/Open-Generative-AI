import { BLOCKERS } from '../../lib/pipeline/blockers.js';
import { validateImageDashboard } from '../../lib/pipeline/validators.js';
import { card, dataTable, el, infoGrid, panelShell } from './ui.js';
import { p } from './copy.js';
import { issueList, plainStatus } from './generationUi.js';

function hasAssetException(asset) {
    return asset.review_verdict === 'EXCEPTION' || asset.explicit_exception === true || asset.exception_approved === true;
}

function assetSubmitBlocked(asset) {
    return ['RETRY', 'BLOCK', 'UNREVIEWED'].includes(asset.review_verdict || 'UNREVIEWED') && !hasAssetException(asset);
}

export function AssetDashboardPanel({ state, compact = false }) {
    const dashboardResult = validateImageDashboard(state);
    const assets = state.imageDashboard?.assets || state.assets || [];
    const submitBlockingAssets = assets.filter(assetSubmitBlocked);
    const blockers = [
        ...dashboardResult.blockers,
        ...(submitBlockingAssets.length ? [BLOCKERS.IMAGE_GEMINI_REVIEW_NOT_PASS] : []),
    ];
    const dashboard = state.imageDashboard || {};
    const reviewPassed = assets.filter((asset) => asset.review_verdict === 'PASS' || hasAssetException(asset)).length;

    const summary = card([
            el('strong', { text: dashboardResult.ok ? '이미지 현황이 최신입니다' : '이미지 현황을 확인하세요', className: 'text-sm text-white' }),
            el('p', {
                text: `검토 완료 ${reviewPassed}/${assets.length} · ${dashboard.parsed === false ? '파일을 읽지 못함' : '파일 읽음'}`,
                className: 'mt-1 text-sm text-secondary',
            }),
        ], dashboardResult.ok ? 'border-emerald-400/20' : 'border-amber-400/20');
    if (compact) {
        return el('section', { className: 'flex flex-col gap-3', attrs: { 'aria-labelledby': 'existing-image-summary-title' } }, [
            el('div', {}, [
                el('h3', { text: '기존 이미지 현황', className: 'text-sm font-semibold text-white', attrs: { id: 'existing-image-summary-title' } }),
                el('p', { text: '기존 제작 폴더의 검토 수만 보여 줍니다.', className: 'mt-1 text-xs leading-5 text-secondary' }),
            ]),
            summary,
            blockers.length ? card([
                el('strong', { text: `먼저 확인할 자료 ${new Set(blockers).size}개`, className: 'text-sm text-white' }),
                el('p', { text: '자세한 검토는 결과 검토 화면에서 진행하세요.', className: 'mt-1 text-xs leading-5 text-secondary' }),
            ]) : null,
        ].filter(Boolean));
    }

    return panelShell(p('First Frames And References'), p('Harness image dashboard mirror. Video submission remains blocked when required assets are RETRY, BLOCK, or UNREVIEWED without an explicit exception.'), [
        summary,
        issueList(blockers),
        infoGrid([
            { label: p('Dashboard path'), value: dashboard.path || p('No dashboard path recorded') },
            { label: p('Dashboard updated'), value: dashboard.updated_at || '—' },
            { label: p('Dashboard parsed'), value: dashboard.parsed === false ? p('no') : p('yes') },
            { label: p('Dashboard stale'), value: dashboardResult.blockers.includes(BLOCKERS.IMAGE_DASHBOARD_STALE) ? p('yes') : p('no') },
            { label: p('Submit-blocking assets'), value: submitBlockingAssets.map((asset) => asset.asset_id || asset.path).join(', ') || p('none') },
            { label: p('Parse error'), value: dashboard.error || p('none') },
        ]),
        dashboardResult.details?.newerAssetOrReviewTimes?.length ? card([
            el('div', { text: p('Newer asset/review timestamps'), className: 'mb-3 text-xs font-semibold text-secondary' }),
            el('ul', { className: 'space-y-1 font-mono text-xs text-secondary' }, dashboardResult.details.newerAssetOrReviewTimes.map((time) => el('li', { text: time }))),
        ], 'border-yellow-400/20') : null,
        dataTable([
            { label: p('Asset'), key: 'asset_id' },
            { label: p('Path'), key: 'path' },
            { label: p('Type'), key: 'type' },
            { label: p('Target shot'), key: 'target_clip_id' },
            { label: p('Prompt path'), key: 'prompt_path' },
            { label: p('Review path'), key: 'review_path' },
            { label: p('Verdict'), render: (asset) => plainStatus(asset.review_verdict || 'UNREVIEWED') },
            { label: p('Video-use status'), key: 'video_use_status' },
            { label: p('Continuity notes'), key: 'continuity_notes' },
            { label: p('Retry notes'), key: 'retry_notes' },
            { label: p('Submit gate'), render: (asset) => plainStatus(assetSubmitBlocked(asset) ? 'BLOCK' : 'PASS') },
        ], assets),
    ]);
}
