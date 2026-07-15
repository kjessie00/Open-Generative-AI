import { actionButton, el } from './ui.js';

export function PromptAgentEditor({ task, lane, request, onRequest, onDecide }) {
    let instruction = '';
    let working = request?.status === 'queued_local_handoff';
    let localNotice = '';
    const accepted = Boolean(task.result_token) && task.status !== '재제작';
    const suggestion = request?.status === 'suggestion_ready' ? request.suggestion : null;
    const section = el('section', {
        className: 'mt-3 border-t border-white/10 pt-3',
        attrs: { 'aria-label': '에이전트에게 수정 요청' },
    });

    const render = () => {
        const instructionInput = el('textarea', {
            value: instruction,
            className: 'min-h-24 w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/50',
            attrs: {
                'aria-label': `${task.label} 수정 요청`, maxlength: 4000,
                placeholder: lane === 'image'
                    ? '예: 인물과 장소는 유지하고 장면의 핵심이 더 잘 보이게 다듬어줘'
                    : '예: 인물과 배경은 유지하고 움직임과 카메라 이동을 자연스럽게 다듬어줘',
            },
        });
        instructionInput.addEventListener('input', (event) => { instruction = event.target.value; });
        const requestButton = actionButton(working ? '수정안 만드는 중…' : '수정안 만들기', {
            disabled: working || accepted,
            onClick: async () => {
                if (!instruction.trim()) {
                    localNotice = '원하는 변경을 짧게 적어주세요.';
                    render();
                    return;
                }
                working = true;
                localNotice = '에이전트가 수정안을 만들고 있습니다…';
                render();
                const result = await onRequest?.(task.task_token, instruction.trim());
                if (!result?.ok) {
                    working = false;
                    localNotice = '수정안을 만들지 못했습니다. 다시 시도하세요.';
                    render();
                }
            },
        });

        const children = [
            el('h4', { text: '에이전트에게 수정 요청', className: 'text-sm font-bold text-white' }),
            el('p', { text: '이 항목만 다듬습니다. 다른 항목은 바뀌지 않습니다.', className: 'mt-1 text-xs leading-5 text-secondary' }),
            accepted
                ? el('p', { text: '완료 결과를 바꾸려면 먼저 다시 만들기를 선택하세요.', className: 'mt-2 text-xs leading-5 text-amber-200' })
                : el('label', { className: 'mt-3 block text-xs font-semibold text-secondary' }, [
                    el('span', { text: '어떻게 바꿀까요?', className: 'mb-1 block' }), instructionInput,
                ]),
            accepted ? null : el('div', { className: 'mt-2' }, [requestButton]),
            localNotice ? el('p', {
                text: localNotice, className: 'mt-2 text-xs leading-5 text-secondary',
                attrs: { role: localNotice.includes('못했습니다') ? 'alert' : 'status', 'aria-live': 'polite' },
            }) : null,
        ];

        if (suggestion) {
            const heading = el('h4', {
                text: '수정안이 도착했습니다. 비교해 보세요.', className: 'text-sm font-bold text-white',
                attrs: { tabindex: -1 },
            });
            children.push(el('div', { className: 'mt-4 rounded-md border border-cyan-300/20 bg-cyan-300/[0.04] p-3' }, [
                heading,
                el('p', { text: suggestion.summary, className: 'mt-1 text-xs leading-5 text-secondary' }),
                el('div', { className: 'mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2' }, [
                    el('label', { className: 'text-xs font-semibold text-secondary' }, [
                        el('span', { text: '현재 프롬프트', className: 'mb-1 block' }),
                        el('textarea', {
                            value: task.prompt,
                            className: 'min-h-40 w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-white',
                            attrs: { readonly: '', 'aria-label': `${task.label} 현재 프롬프트` },
                        }),
                    ]),
                    el('label', { className: 'text-xs font-semibold text-secondary' }, [
                        el('span', { text: '에이전트 수정안', className: 'mb-1 block' }),
                        el('textarea', {
                            value: suggestion.proposed_prompt,
                            className: 'min-h-40 w-full resize-y rounded-md border border-cyan-300/20 bg-black/25 px-3 py-3 text-sm leading-6 text-white',
                            attrs: { readonly: '', 'aria-label': `${task.label} 에이전트 수정안` },
                        }),
                    ]),
                ]),
                el('p', { text: '수정안을 적용해도 생성은 시작하지 않습니다.', className: 'mt-2 text-xs leading-5 text-secondary' }),
                el('div', { className: 'mt-3 flex flex-col gap-2 sm:flex-row' }, [
                    actionButton('수정안 적용', { onClick: () => onDecide?.(suggestion.suggestion_token, 'apply') }),
                    actionButton('현재 내용 유지', { variant: 'muted', onClick: () => onDecide?.(suggestion.suggestion_token, 'hold') }),
                ]),
            ]));
            queueMicrotask(() => heading.focus?.());
        }
        section.replaceChildren(...children.filter(Boolean));
    };
    render();
    return section;
}
