'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  readAsset: (relativePath) => ipcRenderer.invoke('asset:read', relativePath),
  brainInfo: () => ipcRenderer.invoke('brain:info'),
  brainStep: (drives, ms) => ipcRenderer.invoke('brain:step', drives, ms),
  brainNoise: (groups, rate) => ipcRenderer.invoke('brain:noise', groups, rate),
  onSettings: (callback) => {
    ipcRenderer.on('settings:changed', (_event, settings) => callback(settings));
  },
  zoom: (factor) => ipcRenderer.send('widget:zoom', factor),
  showMenu: () => ipcRenderer.send('widget:menu'),
  dragStart: () => ipcRenderer.send('widget:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('widget:drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('widget:drag-end'),
});
