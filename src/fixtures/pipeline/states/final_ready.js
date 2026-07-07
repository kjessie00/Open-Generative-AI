import {
    addAcceptedSeconds,
    addFinalEvidence,
    addPassingQa,
    downloadedState,
} from './_helpers.js';

export function finalReadyState() {
    const state = downloadedState();
    state.fixture_state = 'final_ready';
    addPassingQa(state);
    addAcceptedSeconds(state);
    addFinalEvidence(state);
    return state;
}

export default finalReadyState;
