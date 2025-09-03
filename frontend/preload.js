const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  healthCheck: () => ipcRenderer.invoke('health-check'),
  processPdfs: (pdfPaths, sessionId) => ipcRenderer.invoke('process-pdfs', { pdfPaths, sessionId }),
  processMessage: (prompt, extractedText, sessionId) => ipcRenderer.invoke('process-message', { prompt, extractedText, sessionId }),
  clearSession: (sessionId) => ipcRenderer.invoke('clear-session', sessionId)
});