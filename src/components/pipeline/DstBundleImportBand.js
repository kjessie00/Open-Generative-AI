import { actionButton, el, emptyState } from './ui.js';

const SAFE_PREVIEW_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

function formatBytes(value) {
    if (!Number.isFinite(value) || value < 0) return '크기 미상';
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCreatedAt(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = (number) => String(number).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function previewSource(candidate) {
    const mimeType = candidate?.preview?.mime_type || candidate?.mime_type || '';
    const base64 = candidate?.preview?.base64 || '';
    if (!SAFE_PREVIEW_MIME.has(mimeType) || !/^[A-Za-z0-9+/=]+$/.test(base64)) return '';
    return `data:${mimeType};base64,${base64}`;
}

function labeledSelect(id, labelText, options, value, onChange) {
    const label = el('label', {
        text: labelText,
        className: 'text-xs font-semibold text-secondary',
        attrs: { for: id },
    });
    const select = el('select', {
        value,
        className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
        attrs: { id },
    }, options.map((option) => el('option', {
        value: option.value,
        text: option.label,
    })));
    select.addEventListener('change', () => onChange(select.value));
    return el('div', { className: 'flex min-w-0 flex-col gap-2' }, [label, select]);
}

export function DstBundleImportBand({
    retryItems = [],
    workspace,
    preview,
    plan,
    onRefresh,
    onLoadPreview,
    onPlan,
    onConfirm,
}) {
    const candidates = Array.isArray(workspace?.candidates) ? workspace.candidates : [];
    let selectedRetryMediaId = retryItems.some((item) => item.media_id === plan?.retry_media_id)
        ? plan.retry_media_id
        : retryItems[0]?.media_id || '';
    let selectedCandidateToken = candidates.find((candidate) => candidate.bundle_id === plan?.source_bundle_id)?.candidate_token
        || candidates[0]?.candidate_token
        || '';
    let activePlan = plan?.status && !['empty', 'idle'].includes(plan.status) ? plan : null;
    let activePreview = preview?.candidate_token === selectedCandidateToken ? preview : null;
    let busy = false;
    let feedback = activePlan?.imported || activePlan?.already_current
        ? '이미지 묶음을 작업대에 연결했습니다.'
        : '';

    const root = el('section', {
        className: 'border-t border-white/10 p-4',
        attrs: { 'aria-labelledby': 'dst-bundle-import-title' },
    });

    const render = () => {
        const candidate = candidates.find((item) => item.candidate_token === selectedCandidateToken);
        const retryItem = retryItems.find((item) => item.media_id === selectedRetryMediaId);
        const previewUrl = previewSource(activePreview);
        const workspaceBlocked = workspace?.status === 'blocked';
        const planReady = activePlan?.ready === true && Boolean(activePlan?.plan_token);
        const imported = activePlan?.imported === true || activePlan?.already_current === true;
        const canPlan = Boolean(selectedRetryMediaId && selectedCandidateToken && typeof onPlan === 'function');

        root.replaceChildren(...[
            el('div', { className: 'flex flex-wrap items-start justify-between gap-3' }, [
                el('div', {}, [
                    el('h4', { text: 'DST 이미지 연결', className: 'text-sm font-bold text-white', attrs: { id: 'dst-bundle-import-title' } }),
                    el('p', { text: '완료된 이미지 묶음을 선택한 항목에 한 번에 연결합니다.', className: 'mt-1 text-xs text-secondary' }),
                ]),
                actionButton(workspace?.status === 'loading' ? '확인 중…' : '결과 목록 새로고침', {
                    variant: 'muted',
                    disabled: workspace?.status === 'loading' || typeof onRefresh !== 'function',
                    onClick: () => onRefresh?.(),
                }),
            ]),
            retryItems.length && candidates.length
                ? el('div', { className: 'mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem]' }, [
                    labeledSelect(
                        'dst-import-retry-target',
                        '연결할 항목',
                        retryItems.map((item) => ({
                            value: item.media_id,
                            label: `${item.sequence}. ${item.target_id || item.media_id} · ${item.kind}`,
                        })),
                        selectedRetryMediaId,
                        (value) => {
                            selectedRetryMediaId = value;
                            activePlan = null;
                            feedback = '';
                            render();
                        },
                    ),
                    labeledSelect(
                        'dst-import-candidate',
                        '완료된 이미지 묶음',
                        candidates.map((item) => ({
                            value: item.candidate_token,
                            label: [formatCreatedAt(item.created_at), `${item.image_count || 1}장`, item.prompt_excerpt || 'DST 완료 이미지', formatBytes(item.total_size_bytes || item.size_bytes)]
                                .filter(Boolean).join(' · '),
                        })),
                        selectedCandidateToken,
                        async (value) => {
                            selectedCandidateToken = value;
                            activePlan = null;
                            activePreview = null;
                            feedback = '';
                            render();
                            if (typeof onLoadPreview === 'function') {
                                try {
                                    const loaded = await onLoadPreview({ candidateToken: value });
                                    if (selectedCandidateToken === value && loaded?.candidate_token === value) activePreview = loaded;
                                } catch {
                                    activePreview = null;
                                }
                                render();
                            }
                        },
                    ),
                    previewUrl
                        ? el('img', {
                            className: 'aspect-video h-full max-h-28 w-full rounded-md border border-white/10 bg-black object-cover',
                            attrs: { src: previewUrl, alt: `${candidate.bundle_id} 결과 미리보기` },
                        })
                        : emptyState('미리보기 없음'),
                ])
                : emptyState(retryItems.length
                    ? workspaceBlocked
                        ? 'DST 완료 결과 목록을 읽지 못했습니다. 결과 목록을 새로고침하세요.'
                        : '가져올 수 있는 완료 이미지가 없습니다.'
                    : 'DST 이미지 다시 만들기 항목을 먼저 선택하고 검토 초안을 저장하세요.'),
            candidate ? el('p', {
                text: [formatCreatedAt(candidate.created_at), candidate.prompt_excerpt].filter(Boolean).join(' · '),
                className: 'mt-3 line-clamp-2 text-xs leading-5 text-secondary',
            }) : null,
            retryItems.length && candidates.length ? el('div', { className: 'mt-4 flex flex-wrap items-center gap-3' }, [
                actionButton(busy ? '확인 중…' : '묶음 확인', {
                    disabled: busy || !canPlan,
                    onClick: async () => {
                        busy = true;
                        feedback = '';
                        render();
                        try {
                            activePlan = await onPlan({
                                candidateToken: selectedCandidateToken,
                                retryMediaId: selectedRetryMediaId,
                            });
                        } catch {
                            activePlan = { status: 'blocked', ready: false, blockers: ['DST_BUNDLE_IMPORT_PLAN_FAILED'] };
                        }
                        busy = false;
                        render();
                    },
                }),
                activePlan ? el('span', {
                    text: imported
                        ? `${activePlan.imported_count || activePlan.image_count || 1}장을 ${activePlan.target_id || retryItem?.target_id || '선택 장면'}에 연결했습니다.`
                        : planReady
                            ? `${activePlan.new_image_count ?? activePlan.image_count ?? candidate?.image_count ?? 1}장을 ${activePlan.target_id || retryItem?.target_id || '선택 장면'}에 연결합니다.`
                            : '이미지 묶음을 확인하지 못했습니다.',
                    className: 'min-w-0 flex-1 break-words text-xs text-secondary',
                    attrs: { role: planReady || imported ? 'status' : 'alert' },
                }) : null,
                planReady && !imported ? actionButton(`${activePlan.new_image_count || activePlan.image_count || candidate?.image_count || 1}장 연결`, {
                    disabled: busy || typeof onConfirm !== 'function',
                    onClick: async () => {
                        busy = true;
                        feedback = '';
                        render();
                        try {
                            const result = await onConfirm({ planToken: activePlan.plan_token, confirmed: true });
                            activePlan = { ...activePlan, ...result, ready: false, status: result?.imported || result?.already_current ? 'imported' : 'blocked' };
                            feedback = result?.imported || result?.already_current
                                ? '이미지 묶음을 작업대에 연결했습니다.'
                                : '이미지 연결이 차단되었습니다.';
                        } catch {
                            activePlan = { ...activePlan, ready: false, status: 'blocked', blockers: ['DST_BUNDLE_IMPORT_CONFIRM_FAILED'] };
                            feedback = '이미지 연결이 차단되었습니다.';
                        }
                        busy = false;
                        render();
                    },
                }) : null,
            ]) : null,
            feedback ? el('p', {
                text: feedback,
                className: 'mt-3 text-xs font-semibold text-cyan',
                attrs: { role: 'status', 'aria-live': 'polite' },
            }) : null,
        ].filter(Boolean));
    };

    render();
    return root;
}
