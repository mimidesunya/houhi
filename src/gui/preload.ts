const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    executeScript: (scriptKey, filePaths, options) => ipcRenderer.invoke('execute-script', { scriptKey, filePaths, options }),
    openConfigSettings: () => ipcRenderer.invoke('open-config-settings'),
    openDraftingKitFolder: () => ipcRenderer.invoke('open-drafting-kit-folder'),
    getConfigForEditor: () => ipcRenderer.invoke('config:get'),
    saveConfigFromEditor: (config) => ipcRenderer.invoke('config:save', config),
    onLog: (callback) => ipcRenderer.on('script-log', (_event, value) => callback(value)),
    onError: (callback) => ipcRenderer.on('script-error', (_event, value) => callback(value)),
    getPathForFile: (file) => webUtils.getPathForFile(file)
});
