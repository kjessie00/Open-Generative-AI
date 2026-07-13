import { el, statusBadge } from './ui.js';
import { p } from './copy.js';

function deriveFileStatus(state) {
    return state.fileStatus || {
        files_found: state.assets?.length || 0,
        content_parsed: [
            state.storyboard?.length,
            state.motionBoard?.length,
            state.promptPacks?.length,
            state.submitRecords?.length,
            state.heartbeatRecords?.length,
        ].filter(Boolean).length,
        review_passed: (state.reviewGates || []).filter((gate) => gate.status === 'PASS').length,
        quality_accepted: (state.acceptedSeconds || []).filter((record) => (
            record.canonical_provenance === 'selected_takes.json'
                ? record.accepted === true && record.source_exists === true && Boolean(record.clip_id)
                : record.accepted === true || (record.source_file && record.out_time > record.in_time)
        )).length,
    };
}

export function PipelineStatusStrip({ state }) {
    const status = deriveFileStatus(state);
    const items = [
        [p('Files'), status.files_found || 0, status.files_found > 0 ? 'PASS' : 'UNREVIEWED'],
        [p('Parsed'), status.content_parsed || 0, status.content_parsed > 0 ? 'PASS' : 'UNREVIEWED'],
        [p('Reviewed'), status.review_passed || 0, status.review_passed > 0 ? 'PASS' : 'UNREVIEWED'],
        [p('Accepted'), status.quality_accepted || 0, status.quality_accepted > 0 ? 'PASS' : 'BLOCK'],
    ];

    return el('dl', {
        className: 'pipeline-status-strip',
        attrs: { 'aria-label': p('Pipeline file status') },
    }, items.map(([label, value, badgeStatus]) => el('div', { className: 'pipeline-status-item' }, [
        el('dt', { text: label, className: 'pipeline-status-label' }),
        el('dd', { className: 'pipeline-status-value' }, statusBadge(value, badgeStatus)),
    ])));
}
