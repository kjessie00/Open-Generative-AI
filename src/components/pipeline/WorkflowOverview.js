import { deriveWorkflowGuide } from '../../lib/pipeline/workflowGuide.js';
import { PipelineStatusStrip } from './PipelineStatusStrip.js';
import { el } from './ui.js';

function capabilityBand(capabilities) {
    return el('dl', { className: 'workflow-capability-band' }, capabilities.map((item, index) => (
        el('div', { className: `workflow-capability-row capability-${index + 1}` }, [
            el('dt', { text: item.label, className: 'workflow-capability-label' }),
            el('dd', { text: item.detail, className: 'workflow-capability-detail' }),
        ])
    )));
}

function detailRows(guide) {
    const stage = guide.stages.find((item) => item.id === guide.activeStageId);
    return el('section', {
        className: 'workflow-detail-section',
        attrs: { 'aria-labelledby': 'workflow-detail-title' },
    }, [
        el('h2', {
            text: stage.label,
            className: 'workflow-detail-title',
            attrs: { id: 'workflow-detail-title' },
        }),
        el('ol', { className: 'workflow-detail-list' }, guide.detailRows.map((label, index) => (
            el('li', {
                className: `workflow-detail-row${index === 0 ? ' is-current' : ''}`,
                attrs: index === 0 ? { 'aria-current': 'step' } : {},
            }, [
                el('span', { text: `${stage.number}-${index + 1}`, className: 'workflow-detail-index', attrs: { 'aria-hidden': 'true' } }),
                el('span', { text: label, className: 'workflow-detail-label' }),
            ])
        ))),
    ]);
}

export function WorkflowOverview({ state, onNavigate }) {
    const guide = deriveWorkflowGuide(state);
    return el('section', {
        className: 'workflow-overview',
        attrs: { 'aria-labelledby': 'workflow-overview-title' },
    }, [
        el('header', { className: 'workflow-overview-header' }, [
            el('div', { className: 'workflow-overview-copy', attrs: { 'aria-live': 'polite' } }, [
                el('h1', { text: '지금 할 일', className: 'workflow-overview-title', attrs: { id: 'workflow-overview-title' } }),
                el('p', { text: guide.message, className: 'workflow-next-action' }),
                guide.explanation ? el('p', { text: guide.explanation, className: 'workflow-explanation' }) : null,
            ]),
            el('button', {
                text: guide.actionLabel,
                className: 'workflow-primary-action',
                onClick: () => onNavigate(guide.actionTab),
                attrs: { type: 'button' },
            }),
        ]),
        PipelineStatusStrip({ metrics: guide.metrics }),
        capabilityBand(guide.capabilities),
        detailRows(guide),
    ]);
}
