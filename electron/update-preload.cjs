/**
 * 更新进度窗口 preload：桥接主进程下载事件与页面 UI
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateApi', {
  onReset: (callback) => ipcRenderer.on('update:reset', () => callback()),
  onProgress: (callback) => ipcRenderer.on('update:progress', (_event, progress) => callback(progress)),
  onReady: (callback) => ipcRenderer.on('update:ready', (_event, info) => callback(info)),
  onError: (callback) => ipcRenderer.on('update:error', (_event, message) => callback(message)),
  installNow: () => ipcRenderer.send('update:install'),
  retry: () => ipcRenderer.send('update:retry'),
  close: () => ipcRenderer.send('update:close'),
});
