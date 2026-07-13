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
    onProgress,
});

export default pipelineClient;
