import { BLOCKERS } from '../../lib/pipeline/blockers.js';
import { validateProductionBrief } from '../../lib/pipeline/validators.js';
import { actionButton, blockerList, card, el, flagGrid, infoGrid, panelShell, pathList, statusBadge } from './ui.js';

export function IntakePanel({ state, onSavePlanningFile }) {
    const project = state.project || {};
    const brief = state.brief || {};
    const validation = validateProductionBrief(brief);
    const referencePaths = state.referenceMediaPaths || state.assets?.map((asset) => asset.path) || [];
    const saveButton = actionButton('Save planning file', {
        disabled: !project.root_path,
        onClick: () => onSavePlanningFile?.({
            rootPath: project.root_path,
            relativePath: 'docs/ui_integration/intake_snapshot.json',
            content: JSON.stringify({ project, brief, referencePaths }, null, 2),
        }),
    });

    return panelShell('Intake', 'Production intent, route, media requirements, and stop-loss rule. This panel can save planning files only.', [
        el('div', { className: 'flex flex-wrap items-center gap-2' }, [
            statusBadge(validation.ok ? 'Brief valid' : BLOCKERS.MISSING_PRODUCTION_BRIEF, validation.ok ? 'PASS' : 'BLOCK'),
            statusBadge('No generation actions', 'PREVIEW'),
            saveButton,
        ]),
        infoGrid([
            { label: 'Project title', value: project.title },
            { label: 'Output folder', value: project.root_path },
            { label: 'Target route', value: project.route },
            { label: 'Aspect ratio', value: project.aspect_ratio },
            { label: 'Clip count', value: state.storyboard?.length || 0 },
            { label: 'Script path', value: brief.script_path },
        ]),
        card([
            el('div', { text: 'Concept', className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
            el('p', { text: brief.concept || '—', className: 'mt-2 text-sm leading-6 text-white' }),
            el('div', { text: 'Logline', className: 'mt-5 text-[11px] font-bold uppercase tracking-widest text-secondary' }),
            el('p', { text: brief.logline || '—', className: 'mt-2 text-sm leading-6 text-white' }),
            el('div', { text: 'Stop-loss rule', className: 'mt-5 text-[11px] font-bold uppercase tracking-widest text-secondary' }),
            el('p', { text: brief.stop_loss_rule || '—', className: 'mt-2 text-sm leading-6 text-white' }),
        ]),
        flagGrid([
            { label: 'Dialogue', value: brief.dialogue_required },
            { label: 'Subtitles', value: brief.subtitles_required },
            { label: 'Music', value: brief.music_required },
            { label: 'Natural SFX', value: brief.natural_sfx_required },
        ]),
        card([
            el('h3', { text: 'Reference Media Paths', className: 'mb-3 text-sm font-bold uppercase tracking-widest text-white' }),
            pathList(referencePaths),
        ]),
        validation.ok ? null : blockerList(validation.blockers),
    ].filter(Boolean));
}
