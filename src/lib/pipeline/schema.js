export const ROUTES = Object.freeze(['seedance', 'flow_omni', 'both']);
export const REVIEW_VERDICTS = Object.freeze([
    'PASS',
    'FAIL',
    'BLOCK',
    'RETRY',
    'UNREVIEWED',
    'EXCEPTION',
]);
export const REVIEW_GATE_TYPES = Object.freeze([
    'image_prompt',
    'image_qa',
    'dashboard',
    'prompt_media',
    'preflight',
    'submit_confirmation',
    'frame_qa',
    'accepted_seconds',
]);
export const REVIEW_GATE_STATUSES = Object.freeze([
    'PASS',
    'FAIL',
    'BLOCK',
    'UNREVIEWED',
    'EXCEPTION',
]);

/**
 * @typedef {Object} ProductionProject
 * @property {string} production_id
 * @property {string} title
 * @property {string} root_path
 * @property {'seedance'|'flow_omni'|'both'} route
 * @property {string} target_platform
 * @property {string} aspect_ratio
 * @property {string} status
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} ProductionBrief
 * @property {string} concept
 * @property {string} logline
 * @property {string} script_path
 * @property {boolean} dialogue_required
 * @property {boolean} subtitles_required
 * @property {boolean} music_required
 * @property {boolean} natural_sfx_required
 * @property {string} stop_loss_rule
 */

/**
 * @typedef {Object} StoryboardClip
 * @property {string} scene_id
 * @property {string} clip_id
 * @property {number} duration
 * @property {string} dramatic_beat
 * @property {string[]} characters
 * @property {string} location
 * @property {string} first_frame
 * @property {string} action
 * @property {string} camera
 * @property {string} lighting
 * @property {string} audio_sfx_dialogue
 * @property {string[]} reference_dependencies
 * @property {string} risk
 * @property {string} dominant_action
 * @property {string} dominant_camera_strategy
 */

/**
 * @typedef {Object} MotionBoardShot
 * @property {string} clip_id
 * @property {string} shot_size
 * @property {string} camera_movement
 * @property {string} movement_risk
 * @property {string} identity_risk
 * @property {string} continuity_notes
 * @property {boolean} duration_lock
 */

/**
 * @typedef {Object} AssetRecord
 * @property {string} asset_id
 * @property {string} path
 * @property {string} type
 * @property {string} target_clip_id
 * @property {string} prompt_path
 * @property {string} review_path
 * @property {'PASS'|'FAIL'|'BLOCK'|'RETRY'|'UNREVIEWED'|'EXCEPTION'} review_verdict
 * @property {string} video_use_status
 * @property {string} continuity_notes
 * @property {string} retry_notes
 */

/**
 * @typedef {Object} PromptPackRecord
 * @property {string} clip_id
 * @property {string} generator
 * @property {string} prompt_path
 * @property {string} model
 * @property {string} aspect_ratio
 * @property {number} duration
 * @property {boolean} no_bgm_required
 * @property {string[]} negative_constraints
 * @property {string[]} attached_assets
 * @property {string} review_status
 */

/**
 * @typedef {Object} ReviewGate
 * @property {string} gate_id
 * @property {string} clip_id
 * @property {'image_prompt'|'image_qa'|'dashboard'|'prompt_media'|'preflight'|'submit_confirmation'|'frame_qa'|'accepted_seconds'} type
 * @property {'PASS'|'FAIL'|'BLOCK'|'UNREVIEWED'|'EXCEPTION'} status
 * @property {string} evidence_path
 * @property {string} blocker
 * @property {string} notes
 */

/**
 * @typedef {Object} SubmitRecord
 * @property {string} clip_id
 * @property {string} subcommand
 * @property {string} requested_model
 * @property {string} submitted_cli_model
 * @property {string} submit_id
 * @property {string} logid
 * @property {number} credit_count
 * @property {string} status
 * @property {string} next_heartbeat_at
 * @property {string} download_dir
 * @property {string} command_log_path
 */

/**
 * @typedef {Object} HeartbeatRecord
 * @property {string} checked_at
 * @property {string} submit_id
 * @property {string} clip_id
 * @property {string} queue_status
 * @property {string} gen_status
 * @property {string} backend_benefit_type
 * @property {string} backend_queue_debug
 * @property {string[]} downloaded_files
 * @property {string} next_heartbeat_at
 * @property {string} blocker
 */

/**
 * @typedef {Object} QARecord
 * @property {string} clip_id
 * @property {string} file_path
 * @property {boolean} valid_video
 * @property {boolean} duration_ok
 * @property {boolean} aspect_ratio_ok
 * @property {boolean} identity_ok
 * @property {boolean} first_frame_respected
 * @property {boolean} camera_ok
 * @property {boolean} no_subtitles_or_watermarks
 * @property {boolean} no_background_music
 * @property {boolean} dialogue_ok
 * @property {boolean} continuity_ok
 * @property {string} verdict
 */

/**
 * @typedef {Object} AcceptedSeconds
 * @property {string} clip_id
 * @property {string} source_file
 * @property {number} in_time
 * @property {number} out_time
 * @property {string} reason
 * @property {string} reviewer_confidence
 */

/**
 * @typedef {Object} FinalReport
 * @property {string} final_video_path
 * @property {string} production_folder
 * @property {string} generator_route
 * @property {Object[]} clip_table
 * @property {number} known_credits
 * @property {HeartbeatRecord[]} heartbeat_history
 * @property {QARecord[]} qa_result
 * @property {string[]} residual_risks
 * @property {string[]} blockers
 */

/**
 * @typedef {Object} ImageDashboard
 * @property {string} path
 * @property {string} updated_at
 * @property {boolean} stale
 * @property {AssetRecord[]} assets
 */

/**
 * @typedef {Object} PipelineProjectState
 * @property {ProductionProject} project
 * @property {ProductionBrief} brief
 * @property {StoryboardClip[]} storyboard
 * @property {MotionBoardShot[]} motionBoard
 * @property {ImageDashboard} imageDashboard
 * @property {AssetRecord[]} assets
 * @property {PromptPackRecord[]} promptPacks
 * @property {ReviewGate[]} reviewGates
 * @property {SubmitRecord[]} submitRecords
 * @property {HeartbeatRecord[]} heartbeatRecords
 * @property {QARecord[]} qaRecords
 * @property {AcceptedSeconds[]} acceptedSeconds
 * @property {FinalReport} finalReport
 * @property {Object<string, boolean>} fileEvidence
 */

export const PRODUCTION_PROJECT_SCHEMA = Object.freeze({
    production_id: '',
    title: '',
    root_path: '',
    route: 'seedance',
    target_platform: '',
    aspect_ratio: '',
    status: '',
    created_at: '',
    updated_at: '',
});

export const PRODUCTION_BRIEF_SCHEMA = Object.freeze({
    concept: '',
    logline: '',
    script_path: '',
    dialogue_required: false,
    subtitles_required: false,
    music_required: false,
    natural_sfx_required: false,
    stop_loss_rule: '',
});

export const STORYBOARD_CLIP_SCHEMA = Object.freeze({
    scene_id: '',
    clip_id: '',
    duration: 0,
    dramatic_beat: '',
    characters: [],
    location: '',
    first_frame: '',
    action: '',
    camera: '',
    lighting: '',
    audio_sfx_dialogue: '',
    reference_dependencies: [],
    risk: '',
    dominant_action: '',
    dominant_camera_strategy: '',
});

export const MOTION_BOARD_SHOT_SCHEMA = Object.freeze({
    clip_id: '',
    shot_size: '',
    camera_movement: '',
    movement_risk: '',
    identity_risk: '',
    continuity_notes: '',
    duration_lock: false,
});

export const ASSET_RECORD_SCHEMA = Object.freeze({
    asset_id: '',
    path: '',
    type: '',
    target_clip_id: '',
    prompt_path: '',
    review_path: '',
    review_verdict: 'UNREVIEWED',
    video_use_status: '',
    continuity_notes: '',
    retry_notes: '',
});

export const PROMPT_PACK_RECORD_SCHEMA = Object.freeze({
    clip_id: '',
    generator: '',
    prompt_path: '',
    model: '',
    aspect_ratio: '',
    duration: 0,
    no_bgm_required: true,
    negative_constraints: [],
    attached_assets: [],
    review_status: 'UNREVIEWED',
});

export const REVIEW_GATE_SCHEMA = Object.freeze({
    gate_id: '',
    clip_id: '',
    type: 'preflight',
    status: 'UNREVIEWED',
    evidence_path: '',
    blocker: '',
    notes: '',
});

export const SUBMIT_RECORD_SCHEMA = Object.freeze({
    clip_id: '',
    subcommand: '',
    requested_model: '',
    submitted_cli_model: '',
    submit_id: '',
    logid: '',
    credit_count: 0,
    status: '',
    next_heartbeat_at: '',
    download_dir: '',
    command_log_path: '',
});

export const HEARTBEAT_RECORD_SCHEMA = Object.freeze({
    checked_at: '',
    submit_id: '',
    clip_id: '',
    queue_status: '',
    gen_status: '',
    backend_benefit_type: '',
    backend_queue_debug: '',
    downloaded_files: [],
    next_heartbeat_at: '',
    blocker: '',
});

export const QA_RECORD_SCHEMA = Object.freeze({
    clip_id: '',
    file_path: '',
    valid_video: false,
    duration_ok: false,
    aspect_ratio_ok: false,
    identity_ok: false,
    first_frame_respected: false,
    camera_ok: false,
    no_subtitles_or_watermarks: false,
    no_background_music: false,
    dialogue_ok: false,
    continuity_ok: false,
    verdict: 'UNREVIEWED',
});

export const ACCEPTED_SECONDS_SCHEMA = Object.freeze({
    clip_id: '',
    source_file: '',
    in_time: 0,
    out_time: 0,
    reason: '',
    reviewer_confidence: '',
});

export const FINAL_REPORT_SCHEMA = Object.freeze({
    final_video_path: '',
    production_folder: '',
    generator_route: '',
    clip_table: [],
    known_credits: 0,
    heartbeat_history: [],
    qa_result: [],
    residual_risks: [],
    blockers: [],
});

export const pipelineSchemas = Object.freeze({
    productionProject: PRODUCTION_PROJECT_SCHEMA,
    productionBrief: PRODUCTION_BRIEF_SCHEMA,
    storyboardClip: STORYBOARD_CLIP_SCHEMA,
    motionBoardShot: MOTION_BOARD_SHOT_SCHEMA,
    assetRecord: ASSET_RECORD_SCHEMA,
    promptPackRecord: PROMPT_PACK_RECORD_SCHEMA,
    reviewGate: REVIEW_GATE_SCHEMA,
    submitRecord: SUBMIT_RECORD_SCHEMA,
    heartbeatRecord: HEARTBEAT_RECORD_SCHEMA,
    qaRecord: QA_RECORD_SCHEMA,
    acceptedSeconds: ACCEPTED_SECONDS_SCHEMA,
    finalReport: FINAL_REPORT_SCHEMA,
});
