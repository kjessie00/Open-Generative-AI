import { el, statusBadge } from './ui.js';

export function G3ShotNavigator({ shots, selections, activeShotId, onSelect }) {
    const complete = new Set(selections.filter((selection) => (
        selection.candidate_token && selection.chosen_provider && selection.dialogue_source
        && selection.beat_id && selection.take_id && selection.source_out_sec !== null && selection.selection_reason
    )).map((selection) => selection.shot_id));

    return el('nav', {
        className: 'flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0',
        attrs: { 'aria-label': '검토할 샷 선택' },
    }, shots.map((shot, index) => {
        const active = shot.shot_id === activeShotId;
        return el('button', {
            type: 'button',
            onClick: () => onSelect(shot.shot_id),
            className: `min-h-11 min-w-32 rounded-md border px-3 py-2 text-left text-sm transition-colors ${active
                ? 'border-cyan-300 bg-cyan-400/10 text-white'
                : 'border-white/10 bg-black/20 text-secondary hover:bg-white/[0.06]'}`,
            attrs: { 'aria-pressed': active ? 'true' : 'false' },
        }, [
            el('span', { text: `${index + 1}. ${shot.shot_id}`, className: 'block font-semibold' }),
            statusBadge(complete.has(shot.shot_id) ? '입력 완료' : '입력 필요', complete.has(shot.shot_id) ? 'PASS' : 'UNREVIEWED'),
        ]);
    }));
}
