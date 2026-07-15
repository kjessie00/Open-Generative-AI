const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('filmPipeline', {
    getConfig: () => ipcRenderer.invoke('film-pipeline:get-config'),
    getHarnessContractStatus: () => ipcRenderer.invoke('film-pipeline:get-harness-contract-status'),
    getNewProjectDraftState: () => ipcRenderer.invoke('film-pipeline:get-new-project-draft-state'),
    saveNewProjectDraft: (draft) => ipcRenderer.invoke('film-pipeline:save-new-project-draft', draft),
    enqueuePlanningAgentRequest: (payload) => ipcRenderer.invoke('film-pipeline:enqueue-planning-agent-request', payload),
    decidePlanningAgentSuggestion: (payload) => ipcRenderer.invoke('film-pipeline:decide-planning-agent-suggestion', payload),
    copyNewProjectBuildCommand: () => ipcRenderer.invoke('film-pipeline:copy-new-project-build-command'),
    selectProductionRoot: (request) => ipcRenderer.invoke('film-pipeline:select-production-root', request),
    listProductionChildren: () => ipcRenderer.invoke('film-pipeline:list-production-children'),
    readProductionState: () => ipcRenderer.invoke('film-pipeline:read-production-state'),
    getMediaRetryPlan: () => ipcRenderer.invoke('film-pipeline:get-media-retry-plan'),
    getDstBundleImportWorkspace: () => ipcRenderer.invoke('film-pipeline:get-dst-bundle-import-workspace'),
    loadDstBundleImportPreview: (payload) => ipcRenderer.invoke('film-pipeline:load-dst-bundle-import-preview', payload),
    planDstBundleImport: (payload) => ipcRenderer.invoke('film-pipeline:plan-dst-bundle-import', payload),
    confirmDstBundleImport: (payload) => ipcRenderer.invoke('film-pipeline:confirm-dst-bundle-import', payload),
    getVideoResultImportWorkspace: () => ipcRenderer.invoke('film-pipeline:get-video-result-import-workspace'),
    loadVideoResultImportPreview: (payload) => ipcRenderer.invoke('film-pipeline:load-video-result-import-preview', payload),
    planVideoResultImport: (payload) => ipcRenderer.invoke('film-pipeline:plan-video-result-import', payload),
    confirmVideoResultImport: (payload) => ipcRenderer.invoke('film-pipeline:confirm-video-result-import', payload),
    writePlanningFile: (payload) => ipcRenderer.invoke('film-pipeline:write-planning-file', payload),
    listAssets: () => ipcRenderer.invoke('film-pipeline:list-assets'),
    readJsonl: (payload) => ipcRenderer.invoke('film-pipeline:read-jsonl', payload),
    previewCommand: (commandSpec) => ipcRenderer.invoke('film-pipeline:preview-command', commandSpec),
    copyCommandPreview: (commandSpec) => ipcRenderer.invoke('film-pipeline:copy-command-preview', commandSpec),
    runSafeCommand: (commandSpec) => ipcRenderer.invoke('film-pipeline:run-safe-command', commandSpec),
    getG3ReviewWorkspace: () => ipcRenderer.invoke('film-pipeline:get-g3-review-workspace'),
    loadG3CandidatePreview: (payload) => ipcRenderer.invoke('film-pipeline:load-g3-candidate-preview', payload),
    saveG3ReviewDraft: (payload) => ipcRenderer.invoke('film-pipeline:save-g3-review-draft', payload),
    exportG3ReviewPacket: (payload) => ipcRenderer.invoke('film-pipeline:export-g3-review-packet', payload),
    planG3ProductionPromotion: () => ipcRenderer.invoke('film-pipeline:plan-g3-production-promotion'),
    promoteG3ProductionSelection: (payload) => ipcRenderer.invoke('film-pipeline:promote-g3-production-selection', payload),
    getFinishingWorkspace: () => ipcRenderer.invoke('film-pipeline:get-finishing-workspace'),
    planFinishingRun: () => ipcRenderer.invoke('film-pipeline:plan-finishing-run'),
    executeFinishingRun: (payload) => ipcRenderer.invoke('film-pipeline:execute-finishing-run', payload),
    onProgress: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('film-pipeline:progress', listener);
        return () => ipcRenderer.removeListener('film-pipeline:progress', listener);
    },
});
