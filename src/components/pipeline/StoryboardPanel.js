import { validateStoryboardClip } from '../../lib/pipeline/validators.js';
import { dataTable, el, panelShell, statusBadge } from './ui.js';
import { p } from './copy.js';

function strategyBadges(clip) {
    const validation = validateStoryboardClip(clip);
    return el('div', { className: 'flex flex-wrap gap-2' }, [
        statusBadge(p(clip.dominant_action ? 'one dominant action' : 'dominant action missing'), clip.dominant_action ? 'PASS' : 'BLOCK'),
        statusBadge(p(clip.dominant_camera_strategy ? 'one camera strategy' : 'camera strategy missing'), clip.dominant_camera_strategy ? 'PASS' : 'BLOCK'),
        statusBadge(p(clip.first_frame ? 'first-frame required' : 'first-frame missing'), clip.first_frame ? 'PASS' : 'BLOCK'),
        statusBadge(p(clip.risk ? 'continuity risk tracked' : 'risk missing'), clip.risk ? 'WARN' : 'BLOCK'),
        ...validation.blockers.map((blocker) => statusBadge(blocker, 'BLOCK')),
    ]);
}

export function StoryboardPanel({ state }) {
    const clips = state.storyboard || [];
    return panelShell(p('Storyboard'), p('Clip continuity packet with validator badges for dominant action, camera strategy, first-frame requirement, and continuity risk.'), [
        dataTable([
            { label: p('Scene'), key: 'scene_id' },
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Duration'), render: (clip) => `${clip.duration || 0}s` },
            { label: p('Dramatic beat'), key: 'dramatic_beat' },
            { label: p('Characters'), render: (clip) => (clip.characters || []).join(', ') || '—' },
            { label: p('Location'), key: 'location' },
            { label: p('First frame'), key: 'first_frame' },
            { label: p('Action'), key: 'action' },
            { label: p('Camera'), key: 'camera' },
            { label: p('Lighting'), key: 'lighting' },
            { label: p('Audio/SFX/dialogue'), key: 'audio_sfx_dialogue' },
            { label: p('References'), render: (clip) => (clip.reference_dependencies || []).join(', ') || '—' },
            { label: p('Risk'), key: 'risk' },
            { label: p('Validator badges'), render: strategyBadges },
        ], clips),
    ]);
}
