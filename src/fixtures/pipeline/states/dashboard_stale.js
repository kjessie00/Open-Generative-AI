import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import { completePlanningBase } from './_helpers.js';

export function dashboardStaleState() {
    const state = completePlanningBase();
    state.fixture_state = 'dashboard_stale';
    state.imageDashboard.updated_at = '2026-07-05T10:00:00.000Z';
    state.imageDashboard.assets[0].review_updated_at = '2026-07-05T10:05:00.000Z';
    state.assets[0].review_updated_at = '2026-07-05T10:05:00.000Z';
    state.blockers = [BLOCKERS.IMAGE_DASHBOARD_STALE];
    return state;
}

export default dashboardStaleState;
