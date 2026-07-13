import { BLOCKERS } from './blockers.js';

export const HEARTBEAT_MIN_INTERVAL_MS = 20 * 60 * 1000;

const RETRY_BLOCKED_VERDICTS = new Set(['RETRY', 'BLOCK', 'UNREVIEWED']);
const ACTIVE_QUEUE_STATUSES = new Set(['active', 'queued', 'pending', 'running', 'processing', 'generating', 'submitted']);
const COMPLETE_GEN_STATUSES = new Set(['complete', 'completed', 'done', 'downloaded', 'failed', 'blocked']);
const PREVIEW_OR_NOT_SUBMITTED_STATUSES = new Set(['', 'preview', 'preview_only', 'dry_run', 'not_submitted', 'planned']);
const FAILED_QUEUE_STATUSES = new Set(['fail', 'failed', 'error', 'errored', 'blocked']);
const DOWNLOADED_QUEUE_STATUSES = new Set(['downloaded']);
const FINISHED_QUEUE_STATUSES = new Set(['complete', 'completed', 'done', 'downloaded', 'failed', 'blocked']);

export const QUEUE_PHASES = Object.freeze({
    NOT_QUEUED: 'not_queued',
    PRE_QUEUE_FAILURE: 'pre_queue_failure',
    SUBMITTED_MISSING_ID: 'submitted_missing_id',
    QUEUED: 'queued',
    HEARTBEAT_NOT_DUE: 'heartbeat_not_due',
    HEARTBEAT_DUE: 'heartbeat_due',
    DOWNLOADED: 'downloaded',
    COMPLETED_NOT_DOWNLOADED: 'completed_not_downloaded',
    FAILED_AFTER_REAL_QUEUE: 'failed_after_real_queue',
});

function result(blockers = [], details = {}) {
    return {
        ok: blockers.length === 0,
        blockers: Array.from(new Set(blockers.filter(Boolean))),
        details,
    };
}

function hasText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function hasBoolean(value) {
    return typeof value === 'boolean';
}

function hasPositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalized(value) {
    return String(value || '').trim().toLowerCase();
}

function missingFields(record, requiredFields) {
    if (!record || typeof record !== 'object') return requiredFields;
    return requiredFields.filter((field) => {
        const value = record[field];
        if (typeof value === 'boolean') return false;
        if (Array.isArray(value)) return value.length === 0;
        if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
        return !hasText(String(value ?? ''));
    });
}

function findGate(reviewGates = [], clipId, type) {
    return reviewGates.find((gate) => {
        const sameClip = !clipId || !gate.clip_id || gate.clip_id === clipId;
        return sameClip && gate.type === type;
    });
}

function hasExplicitException(record, gates = []) {
    if (record?.review_verdict === 'EXCEPTION') return true;
    if (record?.explicit_exception === true) return true;
    if (record?.exception_approved === true) return true;
    return gates.some((gate) => gate.type === 'image_qa' && gate.status === 'EXCEPTION');
}

function toTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? time : null;
}

function toIsoOrOriginal(value) {
    const time = toTime(value);
    return time ? new Date(time).toISOString() : String(value || '');
}

function assetRecordsForPrompt(promptPack, clipState) {
    const assets = clipState?.attachedAssetRecords || clipState?.assetRecords || clipState?.assets || [];
    if (!promptPack?.attached_assets?.length) {
        return assets.filter((asset) => !promptPack?.clip_id || asset.target_clip_id === promptPack.clip_id);
    }
    const attached = new Set(promptPack.attached_assets);
    return assets.filter((asset) => attached.has(asset.asset_id) || attached.has(asset.path));
}

function fileHasEvidence(path, projectState = {}) {
    if (!hasText(path)) return false;
    if (projectState.fileEvidence?.[path] === true) return true;
    if (projectState.fileExists?.[path] === true) return true;
    return projectState.files?.includes(path) === true;
}

function acceptedRangeHasEvidence(record, projectState = {}) {
    const inTime = record?.in_time;
    const outTime = record?.out_time;
    const basicRange = hasText(record?.source_file)
        && typeof inTime === 'number'
        && Number.isFinite(inTime)
        && inTime >= 0
        && typeof outTime === 'number'
        && Number.isFinite(outTime)
        && outTime > inTime;
    if (!basicRange) return false;
    if (record.canonical_provenance !== 'selected_takes.json') return true;
    return record.accepted === true
        && record.source_exists === true
        && hasText(record.canonical_shot_id)
        && hasText(record.canonical_alias_source)
        && fileHasEvidence(record.source_file, projectState);
}

function timeValues(values = []) {
    return values.map(toTime).filter(Boolean);
}

function uniqueClipIds(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function plannedClipIds(projectState = {}) {
    return uniqueClipIds([
        ...(projectState.storyboard || []).map((clip) => clip.clip_id),
        ...(projectState.promptPacks || projectState.prompt_packs || []).map((pack) => pack.clip_id),
        ...(projectState.submitRecords || projectState.submit_records || []).map((record) => record.clip_id),
    ]);
}

function approvedSeedanceClipIds(projectState = {}) {
    const promptPacks = projectState.promptPacks || projectState.prompt_packs || [];
    return uniqueClipIds(promptPacks
        .filter((pack) => {
            const generator = normalized(pack.generator);
            const seedanceRoute = generator.includes('seedance') || generator.includes('dreamina');
            const route = normalized(projectState.project?.route);
            const routeAllowsSeedance = !route || route === 'seedance' || route === 'both';
            return seedanceRoute && routeAllowsSeedance && ['PASS', 'EXCEPTION'].includes(pack.review_status);
        })
        .map((pack) => pack.clip_id));
}

function recordsForClip(records = [], clipId) {
    return records.filter((record) => record.clip_id === clipId);
}

function latestRecord(records = []) {
    return records[records.length - 1] || null;
}

function downloadedFilesForClip(submitRecord, heartbeatRecords = []) {
    const files = [];
    if (Array.isArray(submitRecord?.downloaded_files)) files.push(...submitRecord.downloaded_files);
    if (hasText(submitRecord?.source_file)) files.push(submitRecord.source_file);
    heartbeatRecords.forEach((record) => {
        if (Array.isArray(record.downloaded_files)) files.push(...record.downloaded_files);
    });
    return files.filter(Boolean);
}

function hasBackendQueueEvidence(record, heartbeatRecords = []) {
    if (!record) return false;
    if (hasText(record.submit_id)) return true;
    if (hasText(record.logid)) return true;
    if (hasText(record.submitted_cli_model) || hasText(record.backend_model_evidence)) return true;
    if (Number(record.credit_count || 0) > 0) return true;
    return heartbeatRecords.some((heartbeat) => {
        const queueStatus = normalized(heartbeat.queue_status);
        const genStatus = normalized(heartbeat.gen_status);
        const backendStatus = !PREVIEW_OR_NOT_SUBMITTED_STATUSES.has(queueStatus)
            || !PREVIEW_OR_NOT_SUBMITTED_STATUSES.has(genStatus);
        return hasText(heartbeat.submit_id)
            || hasText(heartbeat.backend_benefit_type)
            || backendStatus;
    });
}

function isLiveGenerationAttempt(record, heartbeatRecords = []) {
    if (!record) return false;
    return hasBackendQueueEvidence(record, heartbeatRecords);
}

function latestHeartbeatForClip(heartbeatRecords = [], clipId) {
    return [...heartbeatRecords].reverse().find((record) => record.clip_id === clipId) || null;
}

function isFinishedSubmitRecord(record, heartbeatRecords = []) {
    const statuses = [
        normalized(record?.status),
        normalized(record?.queue_status),
        normalized(record?.gen_status),
        ...heartbeatRecords.flatMap((heartbeat) => [normalized(heartbeat.queue_status), normalized(heartbeat.gen_status)]),
    ];
    return statuses.some((status) => FINISHED_QUEUE_STATUSES.has(status));
}

function hasVipOrFallbackEvidence(record, heartbeatRecords = []) {
    const values = [
        record?.requested_model,
        record?.submitted_cli_model,
        record?.backend_benefit_type,
        record?.backend_queue_debug,
        ...heartbeatRecords.flatMap((heartbeat) => [
            heartbeat.backend_benefit_type,
            heartbeat.backend_queue_debug,
            heartbeat.submitted_cli_model,
        ]),
    ].map(normalized);
    return values.some((value) => value.includes('vip') || value.includes('fallback'));
}

export function classifyQueueClip(projectState = {}, clipId, now = new Date()) {
    const submitRecords = projectState.submitRecords || projectState.submit_records || [];
    const heartbeatRecords = projectState.heartbeatRecords || projectState.heartbeat_records || [];
    const clipSubmitRecords = recordsForClip(submitRecords, clipId);
    const clipHeartbeatRecords = recordsForClip(heartbeatRecords, clipId);
    const submitRecord = latestRecord(clipSubmitRecords);
    const heartbeatRecord = latestHeartbeatForClip(heartbeatRecords, clipId);
    const liveAttemptCount = clipSubmitRecords.filter((record) => isLiveGenerationAttempt(record, clipHeartbeatRecords)).length;
    const submitId = submitRecord?.submit_id || heartbeatRecord?.submit_id || '';
    const knownCreditCount = Number(submitRecord?.credit_count || 0);
    const backendModelEvidence = submitRecord?.submitted_cli_model
        || submitRecord?.backend_model_evidence
        || heartbeatRecord?.submitted_cli_model
        || '';
    const downloadedFiles = downloadedFilesForClip(submitRecord, clipHeartbeatRecords);
    const heartbeat = validateHeartbeatAllowed(heartbeatRecord || submitRecord, now);
    const statuses = [
        normalized(submitRecord?.status),
        normalized(heartbeatRecord?.queue_status),
        normalized(heartbeatRecord?.gen_status),
    ];
    const failedAfterQueue = liveAttemptCount > 0 && statuses.some((status) => FAILED_QUEUE_STATUSES.has(status));
    const finished = isFinishedSubmitRecord(submitRecord, clipHeartbeatRecords);
    let phase = QUEUE_PHASES.NOT_QUEUED;

    if (submitRecord && !submitId && !hasBackendQueueEvidence(submitRecord, clipHeartbeatRecords)) {
        phase = QUEUE_PHASES.PRE_QUEUE_FAILURE;
    } else if (submitRecord && !submitId) {
        phase = QUEUE_PHASES.SUBMITTED_MISSING_ID;
    } else if (failedAfterQueue) {
        phase = QUEUE_PHASES.FAILED_AFTER_REAL_QUEUE;
    } else if (downloadedFiles.length || DOWNLOADED_QUEUE_STATUSES.has(normalized(submitRecord?.status))) {
        phase = QUEUE_PHASES.DOWNLOADED;
    } else if (finished && !downloadedFiles.length) {
        phase = QUEUE_PHASES.COMPLETED_NOT_DOWNLOADED;
    } else if (submitId && heartbeat.details?.reason === 'heartbeat_not_due') {
        phase = QUEUE_PHASES.HEARTBEAT_NOT_DUE;
    } else if (submitId && heartbeat.ok) {
        phase = QUEUE_PHASES.HEARTBEAT_DUE;
    } else if (submitId) {
        phase = QUEUE_PHASES.QUEUED;
    }

    return {
        clip_id: clipId,
        phase,
        submitRecord,
        heartbeatRecord,
        submit_id: submitId,
        liveAttemptCount,
        knownCreditCount,
        backendModelEvidence,
        next_heartbeat_at: heartbeat.details?.nextHeartbeatAt || submitRecord?.next_heartbeat_at || heartbeatRecord?.next_heartbeat_at || '',
        heartbeat,
        downloadedFiles,
        isPreQueueFailure: phase === QUEUE_PHASES.PRE_QUEUE_FAILURE,
        isRetryAllowedByDefault: false,
        hasVipOrFallbackEvidence: hasVipOrFallbackEvidence(submitRecord, clipHeartbeatRecords),
    };
}

export function validateSeedanceQueuePolicy(projectState = {}, now = new Date()) {
    const clipIds = plannedClipIds(projectState);
    const approvedClipIds = approvedSeedanceClipIds(projectState);
    const timeline = clipIds.map((clipId) => classifyQueueClip(projectState, clipId, now));
    const blockers = [];
    const details = {
        plannedClipIds: clipIds,
        approvedClipIds,
        timeline,
        policy: 'one_live_attempt_per_planned_clip_no_auto_retry_no_vip_no_fallback_no_duplicate',
    };

    const missingApprovedSubmitIds = approvedClipIds.filter((clipId) => {
        const item = timeline.find((entry) => entry.clip_id === clipId);
        return !item?.submit_id;
    });
    if (missingApprovedSubmitIds.length) {
        blockers.push(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
        details.missingApprovedSubmitIds = missingApprovedSubmitIds;
        details.queueFirstRule = 'queue_all_approved_clips_with_poll_0_before_heartbeat';
    }

    const missingSubmittedIds = timeline
        .filter((item) => item.phase === QUEUE_PHASES.SUBMITTED_MISSING_ID)
        .map((item) => item.clip_id);
    if (missingSubmittedIds.length) {
        blockers.push(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
        details.missingSubmittedIds = missingSubmittedIds;
    }

    const duplicateAttempts = timeline
        .filter((item) => item.liveAttemptCount > 1)
        .map((item) => item.clip_id);
    if (duplicateAttempts.length) {
        blockers.push(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
        details.duplicateAttempts = duplicateAttempts;
    }

    const vipOrFallback = timeline
        .filter((item) => item.hasVipOrFallbackEvidence)
        .map((item) => item.clip_id);
    if (vipOrFallback.length) {
        blockers.push(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
        details.vipOrFallback = vipOrFallback;
    }

    const heartbeatBeforeAllQueued = timeline
        .filter((item) => item.submit_id && missingApprovedSubmitIds.length)
        .map((item) => item.clip_id);
    if (heartbeatBeforeAllQueued.length) {
        blockers.push(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
        details.heartbeatBeforeAllApprovedQueued = heartbeatBeforeAllQueued;
    }

    const nextHeartbeatBlocked = timeline
        .filter((item) => item.heartbeat.blockers.includes(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED))
        .filter((item) => item.heartbeat.details?.reason === 'heartbeat_not_due' || item.heartbeat.details?.reason === 'heartbeat_interval_too_short')
        .map((item) => ({
            clip_id: item.clip_id,
            next_heartbeat_at: item.heartbeat.details?.nextHeartbeatAt || item.next_heartbeat_at,
            waitMs: item.heartbeat.details?.waitMs,
        }));
    if (nextHeartbeatBlocked.length) {
        blockers.push(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
        details.nextHeartbeatBlocked = nextHeartbeatBlocked;
    }

    return result(blockers, details);
}

export function validateProductionBrief(project) {
    const brief = project?.brief || project;
    if (!brief || typeof brief !== 'object') {
        return result([BLOCKERS.MISSING_PRODUCTION_BRIEF], { missingFields: ['brief'] });
    }

    const requiredText = ['concept', 'logline', 'script_path', 'stop_loss_rule'];
    const missing = missingFields(brief, requiredText);
    const missingBooleans = [
        'dialogue_required',
        'subtitles_required',
        'music_required',
        'natural_sfx_required',
    ].filter((field) => !hasBoolean(brief[field]));

    return result(
        missing.length || missingBooleans.length ? [BLOCKERS.MISSING_PRODUCTION_BRIEF] : [],
        { missingFields: [...missing, ...missingBooleans] },
    );
}

export function validateStoryboardClip(clip) {
    const requiredFields = [
        'scene_id',
        'clip_id',
        'duration',
        'dramatic_beat',
        'characters',
        'location',
        'first_frame',
        'action',
        'camera',
        'lighting',
        'audio_sfx_dialogue',
        'reference_dependencies',
        'risk',
        'dominant_action',
        'dominant_camera_strategy',
    ];
    const missing = missingFields(clip, requiredFields);
    const invalidDuration = !hasPositiveNumber(clip?.duration);

    return result(
        missing.length || invalidDuration ? [BLOCKERS.MISSING_STORYBOARD_CONTINUITY_PACKET] : [],
        { missingFields: missing, invalidDuration },
    );
}

export function validateImageDashboard(projectState) {
    const dashboard = projectState?.imageDashboard || projectState?.image_dashboard;
    if (!dashboard || typeof dashboard !== 'object') {
        return result([BLOCKERS.MISSING_IMAGE_DASHBOARD], { missingFields: ['imageDashboard'] });
    }

    const blockers = [];
    const details = { missingFields: [] };
    const dashboardAssets = dashboard.assets || projectState?.assets || projectState?.assetRecords || [];

    if (!hasText(dashboard.path) && !hasText(dashboard.dashboard_path)) {
        details.missingFields.push('path');
    }

    if (dashboard.parsed === false || dashboard.exists === false) {
        details.missingFields.push('parsed_dashboard_data');
    }

    if (!Array.isArray(dashboardAssets) || dashboardAssets.length === 0) {
        details.missingFields.push('assets');
    }

    const dashboardTime = toTime(dashboard.updated_at || dashboard.generated_at);
    const upstreamTimes = [
        projectState?.storyboard_updated_at,
        projectState?.motion_board_updated_at,
        projectState?.prompt_pack_updated_at,
        ...(dashboardAssets || []).flatMap((asset) => [
            asset.updated_at,
            asset.file_updated_at,
            asset.prompt_updated_at,
            asset.review_updated_at,
            asset.reviewed_at,
        ]),
    ];
    const upstreamFileTimes = timeValues(upstreamTimes);
    const staleByFileTimestamp = dashboardTime && upstreamFileTimes.some((time) => time > dashboardTime);

    if (dashboard.stale === true || dashboard.status === 'stale' || staleByFileTimestamp) {
        blockers.push(BLOCKERS.IMAGE_DASHBOARD_STALE);
        details.stale = true;
        details.dashboardUpdatedAt = dashboard.updated_at || '';
        details.newerAssetOrReviewTimes = upstreamFileTimes
            .filter((time) => dashboardTime && time > dashboardTime)
            .map((time) => new Date(time).toISOString());
    }

    if (details.missingFields.length) {
        blockers.push(BLOCKERS.MISSING_IMAGE_DASHBOARD);
    }

    const missingReferenceAnnotation = dashboardAssets.some((asset) => {
        const isReference = ['image', 'first_frame', 'reference', 'reference_image'].includes(asset.type);
        return isReference && !hasText(asset.continuity_notes);
    });
    if (missingReferenceAnnotation) {
        blockers.push(BLOCKERS.MISSING_REFERENCE_ANNOTATION);
    }

    return result(blockers, details);
}

export function validatePromptPack(promptPack) {
    const requiredFields = [
        'clip_id',
        'generator',
        'prompt_path',
        'model',
        'aspect_ratio',
        'duration',
        'negative_constraints',
        'attached_assets',
        'review_status',
    ];
    const missing = missingFields(promptPack, requiredFields);
    const blockers = missing.length ? [BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED] : [];

    if (promptPack?.no_bgm_required !== true) {
        blockers.push(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
    }

    if (!['PASS', 'EXCEPTION'].includes(promptPack?.review_status)) {
        blockers.push(BLOCKERS.GEMINI_REVIEW_BLOCKED);
    }

    return result(blockers, {
        missingFields: missing,
        noBgmRequired: promptPack?.no_bgm_required === true,
        reviewStatus: promptPack?.review_status,
    });
}

export function validateSubmitAllowed(clipState) {
    const promptPack = clipState?.promptPack || clipState?.prompt_pack;
    const reviewGates = clipState?.reviewGates || clipState?.review_gates || [];
    const blockers = [];
    const details = {};

    const dashboardResult = validateImageDashboard(clipState);
    blockers.push(...dashboardResult.blockers);
    details.imageDashboard = dashboardResult.details;

    const attachedAssets = assetRecordsForPrompt(promptPack, clipState);
    const assetFailures = attachedAssets.filter((asset) => {
        if (!RETRY_BLOCKED_VERDICTS.has(asset.review_verdict)) return false;
        return !hasExplicitException(asset, reviewGates);
    });
    if (assetFailures.length) {
        blockers.push(...assetFailures.map((asset) => (
            asset.review_verdict === 'UNREVIEWED'
                ? BLOCKERS.IMAGE_GEMINI_REVIEW_REQUIRED
                : BLOCKERS.IMAGE_GEMINI_REVIEW_NOT_PASS
        )));
        details.assetFailures = assetFailures.map((asset) => ({
            asset_id: asset.asset_id,
            review_verdict: asset.review_verdict,
        }));
    }

    const promptGate = findGate(reviewGates, promptPack?.clip_id || clipState?.clip_id, 'prompt_media');
    if (promptPack?.review_status !== 'PASS' && promptGate?.status !== 'PASS') {
        blockers.push(BLOCKERS.GEMINI_REVIEW_BLOCKED);
        details.promptMediaReview = promptGate?.status || promptPack?.review_status || 'MISSING';
    }

    const creditConfirmed = clipState?.creditConfirmation?.confirmed === true
        || clipState?.credit_confirmation?.confirmed === true
        || clipState?.credit_confirmed === true;
    if (!creditConfirmed) {
        blockers.push(BLOCKERS.CREDIT_CONFIRMATION_REQUIRED);
    }

    const liveAttempts = clipState?.live_attempt_count
        ?? clipState?.liveAttempts
        ?? clipState?.submitRecords?.filter((record) => {
            const clipHeartbeats = (clipState?.heartbeatRecords || clipState?.heartbeat_records || [])
                .filter((heartbeat) => heartbeat.clip_id === record.clip_id);
            return isLiveGenerationAttempt(record, clipHeartbeats);
        }).length
        ?? 0;
    if (liveAttempts >= 1 && clipState?.allow_additional_live_attempt !== true) {
        blockers.push(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
        details.liveAttemptPolicy = 'one_live_generation_attempt_per_planned_clip';
    }

    const retryRequested = clipState?.retry_requested === true || clipState?.retryRequested === true;
    if (retryRequested && liveAttempts >= 1 && clipState?.allow_retry_after_live_attempt !== true) {
        blockers.push(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED);
        details.retryPolicy = 'retry_blocked_after_one_live_attempt';
    }

    const motionBoardShot = clipState?.motionBoardShot || clipState?.motion_board_shot;
    if (motionBoardShot && motionBoardShot.duration_lock !== true) {
        blockers.push(BLOCKERS.DURATION_LOCK_MISSING);
    }

    const requestedModel = clipState?.requested_model || clipState?.submitRecord?.requested_model;
    const cliModel = clipState?.submitted_cli_model || clipState?.submitRecord?.submitted_cli_model;
    if (hasText(requestedModel) && hasText(cliModel) && requestedModel !== cliModel) {
        blockers.push(BLOCKERS.MODEL_MISMATCH);
    }

    return result(blockers, details);
}

export function validateHeartbeatAllowed(lastHeartbeat, now = new Date()) {
    if (!lastHeartbeat?.checked_at) {
        if (lastHeartbeat?.next_heartbeat_at) {
            const nextTime = toTime(lastHeartbeat.next_heartbeat_at);
            const nowTime = toTime(now);
            if (nextTime && nowTime && nowTime < nextTime) {
                return result([BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED], {
                    elapsedMs: null,
                    minIntervalMs: HEARTBEAT_MIN_INTERVAL_MS,
                    nextHeartbeatAt: toIsoOrOriginal(lastHeartbeat.next_heartbeat_at),
                    waitMs: nextTime - nowTime,
                    reason: 'heartbeat_not_due',
                });
            }
        }
        return result([], { elapsedMs: null, minIntervalMs: HEARTBEAT_MIN_INTERVAL_MS });
    }

    const checkedAt = toTime(lastHeartbeat.checked_at);
    const nowTime = toTime(now);
    if (!checkedAt || !nowTime) {
        return result([BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED], { reason: 'invalid_heartbeat_timestamp' });
    }

    const nextTime = toTime(lastHeartbeat.next_heartbeat_at);
    if (nextTime && nowTime < nextTime) {
        return result([BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED], {
            elapsedMs: nowTime - checkedAt,
            minIntervalMs: HEARTBEAT_MIN_INTERVAL_MS,
            nextHeartbeatAt: toIsoOrOriginal(lastHeartbeat.next_heartbeat_at),
            waitMs: nextTime - nowTime,
            reason: 'heartbeat_not_due',
        });
    }

    const queueStatus = String(lastHeartbeat.queue_status || '').toLowerCase();
    const genStatus = String(lastHeartbeat.gen_status || '').toLowerCase();
    const active = ACTIVE_QUEUE_STATUSES.has(queueStatus) || !COMPLETE_GEN_STATUSES.has(genStatus);
    const elapsedMs = nowTime - checkedAt;

    if (active && elapsedMs < HEARTBEAT_MIN_INTERVAL_MS) {
        return result([BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED], {
            elapsedMs,
            minIntervalMs: HEARTBEAT_MIN_INTERVAL_MS,
            nextHeartbeatAt: new Date(checkedAt + HEARTBEAT_MIN_INTERVAL_MS).toISOString(),
            waitMs: HEARTBEAT_MIN_INTERVAL_MS - elapsedMs,
            reason: 'heartbeat_interval_too_short',
        });
    }

    return result([], { elapsedMs, minIntervalMs: HEARTBEAT_MIN_INTERVAL_MS, nextHeartbeatAt: nextTime ? toIsoOrOriginal(lastHeartbeat.next_heartbeat_at) : '' });
}

export function validateFinalReady(projectState) {
    const finalReport = projectState?.finalReport || projectState?.final_report;
    const submitRecords = projectState?.submitRecords || projectState?.submit_records || [];
    const heartbeatRecords = projectState?.heartbeatRecords || projectState?.heartbeat_records || [];
    const qaRecords = projectState?.qaRecords || projectState?.qa_records || [];
    const acceptedSeconds = projectState?.acceptedSeconds || projectState?.accepted_seconds || [];
    const blockers = [];
    const details = {};

    if (!finalReport || typeof finalReport !== 'object') {
        return result([BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN], { missingFields: ['finalReport'] });
    }

    const finalVideoPath = finalReport.final_video_path;
    const finalVideoExists = finalVideoPath?.endsWith('final.mp4') && fileHasEvidence(finalVideoPath, projectState);
    if (!finalVideoExists) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.finalVideo = 'missing_final_mp4_evidence';
    }

    const expectedClipIds = plannedClipIds(projectState);
    const submittedClipIds = new Set(submitRecords.filter((record) => hasText(record.submit_id)).map((record) => record.clip_id));
    const missingSubmitIds = expectedClipIds.filter((clipId) => !submittedClipIds.has(clipId));
    if (missingSubmitIds.length) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.missingSubmitIds = missingSubmitIds;
    }

    const downloadedClipIds = new Set();
    heartbeatRecords.forEach((record) => {
        if (Array.isArray(record.downloaded_files) && record.downloaded_files.length > 0) {
            downloadedClipIds.add(record.clip_id);
        }
    });
    submitRecords.forEach((record) => {
        if (hasText(record.download_dir) && record.downloaded === true) {
            downloadedClipIds.add(record.clip_id);
        }
    });
    const missingDownloads = expectedClipIds.filter((clipId) => !downloadedClipIds.has(clipId));
    if (missingDownloads.length) {
        blockers.push(BLOCKERS.FRAME_EXTRACTION_BLOCKED);
        details.missingDownloads = missingDownloads;
    }

    const finishedClipIds = new Set();
    submitRecords.forEach((record) => {
        const clipHeartbeats = heartbeatRecords.filter((heartbeat) => heartbeat.clip_id === record.clip_id);
        if (isFinishedSubmitRecord(record, clipHeartbeats)) finishedClipIds.add(record.clip_id);
    });
    heartbeatRecords.forEach((record) => {
        if (FINISHED_QUEUE_STATUSES.has(normalized(record.gen_status)) || FINISHED_QUEUE_STATUSES.has(normalized(record.queue_status))) {
            finishedClipIds.add(record.clip_id);
        }
    });
    const missingFinishedSources = Array.from(finishedClipIds).filter((clipId) => {
        const submitRecord = submitRecords.find((record) => record.clip_id === clipId);
        const clipHeartbeats = heartbeatRecords.filter((heartbeat) => heartbeat.clip_id === clipId);
        return downloadedFilesForClip(submitRecord, clipHeartbeats).length === 0;
    });
    if (missingFinishedSources.length) {
        blockers.push(BLOCKERS.FRAME_EXTRACTION_BLOCKED);
        details.missingFinishedSourceClipPaths = missingFinishedSources;
    }

    const qaPassedClipIds = new Set(qaRecords
        .filter((record) => ['PASS', 'EXCEPTION'].includes(record.verdict))
        .map((record) => record.clip_id));
    const qaRecordedClipIds = new Set(qaRecords.filter((record) => hasText(record.verdict)).map((record) => record.clip_id));
    const missingQa = expectedClipIds.filter((clipId) => !qaRecordedClipIds.has(clipId));
    if (missingQa.length) {
        blockers.push(BLOCKERS.GEMINI_VIDEO_REVIEW_BLOCKED);
        details.missingQa = missingQa;
        if (missingQa.some((clipId) => downloadedClipIds.has(clipId))) {
            blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
            details.downloadedButQaMissing = missingQa.filter((clipId) => downloadedClipIds.has(clipId));
        }
    }

    const qaNotPassed = expectedClipIds.filter((clipId) => qaRecordedClipIds.has(clipId) && !qaPassedClipIds.has(clipId));
    if (qaNotPassed.length) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.qaNotPassedOrException = qaNotPassed;
    }

    const provenAcceptedRanges = acceptedSeconds.filter((record) => acceptedRangeHasEvidence(record, projectState));
    const acceptedClipIds = new Set(provenAcceptedRanges.map((record) => record.clip_id));
    const missingAcceptedSeconds = expectedClipIds.filter((clipId) => !acceptedClipIds.has(clipId));
    if (missingAcceptedSeconds.length) {
        blockers.push(BLOCKERS.MISSING_ACCEPTED_SECONDS);
        details.missingAcceptedSeconds = missingAcceptedSeconds;
    }
    const canonicalIdentifierMismatches = acceptedSeconds
        .filter((record) => record.canonical_provenance === 'selected_takes.json')
        .filter((record) => !record.clip_id || !expectedClipIds.includes(record.clip_id) || !acceptedRangeHasEvidence(record, projectState))
        .map((record) => record.canonical_shot_id || 'unknown_shot');
    if (canonicalIdentifierMismatches.length) {
        blockers.push(BLOCKERS.MISSING_ACCEPTED_SECONDS);
        details.canonicalIdentifierMismatches = Array.from(new Set(canonicalIdentifierMismatches));
    }

    const concatListPath = finalReport.concat_list_path;
    if (!fileHasEvidence(concatListPath, projectState)) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.concatList = 'missing_concat_list_evidence';
    }

    const ffprobePath = finalReport.ffprobe_path || (hasText(finalVideoPath) ? `${finalVideoPath}.ffprobe.json` : '');
    if (finalReport.ffprobe_verified !== true && !fileHasEvidence(ffprobePath, projectState)) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.ffprobe = 'missing_ffprobe_verification_evidence';
    }

    const reportPath = finalReport.report_path;
    if (!fileHasEvidence(reportPath, projectState)) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.report = 'missing_report_evidence';
    }

    if (!Array.isArray(finalReport.blockers)) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.blockersRecorded = false;
    }

    const activeBlockers = [
        ...(projectState?.blockers || []),
        ...(Array.isArray(finalReport.blockers) ? finalReport.blockers : []),
    ].filter(Boolean);
    if (activeBlockers.length) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.activeBlockers = activeBlockers;
    }

    const canonicalHandoff = projectState?.canonicalHandoff;
    if (canonicalHandoff && canonicalHandoff.final_ready !== true) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.canonicalFinalReady = 'not_proven';
    }
    if (canonicalHandoff?.finishing_inconsistencies?.length) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
        details.canonicalFinishingInconsistencies = canonicalHandoff.finishing_inconsistencies;
    }

    return result(blockers, details);
}
