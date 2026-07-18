import samplePipelineState from './mockData.js';

const mockConfig = Object.freeze({
    productionRoot: samplePipelineState.project.root_path,
    productionParentRoot: '',
    recentProductionRoots: [samplePipelineState.project.root_path],
    pathProvenanceVersion: 1,
    externalMediaRoots: { dst: '', flow: '', grok: '', replicate: '', bytedance: '' },
    externalMediaRootProvenanceVersion: 1,
    dryRunMode: true,
    allowSafeCommandExecution: false,
    updatedAt: null,
});

const emptyNewProjectDraft = Object.freeze({
    production_id: '',
    brief: '',
    script: '',
    route: 'both',
    aspect_ratio: '9:16',
    scene_duration: 5,
    max_scenes: 10,
});

function getBridge() {
    return globalThis.window?.filmPipeline || null;
}

function shellQuote(value) {
    const stringValue = String(value ?? '');
    if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(stringValue)) return stringValue;
    return `'${stringValue.replace(/'/g, `'\\''`)}'`;
}

function renderPreviewCommand(commandSpec = {}) {
    const command = commandSpec.command || '';
    const args = Array.isArray(commandSpec.args) ? commandSpec.args : [];
    const rendered = [command, ...args].filter(Boolean).map(shellQuote).join(' ');
    return commandSpec.cwd ? `cd ${shellQuote(commandSpec.cwd)} && ${rendered}` : rendered;
}

function unavailable(method) {
    return {
        ok: false,
        source: 'mock',
        error: 'FILM_PIPELINE_BRIDGE_UNAVAILABLE',
        method,
        executed: false,
    };
}

function unavailableG3State(method = 'getG3ReviewWorkspace') {
    return {
        ...unavailable(method),
        status: 'error',
        draft_id: '',
        project_id: '',
        episode_id: '',
        promotion_ready: false,
        label: '초안/비승격',
        shots: [],
        beats: [],
        canonical_beat_list_available: false,
        candidates: [],
        machine_qc_contract: '',
        machine_qc_read_only: true,
        machine_qc: [],
        selections: [],
        overall_notes: '',
        saved_at: '',
        exported_at: '',
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        validation_blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        authoring_ready: false,
        export_ready: false,
    };
}

export function hasFilmPipelineBridge() {
    return Boolean(getBridge());
}

export async function getConfig() {
    const bridge = getBridge();
    if (bridge) return bridge.getConfig();
    return { ...mockConfig };
}

export async function getHarnessContractStatus() {
    const bridge = getBridge();
    if (bridge) return bridge.getHarnessContractStatus();
    return {
        ...unavailable('getHarnessContractStatus'),
        readOnly: true,
        readiness: 'blocked',
        ready: false,
        reason: 'FILM_PIPELINE_BRIDGE_UNAVAILABLE',
        rootPath: '',
        entries: [],
    };
}

export async function getNewProjectDraftState() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectDraftState === 'function') return bridge.getNewProjectDraftState();
    return {
        ...unavailable('getNewProjectDraftState'),
        status: 'empty',
        draft: { ...emptyNewProjectDraft },
        savedAt: '',
        revision_sha256: '',
        collaboration: {
            status: 'empty', total_request_count: 0, ready_suggestion_count: 0,
            stale_suggestion_count: 0, applied_suggestion_count: 0,
            recent_requests: [], truncated: false, blockers: [],
        },
        readiness: 'blocked',
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        parentRoot: '',
        targetPath: '',
        harnessReady: false,
        preview: {
            ready: false,
            copyAllowed: false,
            previewOnly: true,
            executed: false,
            shellSafeCommand: '',
        },
    };
}

export async function saveNewProjectDraft(draft) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectDraft === 'function') return bridge.saveNewProjectDraft(draft);
    return { ...await getNewProjectDraftState(), ...unavailable('saveNewProjectDraft') };
}

function unavailableCinematicTemplateState(method) {
    return {
        ...unavailable(method),
        status: 'empty',
        template: {
            mode: 'basic',
            director_intent: '',
            visual_thesis: '',
            must_preserve: '',
            must_avoid: '',
        },
        savedAt: '',
        revision_sha256: '',
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
    };
}

export async function getNewProjectCinematicTemplateState() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectCinematicTemplateState === 'function') {
        return bridge.getNewProjectCinematicTemplateState();
    }
    return unavailableCinematicTemplateState('getNewProjectCinematicTemplateState');
}

export async function saveNewProjectCinematicTemplate(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectCinematicTemplate === 'function') {
        return bridge.saveNewProjectCinematicTemplate(payload);
    }
    return unavailableCinematicTemplateState('saveNewProjectCinematicTemplate');
}

export async function enqueuePlanningAgentRequest(payload) {
    const bridge = getBridge();
    if (typeof bridge?.enqueuePlanningAgentRequest === 'function') return bridge.enqueuePlanningAgentRequest(payload);
    return {
        ...unavailable('enqueuePlanningAgentRequest'),
        queued: false,
        already_queued: false,
        request_id: '',
        status: 'blocked',
        model_called: false,
        state: await getNewProjectDraftState(),
    };
}

export async function runPlanningAgentRequest(payload) {
    const bridge = getBridge();
    if (typeof bridge?.runPlanningAgentRequest === 'function') return bridge.runPlanningAgentRequest(payload);
    return {
        ...unavailable('runPlanningAgentRequest'), status: 'blocked', executed: false, model_called: false,
        state: await getNewProjectDraftState(),
    };
}

export async function decidePlanningAgentSuggestion(payload) {
    const bridge = getBridge();
    if (typeof bridge?.decidePlanningAgentSuggestion === 'function') {
        return bridge.decidePlanningAgentSuggestion(payload);
    }
    return {
        ...unavailable('decidePlanningAgentSuggestion'),
        applied: false,
        held: false,
        already_decided: false,
        receipt_recovered: false,
        status: 'blocked',
        reapply_allowed: false,
        state: await getNewProjectDraftState(),
    };
}

function unavailableDesignState(method) {
    return {
        ...unavailable(method),
        status: 'blocked',
        board: { characters: [], locations: [], scenes: [] },
        revision_sha256: '',
        planning_revision_sha256: '',
        collaboration: {
            status: 'empty', total_request_count: 0, ready_suggestion_count: 0,
            stale_suggestion_count: 0, applied_suggestion_count: 0,
            recent_requests: [], truncated: false, blockers: [],
        },
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
    };
}

export async function getNewProjectDesignState() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectDesignState === 'function') return bridge.getNewProjectDesignState();
    return unavailableDesignState('getNewProjectDesignState');
}

export async function saveNewProjectDesignBoard(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectDesignBoard === 'function') return bridge.saveNewProjectDesignBoard(payload);
    return unavailableDesignState('saveNewProjectDesignBoard');
}

export async function enqueueDesignAgentRequest(payload) {
    const bridge = getBridge();
    if (typeof bridge?.enqueueDesignAgentRequest === 'function') return bridge.enqueueDesignAgentRequest(payload);
    return {
        ...unavailableDesignState('enqueueDesignAgentRequest'), queued: false,
        already_queued: false, request_id: '', model_called: false,
    };
}

export async function runDesignAgentRequest() {
    const bridge = getBridge();
    if (typeof bridge?.runDesignAgentRequest === 'function') return bridge.runDesignAgentRequest();
    return {
        ...unavailableDesignState('runDesignAgentRequest'), executed: false, model_called: false,
        state: await getNewProjectDesignState(),
    };
}

export async function decideDesignAgentSuggestion(payload) {
    const bridge = getBridge();
    if (typeof bridge?.decideDesignAgentSuggestion === 'function') return bridge.decideDesignAgentSuggestion(payload);
    return {
        ...unavailableDesignState('decideDesignAgentSuggestion'), applied: false, held: false,
        already_decided: false, receipt_recovered: false, reapply_allowed: false,
    };
}

function unavailableImagePlanState(method) {
    return {
        ...unavailable(method), status: 'blocked', design_revision_sha256: '', revision_sha256: '',
        tasks: [], review_decisions: [], review_blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        preparation: { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false },
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'], generation_executed: false, model_called: false,
    };
}

export async function getNewProjectImagePlan() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectImagePlan === 'function') return bridge.getNewProjectImagePlan();
    return unavailableImagePlanState('getNewProjectImagePlan');
}

export async function saveNewProjectImagePlan(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectImagePlan === 'function') return bridge.saveNewProjectImagePlan(payload);
    return unavailableImagePlanState('saveNewProjectImagePlan');
}

export async function prepareNewProjectImagePlan(payload) {
    const bridge = getBridge();
    if (typeof bridge?.prepareNewProjectImagePlan === 'function') return bridge.prepareNewProjectImagePlan(payload);
    return { ...unavailableImagePlanState('prepareNewProjectImagePlan'), queued: false, task_count: 0, generation_executed: false };
}

export async function getNewProjectImageResultWorkspace() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectImageResultWorkspace === 'function') return bridge.getNewProjectImageResultWorkspace();
    return { ...unavailable('getNewProjectImageResultWorkspace'), status: 'blocked', candidates: [], blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'], generation_executed: false };
}

export async function connectNewProjectImageResult(payload) {
    const bridge = getBridge();
    if (typeof bridge?.connectNewProjectImageResult === 'function') return bridge.connectNewProjectImageResult(payload);
    return { ...unavailableImagePlanState('connectNewProjectImageResult'), connected: false, result_token: '' };
}

export async function getNewProjectImageResultPreview(payload) {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectImageResultPreview === 'function') return bridge.getNewProjectImageResultPreview(payload);
    return { ...unavailable('getNewProjectImageResultPreview'), status: 'blocked', ready: false, result_token: '', preview: null, blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'], generation_executed: false };
}

export async function saveNewProjectImageRetrySelection(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectImageRetrySelection === 'function') return bridge.saveNewProjectImageRetrySelection(payload);
    return unavailableImagePlanState('saveNewProjectImageRetrySelection');
}

export async function saveNewProjectImageReviewDecision(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectImageReviewDecision === 'function') return bridge.saveNewProjectImageReviewDecision(payload);
    return unavailableImagePlanState('saveNewProjectImageReviewDecision');
}

export async function enqueueImagePromptAgentRequest(payload) {
    const bridge = getBridge();
    if (typeof bridge?.enqueueImagePromptAgentRequest === 'function') return bridge.enqueueImagePromptAgentRequest(payload);
    return unavailableImagePlanState('enqueueImagePromptAgentRequest');
}

export async function runImagePromptAgentRequest(payload) {
    const bridge = getBridge();
    if (typeof bridge?.runImagePromptAgentRequest === 'function') return bridge.runImagePromptAgentRequest(payload);
    return unavailableImagePlanState('runImagePromptAgentRequest');
}

export async function decideImagePromptAgentSuggestion(payload) {
    const bridge = getBridge();
    if (typeof bridge?.decideImagePromptAgentSuggestion === 'function') return bridge.decideImagePromptAgentSuggestion(payload);
    return unavailableImagePlanState('decideImagePromptAgentSuggestion');
}

function unavailableVideoPlanState(method) {
    return {
        ...unavailable(method), status: 'blocked', design_revision_sha256: '', image_plan_revision_sha256: '',
        revision_sha256: '', tasks: [], review_decisions: [], review_blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        preparation: { status: 'empty', task_count: 0, task_tokens: [], executed: false, model_called: false },
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'], generation_executed: false, model_called: false,
    };
}

export async function getNewProjectVideoPlan() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectVideoPlan === 'function') return bridge.getNewProjectVideoPlan();
    return unavailableVideoPlanState('getNewProjectVideoPlan');
}

export async function saveNewProjectVideoPlan(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectVideoPlan === 'function') return bridge.saveNewProjectVideoPlan(payload);
    return unavailableVideoPlanState('saveNewProjectVideoPlan');
}

export async function prepareNewProjectVideoPlan(payload) {
    const bridge = getBridge();
    if (typeof bridge?.prepareNewProjectVideoPlan === 'function') return bridge.prepareNewProjectVideoPlan(payload);
    return { ...unavailableVideoPlanState('prepareNewProjectVideoPlan'), queued: false, task_count: 0 };
}

export async function getNewProjectVideoResultWorkspace() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectVideoResultWorkspace === 'function') return bridge.getNewProjectVideoResultWorkspace();
    return { ...unavailable('getNewProjectVideoResultWorkspace'), status: 'blocked', candidates: [], blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'], generation_executed: false };
}

export async function connectNewProjectVideoResult(payload) {
    const bridge = getBridge();
    if (typeof bridge?.connectNewProjectVideoResult === 'function') return bridge.connectNewProjectVideoResult(payload);
    return { ...unavailableVideoPlanState('connectNewProjectVideoResult'), connected: false, result_token: '' };
}

export async function getNewProjectVideoResultPreview(payload) {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectVideoResultPreview === 'function') return bridge.getNewProjectVideoResultPreview(payload);
    return { ...unavailable('getNewProjectVideoResultPreview'), status: 'blocked', loaded: false, result_token: '', blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'], generation_executed: false };
}

export async function saveNewProjectVideoRetrySelection(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectVideoRetrySelection === 'function') return bridge.saveNewProjectVideoRetrySelection(payload);
    return unavailableVideoPlanState('saveNewProjectVideoRetrySelection');
}

export async function saveNewProjectVideoReviewDecision(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectVideoReviewDecision === 'function') return bridge.saveNewProjectVideoReviewDecision(payload);
    return unavailableVideoPlanState('saveNewProjectVideoReviewDecision');
}

function unavailableClipSelectionState(method) {
    return {
        ...unavailable(method), status: 'blocked', design_revision_sha256: '',
        image_plan_revision_sha256: '', video_plan_revision_sha256: '', revision_sha256: '',
        clips: [], accepted_count: 0, total_count: 0,
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'], generation_executed: false,
    };
}

export async function getNewProjectClipSelection() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectClipSelection === 'function') return bridge.getNewProjectClipSelection();
    return unavailableClipSelectionState('getNewProjectClipSelection');
}

export async function saveNewProjectClipSelection(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectClipSelection === 'function') return bridge.saveNewProjectClipSelection(payload);
    return unavailableClipSelectionState('saveNewProjectClipSelection');
}

function unavailableFinalStitchState(method) {
    return {
        ...unavailable(method), status: 'blocked', revision: '', staged: false,
        selected_count: 0, total_duration_seconds: 0, clips: [],
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'], executed: false, rendered: false, generation_executed: false,
    };
}

export async function getNewProjectFinalStitch() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectFinalStitch === 'function') return bridge.getNewProjectFinalStitch();
    return unavailableFinalStitchState('getNewProjectFinalStitch');
}

export async function stageNewProjectFinalStitch(payload) {
    const bridge = getBridge();
    if (typeof bridge?.stageNewProjectFinalStitch === 'function') return bridge.stageNewProjectFinalStitch(payload);
    return unavailableFinalStitchState('stageNewProjectFinalStitch');
}

function unavailableFinalRenderState() {
    return {
        ok: false, status: 'blocked', can_render: false, rendered: false,
        selected_count: 0, selected_duration_seconds: 0, output_duration_seconds: 0,
        fresh_probe_verified: false, has_video: false, has_audio: false, preview_ready: false,
        executed: false, output_quality_approved: false, generation_executed: false,
        review_version: '', review_decision: 'pending', review_ready: false, human_review_recorded: false,
        legacy_production_modified: false, canonical_delivery_modified: false,
        notice: '데스크탑 앱에서 최종 편집 준비를 먼저 저장하세요.',
    };
}

export async function getNewProjectFinalRender() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectFinalRender === 'function') return bridge.getNewProjectFinalRender();
    return unavailableFinalRenderState();
}

export async function planNewProjectFinalRender() {
    const bridge = getBridge();
    if (typeof bridge?.planNewProjectFinalRender === 'function') return bridge.planNewProjectFinalRender();
    return { ...unavailableFinalRenderState(), ready: false, plan_token: '', expires_at: '' };
}

export async function executeNewProjectFinalRender(payload) {
    const bridge = getBridge();
    if (typeof bridge?.executeNewProjectFinalRender === 'function') return bridge.executeNewProjectFinalRender(payload);
    return unavailableFinalRenderState();
}

export async function getNewProjectFinalRenderPreview() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectFinalRenderPreview === 'function') return bridge.getNewProjectFinalRenderPreview();
    return { ready: false, mime_type: '', byte_length: 0, base64: '' };
}

export async function saveNewProjectFinalReviewDecision(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveNewProjectFinalReviewDecision === 'function') {
        return bridge.saveNewProjectFinalReviewDecision(payload);
    }
    return unavailableFinalRenderState();
}

export async function enqueueVideoPromptAgentRequest(payload) {
    const bridge = getBridge();
    if (typeof bridge?.enqueueVideoPromptAgentRequest === 'function') return bridge.enqueueVideoPromptAgentRequest(payload);
    return unavailableVideoPlanState('enqueueVideoPromptAgentRequest');
}

export async function runVideoPromptAgentRequest(payload) {
    const bridge = getBridge();
    if (typeof bridge?.runVideoPromptAgentRequest === 'function') return bridge.runVideoPromptAgentRequest(payload);
    return unavailableVideoPlanState('runVideoPromptAgentRequest');
}

export async function decideVideoPromptAgentSuggestion(payload) {
    const bridge = getBridge();
    if (typeof bridge?.decideVideoPromptAgentSuggestion === 'function') return bridge.decideVideoPromptAgentSuggestion(payload);
    return unavailableVideoPlanState('decideVideoPromptAgentSuggestion');
}

export async function getNewProjectExecutionState() {
    const bridge = getBridge();
    if (typeof bridge?.getNewProjectExecutionState === 'function') return bridge.getNewProjectExecutionState();
    return {
        ...unavailable('getNewProjectExecutionState'),
        status: 'blocked', status_label: '준비 필요', prepared: false,
        tasks: [], summary: { queued: 0, running: 0, succeeded: 0, failed: 0 },
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        external_call_performed: false, model_called: false, generation_executed: false,
    };
}

export async function stageNewProjectExecutionHandoff(payload) {
    const bridge = getBridge();
    if (typeof bridge?.stageNewProjectExecutionHandoff === 'function') return bridge.stageNewProjectExecutionHandoff(payload);
    return {
        ...await getNewProjectExecutionState(),
        ok: false,
        prepared: false,
        error: 'FILM_PIPELINE_BRIDGE_UNAVAILABLE',
    };
}

export async function copyNewProjectBuildCommand() {
    const bridge = getBridge();
    if (typeof bridge?.copyNewProjectBuildCommand === 'function') return bridge.copyNewProjectBuildCommand();
    return {
        ...unavailable('copyNewProjectBuildCommand'),
        copied: false,
        verified: false,
        state: await getNewProjectDraftState(),
    };
}

export async function selectProductionRoot(request) {
    const bridge = getBridge();
    if (bridge) return bridge.selectProductionRoot(request);
    return { ...unavailable('selectProductionRoot'), canceled: true, rootPath: '', config: mockConfig };
}

export async function selectExternalMediaRoot(request) {
    const bridge = getBridge();
    if (typeof bridge?.selectExternalMediaRoot === 'function') return bridge.selectExternalMediaRoot(request);
    return { ...unavailable('selectExternalMediaRoot'), canceled: true, provider: '', config: mockConfig };
}

export async function listProductionChildren() {
    const bridge = getBridge();
    if (bridge) return bridge.listProductionChildren();
    return Promise.resolve({ ok: false, source: 'mock', reason: 'mock-fallback', rootPath: '', entries: [] });
}

export async function readProductionState() {
    const bridge = getBridge();
    if (bridge) return bridge.readProductionState();
    return {
        ok: true,
        source: 'mock',
        rootPath: samplePipelineState.project.root_path,
        state: samplePipelineState,
    };
}

export async function getMediaRetryPlan() {
    const bridge = getBridge();
    if (typeof bridge?.getMediaRetryPlan === 'function') return bridge.getMediaRetryPlan();
    return {
        ...unavailable('getMediaRetryPlan'),
        schema: 'film_pipeline.media_retry_plan.v1',
        execution: 'not_run',
        status: 'blocked',
        ready: false,
        preview_ready: false,
        execution_ready: false,
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        items: [],
    };
}

export async function getDstBundleImportWorkspace() {
    const bridge = getBridge();
    if (typeof bridge?.getDstBundleImportWorkspace === 'function') return bridge.getDstBundleImportWorkspace();
    return {
        ...unavailable('getDstBundleImportWorkspace'),
        status: 'blocked',
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        candidates: [],
    };
}

export async function loadDstBundleImportPreview(payload) {
    const bridge = getBridge();
    if (typeof bridge?.loadDstBundleImportPreview === 'function') return bridge.loadDstBundleImportPreview(payload);
    return {
        ...unavailable('loadDstBundleImportPreview'),
        status: 'blocked',
        ready: false,
        candidate_token: '',
        preview: null,
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
    };
}

export async function planDstBundleImport(payload) {
    const bridge = getBridge();
    if (typeof bridge?.planDstBundleImport === 'function') return bridge.planDstBundleImport(payload);
    return {
        ...unavailable('planDstBundleImport'),
        status: 'blocked',
        ready: false,
        already_current: false,
        plan_token: '',
        retry_media_id: '',
        target_id: '',
        source_bundle_id: '',
        preview: null,
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
    };
}

export async function confirmDstBundleImport(payload) {
    const bridge = getBridge();
    if (typeof bridge?.confirmDstBundleImport === 'function') return bridge.confirmDstBundleImport(payload);
    return {
        ...unavailable('confirmDstBundleImport'),
        ok: false,
        imported: false,
        already_current: false,
        media_id: '',
        target_id: '',
    };
}

export async function getVideoResultImportWorkspace() {
    const bridge = getBridge();
    if (typeof bridge?.getVideoResultImportWorkspace === 'function') return bridge.getVideoResultImportWorkspace();
    return {
        ...unavailable('getVideoResultImportWorkspace'),
        status: 'blocked',
        ready: false,
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        candidates: [],
    };
}

export async function loadVideoResultImportPreview(payload) {
    const bridge = getBridge();
    if (typeof bridge?.loadVideoResultImportPreview === 'function') return bridge.loadVideoResultImportPreview(payload);
    return {
        ...unavailable('loadVideoResultImportPreview'),
        loaded: false,
        candidate_token: '',
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
    };
}

export async function planVideoResultImport(payload) {
    const bridge = getBridge();
    if (typeof bridge?.planVideoResultImport === 'function') return bridge.planVideoResultImport(payload);
    return {
        ...unavailable('planVideoResultImport'),
        status: 'blocked',
        ready: false,
        already_current: false,
        plan_token: '',
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
    };
}

export async function confirmVideoResultImport(payload) {
    const bridge = getBridge();
    if (typeof bridge?.confirmVideoResultImport === 'function') return bridge.confirmVideoResultImport(payload);
    return {
        ...unavailable('confirmVideoResultImport'),
        imported: false,
        already_current: false,
        copied: false,
        ledger_appended: false,
    };
}

export async function writePlanningFile(payload) {
    const bridge = getBridge();
    if (bridge) return bridge.writePlanningFile(payload);
    return unavailable('writePlanningFile');
}

export async function listAssets() {
    const bridge = getBridge();
    if (bridge) return bridge.listAssets();
    return {
        ok: true,
        source: 'mock',
        rootPath: samplePipelineState.project.root_path,
        assets: samplePipelineState.assets,
    };
}

export async function readJsonl(payload) {
    const bridge = getBridge();
    if (bridge) return bridge.readJsonl(payload);
    return { ok: true, source: 'mock', records: [], errors: [], payload };
}

export async function previewCommand(commandSpec) {
    const bridge = getBridge();
    if (bridge) return bridge.previewCommand(commandSpec);
    return {
        ok: true,
        source: 'mock',
        executed: false,
        shellSafeCommand: renderPreviewCommand(commandSpec),
        classification: {
            detectedType: commandSpec?.side_effect_type || 'non_consuming_status',
            hardBlocked: true,
            executionEnabled: false,
        },
    };
}

export async function copyCommandPreview(commandSpec) {
    const bridge = getBridge();
    if (bridge) return bridge.copyCommandPreview(commandSpec);
    return {
        ...unavailable('copyCommandPreview'),
        copied: false,
        verified: false,
        commandSpec,
    };
}

export async function runSafeCommand(commandSpec) {
    const bridge = getBridge();
    if (bridge) return bridge.runSafeCommand(commandSpec);
    return {
        ...unavailable('runSafeCommand'),
        commandSpec,
        reason: 'Browser/Vite fallback never executes pipeline commands.',
    };
}

export async function getG3ReviewWorkspace() {
    const bridge = getBridge();
    if (typeof bridge?.getG3ReviewWorkspace === 'function') return bridge.getG3ReviewWorkspace();
    return unavailableG3State();
}

export async function loadG3CandidatePreview(payload) {
    const bridge = getBridge();
    if (typeof bridge?.loadG3CandidatePreview === 'function') return bridge.loadG3CandidatePreview(payload);
    return { ...unavailable('loadG3CandidatePreview'), loaded: false, base64: '', mime_type: '' };
}

export async function saveG3ReviewDraft(payload) {
    const bridge = getBridge();
    if (typeof bridge?.saveG3ReviewDraft === 'function') return bridge.saveG3ReviewDraft(payload);
    return { ...unavailable('saveG3ReviewDraft'), saved: false, exported: false, state: unavailableG3State('saveG3ReviewDraft') };
}

export async function exportG3ReviewPacket(payload) {
    const bridge = getBridge();
    if (typeof bridge?.exportG3ReviewPacket === 'function') return bridge.exportG3ReviewPacket(payload);
    return { ...unavailable('exportG3ReviewPacket'), saved: false, exported: false, promotion_ready: false, state: unavailableG3State('exportG3ReviewPacket') };
}

export async function planG3ProductionPromotion() {
    const bridge = getBridge();
    if (typeof bridge?.planG3ProductionPromotion === 'function') return bridge.planG3ProductionPromotion();
    return {
        ...unavailable('planG3ProductionPromotion'),
        schema_version: 'film_pipeline.g3_promotion_plan.v1',
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
        safety_summary: ['Electron main bridge가 없어 승격 계획을 만들 수 없습니다.'],
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
    };
}

export async function promoteG3ProductionSelection(payload) {
    const bridge = getBridge();
    if (typeof bridge?.promoteG3ProductionSelection === 'function') return bridge.promoteG3ProductionSelection(payload);
    return {
        ...unavailable('promoteG3ProductionSelection'),
        promoted: false,
        already_current: false,
        receipt_written: false,
    };
}

function unavailableFinishingWorkspace(method = 'getFinishingWorkspace') {
    return {
        ...unavailable(method),
        schema_version: 'film_pipeline.finishing_workbench.v1',
        status: 'blocked',
        ready_to_plan: false,
        already_current: false,
        project_id: '',
        episode_id: '',
        selected_range_count: 0,
        selected_duration_seconds: 0,
        selected_takes_authority: '',
        selected_takes_commit_id: '',
        selected_takes_payload_hash: '',
        input_ready: false,
        qc_ready: false,
        harness_ready: false,
        runtime_ready: false,
        output_contract: {
            version: 'film_pipeline.finishing_workbench.v1',
            location: 'production/final/workbench_runs/<content-derived-run-id>',
            canonical_delivery_untouched: true,
        },
        tool_status: { python: '사용 불가', ffmpeg: '사용 불가', ffprobe: '사용 불가' },
        current_run: null,
        current_blockers: [],
        blockers: ['FILM_PIPELINE_BRIDGE_UNAVAILABLE'],
        output_quality_approved: false,
        quality_notice: '렌더 실행 성공 ≠ 영상 품질 승인',
    };
}

export async function getFinishingWorkspace() {
    const bridge = getBridge();
    if (typeof bridge?.getFinishingWorkspace === 'function') return bridge.getFinishingWorkspace();
    return unavailableFinishingWorkspace();
}

export async function planFinishingRun() {
    const bridge = getBridge();
    if (typeof bridge?.planFinishingRun === 'function') return bridge.planFinishingRun();
    return { ...unavailableFinishingWorkspace('planFinishingRun'), ready: false, plan_token: '', expires_at: '' };
}

export async function executeFinishingRun(payload) {
    const bridge = getBridge();
    if (typeof bridge?.executeFinishingRun === 'function') return bridge.executeFinishingRun(payload);
    return { ...unavailableFinishingWorkspace('executeFinishingRun'), payload: undefined, executed: false };
}

export function onProgress(callback) {
    const bridge = getBridge();
    if (bridge) return bridge.onProgress(callback);
    return () => {};
}

export const pipelineClient = Object.freeze({
    hasFilmPipelineBridge,
    getConfig,
    getHarnessContractStatus,
    getNewProjectDraftState,
    saveNewProjectDraft,
    getNewProjectCinematicTemplateState,
    saveNewProjectCinematicTemplate,
    enqueuePlanningAgentRequest,
    runPlanningAgentRequest,
    decidePlanningAgentSuggestion,
    getNewProjectDesignState,
    saveNewProjectDesignBoard,
    enqueueDesignAgentRequest,
    runDesignAgentRequest,
    decideDesignAgentSuggestion,
    getNewProjectImagePlan,
    saveNewProjectImagePlan,
    prepareNewProjectImagePlan,
    getNewProjectImageResultWorkspace,
    connectNewProjectImageResult,
    getNewProjectImageResultPreview,
    saveNewProjectImageReviewDecision,
    saveNewProjectImageRetrySelection,
    enqueueImagePromptAgentRequest,
    runImagePromptAgentRequest,
    decideImagePromptAgentSuggestion,
    getNewProjectVideoPlan,
    saveNewProjectVideoPlan,
    prepareNewProjectVideoPlan,
    getNewProjectVideoResultWorkspace,
    connectNewProjectVideoResult,
    getNewProjectVideoResultPreview,
    saveNewProjectVideoReviewDecision,
    saveNewProjectVideoRetrySelection,
    getNewProjectClipSelection,
    saveNewProjectClipSelection,
    getNewProjectFinalStitch,
    stageNewProjectFinalStitch,
    getNewProjectFinalRender,
    planNewProjectFinalRender,
    executeNewProjectFinalRender,
    getNewProjectFinalRenderPreview,
    saveNewProjectFinalReviewDecision,
    enqueueVideoPromptAgentRequest,
    runVideoPromptAgentRequest,
    decideVideoPromptAgentSuggestion,
    getNewProjectExecutionState,
    stageNewProjectExecutionHandoff,
    copyNewProjectBuildCommand,
    selectProductionRoot,
    selectExternalMediaRoot,
    listProductionChildren,
    readProductionState,
    getMediaRetryPlan,
    getDstBundleImportWorkspace,
    loadDstBundleImportPreview,
    planDstBundleImport,
    confirmDstBundleImport,
    getVideoResultImportWorkspace,
    loadVideoResultImportPreview,
    planVideoResultImport,
    confirmVideoResultImport,
    writePlanningFile,
    listAssets,
    readJsonl,
    previewCommand,
    copyCommandPreview,
    runSafeCommand,
    getG3ReviewWorkspace,
    loadG3CandidatePreview,
    saveG3ReviewDraft,
    exportG3ReviewPacket,
    planG3ProductionPromotion,
    promoteG3ProductionSelection,
    getFinishingWorkspace,
    planFinishingRun,
    executeFinishingRun,
    onProgress,
});

export default pipelineClient;
