const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('filmPipeline', {
    getConfig: () => ipcRenderer.invoke('film-pipeline:get-config'),
    setConfig: (config) => ipcRenderer.invoke('film-pipeline:set-config', config),
    selectProductionRoot: (rootPath) => ipcRenderer.invoke('film-pipeline:select-production-root', rootPath),
    listProductionChildren: (parentPath) => ipcRenderer.invoke('film-pipeline:list-production-children', parentPath),
    readProductionState: (rootPath) => ipcRenderer.invoke('film-pipeline:read-production-state', rootPath),
    writePlanningFile: (payload) => ipcRenderer.invoke('film-pipeline:write-planning-file', payload),
    listAssets: (rootPath) => ipcRenderer.invoke('film-pipeline:list-assets', rootPath),
    readJsonl: (payload) => ipcRenderer.invoke('film-pipeline:read-jsonl', payload),
    previewCommand: (commandSpec) => ipcRenderer.invoke('film-pipeline:preview-command', commandSpec),
    copyCommandPreview: (commandSpec) => ipcRenderer.invoke('film-pipeline:copy-command-preview', commandSpec),
    runSafeCommand: (commandSpec) => ipcRenderer.invoke('film-pipeline:run-safe-command', commandSpec),
    onProgress: (callback) => {
        const listener = (_, data) => callback(data);
        ipcRenderer.on('film-pipeline:progress', listener);
        return () => ipcRenderer.removeListener('film-pipeline:progress', listener);
    },
});
