import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import { completePlanningBase, markGate } from './_helpers.js';

export function imageUnreviewedState() {
    const state = completePlanningBase();
    state.fixture_state = 'image_unreviewed';
    state.assets[0].review_verdict = 'UNREVIEWED';
    state.imageDashboard.assets[0].review_verdict = 'UNREVIEWED';
    markGate(
        state,
        'image_qa',
        'UNREVIEWED',
        BLOCKERS.IMAGE_GEMINI_REVIEW_REQUIRED,
        'Attached first-frame image has not passed review.',
    );
    state.blockers = [BLOCKERS.IMAGE_GEMINI_REVIEW_REQUIRED];
    return state;
}

export default imageUnreviewedState;
