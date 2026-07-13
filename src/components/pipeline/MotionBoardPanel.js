import { BLOCKERS } from '../../lib/pipeline/blockers.js';
import { blockerList, card, el, infoGrid, panelShell, statusBadge } from './ui.js';
import { p } from './copy.js';

export function MotionBoardPanel({ state }) {
    const shots = state.motionBoard || [];
    const clipIds = new Set((state.storyboard || []).map((clip) => clip.clip_id));
    const coveredClipIds = new Set(shots.map((shot) => shot.clip_id));
    const missing = [...clipIds].filter((clipId) => !coveredClipIds.has(clipId));
    const blockers = shots.length && missing.length === 0 ? [] : [BLOCKERS.MISSING_MOTION_BOARD];

    return panelShell(p('Motion Board'), p('Shot cards used to lock movement, identity risk, and duration before submit preview.'), [
        blockerList(blockers),
        el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, shots.map((shot) => (
            card([
                el('div', { className: 'mb-4 flex flex-wrap items-center gap-2' }, [
                    statusBadge(shot.clip_id || p('missing clip'), shot.clip_id ? 'PASS' : 'BLOCK'),
                    statusBadge(p(shot.duration_lock ? 'duration lock' : 'duration lock missing'), shot.duration_lock ? 'PASS' : 'BLOCK'),
                ]),
                infoGrid([
                    { label: p('Shot size'), value: shot.shot_size },
                    { label: p('Camera movement'), value: shot.camera_movement },
                    { label: p('Movement risk'), value: shot.movement_risk },
                    { label: p('Identity risk'), value: shot.identity_risk },
                    { label: p('Continuity notes'), value: shot.continuity_notes },
                ], 'lg:grid-cols-2'),
            ])
        ))),
    ]);
}
