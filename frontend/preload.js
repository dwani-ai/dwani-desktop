const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runInference: (prompt) => ipcRenderer.invoke('run-inference', prompt),
  onInferenceResult: (callback) => ipcRenderer.on('inference-result', (event, result) => callback(result))
});