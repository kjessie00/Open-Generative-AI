import { actionButton, el } from './ui.js';
import { VIDEO_PROVIDER_LABELS } from './videoPreparationUi.js';
import { VideoResultConnector } from './VideoResultConnector.js';

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

export function VideoTaskCard({ task, resultPreview, resultWorkspace, onPromptChange, onProviderChange, onToggleRetry, onRefreshResults, onLoadCandidatePreview, onConnectResult }) {
    let connectorOpen = false;
    const root = el('article', {
        className: 'min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3',
        attrs: { 'data-work-target': 'video', 'data-sequence': task.sequence, tabindex: -1 },
    });
    const render = () => {
        const provider = el('select', {
            className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
            attrs: { 'aria-label': `${task.label} 생성 도구` },
        }, Object.entries(VIDEO_PROVIDER_LABELS).map(([value, text]) => el('option', { value, text })));
        provider.value = task.provider;
        provider.addEventListener('change', () => onProviderChange?.(task.task_token, provider.value));

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
                    text: task.status === '결과연결' ? '결과 연결됨' : task.status === '재제작' ? '다시 만들기' : '영상 필요',
                    className: 'shrink-0 text-xs font-semibold text-secondary',
                }),
            ]),
            el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3' }, [
                resultSlot(task, resultPreview),
                el('div', { className: 'flex min-w-0 flex-col gap-3 sm:col-span-2' }, [
                    el('label', { className: 'text-xs font-semibold text-secondary' }, [
                        el('span', { text: '생성 도구', className: 'mb-1 block' }), provider,
                    ]),
                    el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
                        el('summary', { text: '프롬프트 수정', className: 'min-h-11 cursor-pointer py-3 text-sm font-semibold text-white' }),
                        el('div', { className: 'pb-3' }, [prompt]),
                    ]),
                    task.result_token
                        ? el('label', { className: 'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white' }, [retry, el('span', { text: '다시 만들기' })])
                        : actionButton(connectorOpen ? '영상 연결 닫기' : '완료 영상 연결', {
                            variant: 'muted', onClick: () => { connectorOpen = !connectorOpen; render(); },
                        }),
                ]),
            ]),
            connectorOpen && !task.result_token ? VideoResultConnector({
                task, workspace: resultWorkspace, onRefresh: onRefreshResults,
                onLoadPreview: onLoadCandidatePreview, onConnect: onConnectResult,
            }) : null,
        ];
        root.replaceChildren(...children.filter(Boolean));
    };
    render();
    return root;
}
