import { validateStoryboardClip } from '../../lib/pipeline/validators.js';
import { dataTable, el, panelShell, statusBadge } from './ui.js';

function strategyBadges(clip) {
    const validation = validateStoryboardClip(clip);
    return el('div', { className: 'flex flex-wrap gap-2' }, [
        statusBadge(clip.dominant_action ? 'one dominant action' : 'dominant action missing', clip.dominant_action ? 'PASS' : 'BLOCK'),
        statusBadge(clip.dominant_camera_strategy ? 'one camera strategy' : 'camera strategy missing', clip.dominant_camera_strategy ? 'PASS' : 'BLOCK'),
        statusBadge(clip.first_frame ? 'first-frame required' : 'first-frame missing', clip.first_frame ? 'PASS' : 'BLOCK'),
        statusBadge(clip.risk ? 'continuity risk tracked' : 'risk missing', clip.risk ? 'WARN' : 'BLOCK'),
        ...validation.blockers.map((blocker) => statusBadge(blocker, 'BLOCK')),
    ]);
}

export function StoryboardPanel({ state }) {
    const clips = state.storyboard || [];
    return panelShell('Storyboard', 'Clip continuity packet with validator badges for dominant action, camera strategy, first-frame requirement, and continuity risk.', [
        dataTable([
            { label: 'Scene', key: 'scene_id' },
            { label: 'Clip', key: 'clip_id' },
            { label: 'Duration', render: (clip) => `${clip.duration || 0}s` },
            { label: 'Dramatic beat', key: 'dramatic_beat' },
            { label: 'Characters', render: (clip) => (clip.characters || []).join(', ') || '—' },
            { label: 'Location', key: 'location' },
            { label: 'First frame', key: 'first_frame' },
            { label: 'Action', key: 'action' },
            { label: 'Camera', key: 'camera' },
            { label: 'Lighting', key: 'lighting' },
            { label: 'Audio/SFX/dialogue', key: 'audio_sfx_dialogue' },
            { label: 'References', render: (clip) => (clip.reference_dependencies || []).join(', ') || '—' },
            { label: 'Risk', key: 'risk' },
            { label: 'Validator badges', render: strategyBadges },
        ], clips),
    ]);
}
