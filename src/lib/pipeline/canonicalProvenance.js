export const SELECTED_TAKES_GRAPH_PROVENANCE = 'selected_takes.commit_graph';
export const SELECTED_TAKES_LEGACY_PROVENANCE = 'selected_takes.json';

export function isCanonicalSelectedTakesProvenance(value) {
    return value === SELECTED_TAKES_GRAPH_PROVENANCE || value === SELECTED_TAKES_LEGACY_PROVENANCE;
}
