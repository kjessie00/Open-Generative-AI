import { createG3PreviewObjectUrl } from '../../lib/pipeline/g3PreviewObjectUrl.js';
import { actionButton, el, emptyState } from './ui.js';
import { videoCandidateLabel } from './videoPreparationUi.js';

function videoPreview(prepared, label) {
    return prepared?.ok
        ? el('video', {
            className: 'aspect-[9/16] w-full rounded-md bg-black/40 object-contain',
            attrs: { src: prepared.url, controls: '', preload: 'metadata', 'aria-label': `${label} 미리보기` },
        })
        : el('div', {
            text: '미리보기를 누르면 여기에 영상이 나옵니다.',
            className: 'flex aspect-[9/16] items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 p-4 text-center text-xs leading-5 text-secondary',
        });
}

export function VideoResultConnector({ task, workspace, preferredCandidateToken = '', onRefresh, onLoadPreview, onConnect }) {
    const candidates = (Array.isArray(workspace?.candidates) ? workspace.candidates : [])
        .filter((candidate) => candidate.provider === task.provider);
    let selectedToken = candidates.some((candidate) => candidate.candidate_token === preferredCandidateToken)
        ? preferredCandidateToken : candidates[0]?.candidate_token || '';
    let preparedPreview = null;
    let feedback = '';
    const root = el('div', { className: 'mt-3 rounded-md border border-white/10 bg-black/20 p-3' });

    const disposePreview = () => {
        preparedPreview?.dispose?.();
        preparedPreview = null;
    };
    const render = () => {
        const select = el('select', {
            className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
            attrs: { 'aria-label': `${task.label} 완료 영상` },
        }, candidates.map((candidate) => el('option', {
            value: candidate.candidate_token,
            text: `${candidate.candidate_token === preferredCandidateToken ? '이번 결과 · ' : ''}${videoCandidateLabel(candidate)}`,
        })));
        select.value = selectedToken;
        select.addEventListener('change', () => {
            selectedToken = select.value;
            disposePreview();
            feedback = '';
            render();
        });

        root.replaceChildren(
            el('div', { className: 'mb-3 flex flex-wrap items-center justify-between gap-2' }, [
                el('strong', { text: '완료 영상 연결', className: 'text-sm text-white' }),
                actionButton('결과 새로고침', { variant: 'muted', onClick: () => onRefresh?.() }),
            ]),
            candidates.length ? el('div', { className: 'grid grid-cols-1 gap-3 md:grid-cols-3' }, [
                el('div', { className: 'flex min-w-0 flex-col gap-3 md:col-span-2' }, [
                    select,
                    actionButton('영상 미리보기', {
                        variant: 'muted',
                        disabled: !selectedToken,
                        onClick: async () => {
                            disposePreview();
                            feedback = '미리보기 불러오는 중…';
                            render();
                            try {
                                preparedPreview = createG3PreviewObjectUrl(await onLoadPreview?.({ candidateToken: selectedToken }));
                                feedback = preparedPreview.ok ? '' : '미리보기를 불러오지 못했습니다.';
                            } catch {
                                feedback = '미리보기를 불러오지 못했습니다.';
                            }
                            render();
                        },
                    }),
                    actionButton('이 영상 연결', {
                        disabled: !selectedToken,
                        onClick: async () => {
                            feedback = '연결 중…';
                            render();
                            const result = await onConnect?.({ taskToken: task.task_token, candidateToken: selectedToken });
                            feedback = result?.ok || result?.connected ? '작업에 연결했습니다.' : '연결하지 못했습니다.';
                            if (result?.ok || result?.connected) disposePreview();
                            render();
                        },
                    }),
                    el('p', {
                        text: feedback || '도구·길이·크기만 표시합니다.',
                        className: 'text-xs leading-5 text-secondary',
                        attrs: { role: 'status', 'aria-live': 'polite' },
                    }),
                ]),
                videoPreview(preparedPreview, task.label),
            ]) : emptyState(`${task.provider === 'flow' ? 'Flow' : task.provider === 'grok' ? 'Grok' : task.provider === 'replicate' ? 'Replicate' : 'ByteDance'} 완료 영상이 아직 없습니다.`),
        );
    };
    render();
    return root;
}
