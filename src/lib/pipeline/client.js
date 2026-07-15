import samplePipelineState from './mockData.js';

const mockConfig = Object.freeze({
    productionRoot: samplePipelineState.project.root_path,
    productionParentRoot: '',
    recentProductionRoots: [samplePipelineState.project.root_path],
    pathProvenanceVersion: 1,
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
    copyNewProjectBuildCommand,
    selectProductionRoot,
    listProductionChildren,
    readProductionState,
    getMediaRetryPlan,
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
