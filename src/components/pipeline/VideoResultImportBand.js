import { createG3PreviewObjectUrl } from '../../lib/pipeline/g3PreviewObjectUrl.js';
import { actionButton, card, el, emptyState } from './ui.js';

const PROVIDER_LABELS = Object.freeze({ flow: 'Flow', grok: 'Grok' });
const BLOCKER_LABELS = Object.freeze({
    VIDEO_IMPORT_CANDIDATE_EMPTY: '가져올 완료 영상이 없습니다.',
    VIDEO_IMPORT_PROVIDER_MISMATCH: '선택한 영상과 다시 만들기 도구가 다릅니다.',
    VIDEO_IMPORT_RETRY_REQUIRED: '영상 다시 만들기 항목을 먼저 저장하세요.',
    VIDEO_IMPORT_PLAN_STALE: '파일이 바뀌었습니다. 다시 확인하세요.',
    VIDEO_IMPORT_SOURCE_CHANGED: '원본 영상이 바뀌었습니다. 목록을 새로고침하세요.',
});

function formatBytes(value) {
    if (!Number.isFinite(value) || value <= 0) return '크기 미상';
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function candidateLabel(candidate) {
    const provider = PROVIDER_LABELS[candidate.provider] || candidate.provider || '영상';
    const durationSeconds = candidate.duration_seconds ?? candidate.duration_sec;
    const duration = Number.isFinite(durationSeconds) ? `${durationSeconds.toFixed(1)}초` : '길이 미상';
    return `${provider} · ${candidate.result_id || '완료 결과'} · ${duration} · ${formatBytes(candidate.size_bytes)}`;
}

function labeledSelect(id, labelText, options, value, onChange) {
    const select = el('select', {
        value,
        className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
        attrs: { id },
    }, options.map((option) => el('option', { value: option.value, text: option.label })));
    select.addEventListener('change', () => onChange(select.value));
    return el('div', { className: 'flex min-w-0 flex-col gap-2' }, [
        el('label', { text: labelText, className: 'text-xs font-semibold text-secondary', attrs: { for: id } }),
        select,
    ]);
}

function blockerText(blockers = []) {
    return blockers.map((blocker) => BLOCKER_LABELS[blocker] || '가져오기 준비를 다시 확인하세요.').join(' ');
}

export function VideoResultImportBand({
    retryItems = [],
    workspace,
    plan,
    onRefresh,
    onLoadPreview,
    onPlan,
    onConfirm,
}) {
    const candidates = Array.isArray(workspace?.candidates) ? workspace.candidates : [];
    let selectedRetryMediaId = retryItems[0]?.media_id || '';
    let selectedCandidateToken = '';
    let activePlan = plan?.status && !['empty', 'idle'].includes(plan.status) ? plan : null;
    let activePreview = null;
    let busy = false;
    let requestVersion = 0;
    let feedback = '';

    const root = el('section', {
        className: 'border-t border-white/10 p-4',
        attrs: { 'aria-labelledby': 'video-result-import-title' },
    });

    const disposePreview = () => {
        requestVersion += 1;
        activePreview?.dispose();
        activePreview = null;
    };

    const render = () => {
        const retryItem = retryItems.find((item) => item.media_id === selectedRetryMediaId);
        const matchingCandidates = candidates.filter((candidate) => candidate.provider === retryItem?.provider);
        if (!matchingCandidates.some((candidate) => candidate.candidate_token === selectedCandidateToken)) {
            selectedCandidateToken = '';
        }
        const candidate = matchingCandidates.find((item) => item.candidate_token === selectedCandidateToken);
        const imported = activePlan?.imported === true || activePlan?.already_current === true;
        const planReady = activePlan?.ready === true && Boolean(activePlan?.plan_token);
        const statusText = imported
            ? '영상이 장면 검토 보드에 연결되었습니다.'
            : planReady
                ? '가져올 영상과 장면을 확인했습니다.'
                : blockerText(activePlan?.blockers);

        root.replaceChildren(...[
            el('div', { className: 'flex flex-wrap items-start justify-between gap-3' }, [
                el('div', {}, [
                    el('h4', { text: '완료 영상 가져오기', className: 'text-sm font-bold text-white', attrs: { id: 'video-result-import-title' } }),
                    el('p', { text: 'Flow·Grok에서 완료된 영상을 골라 장면별 검토 보드에 연결합니다.', className: 'mt-1 text-xs text-secondary' }),
                ]),
                actionButton(workspace?.status === 'loading' ? '확인 중…' : '완료 영상 새로고침', {
                    variant: 'muted',
                    disabled: workspace?.status === 'loading' || typeof onRefresh !== 'function',
                    onClick: () => onRefresh?.(),
                }),
            ]),
            retryItems.length
                ? el('div', { className: 'mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2' }, [
                    labeledSelect('video-import-retry-target', '다시 만들기 항목', retryItems.map((item) => ({
                        value: item.media_id,
                        label: `${item.sequence}. ${item.target_id || item.media_id} · ${PROVIDER_LABELS[item.provider] || item.provider}`,
                    })), selectedRetryMediaId, (value) => {
                        selectedRetryMediaId = value;
                        selectedCandidateToken = '';
                        activePlan = null;
                        feedback = '';
                        disposePreview();
                        render();
                    }),
                    labeledSelect('video-import-candidate', '완료된 영상', [
                        { value: '', label: matchingCandidates.length ? '영상을 선택하세요' : '이 도구의 완료 영상 없음' },
                        ...matchingCandidates.map((item) => ({ value: item.candidate_token, label: candidateLabel(item) })),
                    ], selectedCandidateToken, (value) => {
                        selectedCandidateToken = value;
                        activePlan = null;
                        feedback = '';
                        disposePreview();
                        render();
                    }),
                ])
                : emptyState('영상 다시 만들기 항목을 선택하고 검토 초안을 먼저 저장하세요.'),
            candidate ? card([
                el('p', { text: `${candidateLabel(candidate)} · ${candidate.width}×${candidate.height}`, className: 'text-sm text-secondary' }),
                el('div', { className: 'mt-3 flex flex-wrap gap-3' }, [
                    actionButton('영상 미리보기', {
                        variant: 'muted',
                        disabled: busy || !candidate.preview_allowed || typeof onLoadPreview !== 'function',
                        onClick: async () => {
                            disposePreview();
                            const version = requestVersion;
                            feedback = '영상을 불러오는 중…';
                            render();
                            const loaded = await onLoadPreview({ candidateToken: candidate.candidate_token }).catch(() => null);
                            const prepared = createG3PreviewObjectUrl(loaded);
                            if (version !== requestVersion || ('isConnected' in root && !root.isConnected)) {
                                prepared.dispose();
                                return;
                            }
                            if (!prepared.ok) {
                                feedback = '미리보기를 안전하게 불러오지 못했습니다.';
                                render();
                                return;
                            }
                            activePreview = prepared;
                            feedback = '';
                            render();
                        },
                    }),
                    actionButton(busy ? '확인 중…' : '가져오기 계획', {
                        disabled: busy || typeof onPlan !== 'function',
                        onClick: async () => {
                            busy = true;
                            feedback = '';
                            render();
                            activePlan = await onPlan({ candidateToken: candidate.candidate_token, retryMediaId: selectedRetryMediaId })
                                .catch(() => ({ status: 'blocked', blockers: ['VIDEO_IMPORT_PLAN_FAILED'] }));
                            busy = false;
                            render();
                        },
                    }),
                    planReady && !imported ? actionButton('이 영상 연결', {
                        disabled: busy || typeof onConfirm !== 'function',
                        onClick: async () => {
                            busy = true;
                            render();
                            const result = await onConfirm({ planToken: activePlan.plan_token, confirmed: true })
                                .catch(() => ({ imported: false, blockers: ['VIDEO_IMPORT_CONFIRM_FAILED'] }));
                            activePlan = { ...activePlan, ...result, ready: false };
                            busy = false;
                            feedback = result?.imported || result?.already_current ? '장면 검토 보드에 연결했습니다.' : '가져오기가 차단되었습니다.';
                            render();
                        },
                    }) : null,
                ]),
                activePreview?.ok ? el('video', {
                    className: 'mt-4 max-h-80 w-full rounded-md bg-black object-contain',
                    attrs: { src: activePreview.url, controls: '', playsinline: '', preload: 'metadata', 'aria-label': '선택한 완료 영상 미리보기' },
                }) : null,
                statusText ? el('p', { text: statusText, className: 'mt-3 text-sm text-secondary', attrs: { role: planReady || imported ? 'status' : 'alert' } }) : null,
                feedback ? el('p', { text: feedback, className: 'mt-2 text-sm font-semibold text-cyan', attrs: { role: 'status', 'aria-live': 'polite' } }) : null,
            ]) : null,
        ].filter(Boolean));
    };

    render();
    if (typeof globalThis.MutationObserver === 'function') {
        const observer = new globalThis.MutationObserver(() => {
            if (root.isConnected) return;
            disposePreview();
            observer.disconnect();
        });
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    }
    return root;
}
