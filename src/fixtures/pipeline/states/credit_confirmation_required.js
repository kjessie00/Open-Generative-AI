import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import { completePlanningBase, setCreditConfirmation } from './_helpers.js';

export function creditConfirmationRequiredState() {
    const state = completePlanningBase();
    state.fixture_state = 'credit_confirmation_required';
    setCreditConfirmation(state, false);
    state.blockers = [BLOCKERS.CREDIT_CONFIRMATION_REQUIRED];
    return state;
}

export default creditConfirmationRequiredState;
