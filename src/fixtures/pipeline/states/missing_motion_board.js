import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import { completePlanningBase } from './_helpers.js';

export function missingMotionBoardState() {
    const state = completePlanningBase();
    state.fixture_state = 'missing_motion_board';
    state.motionBoard = [];
    state.blockers = [BLOCKERS.MISSING_MOTION_BOARD];
    return state;
}

export default missingMotionBoardState;
