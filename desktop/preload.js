'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Só a tela de configuração local usa isto; o site do servidor apenas sabe que está no app.
contextBridge.exposeInMainWorld('ressoaDesktop', {
  isDesktop: true,
  getSetup: () => ipcRenderer.invoke('setup:get'),
  saveServer: (url) => ipcRenderer.invoke('setup:save', url),
});
