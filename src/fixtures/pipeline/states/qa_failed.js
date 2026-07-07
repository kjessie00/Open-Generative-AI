import { BLOCKERS } from '../../../lib/pipeline/blockers.js';
import { addAcceptedSeconds, downloadedState, GENERATED_CLIP_PATH } from './_helpers.js';

export function qaFailedState() {
    const state = downloadedState();
    state.fixture_state = 'qa_failed';
    state.qaRecords = [{
        clip_id: 'clip_001',
        file_path: GENERATED_CLIP_PATH,
        valid_video: true,
        duration_ok: true,
        aspect_ratio_ok: true,
        identity_ok: false,
        first_frame_respected: false,
        camera_ok: true,
        no_subtitles_or_watermarks: true,
        no_background_music: true,
        dialogue_ok: true,
        continuity_ok: false,
        verdict: 'FAIL',
    }];
    state.finalReport = {
        ...state.finalReport,
        qa_result: [...state.qaRecords],
    };
    addAcceptedSeconds(state);
    state.blockers = [BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN];
    return state;
}

export default qaFailedState;
