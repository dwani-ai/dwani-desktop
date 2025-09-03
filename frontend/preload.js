const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runInference: (prompt, temperature, maxTokens) =>
    ipcRenderer.invoke('run-inference', { prompt, temperature, maxTokens }),
  saveConfig: (apiKey, apiEndpoint, model) =>
    ipcRenderer.invoke('save-config', { apiKey, apiEndpoint, model })
});