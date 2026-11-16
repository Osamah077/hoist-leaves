'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hoist', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (d) => ipcRenderer.invoke('data:save', d),
  openDataFolder: () => ipcRenderer.invoke('data:openFolder'),
  pickImport: () => ipcRenderer.invoke('import:pick'),
  toISOMany: (arr) => ipcRenderer.invoke('util:toISOMany', arr),
  exportXlsx: (payload) => ipcRenderer.invoke('export:xlsx', payload),
  exportJson: (data) => ipcRenderer.invoke('export:json', data),
  showFile: (p) => ipcRenderer.invoke('shell:show', p)
});
