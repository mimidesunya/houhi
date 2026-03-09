const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('consoleAPI', {
    onLog: (callback) => ipcRenderer.on('console-log', (_event, value) => callback(value)),
    onInfo: (callback) => ipcRenderer.on('console-info', (_event, value) => callback(value)),
    onSuccess: (callback) => ipcRenderer.on('console-success', (_event, value) => callback(value)),
    onError: (callback) => ipcRenderer.on('console-error', (_event, value) => callback(value)),
    onWarning: (callback) => ipcRenderer.on('console-warning', (_event, value) => callback(value)),
    onCommand: (callback) => ipcRenderer.on('console-command', (_event, value) => callback(value)),
    onComplete: (callback) => ipcRenderer.on('console-complete', (_event, success) => callback(success)),
    onTaskInfo: (callback) => ipcRenderer.on('console-task-info', (_event, info) => callback(info))
});
