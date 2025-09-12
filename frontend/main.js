const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const axios = require('axios');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const store = new Store({ encryptionKey: 'dwani-secret-key' });
const MAX_FILE_SIZE_MB = 10;
const API_URL_PDF = 'http://0.0.0.0:18889/process_pdf';
const API_URL_MESSAGE = 'http://0.0.0.0:18889/process_message';
const API_URL_HEALTH = 'http://0.0.0.0:18889/health';
const CACHE_TTL = 3600;

let mainWindow;

app.whenReady().then(() => {
  try {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    mainWindow.loadFile('index.html');

    // Enable drag-and-drop
    mainWindow.webContents.on('dragover', (event) => event.preventDefault());
    mainWindow.webContents.on('drop', (event) => {
      event.preventDefault();
      const filePath = event.dataTransfer.files[0]?.path;
      if (filePath) {
        mainWindow.webContents.send('pdf-dropped', { pdfPath: filePath });
      }
    });
  } catch (err) {
    console.error('Failed to create window:', err);
    app.quit();
  }
}).catch((err) => {
  console.error('App failed to start:', err);
  app.quit();
});

function validatePdf(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'No file selected' };
  }
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    return { valid: false, error: 'Please select a PDF file' };
  }
  try {
    const stats = fs.statSync(filePath);
    const fileSizeMb = stats.size / (1024 * 1024);
    if (fileSizeMb > MAX_FILE_SIZE_MB) {
      return { valid: false, error: `File is too large (max ${MAX_FILE_SIZE_MB}MB)` };
    }
    if (fileSizeMb === 0) {
      return { valid: false, error: 'File is empty' };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: 'Cannot access file' };
  }
}

async function processSinglePdf(filePath, sessionId) {
  const validation = validatePdf(filePath);
  if (!validation.valid) {
    return { error: validation.error };
  }

  const pdfHash = require('crypto').createHash('md5').update(filePath).digest('hex');
  const sessionData = store.get(`sessions.${sessionId}`, {});
  const cached = sessionData.cache?.[pdfHash];

  if (cached && (Date.now() / 1000 - cached.timestamp) < CACHE_TTL) {
    console.log(`Returning cached text for session ${sessionId}`);
    return { extractedText: cached.text, sessionId };
  }

  try {
    const fileContent = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append('file', new Blob([fileContent], { type: 'application/pdf' }), path.basename(filePath));
    formData.append('prompt', 'Extract all text from this PDF.');
    const response = await axios.post(API_URL_PDF, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 90000,
    });
    const extractedText = response.data.extracted_text || {};
    store.set(`sessions.${sessionId}`, {
      cache: { [pdfHash]: { text: extractedText, timestamp: Date.now() / 1000 } },
      timestamp: Date.now() / 1000,
      pdfPath: filePath,
      chatHistory: store.get(`sessions.${sessionId}.chatHistory`, []),
    });
    return { extractedText, sessionId };
  } catch (err) {
    console.error(`Failed to extract text from ${filePath}:`, err.message);
    return { error: 'Failed to process PDF. Please try again.', sessionId };
  }
}

ipcMain.handle('select-pdfs', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'PDFs', extensions: ['pdf'] }],
      buttonLabel: 'Select PDF',
      title: 'Select PDF File',
    });
    if (result.canceled) {
      return { error: 'No PDF selected' };
    }
    return { pdfPaths: result.filePaths };
  } catch (err) {
    return { error: 'Failed to open file picker' };
  }
});

ipcMain.handle('health-check', async () => {
  try {
    const response = await axios.get(API_URL_HEALTH, { timeout: 30000 });
    return response.data;
  } catch (err) {
    return { error: `API health check failed: ${err.message}` };
  }
});

ipcMain.handle('process-pdfs', async (event, { pdfPath, sessionId }) => {
  const newSessionId = sessionId || uuidv4();
  return await processSinglePdf(pdfPath, newSessionId);
});

ipcMain.handle('process-message', async (event, { prompt, extractedText, sessionId }) => {
  if (!prompt.trim()) {
    return { error: 'Please enter a question', sessionId };
  }
  if (!Object.keys(extractedText).length) {
    return { error: 'No PDF text available', sessionId };
  }
  try {
    const response = await axios.post(API_URL_MESSAGE, {
      prompt,
      extracted_text: JSON.stringify(extractedText),
    }, { timeout: 90000 });
    const chatHistory = store.get(`sessions.${sessionId}.chatHistory`, []);
    chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: response.data.response || response.data.error });
    store.set(`sessions.${sessionId}.chatHistory`, chatHistory);
    return { ...response.data, sessionId };
  } catch (err) {
    return { error: `Failed to process question: ${err.message}`, sessionId };
  }
});

ipcMain.handle('clear-session', async (event, sessionId) => {
  store.set(`sessions.${sessionId}`, { chatHistory: [] });
  return { success: true, sessionId: uuidv4() };
});

ipcMain.on('show-error', (event, title, message) => {
  dialog.showErrorBox(title, message);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});