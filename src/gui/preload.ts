const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    executeScript: (scriptKey, filePaths) => ipcRenderer.invoke('execute-script', { scriptKey, filePaths }),
    onLog: (callback) => ipcRenderer.on('script-log', (_event, value) => callback(value)),
    onError: (callback) => ipcRenderer.on('script-error', (_event, value) => callback(value)),
    getPathForFile: (file) => webUtils.getPathForFile(file)
});
