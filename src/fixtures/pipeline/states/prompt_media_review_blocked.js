import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import { completePlanningBase, markGate } from './_helpers.js';

export function promptMediaReviewBlockedState() {
    const state = completePlanningBase();
    state.fixture_state = 'prompt_media_review_blocked';
    state.promptPacks = state.promptPacks.map((pack) => (
        String(pack.generator).includes('seedance')
            ? { ...pack, review_status: 'UNREVIEWED' }
            : pack
    ));
    markGate(
        state,
        'prompt_media',
        'BLOCK',
        BLOCKERS.GEMINI_REVIEW_BLOCKED,
        'Prompt/media review PASS is missing.',
    );
    state.blockers = [BLOCKERS.GEMINI_REVIEW_BLOCKED];
    return state;
}

export default promptMediaReviewBlockedState;
