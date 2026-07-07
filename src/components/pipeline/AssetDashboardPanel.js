import { BLOCKERS } from '../../lib/pipeline/blockers.js';
import { validateImageDashboard, validateSubmitAllowed } from '../../lib/pipeline/validators.js';
import { blockerList, card, dataTable, el, infoGrid, panelShell, statusBadge } from './ui.js';

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

    return panelShell('Assets', 'Harness image dashboard mirror. Video submission remains blocked when required assets are RETRY, BLOCK, or UNREVIEWED without an explicit exception.', [
        el('div', { className: 'flex flex-wrap gap-2' }, [
            statusBadge(dashboardResult.ok ? 'dashboard current' : 'dashboard blocked', dashboardResult.ok ? 'PASS' : 'BLOCK'),
            statusBadge(dashboard.parsed === false ? 'content not parsed' : 'content parsed or fixture', dashboard.parsed === false ? 'BLOCK' : 'PASS'),
            statusBadge(`${reviewPassed}/${assets.length} image reviews pass/exception`, reviewPassed === assets.length && assets.length ? 'PASS' : 'BLOCK'),
            ...submitResult.blockers.map((blocker) => statusBadge(blocker, 'BLOCK')),
        ]),
        blockerList(blockers),
        infoGrid([
            { label: 'Dashboard path', value: dashboard.path || 'No dashboard path recorded' },
            { label: 'Dashboard updated', value: dashboard.updated_at || '—' },
            { label: 'Dashboard parsed', value: dashboard.parsed === false ? 'no' : 'yes' },
            { label: 'Dashboard stale', value: dashboardResult.blockers.includes(BLOCKERS.IMAGE_DASHBOARD_STALE) ? 'yes' : 'no' },
            { label: 'Submit-blocking assets', value: submitBlockingAssets.map((asset) => asset.asset_id || asset.path).join(', ') || 'none' },
            { label: 'Parse error', value: dashboard.error || 'none' },
        ]),
        dashboardResult.details?.newerAssetOrReviewTimes?.length ? card([
            el('div', { text: 'Newer asset/review timestamps', className: 'mb-3 text-[11px] font-bold uppercase tracking-widest text-secondary' }),
            el('div', { className: 'flex flex-wrap gap-2' }, dashboardResult.details.newerAssetOrReviewTimes.map((time) => statusBadge(time, 'WARN'))),
        ], 'border-yellow-400/20') : null,
        dataTable([
            { label: 'Asset', key: 'asset_id' },
            { label: 'Path', key: 'path' },
            { label: 'Type', key: 'type' },
            { label: 'Target shot', key: 'target_clip_id' },
            { label: 'Prompt path', key: 'prompt_path' },
            { label: 'Review path', key: 'review_path' },
            { label: 'Verdict', render: verdictBadge },
            { label: 'Video-use status', key: 'video_use_status' },
            { label: 'Continuity notes', key: 'continuity_notes' },
            { label: 'Retry notes', key: 'retry_notes' },
            { label: 'Submit gate', render: (asset) => statusBadge(assetSubmitBlocked(asset) ? BLOCKERS.IMAGE_GEMINI_REVIEW_NOT_PASS : 'usable', assetSubmitBlocked(asset) ? 'BLOCK' : 'PASS') },
        ], assets),
    ]);
}
