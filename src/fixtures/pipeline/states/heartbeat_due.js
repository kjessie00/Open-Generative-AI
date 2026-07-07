import { queuedState } from './_helpers.js';

export function heartbeatDueState() {
    const state = queuedState({
        checkedAt: '2026-07-05T11:30:00.000Z',
        nextHeartbeatAt: '2026-07-05T11:50:00.000Z',
    });
    state.fixture_state = 'heartbeat_due';
    return state;
}

export default heartbeatDueState;
