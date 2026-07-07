import { dataTable, el, panelShell, statusBadge } from './ui.js';

const GATE_ORDER = [
    'image_prompt',
    'image_qa',
    'dashboard',
    'prompt_media',
    'preflight',
    'submit_confirmation',
    'frame_qa',
    'accepted_seconds',
];

export function ReviewGatesPanel({ state }) {
    const gates = state.reviewGates || [];
    const ordered = [
        ...GATE_ORDER.map((type) => gates.find((gate) => gate.type === type) || {
            gate_id: `missing_${type}`,
            clip_id: '',
            type,
            status: 'UNREVIEWED',
            evidence_path: '',
            blocker: '',
            notes: 'No gate record loaded.',
        }),
        ...gates.filter((gate) => !GATE_ORDER.includes(gate.type)),
    ];

    return panelShell('Review Gates', 'Every gate status must stay separate: pipeline pass is not output-quality acceptance.', [
        el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, ordered.map((gate) => (
            el('article', { className: 'rounded-2xl border border-white/10 bg-white/[0.04] p-5' }, [
                el('div', { className: 'mb-4 flex flex-wrap items-center gap-2' }, [
                    statusBadge(gate.type, gate.status),
                    statusBadge(gate.status || 'UNREVIEWED', gate.status || 'UNREVIEWED'),
                ]),
                dataTable([
                    { label: 'Field', key: 'field' },
                    { label: 'Value', key: 'value' },
                ], [
                    { field: 'gate_id', value: gate.gate_id },
                    { field: 'clip_id', value: gate.clip_id },
                    { field: 'evidence_path', value: gate.evidence_path },
                    { field: 'blocker', value: gate.blocker },
                    { field: 'notes', value: gate.notes },
                ]),
            ])
        ))),
    ]);
}
