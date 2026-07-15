import { actionButton, card, el } from './ui.js';

const EMPTY = Object.freeze({ characters: [], locations: [], scenes: [] });
const safeText = (value) => typeof value === 'string' ? value : '';
const safeList = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

export function normalizeDesignBoard(value = EMPTY, withEmptyRows = true) {
    const characters = (Array.isArray(value.characters) ? value.characters : []).map((item) => ({
        id: safeText(item?.id), name: safeText(item?.name), role: safeText(item?.role), appearance: safeText(item?.appearance),
        wardrobe: safeText(item?.wardrobe), continuity: safeText(item?.continuity),
    }));
    const locations = (Array.isArray(value.locations) ? value.locations : []).map((item) => ({
        id: safeText(item?.id), name: safeText(item?.name), space: safeText(item?.space), lighting: safeText(item?.lighting),
        props: safeText(item?.props), continuity: safeText(item?.continuity),
    }));
    const scenes = (Array.isArray(value.scenes) ? value.scenes : []).map((item) => ({
        id: safeText(item?.id), title: safeText(item?.title), dramatic_beat: safeText(item?.dramatic_beat),
        characters: safeList(item?.characters), location_id: safeText(item?.location_id), duration: Number(item?.duration) || 5,
        first_frame: safeText(item?.first_frame), action: safeText(item?.action), camera: safeText(item?.camera),
        lighting: safeText(item?.lighting), audio_sfx_dialogue: safeText(item?.audio_sfx_dialogue),
    }));
    if (withEmptyRows && !characters.length) characters.push({ id: 'character_01', name: '', role: '', appearance: '', wardrobe: '', continuity: '' });
    if (withEmptyRows && !locations.length) locations.push({ id: 'location_01', name: '', space: '', lighting: '', props: '', continuity: '' });
    if (withEmptyRows && !scenes.length) scenes.push({
        id: 'scene_01', title: '', dramatic_beat: '', characters: [], location_id: '', duration: 5,
        first_frame: '', action: '', camera: '', lighting: '', audio_sfx_dialogue: '',
    });
    return { characters, locations, scenes };
}

function nextId(items, prefix) {
    const used = new Set(items.map((item) => item.id));
    for (let number = 1; number <= 999; number += 1) {
        const candidate = `${prefix}_${String(number).padStart(2, '0')}`;
        if (!used.has(candidate)) return candidate;
    }
    return `${prefix}_999`;
}

function field(label, id, value, onInput, options = {}) {
    const { rows = 0, type = 'text', min, max } = options;
    const control = el(rows ? 'textarea' : 'input', {
        value,
        className: `min-h-11 w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm leading-6 text-white outline-none focus:border-cyan-300/50 ${rows ? 'resize-y' : ''}`,
        attrs: { id, type: rows ? undefined : type, rows: rows || undefined, min, max, autocomplete: type === 'text' ? 'off' : undefined },
    });
    control.addEventListener('input', (event) => onInput(event.target.value));
    return el('label', { className: 'flex min-w-0 flex-col gap-2', attrs: { for: id } }, [
        el('span', { text: label, className: 'text-xs font-semibold text-white' }), control,
    ]);
}

function selectField(id, value, options, onChange) {
    const select = el('select', {
        value,
        className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50',
        attrs: { id },
    }, options.map((option) => el('option', { text: option.label, value: option.value, attrs: { value: option.value } })));
    select.value = value;
    select.addEventListener('change', (event) => onChange(event.target.value));
    return el('label', { className: 'flex min-w-0 flex-col gap-2', attrs: { for: id } }, [
        el('span', { text: '장소', className: 'text-xs font-semibold text-white' }), select,
    ]);
}

function placeholder(label) {
    return el('div', {
        className: 'flex aspect-[16/10] w-full items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 text-xs text-secondary',
        attrs: { role: 'img', 'aria-label': `${label} 이미지 없음` },
    }, [el('span', { text: '이미지 없음' })]);
}

function heading(number, title, subtitle, id) {
    return el('header', { className: 'flex flex-col gap-1' }, [
        el('h4', { text: `${number}. ${title}`, className: 'text-base font-bold text-white', attrs: { id } }),
        el('p', { text: subtitle, className: 'text-xs leading-5 text-secondary' }),
    ]);
}

function sheetCard(item, index, kind, descriptors, board, update, rerender) {
    const prefix = `design-${kind}-${index + 1}`;
    const group = kind === 'character' ? 'characters' : 'locations';
    const details = el('details', {
        className: 'rounded-md border border-white/10 bg-black/20 px-3',
        attrs: { open: item.name ? undefined : 'true' },
    }, [
        el('summary', { text: '수정', className: 'min-h-11 cursor-pointer py-3 text-xs font-semibold text-white' }),
        el('div', { className: 'flex min-w-0 flex-col gap-3 pb-3' }, [
            ...descriptors.map(([key, label, rows = 0]) => field(label, `${prefix}-${key}`, item[key], (value) => update(group, index, key, value), { rows })),
            actionButton('삭제', {
                variant: 'muted', disabled: board[group].length === 1,
                onClick: () => {
                    board[group].splice(index, 1);
                    if (group === 'characters') board.scenes.forEach((scene) => { scene.characters = scene.characters.filter((id) => id !== item.id); });
                    else board.scenes.forEach((scene) => { if (scene.location_id === item.id) scene.location_id = ''; });
                    rerender();
                },
            }),
        ]),
    ]);
    return card([
        placeholder(item.name || `${kind === 'character' ? '인물' : '장소'} ${index + 1}`),
        el('h5', { text: item.name || `${kind === 'character' ? '새 인물' : '새 장소'}`, className: 'text-sm font-bold text-white' }),
        el('p', { text: item[kind === 'character' ? 'role' : 'space'] || '내용을 입력하세요.', className: 'line-clamp-1 text-xs text-secondary' }),
        details,
    ], 'flex min-w-0 flex-col gap-3');
}

function sceneCard(scene, index, board, update, rerender) {
    const prefix = `design-scene-${index + 1}`;
    const patch = (key, value) => update('scenes', index, key, value);
    const choices = el('fieldset', { className: 'flex min-w-0 flex-col gap-2' }, [
        el('legend', { text: '등장인물', className: 'text-xs font-semibold text-white' }),
        el('div', { className: 'grid grid-cols-1 gap-1 sm:grid-cols-2' }, board.characters.map((character, choiceIndex) => {
            const id = `${prefix}-character-${choiceIndex + 1}`;
            const checkbox = el('input', { className: 'h-5 w-5 shrink-0 accent-cyan-400', attrs: { id, type: 'checkbox' } });
            checkbox.checked = scene.characters.includes(character.id);
            checkbox.addEventListener('change', () => {
                const selected = new Set(scene.characters);
                if (checkbox.checked) selected.add(character.id); else selected.delete(character.id);
                patch('characters', [...selected]);
            });
            return el('label', { className: 'flex min-h-11 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white', attrs: { for: id } }, [
                checkbox, el('span', { text: character.name || `인물 ${choiceIndex + 1}` }),
            ]);
        })),
    ]);
    const rows = [
        ['title', '제목', 0], ['dramatic_beat', '핵심 장면', 2], ['first_frame', '첫 화면', 2], ['action', '행동', 2],
        ['camera', '카메라', 2], ['lighting', '조명', 2], ['audio_sfx_dialogue', '소리', 2],
    ];
    const details = el('details', {
        className: 'rounded-md border border-white/10 bg-black/20 px-3',
        attrs: { open: scene.title ? undefined : 'true' },
    }, [
        el('summary', { text: '수정', className: 'min-h-11 cursor-pointer py-3 text-xs font-semibold text-white' }),
        el('div', { className: 'flex min-w-0 flex-col gap-3 pb-3' }, [
            ...rows.slice(0, 2).map(([key, label, count]) => field(label, `${prefix}-${key}`, scene[key], (value) => patch(key, value), { rows: count })),
            choices,
            selectField(`${prefix}-location`, scene.location_id, [
                { value: '', label: '장소 선택' },
                ...board.locations.map((item, itemIndex) => ({ value: item.id, label: item.name || `장소 ${itemIndex + 1}` })),
            ], (value) => patch('location_id', value)),
            field('길이(초)', `${prefix}-duration`, scene.duration, (value) => patch('duration', Number(value) || 0), { type: 'number', min: 1, max: 60 }),
            ...rows.slice(2).map(([key, label, count]) => field(label, `${prefix}-${key}`, scene[key], (value) => patch(key, value), { rows: count })),
            el('div', { className: 'grid grid-cols-3 gap-2' }, [
                actionButton('앞으로', { variant: 'muted', disabled: index === 0, onClick: () => { [board.scenes[index - 1], board.scenes[index]] = [board.scenes[index], board.scenes[index - 1]]; rerender(); } }),
                actionButton('뒤로', { variant: 'muted', disabled: index === board.scenes.length - 1, onClick: () => { [board.scenes[index], board.scenes[index + 1]] = [board.scenes[index + 1], board.scenes[index]]; rerender(); } }),
                actionButton('삭제', { variant: 'muted', disabled: board.scenes.length === 1, onClick: () => { board.scenes.splice(index, 1); rerender(); } }),
            ]),
        ]),
    ]);
    return card([
        placeholder(scene.title || `장면 ${index + 1}`),
        el('h5', { text: scene.title || '새 장면', className: 'text-sm font-bold text-white' }),
        el('p', { text: scene.dramatic_beat || '핵심 장면을 입력하세요.', className: 'line-clamp-1 text-xs text-secondary' }),
        details,
    ], 'flex min-w-0 flex-col gap-3');
}

export function editableDesignSections(board, update, rerender) {
    const characters = board.characters.map((item, index) => sheetCard(item, index, 'character', [
        ['name', '이름'], ['role', '역할'], ['appearance', '외형', 2], ['wardrobe', '의상', 2], ['continuity', '연속성', 2],
    ], board, update, rerender));
    const locations = board.locations.map((item, index) => sheetCard(item, index, 'location', [
        ['name', '이름'], ['space', '공간', 2], ['lighting', '조명', 2], ['props', '소품', 2], ['continuity', '연속성', 2],
    ], board, update, rerender));
    const section = (id, head, cards, gridClass, addLabel, limit, onAdd) => el('section', {
        className: 'flex min-w-0 flex-col gap-3', attrs: { id, 'aria-labelledby': `${id}-title` },
    }, [head, el('div', { className: `grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 ${gridClass}` }, cards), actionButton(addLabel, { variant: 'muted', disabled: cards.length >= limit, onClick: onAdd })]);
    return el('div', { className: 'flex min-w-0 flex-col gap-6' }, [
        section('design-characters', heading(1, '인물 시트', '인물의 역할과 외형·의상 기준을 정합니다.', 'design-characters-title'), characters, '', '인물 추가', 12, () => { board.characters.push({ id: nextId(board.characters, 'character'), name: '', role: '', appearance: '', wardrobe: '', continuity: '' }); rerender(); }),
        section('design-locations', heading(2, '장소 시트', '공간과 조명·소품 기준을 장면보다 먼저 정합니다.', 'design-locations-title'), locations, '', '장소 추가', 12, () => { board.locations.push({ id: nextId(board.locations, 'location'), name: '', space: '', lighting: '', props: '', continuity: '' }); rerender(); }),
        section('design-scenes', heading(3, '장면 카드', '장면 순서와 첫 화면·행동·카메라·소리를 정합니다.', 'design-scenes-title'), board.scenes.map((item, index) => sceneCard(item, index, board, update, rerender)), 'xl:grid-cols-3', '장면 추가', 20, () => { board.scenes.push({ id: nextId(board.scenes, 'scene'), title: '', dramatic_beat: '', characters: [], location_id: '', duration: 5, first_frame: '', action: '', camera: '', lighting: '', audio_sfx_dialogue: '' }); rerender(); }),
    ]);
}
