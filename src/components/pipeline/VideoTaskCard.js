import { actionButton, el } from './ui.js';
import { VIDEO_PROVIDER_LABELS } from './videoPreparationUi.js';
import { VideoResultConnector } from './VideoResultConnector.js';
import { PromptAgentEditor } from './PromptAgentEditor.js';

const PROVIDER_HELP_TEXT = Object.freeze({
    flow: '현재 참조 이미지 1장으로는 준비할 수 없습니다. 완료 영상을 연결하거나 다른 도구를 선택하세요.',
    grok: '6초, 10초 또는 15초를 지원합니다. 완료 영상을 연결하거나 다른 도구를 선택하세요.',
    replicate: '요청 미리보기를 준비할 수 있습니다. 위의 영상 작업 준비를 누르세요.',
    bytedance: '이 작업대에서는 완료 영상만 연결할 수 있습니다.',
});

function resultSlot(task, resultPreview) {
    if (resultPreview?.source) {
        return el('video', {
            className: 'aspect-[9/16] w-full rounded-md bg-black/40 object-contain',
            attrs: { src: resultPreview.source, controls: '', preload: 'metadata', 'aria-label': `${task.label} 연결 결과` },
        });
    }
    return el('div', {
        className: 'flex aspect-[9/16] items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 p-4 text-center text-xs leading-5 text-secondary',
        text: task.result_token ? '연결된 영상을 불러오는 중입니다.' : '아직 연결된 영상이 없습니다.',
    });
}

export function VideoTaskCard({ task, resultPreview, resultWorkspace, agentRequest, onPromptChange, onProviderChange, onToggleRetry, onRefreshResults, onLoadCandidatePreview, onConnectResult, onRequestAgentEdit, onDecideAgentEdit }) {
    let connectorOpen = false;
    let preferredCandidateToken = '';
    const cardClass = () => `min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3 ${agentRequest?.status === 'suggestion_ready' || connectorOpen ? 'lg:col-span-2 xl:col-span-3' : ''}`;
    const root = el('article', {
        className: cardClass(),
        attrs: { 'data-work-target': 'video', 'data-sequence': task.sequence, tabindex: -1 },
    });
    const render = () => {
        root.className = cardClass();
        const providerHelp = el('p', {
            text: PROVIDER_HELP_TEXT[task.provider] || '완료 영상을 연결하거나 다른 도구를 선택하세요.',
            className: 'mt-1 text-xs leading-5 text-secondary',
            attrs: { 'aria-live': 'polite' },
        });
        const provider = el('select', {
            className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
            attrs: { 'aria-label': `${task.label} 생성 도구` },
        }, Object.entries(VIDEO_PROVIDER_LABELS).map(([value, text]) => el('option', { value, text })));
        provider.value = task.provider;
        provider.addEventListener('change', () => {
            providerHelp.textContent = PROVIDER_HELP_TEXT[provider.value] || '완료 영상을 연결하거나 다른 도구를 선택하세요.';
            onProviderChange?.(task.task_token, provider.value);
        });

        const prompt = el('textarea', {
            value: task.prompt,
            className: 'min-h-32 w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/50',
            attrs: { 'aria-label': `${task.label} 프롬프트`, maxlength: 12000 },
        });
        prompt.addEventListener('input', (event) => onPromptChange?.(task.task_token, event.target.value));

        const retry = el('input', { attrs: { type: 'checkbox', 'aria-label': `${task.label} 다시 만들기` } });
        retry.checked = task.status === '재제작';
        retry.addEventListener('change', () => onToggleRetry?.(task.task_token, retry.checked));

        const children = [
            el('header', { className: 'mb-3 flex min-w-0 items-start justify-between gap-3' }, [
                el('div', { className: 'min-w-0' }, [
                    el('p', { text: `${task.sequence}. ${VIDEO_PROVIDER_LABELS[task.provider]}`, className: 'text-xs font-semibold text-secondary' }),
                    el('h3', { text: task.label, className: 'mt-1 truncate text-base font-bold text-white' }),
                ]),
                el('span', {
                    text: task.status === '재제작' ? '결과 연결됨 · 다시 만들기'
                        : task.status === '결과연결' && task.review_decision === 'use' ? '결과 연결됨 · 사용 확인'
                            : task.status === '결과연결' ? '결과 연결됨 · 확인 필요' : '영상 필요',
                    className: 'shrink-0 text-xs font-semibold text-secondary',
                }),
            ]),
            el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3' }, [
                resultSlot(task, resultPreview),
                el('div', { className: 'flex min-w-0 flex-col gap-3 sm:col-span-2' }, [
                    el('label', { className: 'text-xs font-semibold text-secondary' }, [
                        el('span', { text: '생성 도구', className: 'mb-1 block' }), provider,
                        providerHelp,
                    ]),
                    el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
                        el('summary', { text: '프롬프트 수정', className: 'min-h-11 cursor-pointer py-3 text-sm font-semibold text-white' }),
                        el('div', { className: 'pb-3' }, [
                            el('label', { className: 'mb-1 block text-xs font-semibold text-secondary', text: '현재 프롬프트' }),
                            prompt,
                            PromptAgentEditor({ task, lane: 'video', request: agentRequest, onRequest: onRequestAgentEdit, onDecide: onDecideAgentEdit }),
                        ]),
                    ]),
                    task.result_token
                        ? el('label', { className: 'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white' }, [retry, el('span', { text: '다시 만들기' })])
                        : actionButton(connectorOpen ? '영상 연결 닫기' : '완료 영상 연결', {
                            variant: 'muted', onClick: () => { connectorOpen = !connectorOpen; render(); },
                        }),
                ]),
            ]),
            connectorOpen && !task.result_token ? VideoResultConnector({
                task, workspace: resultWorkspace, preferredCandidateToken, onRefresh: onRefreshResults,
                onLoadPreview: onLoadCandidatePreview, onConnect: onConnectResult,
            }) : null,
        ];
        root.replaceChildren(...children.filter(Boolean));
    };
    root.addEventListener('workbench:show-result', (event) => {
        preferredCandidateToken = event?.detail?.candidateToken || '';
        connectorOpen = true;
        render();
    });
    render();
    return root;
}
