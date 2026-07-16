import { createG3PreviewObjectUrl } from '../../lib/pipeline/g3PreviewObjectUrl.js';
import { actionButton, el, emptyState } from './ui.js';
import { videoCandidateLabel } from './videoPreparationUi.js';

function videoPreview(prepared, label, status) {
    return prepared?.ok
        ? el('video', {
            className: 'aspect-[9/16] w-full rounded-md bg-black/40 object-contain',
            attrs: { src: prepared.url, controls: '', preload: 'metadata', 'aria-label': `${label} 미리보기` },
        })
        : el('div', {
            text: status === 'loading' ? '불러오는 중입니다.'
                : status === 'error' ? '불러오지 못했습니다.' : '미리보기를 누르면 여기에 영상이 나옵니다.',
            className: 'flex aspect-[9/16] items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 p-4 text-center text-xs leading-5 text-secondary',
            attrs: { role: 'status' },
        });
}

export function VideoResultConnector({ task, workspace, preferredCandidateToken = '', onRefresh, onLoadPreview, onConnect }) {
    const candidates = (Array.isArray(workspace?.candidates) ? workspace.candidates : [])
        .filter((candidate) => candidate.provider === task.provider);
    let selectedToken = candidates.some((candidate) => candidate.candidate_token === preferredCandidateToken)
        ? preferredCandidateToken : candidates[0]?.candidate_token || '';
    let preparedPreview = null;
    let previewStatus = 'idle';
    let feedback = '';
    let previewEpoch = 0;
    let connecting = false;
    const root = el('div', { className: 'mt-3 rounded-md border border-white/10 bg-black/20 p-3' });

    const disposePreview = () => {
        preparedPreview?.dispose?.();
        preparedPreview = null;
    };
    const invalidatePreview = () => {
        previewEpoch += 1;
        disposePreview();
        previewStatus = 'idle';
    };
    const render = () => {
        const select = el('select', {
            className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
            disabled: connecting,
            attrs: { 'aria-label': `${task.label} 완료 영상` },
        }, candidates.map((candidate) => el('option', {
            value: candidate.candidate_token,
            text: `${candidate.candidate_token === preferredCandidateToken ? '이번 결과 · ' : ''}${videoCandidateLabel(candidate)}`,
        })));
        select.value = selectedToken;
        select.addEventListener('change', () => {
            if (connecting) {
                select.value = selectedToken;
                return;
            }
            selectedToken = select.value;
            invalidatePreview();
            feedback = '';
            render();
        });

        root.replaceChildren(
            el('div', { className: 'mb-3 flex flex-wrap items-center justify-between gap-2' }, [
                el('strong', { text: '완료 영상 연결', className: 'text-sm text-white' }),
                actionButton('결과 새로고침', {
                    variant: 'muted',
                    disabled: connecting,
                    onClick: () => {
                        if (connecting) return;
                        invalidatePreview();
                        feedback = '';
                        render();
                        onRefresh?.();
                    },
                }),
            ]),
            candidates.length ? el('div', { className: 'grid grid-cols-1 gap-3 md:grid-cols-3' }, [
                el('div', { className: 'flex min-w-0 flex-col gap-3 md:col-span-2' }, [
                    select,
                    actionButton('영상 미리보기', {
                        variant: 'muted',
                        disabled: connecting || !selectedToken,
                        onClick: async () => {
                            if (connecting || !selectedToken) return;
                            const candidateToken = selectedToken;
                            const epoch = ++previewEpoch;
                            disposePreview();
                            previewStatus = 'loading';
                            feedback = '미리보기 불러오는 중…';
                            render();
                            let nextPreview;
                            try {
                                const loaded = await onLoadPreview?.({ candidateToken });
                                if (epoch !== previewEpoch || candidateToken !== selectedToken) return;
                                nextPreview = createG3PreviewObjectUrl(loaded);
                            } catch {
                                if (epoch !== previewEpoch || candidateToken !== selectedToken) return;
                                nextPreview = null;
                            }
                            if (epoch !== previewEpoch || candidateToken !== selectedToken) {
                                nextPreview?.dispose?.();
                                return;
                            }
                            preparedPreview = nextPreview;
                            previewStatus = preparedPreview?.ok ? 'ready' : 'error';
                            feedback = preparedPreview?.ok ? '' : '미리보기를 불러오지 못했습니다.';
                            render();
                        },
                    }),
                    actionButton('이 영상 연결', {
                        disabled: connecting || !selectedToken,
                        onClick: async () => {
                            if (connecting || !selectedToken) return;
                            const candidateToken = selectedToken;
                            previewEpoch += 1;
                            if (previewStatus === 'loading') previewStatus = 'idle';
                            connecting = true;
                            feedback = '연결 중…';
                            render();
                            let connected = false;
                            try {
                                const result = await onConnect?.({ taskToken: task.task_token, candidateToken });
                                connected = Boolean(result?.ok || result?.connected);
                            } catch {
                                connected = false;
                            }
                            if (candidateToken !== selectedToken) return;
                            connecting = false;
                            feedback = connected ? '작업에 연결했습니다.' : '연결하지 못했습니다.';
                            if (connected) {
                                disposePreview();
                                previewStatus = 'idle';
                            }
                            render();
                        },
                    }),
                    el('p', {
                        text: feedback || '도구·길이·크기만 표시합니다.',
                        className: 'text-xs leading-5 text-secondary',
                        attrs: { role: 'status', 'aria-live': 'polite' },
                    }),
                ]),
                videoPreview(preparedPreview, task.label, previewStatus),
            ]) : emptyState(`${task.provider === 'flow' ? 'Flow' : task.provider === 'grok' ? 'Grok' : task.provider === 'replicate' ? 'Replicate' : 'ByteDance'} 완료 영상이 아직 없습니다.`),
        );
    };
    render();
    return root;
}
