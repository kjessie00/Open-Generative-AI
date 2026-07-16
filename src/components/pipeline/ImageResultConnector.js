import { actionButton, el, emptyState } from './ui.js';
import { candidateLabel, safePreviewSource } from './imagePreparationUi.js';

function imageCount(candidate) {
    return Math.min(12, Math.max(1, Math.trunc(Number(candidate?.image_count) || 1)));
}

function previewTile(entry, imageIndex, preferred) {
    const source = entry?.status === 'ready' ? safePreviewSource(entry.value) : '';
    const label = `후보 ${imageIndex}`;
    const visual = source
        ? el('img', {
            className: 'aspect-[9/16] w-full rounded-md bg-black/30 object-cover',
            attrs: { src: source, alt: `${label} 미리보기` },
        })
        : el('div', {
            text: entry?.status === 'error' ? '불러오지 못했습니다.' : '불러오는 중입니다.',
            className: 'flex aspect-[9/16] items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 p-3 text-center text-xs leading-5 text-secondary',
            attrs: { role: 'status' },
        });
    return { label, visual, preferred };
}

export function ImageResultConnector({
    task, workspace, preferredCandidateToken = '', preferredImageIndex = 0,
    onRefresh, onLoadPreview, onConnect,
}) {
    const candidates = Array.isArray(workspace?.candidates) ? workspace.candidates : [];
    let selectedToken = candidates.some((candidate) => candidate.candidate_token === preferredCandidateToken)
        ? preferredCandidateToken : candidates[0]?.candidate_token || '';
    let previews = new Map();
    let feedback = '';
    let loadEpoch = 0;
    let connectEpoch = 0;
    let connecting = false;
    const root = el('div', { className: 'mt-3 rounded-md border border-white/10 bg-black/20 p-3' });

    const render = () => {
        const select = el('select', {
            className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
            disabled: connecting,
            attrs: { id: `image-result-${task.sequence}`, 'aria-label': `${task.label} DST 결과` },
        }, candidates.map((candidate) => el('option', {
            value: candidate.candidate_token,
            text: `${candidate.candidate_token === preferredCandidateToken ? '이번 결과 · ' : ''}${candidateLabel(candidate)}`,
        })));
        select.value = selectedToken;
        select.addEventListener('change', async () => {
            if (connecting) {
                select.value = selectedToken;
                return;
            }
            selectedToken = select.value;
            await loadSelectedBundle();
        });

        const selectedCandidate = candidates.find((candidate) => candidate.candidate_token === selectedToken);
        const count = imageCount(selectedCandidate);
        const tiles = Array.from({ length: count }, (_, offset) => {
            const index = offset + 1;
            const preferred = selectedToken === preferredCandidateToken && index === preferredImageIndex;
            const tile = previewTile(previews.get(index), index, preferred);
            const button = actionButton('이 이미지 선택', {
                disabled: connecting || !selectedToken || previews.get(index)?.status !== 'ready',
                onClick: async () => {
                    if (connecting) return;
                    const candidateToken = selectedToken;
                    const requestLoadEpoch = loadEpoch;
                    const requestConnectEpoch = ++connectEpoch;
                    connecting = true;
                    feedback = '연결 중…';
                    render();
                    let nextFeedback;
                    try {
                        const result = await onConnect?.({
                            taskToken: task.task_token,
                            candidateToken,
                            imageIndex: index,
                        });
                        nextFeedback = result?.ok ? '작업에 연결했습니다.' : '연결하지 못했습니다.';
                    } catch {
                        nextFeedback = '연결하지 못했습니다.';
                    }
                    if (requestConnectEpoch !== connectEpoch || requestLoadEpoch !== loadEpoch
                        || candidateToken !== selectedToken) return;
                    connecting = false;
                    feedback = nextFeedback;
                    render();
                },
            });
            button.setAttribute('aria-label', `${tile.label} 이 이미지 선택`);
            return el('div', { className: 'min-w-0 rounded-md border border-white/10 bg-black/20 p-2' }, [
                el('p', {
                    text: `${tile.label}${tile.preferred ? ' · 이번 결과' : ''}`,
                    className: 'mb-2 text-xs font-semibold text-white',
                }),
                tile.visual,
                el('div', { className: 'mt-2' }, [button]),
            ]);
        });

        root.replaceChildren(
            el('div', { className: 'mb-3 flex items-center justify-between gap-2' }, [
                el('strong', { text: 'DST 결과 연결', className: 'text-sm text-white' }),
                actionButton('결과 새로고침', {
                    variant: 'muted',
                    disabled: connecting,
                    onClick: () => { if (!connecting) onRefresh?.(); },
                }),
            ]),
            candidates.length ? el('div', { className: 'flex min-w-0 flex-col gap-3' }, [
                select,
                el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3' }, tiles),
                el('p', {
                    text: feedback || '이미지를 비교한 뒤 하나를 선택하세요.',
                    className: 'text-xs leading-5 text-secondary',
                    attrs: { role: 'status', 'aria-live': 'polite' },
                }),
            ]) : emptyState('DST 완료 결과가 아직 없습니다.'),
        );
    };

    const loadSelectedBundle = async () => {
        const token = selectedToken;
        const selectedCandidate = candidates.find((candidate) => candidate.candidate_token === token);
        const count = imageCount(selectedCandidate);
        const epoch = ++loadEpoch;
        previews = new Map(Array.from({ length: count }, (_, offset) => [offset + 1, { status: 'loading' }]));
        feedback = '';
        render();
        if (!token || typeof onLoadPreview !== 'function') {
            previews = new Map(Array.from({ length: count }, (_, offset) => [offset + 1, { status: 'error' }]));
            render();
            return;
        }
        await Promise.all(Array.from({ length: count }, async (_, offset) => {
            const index = offset + 1;
            try {
                const loaded = await onLoadPreview({ candidateToken: token, imageIndex: index });
                if (epoch !== loadEpoch || selectedToken !== token) return;
                const valid = loaded?.ready === true && loaded.candidate_token === token
                    && Number(loaded.image_index) === index && Boolean(safePreviewSource(loaded));
                previews.set(index, { status: valid ? 'ready' : 'error', value: valid ? loaded : null });
            } catch {
                if (epoch !== loadEpoch || selectedToken !== token) return;
                previews.set(index, { status: 'error' });
            }
            render();
        }));
    };

    render();
    if (selectedToken) void loadSelectedBundle();
    return root;
}
