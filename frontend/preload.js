const { contextBridge, ipcRenderer } = require('electron');
const { webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  healthCheck: () => ipcRenderer.invoke('health-check'),
  selectPdfs: () => ipcRenderer.invoke('select-pdfs'),
  processPdfs: (pdfPath, sessionId) => ipcRenderer.invoke('process-pdfs', { pdfPath, sessionId }),
  processMessage: (prompt, extractedText, sessionId) => ipcRenderer.invoke('process-message', { prompt, extractedText, sessionId }),
  clearSession: (sessionId) => ipcRenderer.invoke('clear-session', sessionId),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),
  webUtils: {
    getPathForFile: webUtils.getPathForFile, // Expose for path extraction in renderer
  },
});