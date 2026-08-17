const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  save: (databaseUrl) => ipcRenderer.invoke('setup:save', databaseUrl),
});
