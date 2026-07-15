import { el } from './ui.js';
import { p } from './copy.js';
import { deriveWorkflowMetrics } from '../../lib/pipeline/workflowGuide.js';

export function PipelineStatusStrip({ state, metrics }) {
    const status = metrics || deriveWorkflowMetrics(state);
    const items = [
        [p('Files'), status.files || 0],
        [p('Parsed'), status.parsed || 0],
        [p('Reviewed'), status.reviewed || 0],
        [p('Accepted'), status.accepted || 0],
    ];

    return el('dl', {
        className: 'pipeline-status-strip',
        attrs: { 'aria-label': p('Pipeline file status') },
    }, items.map(([label, value]) => el('div', { className: 'pipeline-status-item' }, [
        el('dt', { text: label, className: 'pipeline-status-label' }),
        el('dd', { text: value, className: `pipeline-status-value${label === p('Accepted') && value === 0 ? ' is-blocked' : ''}` }),
    ])));
}
