const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('filmPipeline', {
    getConfig: () => ipcRenderer.invoke('film-pipeline:get-config'),
    getHarnessContractStatus: () => ipcRenderer.invoke('film-pipeline:get-harness-contract-status'),
    getNewProjectDraftState: () => ipcRenderer.invoke('film-pipeline:get-new-project-draft-state'),
    saveNewProjectDraft: (draft) => ipcRenderer.invoke('film-pipeline:save-new-project-draft', draft),
    copyNewProjectBuildCommand: () => ipcRenderer.invoke('film-pipeline:copy-new-project-build-command'),
    selectProductionRoot: (request) => ipcRenderer.invoke('film-pipeline:select-production-root', request),
    listProductionChildren: () => ipcRenderer.invoke('film-pipeline:list-production-children'),
    readProductionState: () => ipcRenderer.invoke('film-pipeline:read-production-state'),
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
    onProgress: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('film-pipeline:progress', listener);
        return () => ipcRenderer.removeListener('film-pipeline:progress', listener);
    },
});
