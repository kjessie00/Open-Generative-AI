import { pipelineClient } from '../../lib/pipeline/client.js';
import { el, statusBadge } from './ui.js';
import { p } from './copy.js';

export function PipelineSafetySummary() {
    const rows = [
        ['planning files', 'allowed', 'PASS'],
        ['local reads/writes', 'allowed', 'PASS'],
        ['non-consuming status commands', 'preview only', 'PREVIEW'],
        ['image generation', 'blocked', 'BLOCK'],
        ['Dreamina submit', 'blocked', 'BLOCK'],
        ['Gemini review', 'blocked', 'BLOCK'],
        ['external upload', 'blocked', 'BLOCK'],
    ];

    const details = el('details', { className: 'pipeline-safety-details' });
    details.appendChild(el('summary', { className: 'pipeline-safety-summary' }, [
        el('span', { text: p('Safe mode · generation and upload blocked') }),
        statusBadge(
            pipelineClient.hasFilmPipelineBridge() ? p('Electron bridge') : p('Mock fallback'),
            'PREVIEW',
        ),
    ]));
    details.appendChild(el('div', { className: 'pipeline-safety-grid' }, rows.map(([label, value, status]) => (
        el('div', { className: 'pipeline-safety-row' }, [
            el('span', { text: p(label), className: 'pipeline-safety-label' }),
            statusBadge(p(value), status),
        ])
    ))));
    return details;
}
