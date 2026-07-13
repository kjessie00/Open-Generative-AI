import { el } from './ui.js';

const CONTROL = 'mt-2 min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white';

function field(labelText, control, hint = '') {
    const id = control.getAttribute?.('id') || control.attributes?.get?.('id') || '';
    return el('label', { className: 'block text-xs font-semibold text-secondary', attrs: { for: id } }, [
        el('span', { text: labelText }),
        control,
        hint ? el('span', { text: hint, className: 'mt-1 block text-[11px] font-normal leading-5 text-secondary' }) : null,
    ]);
}

function selectControl(id, value, options) {
    const select = el('select', { className: CONTROL, attrs: { id } }, options.map(([optionValue, label]) => (
        el('option', { value: optionValue, text: label })
    )));
    select.value = value || '';
    return select;
}

function inputControl(id, type, value, attrs = {}) {
    const input = el('input', { type, value: value ?? '', className: CONTROL, attrs: { id, ...attrs } });
    return input;
}

export function G3SelectionEditor({ selection, beats, canonicalBeatListAvailable, onChange }) {
    const provider = selectControl('g3-provider', selection.chosen_provider, [
        ['', '제공자를 선택하세요'], ['seedance', 'Seedance'], ['flow', 'Flow'],
    ]);
    provider.addEventListener('change', () => onChange('chosen_provider', provider.value));

    const dialogue = selectControl('g3-dialogue-source', selection.dialogue_source, [
        ['', '대사 소스를 선택하세요'],
        ['native_video_lipsync', '영상 원본 립싱크'],
        ['tts_adr_overlay', 'TTS/ADR 오버레이'],
    ]);
    dialogue.addEventListener('change', () => onChange('dialogue_source', dialogue.value));

    const beat = canonicalBeatListAvailable
        ? selectControl('g3-beat-id', selection.beat_id, [
            ['', 'canonical 비트를 선택하세요'],
            ...beats.map((item) => [item.beat_id, item.beat_id]),
        ])
        : inputControl('g3-beat-id', 'text', selection.beat_id, { maxlength: '160', autocomplete: 'off' });
    beat.addEventListener('change', () => onChange('beat_id', beat.value));
    beat.addEventListener('input', () => onChange('beat_id', beat.value));

    const take = inputControl('g3-take-id', 'text', selection.take_id, { maxlength: '128', autocomplete: 'off' });
    take.addEventListener('input', () => onChange('take_id', take.value));
    const sourceIn = inputControl('g3-source-in', 'number', selection.source_in_sec, { min: '0', step: '0.01', inputmode: 'decimal' });
    sourceIn.addEventListener('input', () => onChange('source_in_sec', Number(sourceIn.value)));
    const sourceOut = inputControl('g3-source-out', 'number', selection.source_out_sec ?? '', { min: '0.01', step: '0.01', inputmode: 'decimal' });
    sourceOut.addEventListener('input', () => onChange('source_out_sec', sourceOut.value === '' ? null : Number(sourceOut.value)));

    const transitionType = selectControl('g3-transition-type', selection.transition_in?.type || '', [
        ['', '전환 없음'], ['cut', '컷'], ['crossfade', '크로스페이드'], ['dip_black', '딥 블랙'],
    ]);
    const transitionDuration = inputControl('g3-transition-duration', 'number', selection.transition_in?.dur ?? 0, { min: '0', max: '10', step: '0.01', inputmode: 'decimal' });
    transitionDuration.disabled = !transitionType.value;
    const updateTransition = () => {
        transitionDuration.disabled = !transitionType.value;
        onChange('transition_in', transitionType.value
            ? { type: transitionType.value, dur: Number(transitionDuration.value || 0) }
            : null);
    };
    transitionType.addEventListener('change', updateTransition);
    transitionDuration.addEventListener('input', updateTransition);

    const reason = el('textarea', {
        value: selection.selection_reason || '',
        className: `${CONTROL} min-h-24 py-3`,
        attrs: { id: 'g3-selection-reason', maxlength: '8000', rows: '3' },
    });
    reason.value = selection.selection_reason || '';
    reason.addEventListener('input', () => onChange('selection_reason', reason.value));
    const notes = el('textarea', {
        className: `${CONTROL} min-h-24 py-3`,
        attrs: { id: 'g3-shot-notes', maxlength: '32000', rows: '3' },
    });
    notes.value = selection.notes || '';
    notes.addEventListener('input', () => onChange('notes', notes.value));

    return el('fieldset', { className: 'space-y-4', attrs: { 'aria-labelledby': 'g3-selection-title' } }, [
        el('legend', { text: '인간 선택 기록', className: 'text-sm font-bold text-white', attrs: { id: 'g3-selection-title' } }),
        el('div', { className: 'grid grid-cols-1 gap-4 md:grid-cols-2' }, [
            field('생성 제공자', provider),
            field('대사 소스', dialogue),
            field('비트 ID', beat, canonicalBeatListAvailable ? 'canonical beats.json에서 선택합니다.' : 'canonical 비트 목록이 없어 사람이 직접 입력합니다.'),
            field('테이크 ID', take),
            field('채택 시작(초)', sourceIn),
            field('채택 종료(초)', sourceOut),
            field('진입 전환', transitionType),
            field('전환 길이(초)', transitionDuration),
        ]),
        field('선택 사유', reason, '사람이 왜 이 후보를 골랐는지 반드시 기록하세요.'),
        field('샷 메모', notes),
    ]);
}
