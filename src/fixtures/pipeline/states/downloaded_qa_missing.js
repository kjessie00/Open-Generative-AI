import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import { addAcceptedSeconds, downloadedState } from './_helpers.js';

export function downloadedQaMissingState() {
    const state = downloadedState();
    state.fixture_state = 'downloaded_qa_missing';
    state.qaRecords = [];
    addAcceptedSeconds(state);
    state.blockers = [BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN];
    return state;
}

export default downloadedQaMissingState;
