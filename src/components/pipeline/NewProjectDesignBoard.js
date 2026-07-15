import { actionButton, el } from './ui.js';
import { editableDesignSections, normalizeDesignBoard } from './DesignBoardEditor.js';
import {
    designCollaborationView,
    DesignSuggestionHistory,
    DesignSuggestionPanel,
} from './DesignSuggestionPanel.js';

export function NewProjectDesignBoard({
    designState, boardValue, dirty = false, notice = '', onBoardChange, onSave,
    onEnqueue, onRun, onRefresh, onDecide,
}) {
    let board = normalizeDesignBoard(boardValue || designState?.board);
    let localDirty = dirty;
    let statusNode = null;
    let markSuggestionStale = () => {};
    const root = el('section', { className: 'flex min-w-0 flex-col gap-5', attrs: { 'aria-labelledby': 'new-project-design-title' } });

    const emit = () => {
        localDirty = true;
        onBoardChange?.(normalizeDesignBoard(board, false));
    };
    const update = (group, index, key, value) => {
        board[group][index][key] = value;
        emit();
        if (statusNode) statusNode.textContent = '저장하지 않은 변경이 있습니다';
        markSuggestionStale();
    };

    const render = () => {
        markSuggestionStale = () => {};
        const view = designCollaborationView(designState?.collaboration, localDirty);
        const requestInput = el('textarea', {
            className: 'min-h-[112px] w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/50',
            attrs: {
                id: 'design-agent-request', maxlength: 4000,
                placeholder: '예: 인물·의상·장소가 모든 장면에서 이어지도록 설계해줘',
            },
        });
        const requestStatus = el('p', {
            text: view.queued
                ? '요청이 저장됐습니다 · 에이전트 작업을 다시 시작할 수 있습니다.'
                : '직접 수정하거나 에이전트에게 전체 설계를 맡길 수 있습니다.',
            className: 'text-xs leading-5 text-secondary',
            attrs: { role: 'status', 'aria-live': 'polite' },
        });
        const composer = el('div', { className: 'flex min-w-0 flex-col gap-3 rounded-md border border-white/10 bg-black/20 p-3' }, [
            el('h3', { text: '에이전트와 함께 수정', className: 'text-sm font-semibold text-white' }),
            el('p', { text: '시작하면 현재 설계를 먼저 저장합니다. 이미지나 영상 생성은 실행하지 않습니다.', className: 'text-xs leading-5 text-secondary' }),
            el('label', { text: '어떻게 바꿀까요?', className: 'text-xs font-semibold text-white', attrs: { for: 'design-agent-request' } }),
            requestInput,
            el('div', { className: 'flex flex-wrap gap-2' }, [
                actionButton('에이전트 작업 시작', {
                    onClick: async () => {
                        const instruction = requestInput.value.trim();
                        if (!instruction) {
                            requestStatus.textContent = '요청 내용을 입력하세요.';
                            return;
                        }
                        await onEnqueue?.({ instruction, board: normalizeDesignBoard(board, false) });
                    },
                }),
                view.queued ? actionButton('다시 시도', { variant: 'muted', onClick: () => onRun?.() }) : null,
                view.queued ? actionButton('수정안 확인', { variant: 'muted', onClick: () => onRefresh?.() }) : null,
            ].filter(Boolean)),
            requestStatus,
        ]);
        const currentBoard = editableDesignSections(board, update, () => {
            emit();
            render();
        });
        const status = el('p', {
            text: notice || (localDirty ? '저장하지 않은 변경이 있습니다' : '설계를 직접 수정하거나 에이전트에게 요청할 수 있습니다.'),
            className: 'text-xs leading-5 text-secondary',
            attrs: { role: 'status', 'aria-live': 'polite', 'data-design-status': 'true' },
        });
        statusNode = status;
        const boardArea = view.compare
            ? DesignSuggestionPanel({
                view, currentBoard, onDecide,
                registerDirty: (handler) => { markSuggestionStale = handler; },
            })
            : currentBoard;

        root.replaceChildren(...[
            el('header', { className: 'flex flex-col gap-2' }, [
                el('h3', { text: '새 프로젝트 설계', className: 'text-lg font-bold tracking-tight text-white', attrs: { id: 'new-project-design-title' } }),
                el('p', { text: '인물·장소·장면을 직접 고치거나, 에이전트에게 전체 설계를 맡기세요.', className: 'text-sm leading-6 text-secondary' }),
            ]),
            el('nav', { className: 'grid grid-cols-3 gap-2', attrs: { 'aria-label': '설계 구역 바로가기' } }, [
                actionButton('인물', { variant: 'muted', onClick: () => document.getElementById?.('design-characters')?.scrollIntoView?.() }),
                actionButton('장소', { variant: 'muted', onClick: () => document.getElementById?.('design-locations')?.scrollIntoView?.() }),
                actionButton('장면', { variant: 'muted', onClick: () => document.getElementById?.('design-scenes')?.scrollIntoView?.() }),
            ]),
            status,
            el('div', { className: 'flex flex-wrap gap-2' }, [
                actionButton('직접 저장', { onClick: () => onSave?.(normalizeDesignBoard(board, false)) }),
            ]),
            composer,
            boardArea,
            view.history ? DesignSuggestionHistory({
                view, dirty: localDirty, onDecide,
                registerDirty: (handler) => { markSuggestionStale = handler; },
            }) : null,
        ].filter(Boolean));
    };

    render();
    return root;
}

export default NewProjectDesignBoard;
