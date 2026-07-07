import samplePipelineState from '../../../lib/pipeline/mockData.js';
import { BLOCKERS } from '../../../lib/pipeline/blockers.js';

export const FIXTURE_NOW = '2026-07-05T12:00:00.000Z';
export const GENERATED_CLIP_PATH = 'production/dryrun_gangnam_001/dreamina_outputs/clip_001/final.mp4';
export const FINAL_VIDEO_PATH = 'production/dryrun_gangnam_001/final/final.mp4';
export const CONCAT_LIST_PATH = 'production/dryrun_gangnam_001/final/concat_list.txt';
export const FINAL_REPORT_PATH = 'production/dryrun_gangnam_001/final/report.md';
export const FFPROBE_EVIDENCE_PATH = 'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json';

export function cloneState(value = samplePipelineState) {
    return JSON.parse(JSON.stringify(value));
}

export function seedancePromptPack(state) {
    return state.promptPacks.find((pack) => String(pack.generator).includes('seedance')) || state.promptPacks[0];
}

export function markGate(state, type, status, blocker = '', notes = '') {
    state.reviewGates = state.reviewGates.map((gate) => (
        gate.type === type
            ? {
                ...gate,
                status,
                blocker,
                notes: notes || gate.notes,
            }
            : gate
    ));
    return state;
}

export function setCreditConfirmation(state, confirmed) {
    state.creditConfirmation = {
        confirmed,
        confirmed_at: confirmed ? '2026-07-05T11:45:00.000Z' : '',
        confirmation_token: confirmed ? 'FIXTURE_DRY_RUN_CREDIT_GATE' : '',
        mode: 'fixture_only_no_live_submit',
    };
    state.credit_confirmed = confirmed;
    markGate(
        state,
        'preflight',
        confirmed ? 'PASS' : 'BLOCK',
        confirmed ? '' : BLOCKERS.CREDIT_CONFIRMATION_REQUIRED,
        confirmed ? 'Fixture preflight gate is confirmed; command execution remains dry-run only.' : 'Credit confirmation is absent.',
    );
    markGate(
        state,
        'submit_confirmation',
        confirmed ? 'PASS' : 'BLOCK',
        confirmed ? '' : BLOCKERS.CREDIT_CONFIRMATION_REQUIRED,
        confirmed ? 'Fixture submit gate is confirmed for validation only; no live submit is wired.' : 'Live submit remains blocked until explicit confirmation.',
    );
    return state;
}

export function completePlanningBase() {
    const state = cloneState();
    state.fixture_state = 'complete_planning_no_generation';
    setCreditConfirmation(state, true);
    state.submitRecords = [{
        clip_id: 'clip_001',
        subcommand: 'preview-submit',
        requested_model: 'seedance_2_i2v',
        submitted_cli_model: '',
        submit_id: '',
        logid: '',
        credit_count: 0,
        status: 'preview_only',
        next_heartbeat_at: '',
        download_dir: 'production/dryrun_gangnam_001/dreamina_outputs/clip_001',
        command_log_path: 'production/dryrun_gangnam_001/logs/clip_001_submit_preview.log',
    }];
    state.heartbeatRecords = [{
        checked_at: '',
        submit_id: '',
        clip_id: 'clip_001',
        queue_status: 'not_submitted',
        gen_status: 'not_submitted',
        backend_benefit_type: '',
        backend_queue_debug: 'Fixture has complete planning evidence and no live generation attempt.',
        downloaded_files: [],
        next_heartbeat_at: '',
        blocker: '',
    }];
    state.qaRecords = [];
    state.acceptedSeconds = [];
    state.finalReport = {
        ...state.finalReport,
        known_credits: 0,
        heartbeat_history: [...state.heartbeatRecords],
        qa_result: [],
        residual_risks: ['No generated clip exists in this fixture.'],
        blockers: [
            BLOCKERS.MISSING_ACCEPTED_SECONDS,
            BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN,
        ],
    };
    state.fileEvidence = {
        ...state.fileEvidence,
        [FINAL_VIDEO_PATH]: false,
        [CONCAT_LIST_PATH]: false,
        [FINAL_REPORT_PATH]: true,
        [FFPROBE_EVIDENCE_PATH]: false,
    };
    return state;
}

export function queuedState({ checkedAt, nextHeartbeatAt }) {
    const state = completePlanningBase();
    state.fixture_state = nextHeartbeatAt > FIXTURE_NOW ? 'submitted_waiting_heartbeat' : 'heartbeat_due';
    state.submitRecords = [{
        clip_id: 'clip_001',
        subcommand: 'submit',
        requested_model: 'seedance_2_i2v',
        submitted_cli_model: 'seedance_2_i2v',
        submit_id: 'task_clip_001',
        logid: 'log_clip_001',
        credit_count: 4,
        status: 'queued',
        next_heartbeat_at: nextHeartbeatAt,
        download_dir: 'production/dryrun_gangnam_001/dreamina_outputs/clip_001',
        command_log_path: 'production/dryrun_gangnam_001/logs/clip_001_submit.log',
    }];
    state.heartbeatRecords = [{
        checked_at: checkedAt,
        submit_id: 'task_clip_001',
        clip_id: 'clip_001',
        queue_status: 'queued',
        gen_status: 'queued',
        backend_benefit_type: '',
        backend_queue_debug: 'Fixture queue evidence from non-consuming status preview.',
        downloaded_files: [],
        next_heartbeat_at: nextHeartbeatAt,
        blocker: '',
    }];
    state.finalReport = {
        ...state.finalReport,
        known_credits: 4,
        heartbeat_history: [...state.heartbeatRecords],
    };
    return state;
}

export function downloadedState() {
    const state = queuedState({
        checkedAt: '2026-07-05T12:20:00.000Z',
        nextHeartbeatAt: '2026-07-05T12:40:00.000Z',
    });
    state.fixture_state = 'downloaded';
    state.submitRecords[0] = {
        ...state.submitRecords[0],
        status: 'downloaded',
        downloaded: true,
        source_file: GENERATED_CLIP_PATH,
    };
    state.heartbeatRecords[0] = {
        ...state.heartbeatRecords[0],
        queue_status: 'done',
        gen_status: 'downloaded',
        downloaded_files: [GENERATED_CLIP_PATH],
    };
    state.finalReport = {
        ...state.finalReport,
        heartbeat_history: [...state.heartbeatRecords],
    };
    return state;
}

export function addPassingQa(state) {
    state.qaRecords = [{
        clip_id: 'clip_001',
        file_path: GENERATED_CLIP_PATH,
        contact_sheet_path: 'production/dryrun_gangnam_001/qa/contact_sheets/clip_001_contact_sheet.jpg',
        frame_sample_paths: [
            'production/dryrun_gangnam_001/qa/frames/clip_001/frame_0001.jpg',
            'production/dryrun_gangnam_001/qa/frames/clip_001/frame_0048.jpg',
        ],
        gemini_frame_review_path: 'production/dryrun_gangnam_001/reviews/video/clip_001_frame_qa.md',
        video_review_path: 'production/dryrun_gangnam_001/reviews/video/clip_001_video_qa.md',
        valid_video: true,
        duration_ok: true,
        aspect_ratio_ok: true,
        identity_ok: true,
        first_frame_respected: true,
        camera_ok: true,
        no_subtitles_or_watermarks: true,
        no_background_music: true,
        dialogue_ok: true,
        continuity_ok: true,
        verdict: 'PASS',
    }];
    state.finalReport = {
        ...state.finalReport,
        qa_result: [...state.qaRecords],
    };
    return state;
}

export function addAcceptedSeconds(state) {
    state.acceptedSeconds = [{
        clip_id: 'clip_001',
        source_file: GENERATED_CLIP_PATH,
        in_time: 0,
        out_time: 4.8,
        reason: 'Fixture range selected after QA pass.',
        reviewer_confidence: 'high',
    }];
    return state;
}

export function addFinalEvidence(state) {
    state.finalReport = {
        ...state.finalReport,
        final_video_path: FINAL_VIDEO_PATH,
        concat_list_path: CONCAT_LIST_PATH,
        report_path: FINAL_REPORT_PATH,
        ffprobe_path: FFPROBE_EVIDENCE_PATH,
        ffprobe_verified: true,
        known_credits: 4,
        completed_at: '2026-07-05T12:24:00.000Z',
        residual_risks: [],
        blockers: [],
        clip_table: [{
            clip_id: 'clip_001',
            status: 'accepted',
            accepted_seconds: 4.8,
        }],
    };
    state.fileEvidence = {
        ...state.fileEvidence,
        [FINAL_VIDEO_PATH]: true,
        [CONCAT_LIST_PATH]: true,
        [FINAL_REPORT_PATH]: true,
        [FFPROBE_EVIDENCE_PATH]: true,
    };
    return state;
}
