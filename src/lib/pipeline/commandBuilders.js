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

function productionId(state) {
    return state.project?.production_id || 'unknown_production';
}

function rootPath(state) {
    return state.project?.root_path || '';
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
    return buildCanonicalPackBuildCommand(state);
}

export function canonicalGeneratorRoute(route) {
    return ({
        seedance: 'seedance',
        flow_omni: 'flow',
        both: 'both',
    })[route] || '';
}

function harnessEntrypoint(harnessStatus, id) {
    if (harnessStatus?.readiness !== 'available' || harnessStatus?.ready !== true) return null;
    const entry = harnessStatus.entries?.find((candidate) => candidate.id === id);
    return entry?.ready === true && entry?.path ? entry : null;
}

export function buildCanonicalPackBuildCommand(state, options = {}) {
    const route = canonicalGeneratorRoute(state.project?.route);
    const harnessStatus = options.harnessStatus || state.harnessContractStatus;
    const builder = harnessEntrypoint(harnessStatus, 'pack_builder');
    const reason = !builder
        ? 'CANONICAL_HARNESS_CONTRACT_UNAVAILABLE'
        : !route
            ? 'UNSUPPORTED_GENERATOR_ROUTE'
            : 'NEW_PACK_OUTPUT_SAFETY_UNPROVEN';
    return spec({
        id: 'canonical_pack_build',
        label: 'Canonical pack build',
        command: '',
        args: [],
        cwd: harnessStatus?.rootPath || '',
        side_effect_type: SIDE_EFFECT_TYPES.LOCAL_PLANNING_WRITE,
        copy_allowed: false,
        disabled_reason: reason,
        disabled_detail: !builder
            ? 'happyVideoFactory canonical pack 계약이 확인되지 않아 build 명령을 만들지 않았습니다.'
            : !route
                ? `지원하지 않는 generator route입니다: ${state.project?.route || 'missing'}`
                : '현재 선택된 기존 production이 새 빈 출력 폴더임을 main process가 증명하지 못하므로 build preview를 차단합니다. 기존 산출물에 덮어쓰기 옵션을 자동 추가하지 않습니다.',
        canonical_target_generator: route,
        production_id: productionId(state),
    });
}

export function buildCanonicalPackValidationCommand(state, options = {}) {
    const harnessStatus = options.harnessStatus || state.harnessContractStatus;
    const validator = harnessEntrypoint(harnessStatus, 'pack_validator');
    const configuredRoot = options.configuredProductionRoot || '';
    const stateRoot = rootPath(state);
    const usableRoot = Boolean(configuredRoot)
        && isAbsolutePath(configuredRoot)
        && configuredRoot === stateRoot;
    const canonicalInputsReady = state.canonicalHandoff?.validation_input_ready === true;
    const disabledReason = !validator
        ? 'CANONICAL_HARNESS_CONTRACT_UNAVAILABLE'
        : !usableRoot
            ? 'MAIN_OWNED_PRODUCTION_ROOT_REQUIRED'
            : !canonicalInputsReady
                ? 'CANONICAL_PACK_INPUT_INCOMPLETE'
            : '';
    return spec({
        id: 'canonical_pack_validate',
        label: 'Canonical pack validate',
        command: validator ? 'python3' : '',
        args: validator && usableRoot ? [validator.path, configuredRoot, '--json'] : [],
        cwd: validator ? harnessStatus.rootPath : '',
        side_effect_type: SIDE_EFFECT_TYPES.LOCAL_READ,
        evidence_output_path: '',
        copy_allowed: disabledReason === '',
        disabled_reason: disabledReason,
        disabled_detail: disabledReason === 'CANONICAL_HARNESS_CONTRACT_UNAVAILABLE'
            ? 'canonical validator의 fixed-root hash 계약이 준비되지 않았습니다.'
            : disabledReason
                ? disabledReason === 'CANONICAL_PACK_INPUT_INCOMPLETE'
                    ? 'canonical intake brief, script.txt, pipeline_pack_report.json이 안전하게 복원되어야 validator를 복사할 수 있습니다.'
                    : 'main process가 소유한 현재 production root와 복원된 프로젝트가 일치해야 합니다.'
                : '읽기 전용 canonical pack 검증 preview입니다. 결과 파일을 생성한다고 주장하지 않습니다.',
    });
}

export function buildContractOnlyRunCommand(state, options = {}) {
    return buildCanonicalPackValidationCommand(state, options);
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
        buildCanonicalPackBuildCommand(state, options),
        buildCanonicalPackValidationCommand(state, options),
        ...buildDeepSearchSceneImageCommandSpecs(state),
        ...buildDreaminaHelpCommands(state),
        ...buildDreaminaQueueCommands(state, now),
        ...buildFfprobeValidationCommands(state),
        buildFfmpegConcatPreviewCommand(state),
    ];
}
