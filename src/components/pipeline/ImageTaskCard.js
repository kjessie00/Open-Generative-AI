import { actionButton, el } from './ui.js';
import { IMAGE_KIND_LABELS, safePreviewSource } from './imagePreparationUi.js';
import { ImageResultConnector } from './ImageResultConnector.js';
import { PromptAgentEditor } from './PromptAgentEditor.js';

function resultSlot(task, resultPreview) {
    const source = safePreviewSource(resultPreview);
    if (source) {
        return el('img', {
            className: 'aspect-[9/16] w-full rounded-md bg-black/30 object-cover',
            attrs: { src: source, alt: `${task.label} 연결 결과` },
        });
    }
    return el('div', {
        className: 'flex aspect-[9/16] items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 p-4 text-center text-xs leading-5 text-secondary',
        text: task.result_token ? '연결된 결과를 불러오는 중입니다.' : '아직 연결된 이미지가 없습니다.',
        attrs: { role: 'status' },
    });
}

export function ImageTaskCard({ task, resultPreview, resultWorkspace, agentRequest, onPromptChange, onToggleRetry, onRefreshResults, onLoadCandidatePreview, onConnectResult, onRequestAgentEdit, onDecideAgentEdit }) {
    let connectorOpen = false;
    let preferredCandidateToken = '';
    let preferredImageIndex = 0;
    const root = el('article', {
        className: `min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3 ${agentRequest?.status === 'suggestion_ready' ? 'lg:col-span-2 xl:col-span-3' : ''}`,
        attrs: { 'data-work-target': 'image', 'data-sequence': task.sequence, tabindex: -1 },
    });

    const render = () => {
        const prompt = el('textarea', {
            value: task.prompt,
            className: 'min-h-32 w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/50',
            attrs: { 'aria-label': `${task.label} 프롬프트`, maxlength: 12000 },
        });
        prompt.addEventListener('input', (event) => onPromptChange?.(task.task_token, event.target.value));

        const retry = el('input', {
            attrs: { type: 'checkbox', id: `image-retry-${task.sequence}`, 'aria-label': `${task.label} 다시 만들기` },
        });
        retry.checked = task.status === '재제작';
        retry.addEventListener('change', () => onToggleRetry?.(task.task_token, retry.checked));

        const children = [
            el('header', { className: 'mb-3 flex min-w-0 items-start justify-between gap-3' }, [
                el('div', { className: 'min-w-0' }, [
                    el('p', { text: `${task.sequence}. ${IMAGE_KIND_LABELS[task.kind]}`, className: 'text-xs font-semibold text-secondary' }),
                    el('h3', { text: task.label, className: 'mt-1 truncate text-base font-bold text-white' }),
                ]),
                el('span', {
                    text: task.status === '결과연결' ? '결과 연결됨' : task.status === '재제작' ? '다시 만들기' : '이미지 필요',
                    className: 'shrink-0 text-xs font-semibold text-secondary',
                }),
            ]),
            el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3' }, [
                resultSlot(task, resultPreview),
                el('div', { className: 'flex min-w-0 flex-col gap-3 sm:col-span-2' }, [
                    el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
                        el('summary', { text: '프롬프트 수정', className: 'min-h-11 cursor-pointer py-3 text-sm font-semibold text-white' }),
                        el('div', { className: 'pb-3' }, [
                            el('label', { className: 'mb-1 block text-xs font-semibold text-secondary', text: '현재 프롬프트' }),
                            prompt,
                            PromptAgentEditor({ task, lane: 'image', request: agentRequest, onRequest: onRequestAgentEdit, onDecide: onDecideAgentEdit }),
                        ]),
                    ]),
                    task.result_token
                        ? el('label', { className: 'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white' }, [
                            retry,
                            el('span', { text: '다시 만들기' }),
                        ])
                        : actionButton(connectorOpen ? '결과 연결 닫기' : 'DST 결과 연결', {
                            variant: 'muted',
                            onClick: () => { connectorOpen = !connectorOpen; render(); },
                        }),
                ]),
            ]),
            connectorOpen && !task.result_token ? ImageResultConnector({
                task,
                workspace: resultWorkspace,
                preferredCandidateToken,
                preferredImageIndex,
                onRefresh: onRefreshResults,
                onLoadPreview: onLoadCandidatePreview,
                onConnect: onConnectResult,
            }) : null,
        ];
        root.replaceChildren(...children.filter(Boolean));
    };
    root.addEventListener('workbench:show-result', (event) => {
        preferredCandidateToken = event?.detail?.candidateToken || '';
        preferredImageIndex = Number(event?.detail?.imageIndex) || 0;
        connectorOpen = true;
        render();
    });
    render();
    return root;
}
