import { actionButton, el, emptyState } from './ui.js';

const SAFE_PREVIEW_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const REFERENCE_KINDS = new Set(['character_sheet', 'location_sheet']);
const INITIAL_KINDS = ['character_sheet', 'location_sheet', 'scene_image'];

const KIND_LABELS = Object.freeze({
    character_sheet: '캐릭터',
    location_sheet: '장소',
    scene_image: '장면',
});

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
    const value = candidate?.preview || candidate || {};
    const mimeType = value.mime_type || '';
    const base64 = value.base64 || '';
    if (!SAFE_PREVIEW_MIME.has(mimeType) || !/^[A-Za-z0-9+/=]+$/.test(base64)) return '';
    return `data:${mimeType};base64,${base64}`;
}

function itemSequence(item) {
    const value = Number(item?.sequence);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function itemLabel(item) {
    return `${itemSequence(item)}. ${item.target_label || item.target_id || item.media_id} · ${KIND_LABELS[item.kind] || '이미지'}`;
}

function initialTargetLabel(item) {
    return `${itemSequence(item)}. ${item.target_label || item.target_id} · ${KIND_LABELS[item.kind] || '이미지'}`;
}

function labeledSelect(id, labelText, options, value, onChange) {
    const label = el('label', {
        text: labelText,
        className: 'text-xs font-semibold text-secondary',
        attrs: { for: id },
    });
    const select = el('select', {
        className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
        attrs: { id },
    }, options.map((option) => el('option', {
        value: option.value,
        text: option.label,
    })));
    select.value = value;
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
    const initialTargets = Array.isArray(workspace?.initial_targets)
        ? workspace.initial_targets.filter((item) => (
            INITIAL_KINDS.includes(item?.kind)
            && typeof item?.target_token === 'string'
            && item.target_token
            && itemSequence(item)
        ))
        : [];
    const initialKinds = INITIAL_KINDS.filter((kind) => initialTargets.some((item) => item.kind === kind));
    const hasInitialMode = initialKinds.length > 0;
    const hasRetryMode = retryItems.length > 0;
    const planUsesInitialTargets = ['initial_targets', 'explicit_initial_targets'].includes(plan?.mapping_mode)
        || plan?.import_mode === 'initial'
        || plan?.initial === true;
    const planUsesRetryItems = Boolean(plan?.retry_media_id)
        || ['single_retry_target', 'explicit_retry_items'].includes(plan?.mapping_mode);
    let selectedMode = planUsesInitialTargets
        ? 'initial'
        : planUsesRetryItems
            ? 'retry'
            : hasInitialMode
                ? 'initial'
                : 'retry';
    let selectedInitialKind = initialKinds.includes(plan?.kind) ? plan.kind : initialKinds[0] || '';
    const plannedRetry = retryItems.find((item) => item.media_id === plan?.retry_media_id);
    let selectedRetryMediaId = plannedRetry?.media_id || retryItems[0]?.media_id || '';
    let selectedCandidateToken = candidates.find((candidate) => candidate.bundle_id === plan?.source_bundle_id)?.candidate_token
        || candidates[0]?.candidate_token
        || '';
    let activePlan = plan?.status && !['empty', 'idle'].includes(plan.status) ? plan : null;
    let activePreview = preview?.candidate_token === selectedCandidateToken ? preview : null;
    const previewCache = new Map();
    if (activePreview?.ready === true && activePreview.preview) {
        const initialIndex = Number.isSafeInteger(Number(activePreview.image_index)) && Number(activePreview.image_index) > 0
            ? Number(activePreview.image_index) : 1;
        previewCache.set(`${selectedCandidateToken}:${initialIndex}`, { status: 'ready', value: activePreview });
    }
    let referenceMappingKey = '';
    let referenceMappings = [];
    let busy = false;
    let feedback = activePlan?.imported || activePlan?.already_current
        ? '이미지 묶음을 작업대에 연결했습니다.'
        : '';

    const root = el('section', {
        className: 'border-t border-white/10 p-4',
        attrs: { 'aria-labelledby': 'dst-bundle-import-title' },
    });

    const resetSelection = () => {
        activePlan = null;
        activePreview = null;
        referenceMappingKey = '';
        referenceMappings = [];
        feedback = '';
    };

    const referenceContext = (candidate, retryItem) => {
        if (!candidate || !REFERENCE_KINDS.has(retryItem?.kind)) return null;
        const count = Number(candidate.image_count) || 1;
        const targets = retryItems
            .filter((item) => item.kind === retryItem.kind && itemSequence(item))
            .sort((left, right) => itemSequence(left) - itemSequence(right));
        const key = `${selectedCandidateToken}:${retryItem.kind}:${count}:${targets.map((item) => item.media_id).join(',')}`;
        if (referenceMappingKey !== key) {
            referenceMappingKey = key;
            referenceMappings = Array.from({ length: count }, (_, index) => targets[index]?.media_id || '');
        }
        const availableTargets = new Set(targets.map((item) => item.media_id));
        const selected = referenceMappings.filter(Boolean);
        const complete = referenceMappings.length === count
            && selected.length === count
            && new Set(selected).size === count
            && selected.every((mediaId) => availableTargets.has(mediaId));
        return { count, targets, complete };
    };

    const initialContext = (candidate) => {
        if (!candidate || selectedMode !== 'initial' || !selectedInitialKind) return null;
        const count = Number(candidate.image_count) || 1;
        const targets = initialTargets
            .filter((item) => item.kind === selectedInitialKind)
            .sort((left, right) => itemSequence(left) - itemSequence(right));
        const key = `initial:${selectedCandidateToken}:${selectedInitialKind}:${count}:${targets.map((item) => item.target_token).join(',')}`;
        if (referenceMappingKey !== key) {
            referenceMappingKey = key;
            referenceMappings = Array.from({ length: count }, (_, index) => targets[index]?.target_token || '');
        }
        const availableTargets = new Set(targets.map((item) => item.target_token));
        const selected = referenceMappings.filter(Boolean);
        const complete = referenceMappings.length === count
            && selected.length === count
            && new Set(selected).size === count
            && selected.every((targetToken) => availableTargets.has(targetToken));
        return { count, targets, complete, initial: true, kind: selectedInitialKind };
    };

    const loadScenePreview = async (candidateToken) => {
        if (typeof onLoadPreview !== 'function') return;
        try {
            const loaded = await onLoadPreview({ candidateToken });
            if (selectedCandidateToken === candidateToken && loaded?.candidate_token === candidateToken) activePreview = loaded;
        } catch {
            activePreview = null;
        }
        render();
    };

    const ensureReferencePreviews = (context) => {
        if (typeof onLoadPreview !== 'function') return;
        for (let imageIndex = 1; imageIndex <= context.count; imageIndex += 1) {
            const cacheKey = `${selectedCandidateToken}:${imageIndex}`;
            if (previewCache.has(cacheKey)) continue;
            const candidateToken = selectedCandidateToken;
            previewCache.set(cacheKey, { status: 'loading', value: null });
            Promise.resolve(onLoadPreview({ candidateToken, imageIndex })).then((loaded) => {
                const loadedIndex = Number(loaded?.image_index ?? (imageIndex === 1 ? 1 : 0));
                const valid = loaded?.ready === true && loaded?.candidate_token === candidateToken
                    && loadedIndex === imageIndex && Boolean(previewSource(loaded));
                previewCache.set(cacheKey, { status: valid ? 'ready' : 'failed', value: valid ? loaded : null });
                if (selectedCandidateToken === candidateToken) render();
            }).catch(() => {
                previewCache.set(cacheKey, { status: 'failed', value: null });
                if (selectedCandidateToken === candidateToken) render();
            });
        }
    };

    const mappingValue = (context, item) => context.initial ? item.target_token : item.media_id;
    const mappingLabel = (context, item) => context.initial ? initialTargetLabel(item) : itemLabel(item);

    const mappingOptions = (context, imageIndex) => {
        const selectedElsewhere = new Set(referenceMappings
            .filter((_, index) => index !== imageIndex - 1)
            .filter(Boolean));
        const current = referenceMappings[imageIndex - 1] || '';
        return [
            { value: '', label: '대상 선택' },
            ...context.targets
                .filter((item) => mappingValue(context, item) === current || !selectedElsewhere.has(mappingValue(context, item)))
                .map((item) => ({ value: mappingValue(context, item), label: mappingLabel(context, item) })),
        ];
    };

    const referenceMappingGrid = (context) => el('section', {
        className: 'mt-4',
        attrs: { 'aria-label': '참조 이미지 대상 연결' },
    }, [
        el('p', {
            text: `${KIND_LABELS[context.kind || retryItems.find((item) => item.media_id === selectedRetryMediaId)?.kind] || '참조'} 이미지 ${context.count}장을 각각 연결하세요.`,
            className: 'text-xs text-secondary',
        }),
        el('div', { className: 'mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3' }, (
            Array.from({ length: context.count }, (_, index) => {
                const imageIndex = index + 1;
                const cached = previewCache.get(`${selectedCandidateToken}:${imageIndex}`);
                const source = cached?.status === 'ready' ? previewSource(cached.value) : '';
                return el('article', { className: 'rounded-lg border border-white/10 bg-black/20 p-3' }, [
                    el('strong', { text: `이미지 ${imageIndex}`, className: 'text-sm text-white' }),
                    source
                        ? el('img', {
                            className: 'mt-2 aspect-[9/16] max-h-64 w-full rounded-md bg-black object-contain',
                            attrs: { src: source, alt: `이미지 ${imageIndex} 미리보기` },
                        })
                        : el('p', {
                            text: cached?.status === 'failed' ? '미리보기 없음' : '불러오는 중',
                            className: 'mt-2 flex aspect-[9/16] max-h-64 items-center justify-center rounded-md bg-black/40 text-xs text-secondary',
                            attrs: { role: 'status' },
                        }),
                    labeledSelect(
                        `dst-reference-target-${imageIndex}`,
                        `이미지 ${imageIndex} 대상`,
                        mappingOptions(context, imageIndex),
                        referenceMappings[index] || '',
                        (value) => {
                            referenceMappings[index] = value;
                            activePlan = null;
                            feedback = '';
                            render();
                        },
                    ),
                ]);
            })
        )),
    ]);

    const render = () => {
        const candidate = candidates.find((item) => item.candidate_token === selectedCandidateToken);
        const retryItem = retryItems.find((item) => item.media_id === selectedRetryMediaId);
        const references = selectedMode === 'initial'
            ? initialContext(candidate)
            : referenceContext(candidate, retryItem);
        const previewUrl = previewSource(activePreview);
        const workspaceBlocked = workspace?.status === 'blocked';
        const planReady = activePlan?.ready === true && Boolean(activePlan?.plan_token);
        const imported = activePlan?.imported === true || activePlan?.already_current === true;
        const canPlan = Boolean(selectedCandidateToken && typeof onPlan === 'function'
            && (selectedMode === 'initial'
                ? references?.complete
                : selectedRetryMediaId && (!references || references.complete)));
        const hasActiveMode = selectedMode === 'initial' ? hasInitialMode : hasRetryMode;
        const showModeSelect = hasInitialMode && hasRetryMode;
        const controlColumns = selectedMode === 'initial'
            ? showModeSelect ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
            : showModeSelect ? 'lg:grid-cols-3' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem]';

        root.replaceChildren(...[
            el('div', { className: 'flex flex-wrap items-start justify-between gap-3' }, [
                el('div', {}, [
                    el('h4', { text: selectedMode === 'initial' ? '첫 이미지 연결' : 'DST 이미지 연결', className: 'text-sm font-bold text-white', attrs: { id: 'dst-bundle-import-title' } }),
                    el('p', {
                        text: selectedMode === 'initial'
                            ? '완료된 이미지를 캐릭터·장소·장면에 처음 연결합니다.'
                            : '완료된 이미지 묶음을 선택한 항목에 한 번에 연결합니다.',
                        className: 'mt-1 text-xs text-secondary',
                    }),
                ]),
                actionButton(workspace?.status === 'loading' ? '확인 중…' : '결과 목록 새로고침', {
                    variant: 'muted',
                    disabled: workspace?.status === 'loading' || typeof onRefresh !== 'function',
                    onClick: () => onRefresh?.(),
                }),
            ]),
            hasActiveMode && candidates.length
                ? el('div', { className: `mt-4 grid grid-cols-1 gap-4 ${controlColumns}` }, [
                    showModeSelect ? labeledSelect(
                        'dst-import-mode',
                        '연결 방식',
                        [
                            { value: 'initial', label: '처음 연결' },
                            { value: 'retry', label: '다시 연결' },
                        ],
                        selectedMode,
                        (value) => {
                            selectedMode = value;
                            resetSelection();
                            render();
                            const nextItem = retryItems.find((item) => item.media_id === selectedRetryMediaId);
                            if (value === 'retry' && !REFERENCE_KINDS.has(nextItem?.kind)) void loadScenePreview(selectedCandidateToken);
                        },
                    ) : null,
                    selectedMode === 'initial' ? labeledSelect(
                        'dst-import-initial-kind',
                        '이미지 종류',
                        initialKinds.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
                        selectedInitialKind,
                        (value) => {
                            selectedInitialKind = value;
                            resetSelection();
                            render();
                        },
                    ) : labeledSelect(
                        'dst-import-retry-target',
                        '연결할 항목',
                        retryItems.map((item) => ({
                            value: item.media_id,
                            label: itemLabel(item),
                        })),
                        selectedRetryMediaId,
                        (value) => {
                            selectedRetryMediaId = value;
                            resetSelection();
                            render();
                            const nextItem = retryItems.find((item) => item.media_id === value);
                            if (!REFERENCE_KINDS.has(nextItem?.kind)) void loadScenePreview(selectedCandidateToken);
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
                            resetSelection();
                            render();
                            const nextItem = retryItems.find((item) => item.media_id === selectedRetryMediaId);
                            if (selectedMode === 'retry' && !REFERENCE_KINDS.has(nextItem?.kind)) await loadScenePreview(value);
                        },
                    ),
                    selectedMode === 'retry' && !references && previewUrl
                        ? el('img', {
                            className: 'aspect-video h-full max-h-28 w-full rounded-md border border-white/10 bg-black object-cover',
                            attrs: { src: previewUrl, alt: `${candidate.bundle_id} 결과 미리보기` },
                        })
                        : selectedMode === 'retry' && !references ? emptyState('미리보기 없음') : null,
                ].filter(Boolean))
                : emptyState(candidates.length
                    ? selectedMode === 'initial'
                        ? '스토리보드에 연결할 첫 대상이 없습니다.'
                        : 'DST 이미지 다시 만들기 항목을 먼저 선택하고 검토 초안을 저장하세요.'
                    : workspaceBlocked
                        ? 'DST 완료 결과 목록을 읽지 못했습니다. 결과 목록을 새로고침하세요.'
                        : '가져올 수 있는 완료 이미지가 없습니다.'),
            candidate ? el('p', {
                text: [formatCreatedAt(candidate.created_at), candidate.prompt_excerpt].filter(Boolean).join(' · '),
                className: 'mt-3 line-clamp-2 text-xs leading-5 text-secondary',
            }) : null,
            references ? referenceMappingGrid(references) : null,
            hasActiveMode && candidates.length ? el('div', { className: 'mt-4 flex flex-wrap items-center gap-3' }, [
                actionButton(busy ? '확인 중…' : selectedMode === 'initial' ? '연결 확인' : '묶음 확인', {
                    disabled: busy || !canPlan,
                    onClick: async () => {
                        busy = true;
                        feedback = '';
                        render();
                        try {
                            activePlan = await onPlan(selectedMode === 'initial' ? {
                                candidateToken: selectedCandidateToken,
                                initialMappings: referenceMappings.map((targetToken, index) => ({
                                    imageIndex: index + 1,
                                    targetToken,
                                })),
                            } : references ? {
                                candidateToken: selectedCandidateToken,
                                mappings: referenceMappings.map((retryMediaId, index) => ({
                                    imageIndex: index + 1,
                                    retryMediaId,
                                })),
                            } : {
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
                        ? references
                            ? `${activePlan.imported_count || activePlan.image_count || references.count}장을 각각 연결했습니다.`
                            : `${activePlan.imported_count || activePlan.image_count || 1}장을 ${activePlan.target_id || retryItem?.target_id || '선택 장면'}에 연결했습니다.`
                        : planReady
                            ? references
                                ? `${activePlan.new_image_count ?? activePlan.image_count ?? references.count}장의 연결을 확인했습니다.`
                                : `${activePlan.new_image_count ?? activePlan.image_count ?? candidate?.image_count ?? 1}장을 ${activePlan.target_id || retryItem?.target_id || '선택 장면'}에 연결합니다.`
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

        if (references) ensureReferencePreviews(references);
    };

    render();
    return root;
}
