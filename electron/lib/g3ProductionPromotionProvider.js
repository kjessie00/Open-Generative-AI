const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');
const {
    G3_EXPORT_SCHEMA,
    ROOM_QC_SCHEMA,
    SELECTED_TAKES_SCHEMA,
    boundedText,
    exactKeys,
    g3Error,
    jsonBuffer,
    safeId,
    sha256,
    validateTransition,
} = require('./g3ReviewContract');
const {
    assertRelativeCandidate,
    readStableFile,
} = require('./g3ReviewCandidateStore');
const { contextState } = require('./g3ReviewDraftProvider');
const {
    NAMESPACES,
    appendValue,
    inspectGraph,
    syncCompatibilityCache,
} = require('./contentAddressedCommitStore');
const {
    acquirePromotionLock,
    ensurePromotionRoot,
    exactPromotionPaths,
    privateAtomicWrite,
    readTarget,
    sameTargetSnapshot,
} = require('./g3PromotionStore');

const PLAN_SCHEMA = 'film_pipeline.g3_promotion_plan.v1';
const RECEIPT_SCHEMA = 'film_pipeline.g3_promotion_receipt.v1';
const PENDING_SCHEMA = 'film_pipeline.g3_promotion_pending.v1';
const DEFAULT_PLAN_TTL_MS = 2 * 60 * 1000;
const MAX_PLAN_TTL_MS = 10 * 60 * 1000;
const SESSION_PLAN_STORE = new Map();
const SELECTED_GRAPH_PREFIX = 'G3_SELECTED_TAKES_GRAPH';
const SELECTED_CACHE_PREFIX = 'G3_SELECTED_TAKES';

function clockMs(context = {}) {
    const value = context.promotionNowMs ? context.promotionNowMs() : Date.now();
    if (!Number.isFinite(value) || value < 0) throw g3Error('G3_PROMOTION_CLOCK_INVALID', 'Promotion clock is invalid');
    return Math.trunc(value);
}

function operationIso(context = {}) {
    const value = (context.now || (() => new Date().toISOString()))();
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw g3Error('G3_PROMOTION_CLOCK_INVALID', 'Promotion timestamp is invalid');
    }
    return value;
}

function planStore(context = {}) {
    return context.promotionPlanStore || SESSION_PLAN_STORE;
}

function cleanExpiredPlans(store, nowMs) {
    for (const [token, record] of store.entries()) {
        if (!record || record.expiresAtMs <= nowMs) store.delete(token);
    }
}

function planTtl(context = {}) {
    const value = context.promotionPlanTtlMs ?? DEFAULT_PLAN_TTL_MS;
    if (!Number.isInteger(value) || value <= 0 || value > MAX_PLAN_TTL_MS) {
        throw g3Error('G3_PROMOTION_TTL_INVALID', 'Promotion plan TTL is invalid');
    }
    return value;
}

function parseJson(buffer, code) {
    try { return JSON.parse(buffer.toString('utf8')); } catch { throw g3Error(code, 'Promotion JSON is malformed'); }
}

function sourceSnapshotKeys() {
    return ['root_fingerprint', 'shot_manifest_sha256', 'beats_sha256', 'qc_report_sha256', 'candidate_inventory_sha256'];
}

function validateSelectedTakes(value, source, code = 'G3_PROMOTION_SELECTED_TAKES_NONCANONICAL') {
    try {
        exactKeys(value, ['schema_version', 'project_id', 'episode_id', 'takes'], code);
        if (value.schema_version !== SELECTED_TAKES_SCHEMA || value.project_id !== source.projectId
            || value.episode_id !== source.episodeId || !Array.isArray(value.takes)
            || value.takes.length !== source.shotIds.length) throw g3Error(code, 'Selected takes root is invalid');
        const candidates = new Map(source.inventory.records.map((record) => [record.relativePath, record]));
        const seen = new Set();
        value.takes.forEach((take, index) => {
            exactKeys(take, [
                'shot_id', 'chosen_provider', 'video_path', 'dialogue_source', 'qc_report_ref', 'selected_at',
                'beat_id', 'take_id', 'source_in_sec', 'source_out_sec', 'transition_in',
            ], code);
            const shotId = safeId(take.shot_id, code);
            if (shotId !== source.shotIds[index] || seen.has(shotId)) throw g3Error(code, 'Selected shot coverage is invalid');
            seen.add(shotId);
            const provider = boundedText(take.chosen_provider, code, 32);
            const dialogue = boundedText(take.dialogue_source, code, 64);
            if (!['seedance', 'flow'].includes(provider)
                || !['native_video_lipsync', 'tts_adr_overlay'].includes(dialogue)) throw g3Error(code, 'Selected enum is invalid');
            const relativePath = boundedText(take.video_path, code, 1024);
            assertRelativeCandidate(relativePath);
            const candidate = candidates.get(relativePath);
            if (!candidate) throw g3Error(code, 'Selected candidate is not in the current inventory');
            if (take.qc_report_ref !== `qc_report.json#shot_qc/${shotId}`) throw g3Error(code, 'QC reference is invalid');
            const selectedAt = boundedText(take.selected_at, code, 128);
            if (!Number.isFinite(Date.parse(selectedAt))) throw g3Error(code, 'Selection time is invalid');
            const beatId = safeId(take.beat_id, code);
            const takeId = safeId(take.take_id, code, 128);
            if (!source.beat.available || !source.beat.beatIds.includes(beatId) || !takeId) {
                throw g3Error(code, 'Beat or take identity is invalid');
            }
            if (typeof take.source_in_sec !== 'number' || !Number.isFinite(take.source_in_sec) || take.source_in_sec < 0
                || typeof take.source_out_sec !== 'number' || !Number.isFinite(take.source_out_sec)
                || take.source_out_sec <= take.source_in_sec
                || (candidate.durationAuthoritative && take.source_out_sec > candidate.durationSec)) {
                throw g3Error(code, 'Selected source range is invalid');
            }
            validateTransition(take.transition_in, { partial: false });
            const qc = source.machineQc.find((record) => record.shot_id === shotId && record.provider === provider);
            if (!qc) throw g3Error(code, 'Selected provider lacks matching machine QC');
        });
        return value;
    } catch (error) {
        if (error.code === code) throw error;
        throw g3Error(code, 'Selected takes are not canonical for the current source');
    }
}

function validateExportEnvelope(value, internal, selectedTakes) {
    const code = 'G3_PROMOTION_EXPORT_NONCANONICAL';
    exactKeys(value, [
        'schema_version', 'draft_id', 'project_id', 'episode_id', 'source_snapshot', 'selected_takes',
        'human_review', 'validation', 'exported_at', 'promotion_ready',
    ], code);
    if (value.schema_version !== G3_EXPORT_SCHEMA || value.draft_id !== internal.draftId
        || value.project_id !== internal.source.projectId || value.episode_id !== internal.source.episodeId
        || value.promotion_ready !== false || value.exported_at !== internal.loaded.value.exported_at
        || !util.isDeepStrictEqual(value.selected_takes, selectedTakes)) {
        throw g3Error(code, 'Export envelope identity is invalid');
    }
    exactKeys(value.source_snapshot, sourceSnapshotKeys(), code);
    if (!util.isDeepStrictEqual(value.source_snapshot, internal.source.sourceSnapshot)) {
        throw g3Error('G3_PROMOTION_SOURCE_STALE', 'Export source snapshot is stale');
    }
    exactKeys(value.human_review, ['status', 'overall_notes', 'shots'], code);
    if (value.human_review.status !== 'draft_unpromoted' || !Array.isArray(value.human_review.shots)
        || value.human_review.shots.length !== internal.source.shotIds.length) throw g3Error(code, 'Human review envelope is invalid');
    boundedText(value.human_review.overall_notes, code, 32 * 1024, { allowEmpty: true });
    value.human_review.shots.forEach((shot, index) => {
        exactKeys(shot, ['shot_id', 'selection_reason', 'notes'], code);
        if (shot.shot_id !== internal.source.shotIds[index]) throw g3Error(code, 'Human review shot coverage is invalid');
        boundedText(shot.selection_reason, code, 8 * 1024);
        boundedText(shot.notes, code, 32 * 1024, { allowEmpty: true });
    });
    exactKeys(value.validation, [
        'valid', 'blockers', 'canonical_shape', 'canonical_beat_list_available', 'candidate_sources_revalidated',
        'duration_upper_bound_checked', 'machine_qc_contract', 'machine_qc_read_only', 'human_decision_separate',
    ], code);
    if (value.validation.valid !== true || !Array.isArray(value.validation.blockers) || value.validation.blockers.length
        || value.validation.canonical_shape !== SELECTED_TAKES_SCHEMA || value.validation.canonical_beat_list_available !== true
        || value.validation.candidate_sources_revalidated !== true || typeof value.validation.duration_upper_bound_checked !== 'boolean'
        || value.validation.machine_qc_contract !== ROOM_QC_SCHEMA || value.validation.machine_qc_read_only !== true
        || value.validation.human_decision_separate !== true) throw g3Error(code, 'Export validation evidence is incomplete');
    return value;
}

function promotionInputs(context = {}) {
    const internal = contextState(context);
    if (internal.loaded.status !== 'restored' || !internal.loaded.value?.exported_at
        || !internal.loaded.value.selected_takes_sha256 || !internal.loaded.value.g3_review_export_sha256) {
        throw g3Error('G3_PROMOTION_EXPORT_REQUIRED', 'A current strict export is required');
    }
    if (internal.validationBlockers.length) {
        throw g3Error(internal.validationBlockers[0], 'Current G3 review state is blocked');
    }
    const draftRead = readStableFile(internal.paths.draftPath, 2 * 1024 * 1024, { privateFile: true });
    const selectedRead = readStableFile(internal.paths.selectedTakesPath, 2 * 1024 * 1024, { privateFile: true });
    const exportRead = readStableFile(internal.paths.exportPath, 2 * 1024 * 1024, { privateFile: true });
    if (selectedRead.sha256 !== internal.loaded.value.selected_takes_sha256
        || exportRead.sha256 !== internal.loaded.value.g3_review_export_sha256) {
        throw g3Error('G3_PROMOTION_EXPORT_STALE', 'Export hashes no longer match the private draft');
    }
    const selectedTakes = validateSelectedTakes(parseJson(selectedRead.buffer, 'G3_PROMOTION_SELECTED_TAKES_NONCANONICAL'), internal.source);
    const envelope = validateExportEnvelope(parseJson(exportRead.buffer, 'G3_PROMOTION_EXPORT_NONCANONICAL'), internal, selectedTakes);
    const graph = inspectGraph(internal.rootInfo.root, NAMESPACES.SELECTED_TAKES, {
        codePrefix: SELECTED_GRAPH_PREFIX,
    });
    const targetPath = path.join(internal.rootInfo.root, 'selected_takes.json');
    let target;
    let targetError = '';
    try {
        target = readTarget(targetPath);
    } catch (error) {
        if (!graph.exists) throw error;
        targetError = error.code || 'G3_SELECTED_TAKES_CACHE_UNSAFE';
        target = { exists: false, sha256: '', size: 0, mode: 0, identity: null, buffer: null };
    }
    let legacySelectedTakes = null;
    if (graph.exists) {
        validateSelectedTakes(graph.payload, internal.source, 'G3_SELECTED_TAKES_GRAPH_PAYLOAD_NONCANONICAL');
    } else if (target.exists) {
        legacySelectedTakes = validateSelectedTakes(
            parseJson(target.buffer, 'G3_PROMOTION_TARGET_NONCANONICAL'),
            internal.source,
            'G3_PROMOTION_TARGET_NONCANONICAL',
        );
    }
    let cacheFresh = false;
    if (!targetError && target.exists && target.mode === 0o600) {
        try { cacheFresh = util.isDeepStrictEqual(parseJson(target.buffer, 'G3_SELECTED_TAKES_CACHE_MALFORMED'), selectedTakes); } catch { /* stale cache */ }
    }
    return {
        internal,
        draftRead,
        selectedRead,
        exportRead,
        selectedTakes,
        envelope,
        target,
        targetError,
        cacheFresh,
        legacySelectedTakes,
        graph,
    };
}

function evidence(inputs) {
    return {
        rootFingerprint: inputs.internal.source.inventory.rootFingerprint,
        draftId: inputs.internal.draftId,
        projectId: inputs.internal.source.projectId,
        episodeId: inputs.internal.source.episodeId,
        sourceSnapshot: inputs.internal.source.sourceSnapshot,
        draftSha256: inputs.draftRead.sha256,
        selectedTakesSha256: inputs.selectedRead.sha256,
        exportSha256: inputs.exportRead.sha256,
        target: inputs.target,
        targetError: inputs.targetError,
        graph: inputs.graph.exists ? {
            exists: true,
            headCommitId: inputs.graph.headCommitId,
            payloadHash: inputs.graph.payloadHash,
        } : { exists: false, headCommitId: '', payloadHash: '' },
    };
}

function sameEvidence(record, current) {
    return record.rootFingerprint === current.rootFingerprint && record.draftId === current.draftId
        && record.projectId === current.projectId && record.episodeId === current.episodeId
        && record.draftSha256 === current.draftSha256 && record.selectedTakesSha256 === current.selectedTakesSha256
        && record.exportSha256 === current.exportSha256 && util.isDeepStrictEqual(record.sourceSnapshot, current.sourceSnapshot)
        && util.isDeepStrictEqual(record.graph, current.graph)
        && (record.graph.exists || (record.targetError === current.targetError && sameTargetSnapshot(record.target, current.target)));
}

function blockedPlan(error) {
    const code = error.code || 'G3_PROMOTION_PLAN_BLOCKED';
    return {
        ok: false,
        schema_version: PLAN_SCHEMA,
        status: 'blocked',
        ready: false,
        already_current: false,
        plan_token: '',
        expires_at: '',
        project_id: '',
        episode_id: '',
        shot_count: 0,
        target_state: '확인 불가',
        selected_takes_sha256: '',
        current_target_sha256: '',
        graph_head_commit_id: '',
        graph_payload_hash: '',
        cache_fresh: false,
        safety_summary: ['승격 계획을 안전하게 만들지 못했습니다.', 'production 파일은 변경되지 않았습니다.'],
        blockers: [code],
        executed: false,
    };
}

function planG3ProductionPromotion(context = {}) {
    try {
        const inputs = promotionInputs(context);
        const nowMs = clockMs(context);
        const expiresAtMs = nowMs + planTtl(context);
        const store = planStore(context);
        cleanExpiredPlans(store, nowMs);
        const randomBytes = context.promotionRandomBytes || crypto.randomBytes;
        let token = '';
        for (let attempt = 0; attempt < 4 && !token; attempt += 1) {
            const candidate = randomBytes(32).toString('base64url');
            if (/^[A-Za-z0-9_-]{43}$/.test(candidate) && !store.has(candidate)) token = candidate;
        }
        if (!token) throw g3Error('G3_PROMOTION_TOKEN_UNAVAILABLE', 'Could not allocate an opaque plan token');
        const current = evidence(inputs);
        const alreadyCurrent = inputs.graph.exists
            ? util.isDeepStrictEqual(inputs.graph.payload, inputs.selectedTakes)
            : Boolean(inputs.legacySelectedTakes && util.isDeepStrictEqual(inputs.legacySelectedTakes, inputs.selectedTakes));
        const ready = !alreadyCurrent || !inputs.cacheFresh || !inputs.graph.exists;
        store.set(token, { ...current, expiresAtMs });
        return {
            ok: true,
            schema_version: PLAN_SCHEMA,
            status: alreadyCurrent && inputs.graph.exists && inputs.cacheFresh ? 'already_current'
                : alreadyCurrent && inputs.graph.exists ? 'cache_repair_ready'
                    : alreadyCurrent ? 'migration_ready' : 'ready',
            ready,
            already_current: alreadyCurrent,
            plan_token: token,
            expires_at: new Date(expiresAtMs).toISOString(),
            project_id: current.projectId,
            episode_id: current.episodeId,
            shot_count: inputs.selectedTakes.takes.length,
            target_state: alreadyCurrent && inputs.graph.exists && inputs.cacheFresh ? 'commit graph와 호환 cache가 이미 최신'
                : alreadyCurrent ? 'legacy 상태를 commit graph로 이관하고 cache 동기화 예정'
                    : inputs.graph.exists ? '현재 graph head에 새 선택 commit 추가 예정'
                        : inputs.target.exists ? 'legacy root import 후 새 선택 commit 추가 예정' : '새 root commit 생성 예정',
            selected_takes_sha256: current.selectedTakesSha256,
            current_target_sha256: inputs.target.sha256,
            graph_head_commit_id: current.graph.headCommitId,
            graph_payload_hash: current.graph.payloadHash,
            cache_fresh: inputs.cacheFresh,
            safety_summary: [
                '현재 source, 기계 QC, 사람 선택 초안과 내보낸 canonical 파일을 다시 검증했습니다.',
                alreadyCurrent && inputs.graph.exists
                    ? 'canonical commit graph는 이미 이 선택과 같으며 필요하면 호환 cache만 복구합니다.'
                    : '확인 시 production 소유 immutable payload/commit graph에 append합니다.',
                'selected_takes.json은 이관 뒤 재생성 가능한 mode 0600 호환 cache일 뿐입니다.',
                '생성·업로드·외부 검토·ledger 작업은 실행하지 않습니다.',
            ],
            blockers: [],
            executed: false,
        };
    } catch (error) {
        return blockedPlan(error);
    }
}

function consumePlan(payload, context = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw g3Error('G3_PROMOTION_REQUEST_INVALID', 'Promotion request is invalid');
    }
    const token = payload.planToken;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        throw g3Error('G3_PROMOTION_TOKEN_INVALID', 'Plan token is invalid');
    }
    const store = planStore(context);
    const record = store.get(token);
    store.delete(token);
    if (!record) throw g3Error('G3_PROMOTION_TOKEN_INVALID', 'Plan token is unknown or already used');
    exactKeys(payload, ['planToken', 'projectIdConfirmation', 'confirmed'], 'G3_PROMOTION_REQUEST_INVALID');
    const rawConfirmation = payload.projectIdConfirmation;
    const confirmation = safeId(rawConfirmation, 'G3_PROMOTION_CONFIRMATION_INVALID');
    if (payload.confirmed !== true) throw g3Error('G3_PROMOTION_CONFIRMATION_REQUIRED', 'Explicit confirmation is required');
    if (record.expiresAtMs <= clockMs(context)) throw g3Error('G3_PROMOTION_TOKEN_EXPIRED', 'Plan token expired');
    if (rawConfirmation !== confirmation || confirmation !== record.projectId) {
        throw g3Error('G3_PROMOTION_CONFIRMATION_MISMATCH', 'Typed project id does not match exactly');
    }
    return { token, record };
}

function safeRemovePending(filePath) {
    let stats;
    try { stats = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile() || (stats.mode & 0o777) !== 0o600) {
        throw g3Error('G3_PROMOTION_PRIVATE_TARGET_UNSAFE', 'Pending record is unsafe');
    }
    fs.unlinkSync(filePath);
}

function promoteG3ProductionSelection(payload, context = {}) {
    const consumed = consumePlan(payload, context);
    const { record, token } = consumed;
    const paths = exactPromotionPaths(context.userDataPath, record.rootFingerprint);
    ensurePromotionRoot(context.userDataPath, paths);
    const releaseLock = acquirePromotionLock(paths, sha256(token), context);
    try {
        const inputs = promotionInputs(context);
        const current = evidence(inputs);
        if (!sameEvidence(record, current)) throw g3Error('G3_PROMOTION_PLAN_STALE', 'Promotion evidence changed after planning');
        const canonicalAlreadyCurrent = inputs.graph.exists && util.isDeepStrictEqual(inputs.graph.payload, inputs.selectedTakes);
        if (canonicalAlreadyCurrent && inputs.cacheFresh) {
            return {
                ok: true,
                promoted: false,
                already_current: true,
                executed: false,
                project_id: current.projectId,
                episode_id: current.episodeId,
                selected_takes_sha256: current.selectedTakesSha256,
                graph_head_commit_id: inputs.graph.headCommitId,
                graph_payload_hash: inputs.graph.payloadHash,
                canonical_committed: false,
                cache_synchronized: false,
                receipt_written: false,
                warning: '',
                warnings: [],
            };
        }
        const promotedAt = operationIso(context);
        const pending = {
            schema_version: PENDING_SCHEMA,
            project_id: current.projectId,
            episode_id: current.episodeId,
            selected_takes_sha256: current.selectedTakesSha256,
            previous_target_sha256: current.target.sha256,
            previous_graph_head_commit_id: current.graph.headCommitId,
            planned_at: promotedAt,
            status: 'prepared_not_committed',
        };
        privateAtomicWrite(paths.pendingPath, jsonBuffer(pending), context);
        let backupWritten = false;
        if (!inputs.targetError && current.target.exists) {
            privateAtomicWrite(paths.backupPath, current.target.buffer, context);
            backupWritten = true;
        }
        const graphOptions = {
            expectedParent: null,
            codePrefix: SELECTED_GRAPH_PREFIX,
            randomBytes: context.promotionRandomBytes,
            linkSync: context.canonicalGraphLinkSync,
            beforeCommitPublish: context.canonicalGraphBeforeCommitPublish,
        };
        let graph = inputs.graph;
        let canonicalCommitted = false;
        let legacyImported = false;
        if (!graph.exists && inputs.legacySelectedTakes) {
            graph = appendValue(inputs.internal.rootInfo.root, NAMESPACES.SELECTED_TAKES, inputs.legacySelectedTakes, graphOptions);
            canonicalCommitted = graph.appended;
            legacyImported = graph.appended;
        }
        const desiredAlreadyHead = graph.exists && util.isDeepStrictEqual(graph.payload, inputs.selectedTakes);
        if (!desiredAlreadyHead) {
            graph = appendValue(inputs.internal.rootInfo.root, NAMESPACES.SELECTED_TAKES, inputs.selectedTakes, {
                ...graphOptions,
                expectedParent: graph.exists ? graph.headCommitId : null,
            });
            canonicalCommitted = canonicalCommitted || graph.appended;
        }
        const warnings = [];
        let cacheSynchronized = false;
        let cacheRecord = null;
        try {
            cacheRecord = syncCompatibilityCache(inputs.internal.rootInfo.root, 'selected_takes.json', inputs.selectedTakes, {
                codePrefix: SELECTED_CACHE_PREFIX,
                randomBytes: context.promotionRandomBytes,
                renameSync: context.promotionRenameFile,
            });
            cacheSynchronized = true;
        } catch {
            warnings.push('G3_SELECTED_TAKES_CACHE_STALE');
        }
        const receipt = {
            schema_version: RECEIPT_SCHEMA,
            project_id: current.projectId,
            episode_id: current.episodeId,
            selected_takes_sha256: current.selectedTakesSha256,
            previous_target_sha256: current.target.sha256,
            graph_head_commit_id: graph.headCommitId,
            graph_payload_hash: graph.payloadHash,
            previous_graph_head_commit_id: current.graph.headCommitId,
            legacy_imported: legacyImported,
            canonical_committed: canonicalCommitted,
            cache_synchronized: cacheSynchronized,
            cache_sha256: cacheRecord?.sha256 || '',
            target_mode: cacheRecord?.mode || 0,
            backup_written: backupWritten,
            promoted_at: promotedAt,
            executed: true,
        };
        let receiptWritten = false;
        try {
            privateAtomicWrite(paths.receiptPath, jsonBuffer(receipt), context);
            safeRemovePending(paths.pendingPath);
            receiptWritten = true;
        } catch {
            warnings.push('G3_PROMOTION_RECEIPT_WRITE_FAILED');
        }
        return {
            ok: true,
            promoted: !canonicalAlreadyCurrent,
            already_current: util.isDeepStrictEqual(graph.payload, inputs.selectedTakes),
            executed: canonicalCommitted || cacheSynchronized,
            project_id: current.projectId,
            episode_id: current.episodeId,
            selected_takes_sha256: current.selectedTakesSha256,
            graph_head_commit_id: graph.headCommitId,
            graph_payload_hash: graph.payloadHash,
            canonical_committed: canonicalCommitted,
            cache_synchronized: cacheSynchronized,
            receipt_written: receiptWritten,
            warning: warnings[0] || '',
            warnings,
        };
    } finally {
        releaseLock();
    }
}

module.exports = {
    PLAN_SCHEMA,
    RECEIPT_SCHEMA,
    PENDING_SCHEMA,
    DEFAULT_PLAN_TTL_MS,
    planG3ProductionPromotion,
    promoteG3ProductionSelection,
    validateSelectedTakes,
    promotionInputs,
};
