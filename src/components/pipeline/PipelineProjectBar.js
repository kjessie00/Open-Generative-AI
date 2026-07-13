import { actionButton, el } from './ui.js';
import { p } from './copy.js';

export function PipelineProjectBar({ state, onOpenProduction, onRefreshProductions }) {
    const project = state.project || {};
    return el('header', { className: 'pipeline-project-bar' }, [
        el('div', { className: 'pipeline-project-context' }, [
            el('h1', {
                text: project.title || p('Mock production'),
                className: 'pipeline-project-title',
            }),
            el('p', {
                text: `${project.route || 'seedance'} · ${project.aspect_ratio || '9:16'}`,
                className: 'pipeline-project-meta',
            }),
        ]),
        el('div', { className: 'pipeline-project-actions' }, [
            actionButton(p('Open production folder'), { onClick: onOpenProduction }),
            actionButton(p('Refresh productions'), { onClick: onRefreshProductions, variant: 'muted' }),
        ]),
    ]);
}
