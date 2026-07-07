import { BLOCKERS } from './blockers.js';

export const sampleProductionProject = Object.freeze({
    production_id: 'dryrun_gangnam_001',
    title: 'Gangnam Sinsa Dry Run Pilot',
    root_path: '/Users/jessiek/StudioProjects/happyVideoFactory/production/dryrun_gangnam_001',
    route: 'both',
    target_platform: 'youtube_shorts',
    aspect_ratio: '9:16',
    status: 'dry_run_ready',
    created_at: '2026-07-05T09:00:00+09:00',
    updated_at: '2026-07-05T09:20:00+09:00',
});

export const sampleProductionBrief = Object.freeze({
    concept: 'A cinematic dry-run workflow for proving local pipeline readiness without spending credits.',
    logline: 'A founder stress-tests a local cinematic pipeline before letting any live generation command run.',
    script_path: 'production/dryrun_gangnam_001/story/script.md',
    dialogue_required: false,
    subtitles_required: false,
    music_required: false,
    natural_sfx_required: true,
    stop_loss_rule: 'Stop after one live submit attempt per clip; all UI work stays in preview until Jessie confirms credits.',
});

export const sampleStoryboard = Object.freeze([
    Object.freeze({
        scene_id: 'scene_01',
        clip_id: 'clip_001',
        duration: 5,
        dramatic_beat: 'The control room opens on dry-run safety status.',
        characters: ['operator'],
        location: 'local pipeline dashboard',
        first_frame: 'operator silhouette facing a dark dashboard with queue panels',
        action: 'operator checks the side-effect gates before approving any action',
        camera: 'slow push-in from over-the-shoulder',
        lighting: 'cool monitor light with warm practical edge',
        audio_sfx_dialogue: 'soft room tone, keyboard tap, no dialogue',
        reference_dependencies: ['asset_clip_001_first_frame'],
        risk: 'dashboard text can become unreadable if generated directly',
        dominant_action: 'safety review',
        dominant_camera_strategy: 'controlled push-in',
    }),
]);

export const sampleMotionBoard = Object.freeze([
    Object.freeze({
        clip_id: 'clip_001',
        shot_size: 'medium over-the-shoulder',
        camera_movement: 'slow push-in',
        movement_risk: 'low',
        identity_risk: 'low',
        continuity_notes: 'Keep the operator silhouette and dashboard angle consistent with the first frame.',
        duration_lock: true,
    }),
]);

export const sampleAssets = Object.freeze([
    Object.freeze({
        asset_id: 'asset_clip_001_first_frame',
        path: 'production/dryrun_gangnam_001/assets/clip_001/first_frame.png',
        type: 'first_frame',
        target_clip_id: 'clip_001',
        prompt_path: 'production/dryrun_gangnam_001/prompts/images/clip_001_first_frame.md',
        review_path: 'production/dryrun_gangnam_001/reviews/images/clip_001_first_frame_gemini.md',
        review_verdict: 'PASS',
        video_use_status: 'approved_for_prompt_pack',
        continuity_notes: 'Operator remains anonymous; dashboard text is treated as abstract UI glow.',
        retry_notes: '',
    }),
]);

export const samplePromptPacks = Object.freeze([
    Object.freeze({
        clip_id: 'clip_001',
        generator: 'seedance_dreamina',
        prompt_path: 'production/dryrun_gangnam_001/prompts/video/clip_001_dreamina.md',
        model: 'seedance_2_i2v',
        aspect_ratio: '9:16',
        duration: 5,
        no_bgm_required: true,
        negative_constraints: [
            'no subtitles',
            'no logo',
            'no watermark',
            'no background music',
            'no extra people',
            'no extra characters',
            'no face morphing',
            'no warped hands',
        ],
        attached_assets: ['asset_clip_001_first_frame'],
        review_status: 'PASS',
    }),
    Object.freeze({
        clip_id: 'clip_001',
        generator: 'flow_omni',
        prompt_path: 'production/dryrun_gangnam_001/prompts/video/clip_001_flow_omni.md',
        model: 'flow_omni_preview',
        aspect_ratio: '9:16',
        duration: 5,
        no_bgm_required: true,
        negative_constraints: [
            'no subtitles',
            'no logo',
            'no watermark',
            'no background music',
            'no extra characters',
            'no face morphing',
            'no warped hands',
        ],
        attached_assets: ['asset_clip_001_first_frame'],
        review_status: 'PASS',
    }),
]);

export const sampleReviewGates = Object.freeze([
    Object.freeze({
        gate_id: 'gate_clip_001_image_prompt',
        clip_id: 'clip_001',
        type: 'image_prompt',
        status: 'PASS',
        evidence_path: 'production/dryrun_gangnam_001/reviews/images/clip_001_prompt_template.md',
        blocker: '',
        notes: 'Image prompt follows local template in dry-run mode.',
    }),
    Object.freeze({
        gate_id: 'gate_clip_001_image_qa',
        clip_id: 'clip_001',
        type: 'image_qa',
        status: 'PASS',
        evidence_path: 'production/dryrun_gangnam_001/reviews/images/clip_001_first_frame_gemini.md',
        blocker: '',
        notes: 'Still asset is approved for prompt-pack attachment.',
    }),
    Object.freeze({
        gate_id: 'gate_clip_001_dashboard',
        clip_id: 'clip_001',
        type: 'dashboard',
        status: 'PASS',
        evidence_path: 'production/dryrun_gangnam_001/dashboard/image_dashboard.md',
        blocker: '',
        notes: 'Dry-run dashboard is current with storyboard and prompt pack timestamps.',
    }),
    Object.freeze({
        gate_id: 'gate_clip_001_prompt_media',
        clip_id: 'clip_001',
        type: 'prompt_media',
        status: 'PASS',
        evidence_path: 'production/dryrun_gangnam_001/reviews/video/clip_001_prompt_media.md',
        blocker: '',
        notes: 'Prompt/media review passes for preview only.',
    }),
    Object.freeze({
        gate_id: 'gate_clip_001_preflight',
        clip_id: 'clip_001',
        type: 'preflight',
        status: 'BLOCK',
        evidence_path: 'production/dryrun_gangnam_001/reviews/preflight/clip_001.md',
        blocker: BLOCKERS.CREDIT_CONFIRMATION_REQUIRED,
        notes: 'Preflight remains blocked for live submit because credit confirmation is absent.',
    }),
    Object.freeze({
        gate_id: 'gate_clip_001_submit_confirmation',
        clip_id: 'clip_001',
        type: 'submit_confirmation',
        status: 'BLOCK',
        evidence_path: '',
        blocker: BLOCKERS.CREDIT_CONFIRMATION_REQUIRED,
        notes: 'Live submit is blocked until Jessie explicitly confirms credit use.',
    }),
    Object.freeze({
        gate_id: 'gate_clip_001_frame_qa',
        clip_id: 'clip_001',
        type: 'frame_qa',
        status: 'UNREVIEWED',
        evidence_path: '',
        blocker: BLOCKERS.FRAME_EXTRACTION_BLOCKED,
        notes: 'No generated clip exists in dry-run mode.',
    }),
    Object.freeze({
        gate_id: 'gate_clip_001_accepted_seconds',
        clip_id: 'clip_001',
        type: 'accepted_seconds',
        status: 'BLOCK',
        evidence_path: '',
        blocker: BLOCKERS.MISSING_ACCEPTED_SECONDS,
        notes: 'Accepted seconds require generated video and human/QA review.',
    }),
]);

export const sampleSubmitRecords = Object.freeze([
    Object.freeze({
        clip_id: 'clip_001',
        subcommand: 'preview-submit',
        requested_model: 'seedance_2_i2v',
        submitted_cli_model: '',
        submit_id: '',
        logid: '',
        credit_count: 0,
        status: 'preview_only',
        next_heartbeat_at: '',
        download_dir: 'production/dryrun_gangnam_001/downloads/clip_001',
        command_log_path: 'production/dryrun_gangnam_001/logs/clip_001_submit_preview.log',
    }),
]);

export const sampleHeartbeatRecords = Object.freeze([
    Object.freeze({
        checked_at: '2026-07-05T09:10:00+09:00',
        submit_id: '',
        clip_id: 'clip_001',
        queue_status: 'preview_only',
        gen_status: 'not_submitted',
        backend_benefit_type: '',
        backend_queue_debug: 'No backend call made in dry-run mode.',
        downloaded_files: [],
        next_heartbeat_at: '',
        blocker: BLOCKERS.CREDIT_CONFIRMATION_REQUIRED,
    }),
]);

export const sampleQaRecords = Object.freeze([
    Object.freeze({
        clip_id: 'clip_001',
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
    }),
]);

export const sampleAcceptedSeconds = Object.freeze([
    Object.freeze({
        clip_id: 'clip_001',
        source_file: '',
        in_time: 0,
        out_time: 0,
        reason: 'No generated video in dry-run mode.',
        reviewer_confidence: 'blocked_until_generation_exists',
    }),
]);

export const sampleFinalReport = Object.freeze({
    final_video_path: 'production/dryrun_gangnam_001/final/final.mp4',
    production_folder: 'production/dryrun_gangnam_001',
    generator_route: 'seedance',
    concat_list_path: 'production/dryrun_gangnam_001/final/concat_list.txt',
    ffprobe_verified: false,
    report_path: 'production/dryrun_gangnam_001/final/report.md',
    clip_table: [
        {
            clip_id: 'clip_001',
            status: 'preview_only',
            accepted_seconds: 0,
        },
    ],
    known_credits: 0,
    heartbeat_history: [...sampleHeartbeatRecords],
    qa_result: [...sampleQaRecords],
    residual_risks: ['No live generation or downloaded clip exists in dry-run mode.'],
    blockers: [
        BLOCKERS.CREDIT_CONFIRMATION_REQUIRED,
        BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN,
    ],
});

export const samplePipelineState = Object.freeze({
    project: sampleProductionProject,
    brief: sampleProductionBrief,
    storyboard: [...sampleStoryboard],
    motionBoard: [...sampleMotionBoard],
    imageDashboard: Object.freeze({
        path: 'production/dryrun_gangnam_001/dashboard/image_dashboard.md',
        updated_at: '2026-07-05T09:20:00+09:00',
        stale: false,
        assets: [...sampleAssets],
    }),
    assets: [...sampleAssets],
    promptPacks: [...samplePromptPacks],
    reviewGates: [...sampleReviewGates],
    submitRecords: [...sampleSubmitRecords],
    heartbeatRecords: [...sampleHeartbeatRecords],
    qaRecords: [...sampleQaRecords],
    acceptedSeconds: [...sampleAcceptedSeconds],
    finalReport: sampleFinalReport,
    referenceMediaPaths: Object.freeze([
        'production/dryrun_gangnam_001/assets/clip_001/first_frame.png',
        'production/dryrun_gangnam_001/assets/reference/operator_dashboard_style.png',
    ]),
    queueLedgers: Object.freeze({
        submit_records: 'production/dryrun_gangnam_001/queue/submit_records.jsonl',
        heartbeat_log: 'production/dryrun_gangnam_001/queue/heartbeat_log.jsonl',
    }),
    qaArtifacts: Object.freeze({
        contactSheetPaths: [
            'production/dryrun_gangnam_001/qa/contact_sheets/clip_001_contact_sheet.jpg',
        ],
        frameSamplePaths: [
            'production/dryrun_gangnam_001/qa/frames/clip_001/frame_0001.jpg',
            'production/dryrun_gangnam_001/qa/frames/clip_001/frame_0048.jpg',
        ],
    }),
    settings: Object.freeze({
        harnessDocs: Object.freeze({
            shorts: 'docs/harness/shorts-SKILL.md',
            seedance: 'docs/harness/Seedance2-SKILL.md',
        }),
        dreaminaCliPath: '/Users/jessiek/.local/bin/dreamina',
        flowOmniSetting: 'Flow/Omni placeholder only; no execution wired',
        ffmpegPath: '/opt/homebrew/bin/ffmpeg',
        ffprobePath: '/opt/homebrew/bin/ffprobe',
        modelDirectories: [
            '/Users/jessiek/StudioProjects/happyVideoFactory/models',
            '/Users/jessiek/Library/Application Support/Open Generative AI/local-ai/models',
        ],
    }),
    fileEvidence: Object.freeze({
        'production/dryrun_gangnam_001/final/final.mp4': false,
        'production/dryrun_gangnam_001/final/concat_list.txt': false,
        'production/dryrun_gangnam_001/final/report.md': true,
    }),
});

export default samplePipelineState;
