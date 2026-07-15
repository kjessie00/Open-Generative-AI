import { actionButton, el, emptyState } from './ui.js';
import { candidateLabel, safePreviewSource } from './imagePreparationUi.js';

function previewNode(preview, label) {
    const source = safePreviewSource(preview);
    return source
        ? el('img', {
            className: 'aspect-[9/16] w-full rounded-md bg-black/30 object-cover',
            attrs: { src: source, alt: `${label} 연결 미리보기` },
        })
        : el('div', {
            text: '결과를 고르면 여기에 미리보기가 나옵니다.',
            className: 'flex aspect-[9/16] items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 p-4 text-center text-xs leading-5 text-secondary',
            attrs: { role: 'status' },
        });
}

export function ImageResultConnector({
    task, workspace, preview, preferredCandidateToken = '', preferredImageIndex = 0,
    onRefresh, onLoadPreview, onConnect,
}) {
    const candidates = Array.isArray(workspace?.candidates) ? workspace.candidates : [];
    let selectedToken = candidates.some((candidate) => candidate.candidate_token === preferredCandidateToken)
        ? preferredCandidateToken : candidates[0]?.candidate_token || '';
    let selectedImageIndex = Number.isSafeInteger(preferredImageIndex) && preferredImageIndex > 0
        ? preferredImageIndex : 1;
    let activePreview = preview?.candidate_token === selectedToken ? preview : null;
    let feedback = '';
    let loadingKey = '';
    const root = el('div', { className: 'mt-3 rounded-md border border-white/10 bg-black/20 p-3' });

    const render = () => {
        const select = el('select', {
            className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
            attrs: { id: `image-result-${task.sequence}`, 'aria-label': `${task.label} DST 결과` },
        }, candidates.map((candidate) => el('option', {
            value: candidate.candidate_token,
            text: `${candidate.candidate_token === preferredCandidateToken ? '이번 결과 · ' : ''}${candidateLabel(candidate)}`,
        })));
        select.value = selectedToken;
        select.addEventListener('change', async () => {
            selectedToken = select.value;
            selectedImageIndex = 1;
            activePreview = null;
            feedback = '미리보기 불러오는 중…';
            render();
            try {
                activePreview = await onLoadPreview?.({ candidateToken: selectedToken, imageIndex: selectedImageIndex });
                feedback = activePreview?.ready ? '' : '미리보기를 불러오지 못했습니다.';
            } catch {
                activePreview = null;
                feedback = '미리보기를 불러오지 못했습니다.';
            }
            render();
        });
        const selectedCandidate = candidates.find((candidate) => candidate.candidate_token === selectedToken);
        const imageCount = Math.max(1, Number(selectedCandidate?.image_count) || 1);
        const imageSelect = imageCount > 1 ? el('select', {
            className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
            attrs: { 'aria-label': `${task.label} 이미지 선택` },
        }, Array.from({ length: imageCount }, (_, index) => el('option', {
            value: index + 1,
            text: `이미지 ${index + 1}`,
        }))) : null;
        if (imageSelect) {
            imageSelect.value = String(selectedImageIndex);
            imageSelect.addEventListener('change', () => {
                selectedImageIndex = Number(imageSelect.value);
                activePreview = null;
                feedback = '미리보기 불러오는 중…';
                render();
            });
        }
        root.replaceChildren(
            el('div', { className: 'mb-3 flex items-center justify-between gap-2' }, [
                el('strong', { text: 'DST 결과 연결', className: 'text-sm text-white' }),
                actionButton('결과 새로고침', { variant: 'muted', onClick: () => onRefresh?.() }),
            ]),
            candidates.length ? el('div', { className: 'grid grid-cols-1 gap-3 md:grid-cols-3' }, [
                el('div', { className: 'flex min-w-0 flex-col gap-3 md:col-span-2' }, [
                    select,
                    imageSelect,
                    actionButton('이 결과 연결', {
                        disabled: !selectedToken,
                        onClick: async () => {
                            feedback = '연결 중…';
                            render();
                            const result = await onConnect?.({ taskToken: task.task_token, candidateToken: selectedToken, imageIndex: selectedImageIndex });
                            feedback = result?.ok ? '작업에 연결했습니다.' : '연결하지 못했습니다.';
                            render();
                        },
                    }),
                    el('p', {
                        text: feedback || '후보의 시간과 이미지 수만 표시합니다.',
                        className: 'text-xs leading-5 text-secondary',
                        attrs: { role: 'status', 'aria-live': 'polite' },
                    }),
                ]),
                previewNode(activePreview, task.label),
            ]) : emptyState('DST 완료 결과가 아직 없습니다.'),
        );
        const selectionKey = `${selectedToken}:${selectedImageIndex}`;
        if (selectedToken && !activePreview && loadingKey !== selectionKey && typeof onLoadPreview === 'function') {
            loadingKey = selectionKey;
            Promise.resolve(onLoadPreview({ candidateToken: selectedToken, imageIndex: selectedImageIndex })).then((loaded) => {
                if (selectionKey === loadingKey) activePreview = loaded?.candidate_token === selectedToken
                    && Number(loaded?.image_index || 1) === selectedImageIndex ? loaded : null;
                feedback = activePreview?.ready ? '' : '미리보기를 불러오지 못했습니다.';
                render();
            }).catch(() => {
                feedback = '미리보기를 불러오지 못했습니다.';
                render();
            });
        }
    };
    render();
    return root;
}
