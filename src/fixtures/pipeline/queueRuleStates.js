import samplePipelineState from '../../lib/pipeline/mockData.js';
import { BLOCKERS } from '../../lib/pipeline/blockers.js';

export const QUEUE_RULE_NOW = '2026-07-05T12:00:00.000Z';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function readyBase() {
    const state = clone(samplePipelineState);
    state.submitRecords = [{
        clip_id: 'clip_001',
        subcommand: 'submit',
        requested_model: 'seedance_2_i2v',
        submitted_cli_model: 'seedance_2_i2v',
        submit_id: 'task_clip_001',
        logid: 'log_clip_001',
        credit_count: 4,
        status: 'queued',
        next_heartbeat_at: '2026-07-05T11:40:00.000Z',
        download_dir: 'production/dryrun_gangnam_001/dreamina_outputs/clip_001',
        command_log_path: 'production/dryrun_gangnam_001/logs/clip_001_submit.log',
    }];
    state.heartbeatRecords = [{
        checked_at: '2026-07-05T11:30:00.000Z',
        submit_id: 'task_clip_001',
        clip_id: 'clip_001',
        queue_status: 'queued',
        gen_status: 'queued',
        backend_benefit_type: '',
        backend_queue_debug: 'list_task returned queued',
        downloaded_files: [],
        next_heartbeat_at: '2026-07-05T11:50:00.000Z',
        blocker: '',
    }];
    state.finalReport = {
        ...state.finalReport,
        blockers: [],
        residual_risks: [],
        final_video_path: 'production/dryrun_gangnam_001/final/final.mp4',
    };
    return state;
}

export function noSubmitIdState() {
    const state = clone(samplePipelineState);
    state.submitRecords = [{
        ...state.submitRecords[0],
        status: 'failed',
        submit_id: '',
        logid: '',
        credit_count: 0,
        submitted_cli_model: '',
    }];
    state.heartbeatRecords = [{
        ...state.heartbeatRecords[0],
        checked_at: '',
        queue_status: 'not_submitted',
        gen_status: 'not_submitted',
        backend_queue_debug: 'No backend call made in dry-run mode.',
    }];
    return state;
}

export function queuedHeartbeatNotDueState() {
    const state = readyBase();
    state.submitRecords[0].next_heartbeat_at = '2026-07-05T12:10:00.000Z';
    state.heartbeatRecords[0].checked_at = '2026-07-05T11:55:00.000Z';
    state.heartbeatRecords[0].next_heartbeat_at = '2026-07-05T12:10:00.000Z';
    return state;
}

export function queuedHeartbeatDueState() {
    return readyBase();
}

export function downloadedQaMissingState() {
    const state = readyBase();
    state.submitRecords[0].status = 'downloaded';
    state.submitRecords[0].downloaded = true;
    state.heartbeatRecords[0].queue_status = 'done';
    state.heartbeatRecords[0].gen_status = 'downloaded';
    state.heartbeatRecords[0].downloaded_files = ['production/dryrun_gangnam_001/dreamina_outputs/clip_001/final.mp4'];
    state.qaRecords = [];
    state.acceptedSeconds = [{
        clip_id: 'clip_001',
        source_file: 'production/dryrun_gangnam_001/dreamina_outputs/clip_001/final.mp4',
        in_time: 0,
        out_time: 4.8,
        reason: 'fixture accepted seconds',
        reviewer_confidence: 'fixture',
    }];
    state.fileEvidence = {
        ...state.fileEvidence,
        'production/dryrun_gangnam_001/final/final.mp4': true,
    };
    return state;
}

export function failedAfterRealQueueState() {
    const state = readyBase();
    state.submitRecords[0].status = 'failed';
    state.heartbeatRecords[0].queue_status = 'done';
    state.heartbeatRecords[0].gen_status = 'failed';
    state.finalReport.blockers = [BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN];
    return state;
}

export function finalMissingMp4State() {
    const state = readyBase();
    state.submitRecords[0].status = 'downloaded';
    state.submitRecords[0].downloaded = true;
    state.heartbeatRecords[0].queue_status = 'done';
    state.heartbeatRecords[0].gen_status = 'downloaded';
    state.heartbeatRecords[0].downloaded_files = ['production/dryrun_gangnam_001/dreamina_outputs/clip_001/final.mp4'];
    state.qaRecords = [{
        clip_id: 'clip_001',
        file_path: 'production/dryrun_gangnam_001/dreamina_outputs/clip_001/final.mp4',
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
    state.acceptedSeconds = [{
        clip_id: 'clip_001',
        source_file: 'production/dryrun_gangnam_001/dreamina_outputs/clip_001/final.mp4',
        in_time: 0,
        out_time: 4.8,
        reason: 'fixture accepted seconds',
        reviewer_confidence: 'high',
    }];
    state.fileEvidence = {
        ...state.fileEvidence,
        'production/dryrun_gangnam_001/final/final.mp4': false,
    };
    state.finalReport.blockers = [];
    return state;
}

export function finalReadyState() {
    const state = finalMissingMp4State();
    const sourceFile = 'production/dryrun_gangnam_001/dreamina_outputs/clip_001/final.mp4';
    state.submitRecords[0].status = 'downloaded';
    state.submitRecords[0].downloaded = true;
    state.submitRecords[0].source_file = sourceFile;
    state.heartbeatRecords[0].checked_at = '2026-07-05T12:20:00.000Z';
    state.heartbeatRecords[0].downloaded_files = [sourceFile];
    state.heartbeatRecords[0].queue_status = 'done';
    state.heartbeatRecords[0].gen_status = 'downloaded';
    state.qaRecords[0].file_path = sourceFile;
    state.qaRecords[0].verdict = 'PASS';
    state.acceptedSeconds[0].source_file = sourceFile;
    state.finalReport.final_video_path = 'production/dryrun_gangnam_001/final/final.mp4';
    state.finalReport.concat_list_path = 'production/dryrun_gangnam_001/final/concat_list.txt';
    state.finalReport.report_path = 'production/dryrun_gangnam_001/final/report.md';
    state.finalReport.ffprobe_path = 'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json';
    state.finalReport.ffprobe_verified = true;
    state.finalReport.known_credits = 4;
    state.finalReport.completed_at = '2026-07-05T12:24:00.000Z';
    state.finalReport.residual_risks = [];
    state.finalReport.blockers = [];
    state.finalReport.clip_table = [{
        clip_id: 'clip_001',
        status: 'accepted',
        accepted_seconds: 4.8,
    }];
    state.fileEvidence = {
        ...state.fileEvidence,
        'production/dryrun_gangnam_001/final/final.mp4': true,
        'production/dryrun_gangnam_001/final/concat_list.txt': true,
        'production/dryrun_gangnam_001/final/report.md': true,
        'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json': true,
    };
    return state;
}

export function finalNotReadyStitchState() {
    const state = finalReadyState();
    state.finalReport.completed_at = '';
    state.finalReport.ffprobe_verified = false;
    state.finalReport.blockers = [BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN];
    state.finalReport.residual_risks = ['Final stitch artifact is not recorded.'];
    state.fileEvidence = {
        ...state.fileEvidence,
        'production/dryrun_gangnam_001/final/final.mp4': false,
        'production/dryrun_gangnam_001/final/final.mp4.ffprobe.json': false,
    };
    return state;
}

export const queueRuleStates = Object.freeze({
    noSubmitId: noSubmitIdState,
    queuedHeartbeatNotDue: queuedHeartbeatNotDueState,
    queuedHeartbeatDue: queuedHeartbeatDueState,
    downloadedQaMissing: downloadedQaMissingState,
    failedAfterRealQueue: failedAfterRealQueueState,
    finalMissingMp4: finalMissingMp4State,
    finalReady: finalReadyState,
    finalNotReadyStitch: finalNotReadyStitchState,
});
