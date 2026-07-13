import { BLOCKERS } from '../../lib/pipeline/blockers.js';
import { validateImageDashboard, validateSubmitAllowed } from '../../lib/pipeline/validators.js';
import { blockerList, card, dataTable, el, infoGrid, panelShell, statusBadge } from './ui.js';
import { p } from './copy.js';

function verdictBadge(asset) {
    const verdict = asset.review_verdict || 'UNREVIEWED';
    return statusBadge(verdict, verdict);
}

function hasAssetException(asset) {
    return asset.review_verdict === 'EXCEPTION' || asset.explicit_exception === true || asset.exception_approved === true;
}

function assetSubmitBlocked(asset) {
    return ['RETRY', 'BLOCK', 'UNREVIEWED'].includes(asset.review_verdict || 'UNREVIEWED') && !hasAssetException(asset);
}

export function AssetDashboardPanel({ state }) {
    const dashboardResult = validateImageDashboard(state);
    const promptPack = state.promptPacks?.[0];
    const submitResult = validateSubmitAllowed({
        ...state,
        promptPack,
        reviewGates: state.reviewGates || [],
        credit_confirmed: false,
    });
    const assets = state.imageDashboard?.assets || state.assets || [];
    const submitBlockingAssets = assets.filter(assetSubmitBlocked);
    const blockers = [
        ...dashboardResult.blockers,
        ...(submitBlockingAssets.length ? [BLOCKERS.IMAGE_GEMINI_REVIEW_NOT_PASS] : []),
    ];
    const dashboard = state.imageDashboard || {};
    const reviewPassed = assets.filter((asset) => asset.review_verdict === 'PASS' || hasAssetException(asset)).length;

    return panelShell(p('First Frames And References'), p('Harness image dashboard mirror. Video submission remains blocked when required assets are RETRY, BLOCK, or UNREVIEWED without an explicit exception.'), [
        el('div', { className: 'flex flex-wrap gap-2' }, [
            statusBadge(p(dashboardResult.ok ? 'dashboard current' : 'dashboard blocked'), dashboardResult.ok ? 'PASS' : 'BLOCK'),
            statusBadge(p(dashboard.parsed === false ? 'content not parsed' : 'content parsed or fixture'), dashboard.parsed === false ? 'BLOCK' : 'PASS'),
            statusBadge(p('{passed}/{total} image reviews pass/exception', { passed: reviewPassed, total: assets.length }), reviewPassed === assets.length && assets.length ? 'PASS' : 'BLOCK'),
            ...submitResult.blockers.map((blocker) => statusBadge(blocker, 'BLOCK')),
        ]),
        blockerList(blockers),
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
            el('div', { className: 'flex flex-wrap gap-2' }, dashboardResult.details.newerAssetOrReviewTimes.map((time) => statusBadge(time, 'WARN'))),
        ], 'border-yellow-400/20') : null,
        dataTable([
            { label: p('Asset'), key: 'asset_id' },
            { label: p('Path'), key: 'path' },
            { label: p('Type'), key: 'type' },
            { label: p('Target shot'), key: 'target_clip_id' },
            { label: p('Prompt path'), key: 'prompt_path' },
            { label: p('Review path'), key: 'review_path' },
            { label: p('Verdict'), render: verdictBadge },
            { label: p('Video-use status'), key: 'video_use_status' },
            { label: p('Continuity notes'), key: 'continuity_notes' },
            { label: p('Retry notes'), key: 'retry_notes' },
            { label: p('Submit gate'), render: (asset) => statusBadge(assetSubmitBlocked(asset) ? BLOCKERS.IMAGE_GEMINI_REVIEW_NOT_PASS : p('usable'), assetSubmitBlocked(asset) ? 'BLOCK' : 'PASS') },
        ], assets),
    ]);
}
