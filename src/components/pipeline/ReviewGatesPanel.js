import { dataTable, el, panelShell } from './ui.js';
import { p } from './copy.js';
import { blockerLabel, gateLabel, plainStatus } from './generationUi.js';

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
            notes: p('No gate record loaded.'),
        }),
        ...gates.filter((gate) => !GATE_ORDER.includes(gate.type)),
    ];

    return panelShell(p('Review Gates'), p('Every gate status must stay separate: pipeline pass is not output-quality acceptance.'), [
        el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, ordered.map((gate) => (
            el('article', { className: 'rounded-lg border border-white/10 bg-white/[0.035] p-4' }, [
                el('div', { className: 'flex items-center justify-between gap-3' }, [
                    el('h3', { text: gateLabel(gate.type), className: 'text-base font-bold text-white' }),
                    plainStatus(gate.status),
                ]),
                gate.blocker ? el('p', { text: blockerLabel(gate.blocker), className: 'mt-3 text-sm text-amber-100', title: gate.blocker }) : null,
                gate.notes ? el('p', { text: gate.notes, className: 'mt-2 text-sm leading-6 text-secondary' }) : null,
                el('details', { className: 'mt-4' }, [
                    el('summary', { text: '세부 기록', className: 'cursor-pointer text-xs font-semibold text-secondary' }),
                    el('div', { className: 'mt-3' }, [dataTable([
                        { label: '항목', key: 'field' },
                        { label: '내용', key: 'value' },
                    ], [
                        { field: '게이트 ID', value: gate.gate_id },
                        { field: '클립', value: gate.clip_id },
                        { field: '근거 파일', value: gate.evidence_path },
                    ])]),
                ]),
            ])
        ))),
    ]);
}
