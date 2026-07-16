import { normalizeDesignBoard } from './DesignBoardEditor.js';
import { actionButton, card, el, emptyState } from './ui.js';

const SCENE_FIELDS = Object.freeze([
    ['title', '장면 이름', 0],
    ['dramatic_beat', '핵심 장면', 2],
    ['first_frame', '첫 화면', 2],
    ['action', '행동', 2],
    ['camera', '카메라·움직임', 2],
    ['lighting', '조명', 2],
    ['audio_sfx_dialogue', '소리·대사', 2],
]);

function cloneBoard(value) {
    const board = normalizeDesignBoard(value);
    return {
        characters: board.characters.map((item) => ({ ...item })),
        locations: board.locations.map((item) => ({ ...item })),
        scenes: board.scenes.map((item) => ({ ...item, characters: [...item.characters] })),
    };
}

function sceneField(scene, sceneIndex, key, label, rows, onInput) {
    const id = `continuity-scene-${sceneIndex + 1}-${key}`;
    const control = el(rows ? 'textarea' : 'input', {
        value: scene[key],
        className: `min-h-11 w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-white outline-none focus:border-cyan-300/50 ${rows ? 'resize-y' : ''}`,
        attrs: { id, rows: rows || undefined, type: rows ? undefined : 'text', maxlength: 12000 },
    });
    control.addEventListener('input', () => onInput(control.value));
    return el('label', { className: 'flex min-w-0 flex-col gap-2', attrs: { for: id } }, [
        el('span', { text: label, className: 'text-xs font-semibold text-white' }),
        control,
    ]);
}

function durationField(scene, sceneIndex, onInput) {
    const id = `continuity-scene-${sceneIndex + 1}-duration`;
    const control = el('input', {
        value: scene.duration,
        className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50',
        attrs: { id, type: 'number', min: 1, max: 60, step: 1 },
    });
    control.addEventListener('input', () => onInput(Number(control.value) || 0));
    return el('label', { className: 'flex min-w-0 flex-col gap-2', attrs: { for: id } }, [
        el('span', { text: '길이(초)', className: 'text-xs font-semibold text-white' }),
        control,
    ]);
}

export function NewProjectContinuityEditor({
    mode = 'shot', designState, boardValue, dirty = false, notice = '',
    onBoardChange, onSave, onAgentRequest,
}) {
    let board = cloneBoard(boardValue || designState?.board);
    let localDirty = dirty;
    let working = ['saving', 'requesting'].includes(designState?.status);
    let localNotice = notice;
    const title = mode === 'motion' ? '새 프로젝트 모션 보드' : '새 프로젝트 샷 설계';
    const root = el('section', { className: 'flex min-w-0 flex-col gap-4', attrs: { 'aria-label': title } });

    const snapshot = () => normalizeDesignBoard(board, false);
    const updateScene = (index, key, value) => {
        board.scenes[index] = { ...board.scenes[index], [key]: value };
        localDirty = true;
        localNotice = '저장하지 않은 변경이 있습니다.';
        onBoardChange?.(snapshot());
    };

    const render = () => {
        const request = el('textarea', {
            className: 'min-h-24 w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/50',
            attrs: {
                maxlength: 4000,
                'aria-label': `${title} 수정 요청`,
                placeholder: mode === 'motion'
                    ? '예: 인물의 연속성은 유지하고 장면별 움직임과 카메라를 더 자연스럽게 다듬어줘'
                    : '예: 첫 화면에서 갈등이 바로 보이도록 샷 순서를 다듬어줘',
            },
        });
        const requestStatus = el('p', {
            text: localNotice || (localDirty ? '저장하지 않은 변경이 있습니다.' : '현재 장면 설계를 바로 수정할 수 있습니다.'),
            className: 'text-xs leading-5 text-secondary',
            attrs: { role: 'status', 'aria-live': 'polite' },
        });
        const sceneCards = board.scenes.map((scene, index) => card([
            el('header', { className: 'mb-3' }, [
                el('p', { text: `장면 ${index + 1}`, className: 'text-xs font-semibold text-secondary' }),
                el('h3', { text: scene.title || `장면 ${index + 1}`, className: 'mt-1 text-base font-bold text-white' }),
            ]),
            el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2' }, [
                ...SCENE_FIELDS.map(([key, label, rows]) => sceneField(
                    scene, index, key, label, rows, (value) => updateScene(index, key, value),
                )),
                durationField(scene, index, (value) => updateScene(index, 'duration', value)),
            ]),
        ], 'min-w-0'));

        root.replaceChildren(...[
            el('header', {}, [
                el('h3', { text: title, className: 'text-lg font-bold text-white' }),
                el('p', {
                    text: '장면 이름부터 첫 화면·행동·카메라·조명·소리·길이까지 현재 설계에 함께 저장합니다.',
                    className: 'mt-1 text-sm leading-6 text-secondary',
                }),
            ]),
            requestStatus,
            el('div', { className: 'flex flex-wrap gap-2' }, [
                actionButton('전체 저장', {
                    disabled: working || !board.scenes.length || typeof onSave !== 'function',
                    onClick: async () => {
                        working = true;
                        localNotice = '저장 중…';
                        render();
                        const result = await onSave?.(snapshot());
                        if (result?.ok === false) {
                            working = false;
                            localNotice = '저장하지 못했습니다.';
                            render();
                        }
                    },
                }),
            ]),
            board.scenes.length
                ? el('div', { className: 'grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2' }, sceneCards)
                : emptyState('기획·대본과 인물·장소 설계를 저장하면 장면이 표시됩니다.'),
            el('section', { className: 'rounded-md border border-white/10 bg-black/20 p-3' }, [
                el('h3', { text: '에이전트에게 전체 설계 요청', className: 'text-sm font-bold text-white' }),
                el('p', { text: '인물·장소와 모든 장면을 함께 보고 수정안을 만듭니다. 생성은 시작하지 않습니다.', className: 'mt-1 text-xs leading-5 text-secondary' }),
                el('label', { className: 'mt-3 block text-xs font-semibold text-white' }, [
                    el('span', { text: '어떻게 바꿀까요?', className: 'mb-2 block' }),
                    request,
                ]),
                el('div', { className: 'mt-2' }, [actionButton('에이전트 작업 시작', {
                    variant: 'muted',
                    disabled: working || typeof onAgentRequest !== 'function',
                    onClick: async () => {
                        const instruction = request.value.trim();
                        if (!instruction) {
                            localNotice = '요청 내용을 입력하세요.';
                            render();
                            return;
                        }
                        working = true;
                        localNotice = '에이전트가 수정안을 만드는 중…';
                        render();
                        const result = await onAgentRequest({ instruction, board: snapshot() });
                        if (result?.ok === false) {
                            working = false;
                            localNotice = '수정안을 만들지 못했습니다.';
                            render();
                        }
                    },
                })]),
            ]),
        ]);
    };

    render();
    return root;
}

export default NewProjectContinuityEditor;
