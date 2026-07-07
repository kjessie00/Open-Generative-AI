import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import { completePlanningBase } from './_helpers.js';

export function missingStoryboardState() {
    const state = completePlanningBase();
    state.fixture_state = 'missing_storyboard';
    state.storyboard = [];
    state.blockers = [BLOCKERS.MISSING_STORYBOARD_CONTINUITY_PACKET];
    return state;
}

export default missingStoryboardState;
