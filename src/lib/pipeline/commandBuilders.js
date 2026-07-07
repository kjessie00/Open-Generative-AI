import { BLOCKERS } from './blockers.js';
import { buildDeepSearchSceneImageCommandSpecs } from './deepsearchSceneImages.js';
import { SIDE_EFFECT_TYPES } from './sideEffects.js';
import { basename, joinPath } from './filePathUtils.js';
import { validateSeedanceQueuePolicy } from './validators.js';

function isAbsolutePath(pathValue = '') {
    return String(pathValue).startsWith('/') || /^[A-Za-z]:[\\/]/.test(String(pathValue));
}

function absolutePath(state, pathValue = '') {
    const value = String(pathValue || '');
    if (!value) return '';
    if (isAbsolutePath(value)) return value;

    const root = rootPath(state);
    if (!root) return value;

    const rootName = basename(root);
    const parts = value.split('/').filter(Boolean);
    const rootIndex = parts.lastIndexOf(rootName);
    const relativeInsideRoot = rootIndex >= 0 ? parts.slice(rootIndex + 1).join('/') : value;
    return joinPath(root, relativeInsideRoot);
}

function firstAssetPath(state) {
    const pathValue = state.assets?.find((asset) => asset.path)?.path || 'assets/start_frame.png';
    return absolutePath(state, pathValue);
}

function productionId(state) {
    return state.project?.production_id || 'unknown_production';
}

function rootPath(state) {
    return state.project?.root_path || '';
}

function goalText(state) {
    return state.brief?.logline || state.brief?.concept || `Build cinematic pipeline plan for ${state.project?.title || productionId(state)}`;
}

function targetLane(state) {
    const route = state.project?.route;
    if (route === 'flow_omni') return 'flow_omni';
    return 'seedance';
}

function absOutput(state, relativePath) {
    return joinPath(rootPath(state), relativePath);
}

function spec(base) {
    return {
        preview_only: true,
        requires_confirmation: false,
        confirmation_token: '',
        related_clip_id: '',
        evidence_output_path: '',
        ...base,
    };
}

export function buildContractPlanCommand(state) {
    const output = absOutput(state, 'pipeline_plan.json');
    return spec({
        id: 'contract_plan',
        label: 'Build pipeline plan',
        command: 'python',
        args: [
            'scripts/build_ai_video_pipeline_plan.py',
            '--production-id', productionId(state),
            '--goal', goalText(state),
            '--target-lane', targetLane(state),
            '--asset', `${firstAssetPath(state)}:image:start_frame`,
            '--output', output,
            '--packets-output', absOutput(state, 'agent_work_packets.json'),
        ],
        cwd: rootPath(state),
        side_effect_type: SIDE_EFFECT_TYPES.LOCAL_PLANNING_WRITE,
        evidence_output_path: output,
    });
}

export function buildContractOnlyRunCommand(state) {
    const outputDir = absOutput(state, 'pipeline_run');
    return spec({
        id: 'contract_only_run',
        label: 'Run contract-only pipeline',
        command: 'python',
        args: [
            'scripts/run_ai_video_pipeline.py',
            '--production-id', productionId(state),
            '--goal', goalText(state),
            '--target-lane', targetLane(state),
            '--asset', `${firstAssetPath(state)}:image:start_frame`,
            '--output-dir', outputDir,
        ],
        cwd: rootPath(state),
        side_effect_type: SIDE_EFFECT_TYPES.LOCAL_PLANNING_WRITE,
        evidence_output_path: outputDir,
    });
}

export function buildDreaminaHelpCommands(state) {
    return [
        spec({
            id: 'dreamina_help',
            label: 'Dreamina help',
            command: 'dreamina',
            args: ['-h'],
            cwd: rootPath(state),
            side_effect_type: SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS,
            evidence_output_path: absOutput(state, 'logs/dreamina_help.txt'),
        }),
        spec({
            id: 'dreamina_user_credit',
            label: 'Dreamina user_credit',
            command: 'dreamina',
            args: ['user_credit'],
            cwd: rootPath(state),
            side_effect_type: SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS,
            evidence_output_path: absOutput(state, 'logs/dreamina_user_credit.txt'),
        }),
        spec({
            id: 'dreamina_list_task_help',
            label: 'Dreamina list_task help',
            command: 'dreamina',
            args: ['list_task', '-h'],
            cwd: rootPath(state),
            side_effect_type: SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS,
            evidence_output_path: absOutput(state, 'logs/dreamina_list_task_help.txt'),
        }),
        spec({
            id: 'dreamina_query_result_help',
            label: 'Dreamina query_result help',
            command: 'dreamina',
            args: ['query_result', '-h'],
            cwd: rootPath(state),
            side_effect_type: SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS,
            evidence_output_path: absOutput(state, 'logs/dreamina_query_result_help.txt'),
        }),
    ];
}

function disabledQueueCommandReason(item, policy) {
    const details = [];
    if (!item.submit_id) {
        details.push(`${item.clip_id}: submit_id is not recorded; phase=${item.phase}`);
    }
    if (policy.details?.missingApprovedSubmitIds?.length) {
        details.push(`Queue all approved Seedance/Dreamina clips with --poll=0 before heartbeat checks: ${policy.details.missingApprovedSubmitIds.join(', ')}`);
    }
    if (item.heartbeat?.details?.reason === 'heartbeat_not_due' || item.heartbeat?.details?.reason === 'heartbeat_interval_too_short') {
        details.push(`Next heartbeat at ${item.heartbeat.details.nextHeartbeatAt || item.next_heartbeat_at}`);
    }
    if (item.liveAttemptCount > 1) {
        details.push(`${item.clip_id}: duplicate live generation attempt is blocked by default`);
    }
    if (item.hasVipOrFallbackEvidence) {
        details.push(`${item.clip_id}: VIP/fallback model evidence is blocked`);
    }

    return {
        disabled_reason: details.length ? BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED : '',
        disabled_detail: details.join(' | '),
    };
}

export function buildDreaminaQueueCommands(state, now = new Date()) {
    const policy = validateSeedanceQueuePolicy(state, now);
    const timeline = policy.details?.timeline || [];
    const rows = timeline.length ? timeline : [{ clip_id: 'clip', submit_id: '', phase: 'not_queued', heartbeat: { details: {} }, liveAttemptCount: 0 }];

    return rows.flatMap((item) => {
        const submitId = item.submit_id || '<submit_id>';
        const disabled = disabledQueueCommandReason(item, policy);
        const clipId = item.clip_id || 'clip';
        const downloadDir = absolutePath(state, item.submitRecord?.download_dir || `dreamina_outputs/${clipId}`);

        return [
            spec({
                id: `dreamina_list_task_${clipId}`,
                label: `Dreamina list_task · ${clipId}`,
                command: 'dreamina',
                args: ['list_task', `--submit_id=${submitId}`, '--limit=1'],
                cwd: rootPath(state),
                side_effect_type: SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS,
                related_clip_id: clipId,
                evidence_output_path: absOutput(state, `logs/${clipId}_dreamina_list_task.json`),
                ...disabled,
            }),
            spec({
                id: `dreamina_query_result_${clipId}`,
                label: `Dreamina query_result · ${clipId}`,
                command: 'dreamina',
                args: ['query_result', `--submit_id=${submitId}`, '--download_dir', downloadDir],
                cwd: rootPath(state),
                side_effect_type: SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS,
                related_clip_id: clipId,
                evidence_output_path: downloadDir,
                ...disabled,
            }),
        ];
    });
}

export function buildFfprobeValidationCommands(state) {
    const files = [
        ...(state.qaRecords || []).map((record) => record.file_path).filter(Boolean),
        state.finalReport?.final_video_path,
    ].filter(Boolean).map((filePath) => absolutePath(state, filePath));
    const uniqueFiles = Array.from(new Set(files));
    return (uniqueFiles.length ? uniqueFiles : [state.finalReport?.final_video_path || absOutput(state, 'final/final.mp4')]).map((filePath, index) => spec({
        id: `ffprobe_${index + 1}`,
        label: index === 0 ? 'ffprobe validation' : `ffprobe validation ${index + 1}`,
        command: 'ffprobe',
        args: [filePath],
        cwd: rootPath(state),
        side_effect_type: SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS,
        evidence_output_path: `${filePath}.ffprobe.json`,
        disabled_reason: filePath ? '' : 'MISSING_VIDEO_FILE',
    }));
}

export function buildFfmpegConcatPreviewCommand(state) {
    const concatList = absolutePath(state, state.finalReport?.concat_list_path || 'final/concat_list.txt');
    const finalPath = absolutePath(state, state.finalReport?.final_video_path || 'final/final.mp4');
    return spec({
        id: 'ffmpeg_concat_preview',
        label: 'ffmpeg concat preview',
        command: 'ffmpeg',
        args: ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', finalPath],
        cwd: rootPath(state),
        side_effect_type: SIDE_EFFECT_TYPES.LOCAL_WRITE,
        evidence_output_path: finalPath,
        disabled_reason: 'PREVIEW_ONLY_REQUIRED',
    });
}

export function buildPipelineCommandSpecs(state, options = {}) {
    const now = options.now || new Date();
    return [
        buildContractPlanCommand(state),
        buildContractOnlyRunCommand(state),
        ...buildDeepSearchSceneImageCommandSpecs(state),
        ...buildDreaminaHelpCommands(state),
        ...buildDreaminaQueueCommands(state, now),
        ...buildFfprobeValidationCommands(state),
        buildFfmpegConcatPreviewCommand(state),
    ];
}
