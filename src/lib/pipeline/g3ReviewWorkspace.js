export function emptyG3ReviewState(status = 'loading') {
    return {
        ok: status !== 'error',
        status,
        draft_id: '',
        project_id: '',
        episode_id: '',
        promotion_ready: false,
        label: '초안/비승격',
        shots: [],
        beats: [],
        canonical_beat_list_available: false,
        candidates: [],
        machine_qc_contract: '',
        machine_qc_read_only: true,
        machine_qc: [],
        selections: [],
        overall_notes: '',
        saved_at: '',
        exported_at: '',
        blockers: [],
        validation_blockers: [],
        authoring_ready: false,
        export_ready: false,
        executed: false,
    };
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

export function normalizeG3ReviewState(value) {
    const fallback = emptyG3ReviewState('error');
    if (!value || typeof value !== 'object') return fallback;
    return {
        ...fallback,
        ...value,
        shots: array(value.shots),
        beats: array(value.beats),
        candidates: array(value.candidates),
        machine_qc: array(value.machine_qc),
        selections: array(value.selections).map((selection) => ({
            ...selection,
            transition_in: selection?.transition_in || null,
        })),
        blockers: array(value.blockers),
        validation_blockers: array(value.validation_blockers),
        promotion_ready: false,
        executed: false,
    };
}

export function updateG3Selection(state, shotId, field, value) {
    const selections = state.selections.map((selection) => (
        selection.shot_id === shotId ? { ...selection, [field]: value } : selection
    ));
    return { ...state, selections };
}

export function g3DraftPayload(state) {
    return {
        draft_id: state.draft_id,
        selections: state.selections.map((selection) => ({
            shot_id: selection.shot_id,
            candidate_token: selection.candidate_token || '',
            chosen_provider: selection.chosen_provider || '',
            dialogue_source: selection.dialogue_source || '',
            beat_id: selection.beat_id || '',
            take_id: selection.take_id || '',
            source_in_sec: Number.isFinite(selection.source_in_sec) ? selection.source_in_sec : 0,
            source_out_sec: Number.isFinite(selection.source_out_sec) ? selection.source_out_sec : null,
            transition_in: selection.transition_in || null,
            selection_reason: selection.selection_reason || '',
            notes: selection.notes || '',
        })),
        overall_notes: state.overall_notes || '',
    };
}
