const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readProductionFolder } = require('./productionReader');
const {
    APPROVED_CANDIDATE_PREFIXES,
    BEATS_SCHEMA,
    G3_DRAFT_SCHEMA,
    G3_EXPORT_SCHEMA,
    MAX_SHOTS,
    ROOM_QC_SCHEMA,
    SELECTED_TAKES_SCHEMA,
    SHOT_MANIFEST_SCHEMA,
    emptySelection,
    g3Error,
    jsonBuffer,
    safeId,
    sha256,
    validateSelectionPayload,
} = require('./g3ReviewContract');
const {
    assertMainOwnedRoot,
    inventoryFromReader,
    loadCandidatePreview,
    revalidateCandidate,
    safeJson,
    sourceHash,
} = require('./g3ReviewCandidateStore');
const {
    atomicWrite,
    draftDocument,
    ensureDraftRoot,
    exactDraftPaths,
    loadDraft,
} = require('./g3ReviewDraftStore');

function beatContract(root, projectId, episodeId) {
    const beatPath = path.join(root, 'beats.json');
    if (!fs.existsSync(beatPath)) return { available: false, beatIds: [], sha256: '', blocker: '' };
    try {
        const source = safeJson(beatPath);
        const value = source.value;
        if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema_version !== BEATS_SCHEMA
            || value.project_id !== projectId || value.episode_id !== episodeId || !Array.isArray(value.beats)
            || value.beats.length === 0 || value.beats.length > MAX_SHOTS) {
            throw g3Error('G3_BEAT_MANIFEST_INVALID', 'Beat manifest contract is invalid');
        }
        const beatIds = value.beats.map((beat) => safeId(beat?.beat_id, 'G3_BEAT_MANIFEST_INVALID'));
        if (new Set(beatIds).size !== beatIds.length) throw g3Error('G3_BEAT_MANIFEST_INVALID', 'Beat ids are duplicated');
        return { available: true, beatIds, sha256: source.sha256, blocker: '' };
    } catch {
        return { available: false, beatIds: [], sha256: '', blocker: 'G3_BEAT_MANIFEST_INVALID' };
    }
}

function sourceContract(rootInfo, context = {}) {
    const readProductionFolderFn = context.readProductionFolderFn || readProductionFolder;
    const reader = readProductionFolderFn(rootInfo.root);
    const blockers = [];
    const shotManifest = reader?.parsed?.shotManifest;
    const shotReady = shotManifest?.parsed === true && (shotManifest.issues || []).length === 0
        && shotManifest.value?.schema_version === SHOT_MANIFEST_SCHEMA;
    if (!shotReady) blockers.push('G3_SHOT_MANIFEST_REQUIRED');
    const projectId = shotReady ? shotManifest.value.project_id : '';
    const episodeId = shotReady ? shotManifest.value.episode_id : '';
    const shotIds = shotReady ? shotManifest.records.map((record) => record.shot_id).filter(Boolean) : [];
    if (!shotIds.length || new Set(shotIds).size !== shotIds.length) blockers.push('G3_SHOT_MANIFEST_REQUIRED');

    const beat = shotReady ? beatContract(rootInfo.root, projectId, episodeId)
        : { available: false, beatIds: [], sha256: '', blocker: '' };
    if (beat.blocker) blockers.push(beat.blocker);
    const qc = reader?.parsed?.qcReport;
    const qcIds = (qc?.records || []).map((record) => record.shot_id).filter(Boolean);
    const qcCoverageReady = shotIds.length > 0 && qcIds.length === shotIds.length
        && new Set(qcIds).size === qcIds.length && shotIds.every((shotId) => qcIds.includes(shotId))
        && (qc?.records || []).every((record) => record.record_ready === true);
    const qcReady = qc?.parsed === true && (qc.issues || []).length === 0 && qcCoverageReady
        && qc.value?.schema_version === ROOM_QC_SCHEMA && qc.value.project_id === projectId && qc.value.episode_id === episodeId;
    if (!qcReady) blockers.push(qc?.exists ? 'G3_MACHINE_QC_NONCANONICAL' : 'G3_MACHINE_QC_REQUIRED');
    const machineQc = qcReady ? qc.records.map((record) => ({
        shot_id: record.shot_id,
        provider: record.provider,
        deterministic_checks_passed: record.deterministic_checks_passed,
        dialogue_intelligibility_score: record.dialogue_intelligibility_score,
        pronunciation_risk_flag: record.pronunciation_risk_flag,
        decision: record.decision,
        external_review_state: record.external_review_state,
        external_finding_count: record.external_finding_count,
    })) : [];
    const inventory = inventoryFromReader(rootInfo, reader, context);
    blockers.push(...inventory.blockers);
    const sourceSnapshot = {
        root_fingerprint: inventory.rootFingerprint,
        shot_manifest_sha256: '',
        beats_sha256: beat.sha256,
        qc_report_sha256: '',
        candidate_inventory_sha256: inventory.inventoryHash,
    };
    try {
        if (shotReady) sourceSnapshot.shot_manifest_sha256 = sourceHash(rootInfo.root, 'shot_manifest.json');
        if (qcReady) sourceSnapshot.qc_report_sha256 = sourceHash(rootInfo.root, 'qc_report.json');
    } catch {
        blockers.push('G3_SOURCE_CHANGED');
    }
    if (shotReady && !sourceSnapshot.shot_manifest_sha256) blockers.push('G3_SHOT_MANIFEST_REQUIRED');
    if (qcReady && !sourceSnapshot.qc_report_sha256) blockers.push('G3_MACHINE_QC_REQUIRED');
    return {
        projectId,
        episodeId,
        shotIds,
        beat,
        qcReady,
        machineQc,
        inventory,
        sourceSnapshot,
        blockers: Array.from(new Set(blockers)),
    };
}

function stateSelections(source, loaded) {
    const blockers = [];
    const storedByShot = new Map((loaded?.value?.selections || []).map((selection) => [selection.shot_id, selection]));
    const candidatesByEvidence = new Map(source.inventory.records
        .map((candidate) => [`${candidate.relativePath}\0${candidate.sha256}`, candidate]));
    const selections = source.shotIds.map((shotId) => {
        const stored = storedByShot.get(shotId);
        if (!stored) return emptySelection(shotId);
        const candidate = stored.candidate_relative_path
            ? candidatesByEvidence.get(`${stored.candidate_relative_path}\0${stored.candidate_sha256}`)
            : null;
        if (stored.candidate_relative_path && !candidate) blockers.push('G3_DRAFT_CANDIDATE_CHANGED');
        return {
            shot_id: shotId,
            candidate_token: candidate?.token || '',
            chosen_provider: stored.chosen_provider || '',
            dialogue_source: stored.dialogue_source || '',
            beat_id: stored.beat_id || '',
            take_id: stored.take_id || '',
            source_in_sec: typeof stored.source_in_sec === 'number' ? stored.source_in_sec : 0,
            source_out_sec: typeof stored.source_out_sec === 'number' ? stored.source_out_sec : null,
            transition_in: stored.transition_in || null,
            selection_reason: stored.selection_reason || '',
            notes: stored.notes || '',
        };
    });
    if (loaded.value && Object.entries(loaded.value.source_snapshot)
        .some(([key, value]) => value !== source.sourceSnapshot[key])) blockers.push('G3_DRAFT_SOURCE_CHANGED');
    return { selections, blockers };
}

function reviewBlockers(source, selections) {
    const blockers = [...source.blockers];
    if (!selections.length || selections.some((selection) => !selection.candidate_token || !selection.chosen_provider
        || !selection.dialogue_source || !selection.beat_id || !selection.take_id || selection.source_out_sec === null
        || !selection.selection_reason)) blockers.push('G3_SELECTION_INCOMPLETE');
    for (const selection of selections) {
        if (source.beat.available && selection.beat_id && !source.beat.beatIds.includes(selection.beat_id)) blockers.push('G3_BEAT_ID_INVALID');
        const candidate = source.inventory.records.find((record) => record.token === selection.candidate_token);
        if (candidate?.durationAuthoritative && typeof selection.source_out_sec === 'number'
            && selection.source_out_sec > candidate.durationSec) blockers.push('G3_RANGE_EXCEEDS_DURATION');
        const qc = source.machineQc.find((record) => record.shot_id === selection.shot_id && record.provider === selection.chosen_provider);
        if (selection.chosen_provider && !qc) blockers.push('G3_MACHINE_QC_PROVIDER_MISMATCH');
    }
    return Array.from(new Set(blockers));
}

function contextState(context = {}) {
    const rootInfo = assertMainOwnedRoot(context.config);
    const source = sourceContract(rootInfo, context);
    const paths = exactDraftPaths(context.userDataPath, source.inventory.rootFingerprint);
    const loaded = loadDraft(context.userDataPath, paths, source);
    const mapped = stateSelections(source, loaded);
    const draftId = loaded.value?.draft_id || `g3_${crypto.createHmac('sha256', context.tokenSecret || Buffer.alloc(32))
        .update(`${source.inventory.rootFingerprint}\0${source.sourceSnapshot.shot_manifest_sha256}`)
        .digest('hex').slice(0, 32)}`;
    const blockers = Array.from(new Set([
        ...source.blockers,
        ...(loaded.blocker ? [loaded.blocker] : []),
        ...mapped.blockers,
    ]));
    const validationBlockers = Array.from(new Set([...blockers, ...reviewBlockers(source, mapped.selections)]));
    return { rootInfo, source, paths, loaded, mapped, draftId, blockers, validationBlockers };
}

function publicState(internal) {
    const { source, loaded, mapped, draftId, blockers, validationBlockers } = internal;
    return {
        ok: loaded.status !== 'error',
        status: loaded.status,
        draft_id: draftId,
        project_id: source.projectId,
        episode_id: source.episodeId,
        promotion_ready: false,
        label: '초안/비승격',
        shots: source.shotIds.map((shotId) => ({ shot_id: shotId })),
        beats: source.beat.beatIds.map((beatId) => ({ beat_id: beatId })),
        canonical_beat_list_available: source.beat.available,
        candidates: source.inventory.records.map((candidate) => ({
            candidate_token: candidate.token,
            display_path: candidate.relativePath,
            file_name: candidate.fileName,
            size_bytes: candidate.sizeBytes,
            sha256: candidate.sha256,
            duration_sec: candidate.durationSec,
            duration_authoritative: candidate.durationAuthoritative,
            preview_allowed: candidate.previewAllowed,
        })),
        machine_qc_contract: source.qcReady ? ROOM_QC_SCHEMA : '',
        machine_qc_read_only: true,
        machine_qc: source.machineQc,
        selections: mapped.selections,
        overall_notes: loaded.value?.overall_notes || '',
        saved_at: loaded.value?.saved_at || '',
        exported_at: loaded.value?.exported_at || '',
        blockers,
        validation_blockers: validationBlockers,
        authoring_ready: source.shotIds.length > 0 && source.inventory.records.length > 0,
        export_ready: validationBlockers.length === 0,
        executed: false,
    };
}

function getG3ReviewWorkspace(context = {}) {
    try { return publicState(contextState(context)); } catch (error) {
        const code = error.code || 'G3_WORKSPACE_UNAVAILABLE';
        return {
            ok: false, status: 'error', draft_id: '', project_id: '', episode_id: '', promotion_ready: false,
            label: '초안/비승격', shots: [], beats: [], canonical_beat_list_available: false, candidates: [],
            machine_qc_contract: '', machine_qc_read_only: true, machine_qc: [], selections: [], overall_notes: '',
            saved_at: '', exported_at: '', blockers: [code], validation_blockers: [code], authoring_ready: false,
            export_ready: false, executed: false,
        };
    }
}

function candidateMap(source) {
    return new Map(source.inventory.records.map((candidate) => [candidate.token, candidate]));
}

function saveG3ReviewDraft(payload, context = {}) {
    const internal = contextState(context);
    if (!internal.source.shotIds.length) throw g3Error('G3_SHOT_MANIFEST_REQUIRED', 'Shot manifest is required');
    const normalized = validateSelectionPayload(payload, internal.source, { partial: true });
    if (normalized.draftId !== internal.draftId) throw g3Error('G3_DRAFT_STALE', 'Draft id is stale');
    const candidates = candidateMap(internal.source);
    for (const selection of normalized.selections) {
        if (selection.candidate_token && !candidates.has(selection.candidate_token)) {
            throw g3Error('G3_CANDIDATE_TOKEN_INVALID', 'Candidate token is stale');
        }
    }
    ensureDraftRoot(context.userDataPath, internal.paths);
    const now = (context.now || (() => new Date().toISOString()))();
    atomicWrite(internal.paths.draftPath, jsonBuffer(draftDocument(internal.source, normalized, candidates, now)), context);
    return { ok: true, saved: true, exported: false, promotion_ready: false, executed: false, state: getG3ReviewWorkspace(context) };
}

function exportG3ReviewPacket(payload, context = {}) {
    const internal = contextState(context);
    const normalized = validateSelectionPayload(payload, internal.source, { partial: false });
    if (normalized.draftId !== internal.draftId) throw g3Error('G3_DRAFT_STALE', 'Draft id is stale');
    if (internal.source.blockers.length) throw g3Error(internal.source.blockers[0], 'Source contract is blocked');
    if (!internal.source.qcReady) throw g3Error('G3_MACHINE_QC_REQUIRED', 'Canonical room QC is required');
    const candidates = candidateMap(internal.source);
    const now = (context.now || (() => new Date().toISOString()))();
    const takes = normalized.selections.map((selection) => {
        const candidate = candidates.get(selection.candidate_token);
        if (!candidate) throw g3Error('G3_CANDIDATE_TOKEN_INVALID', 'Candidate token is stale');
        revalidateCandidate(internal.rootInfo, candidate);
        if (candidate.durationAuthoritative && selection.source_out_sec > candidate.durationSec) {
            throw g3Error('G3_RANGE_EXCEEDS_DURATION', 'Source range exceeds authoritative duration');
        }
        const qc = internal.source.machineQc.find((record) => record.shot_id === selection.shot_id
            && record.provider === selection.chosen_provider);
        if (!qc) throw g3Error('G3_MACHINE_QC_PROVIDER_MISMATCH', 'Machine QC provider does not match human selection');
        return {
            shot_id: selection.shot_id,
            chosen_provider: selection.chosen_provider,
            video_path: candidate.relativePath,
            dialogue_source: selection.dialogue_source,
            qc_report_ref: `qc_report.json#shot_qc/${selection.shot_id}`,
            selected_at: now,
            beat_id: selection.beat_id,
            take_id: selection.take_id,
            source_in_sec: selection.source_in_sec,
            source_out_sec: selection.source_out_sec,
            transition_in: selection.transition_in,
        };
    });
    const selectedTakes = {
        schema_version: SELECTED_TAKES_SCHEMA,
        project_id: internal.source.projectId,
        episode_id: internal.source.episodeId,
        takes,
    };
    const envelope = {
        schema_version: G3_EXPORT_SCHEMA,
        draft_id: normalized.draftId,
        project_id: internal.source.projectId,
        episode_id: internal.source.episodeId,
        source_snapshot: internal.source.sourceSnapshot,
        selected_takes: selectedTakes,
        human_review: {
            status: 'draft_unpromoted',
            overall_notes: normalized.overallNotes,
            shots: normalized.selections.map((selection) => ({
                shot_id: selection.shot_id,
                selection_reason: selection.selection_reason,
                notes: selection.notes,
            })),
        },
        validation: {
            valid: true,
            blockers: [],
            canonical_shape: SELECTED_TAKES_SCHEMA,
            canonical_beat_list_available: internal.source.beat.available,
            candidate_sources_revalidated: true,
            duration_upper_bound_checked: takes.every((take, index) => {
                const candidate = candidates.get(normalized.selections[index].candidate_token);
                return candidate.durationAuthoritative && take.source_out_sec <= candidate.durationSec;
            }),
            machine_qc_contract: ROOM_QC_SCHEMA,
            machine_qc_read_only: true,
            human_decision_separate: true,
        },
        exported_at: now,
        promotion_ready: false,
    };
    const selectedBuffer = jsonBuffer(selectedTakes);
    const exportBuffer = jsonBuffer(envelope);
    ensureDraftRoot(context.userDataPath, internal.paths);
    atomicWrite(internal.paths.selectedTakesPath, selectedBuffer, context);
    atomicWrite(internal.paths.exportPath, exportBuffer, context);
    atomicWrite(internal.paths.draftPath, jsonBuffer(draftDocument(internal.source, normalized, candidates, now, {
        exportedAt: now,
        selectedTakesSha256: sha256(selectedBuffer),
        exportSha256: sha256(exportBuffer),
    })), context);
    return {
        ok: true, saved: true, exported: true, promotion_ready: false, executed: false,
        selected_takes_sha256: sha256(selectedBuffer), export_sha256: sha256(exportBuffer),
        state: getG3ReviewWorkspace(context),
    };
}

function loadG3CandidatePreview(payload, context = {}) {
    const internal = contextState(context);
    return loadCandidatePreview(payload, internal.rootInfo, internal.source.inventory);
}

module.exports = {
    G3_DRAFT_SCHEMA,
    G3_EXPORT_SCHEMA,
    SELECTED_TAKES_SCHEMA,
    ROOM_QC_SCHEMA,
    APPROVED_CANDIDATE_PREFIXES,
    exactDraftPaths,
    getG3ReviewWorkspace,
    saveG3ReviewDraft,
    exportG3ReviewPacket,
    loadG3CandidatePreview,
};
