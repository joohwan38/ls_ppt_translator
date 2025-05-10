const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  checkOllamaStatus: () => ipcRenderer.invoke('check-ollama-status'),
  startOllamaManually: () => ipcRenderer.invoke('start-ollama-manually'),
  saveFile: (options) => ipcRenderer.invoke('save-file', options),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath)
});