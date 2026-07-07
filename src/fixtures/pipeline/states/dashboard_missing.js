import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import { completePlanningBase } from './_helpers.js';

export function dashboardMissingState() {
    const state = completePlanningBase();
    state.fixture_state = 'dashboard_missing';
    state.imageDashboard = null;
    state.blockers = [BLOCKERS.MISSING_IMAGE_DASHBOARD];
    return state;
}

export default dashboardMissingState;
