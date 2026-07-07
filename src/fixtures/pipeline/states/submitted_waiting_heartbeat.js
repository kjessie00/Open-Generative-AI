import { queuedState } from './_helpers.js';

export function submittedWaitingHeartbeatState() {
    const state = queuedState({
        checkedAt: '2026-07-05T11:55:00.000Z',
        nextHeartbeatAt: '2026-07-05T12:10:00.000Z',
    });
    state.fixture_state = 'submitted_waiting_heartbeat';
    return state;
}

export default submittedWaitingHeartbeatState;
