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

export function hasFilmPipelineBridge() {
    return Boolean(getBridge());
}

export async function getConfig() {
    const bridge = getBridge();
    if (bridge) return bridge.getConfig();
    return { ...mockConfig };
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

export function onProgress(callback) {
    const bridge = getBridge();
    if (bridge) return bridge.onProgress(callback);
    return () => {};
}

export const pipelineClient = Object.freeze({
    hasFilmPipelineBridge,
    getConfig,
    selectProductionRoot,
    listProductionChildren,
    readProductionState,
    writePlanningFile,
    listAssets,
    readJsonl,
    previewCommand,
    copyCommandPreview,
    runSafeCommand,
    onProgress,
});

export default pipelineClient;
