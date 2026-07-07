import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import {
    addFinalEvidence,
    addPassingQa,
    downloadedState,
} from './_helpers.js';

export function acceptedSecondsMissingState() {
    const state = downloadedState();
    state.fixture_state = 'accepted_seconds_missing';
    addPassingQa(state);
    addFinalEvidence(state);
    state.acceptedSeconds = [];
    state.finalReport.blockers = [BLOCKERS.MISSING_ACCEPTED_SECONDS];
    state.blockers = [BLOCKERS.MISSING_ACCEPTED_SECONDS];
    return state;
}

export default acceptedSecondsMissingState;
