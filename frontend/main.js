const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const axios = require('axios');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');

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
        nodeIntegration: false
      }
    });
    mainWindow.loadFile('index.html');
  } catch (err) {
    console.error('Failed to create window:', err);
    app.quit();
  }
}).catch(err => {
  console.error('App failed to start:', err);
  app.quit();
});

function validatePdf(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    console.error('Invalid file path:', filePath);
    return { valid: false, error: 'Invalid file path' };
  }
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    return { valid: false, error: 'Invalid file type: Must be a PDF' };
  }
  try {
    const stats = fs.statSync(filePath);
    const fileSizeMb = stats.size / (1024 * 1024);
    if (fileSizeMb > MAX_FILE_SIZE_MB) {
      return { valid: false, error: `File exceeds size limit of ${MAX_FILE_SIZE_MB}MB` };
    }
    if (fileSizeMb === 0) {
      return { valid: false, error: 'File is empty' };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Error accessing file: ${err.message}` };
  }
}

async function processSinglePdf(filePath) {
  const validation = validatePdf(filePath);
  if (!validation.valid) {
    return { error: validation.error };
  }
  try {
    const fileContent = fs.readFileSync(filePath);
    console.log(`Processing file: ${filePath}, size: ${fileContent.length} bytes`);
    const formData = new FormData();
    formData.append('file', new Blob([fileContent], { type: 'application/pdf' }), path.basename(filePath));
    formData.append('prompt', 'Extract all text from this PDF.');
    console.log('FormData prepared for /process_pdf');
    const response = await axios.post(API_URL_PDF, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 90000
    });
    console.log('API response:', response.data);
    return response.data.extracted_text || {};
  } catch (err) {
    console.error(`Failed to extract text from ${filePath}:`, err.message, err.response?.data);
    return { error: `Failed to extract text: ${err.message}${err.response?.data ? ` - ${JSON.stringify(err.response.data)}` : ''}` };
  }
}

ipcMain.handle('select-pdfs', async () => {
  try {
    console.log('Opening file picker dialog');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'PDFs', extensions: ['pdf'] }],
      buttonLabel: 'Select PDF',
      title: 'Select a PDF File',
      modal: true // Ensure dialog is modal to force focus and closure
    });
    if (result.canceled) {
      console.log('File picker cancelled by user');
      return { error: 'No PDF selected' };
    }
    console.log('Selected file:', result.filePaths[0]);
    return { pdfPath: result.filePaths[0] };
  } catch (err) {
    console.error('File picker error:', err.message);
    return { error: `File picker failed: ${err.message}` };
  }
});

ipcMain.handle('health-check', async () => {
  try {
    const response = await axios.get(API_URL_HEALTH, { timeout: 30000 });
    return response.data;
  } catch (err) {
    console.error('Health check failed:', err.message);
    return { error: `API health check failed: ${err.message}` };
  }
});

ipcMain.handle('process-pdfs', async (event, { pdfPath, sessionId }) => {
  console.log('Received pdfPath:', pdfPath);
  console.log('Type of pdfPath:', typeof pdfPath);
  if (!pdfPath || typeof pdfPath !== 'string') {
    return { error: 'No valid PDF path provided' };
  }
  const validation = validatePdf(pdfPath);
  if (!validation.valid) {
    return { error: validation.error };
  }

  const pdfHash = require('crypto').createHash('md5').update(pdfPath).digest('hex');
  const sessionData = store.get(`sessions.${sessionId}`, {});
  const cached = sessionData.cache?.[pdfHash];

  if (cached && (Date.now() / 1000 - cached.timestamp) < CACHE_TTL) {
    console.log(`Returning cached text for session ${sessionId}`);
    return { extractedText: cached.text };
  }

  const result = await processSinglePdf(pdfPath);
  if (result.error) {
    return { error: result.error };
  }

  const extractedText = result;
  store.set(`sessions.${sessionId}`, {
    cache: { [pdfHash]: { text: extractedText, timestamp: Date.now() / 1000 } },
    timestamp: Date.now() / 1000,
    pdfPath: pdfPath,
    chatHistory: store.get(`sessions.${sessionId}.chatHistory`, [])
  });

  return { extractedText };
});

ipcMain.handle('process-message', async (event, { prompt, extractedText, sessionId }) => {
  if (!prompt.trim()) {
    return { error: 'Please provide a non-empty prompt' };
  }
  if (!Object.keys(extractedText).length) {
    return { error: 'No extracted text provided' };
  }
  try {
    const response = await axios.post(API_URL_MESSAGE, {
      prompt,
      extracted_text: JSON.stringify(extractedText)
    }, { timeout: 90000 });
    const chatHistory = store.get(`sessions.${sessionId}.chatHistory`, []);
    chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: response.data.response || response.data.error });
    store.set(`sessions.${sessionId}.chatHistory`, chatHistory);
    return response.data;
  } catch (err) {
    console.error('Message processing failed:', err.message);
    return { error: `Failed to process message: ${err.message}` };
  }
});

ipcMain.handle('clear-session', async (event, sessionId) => {
  store.set(`sessions.${sessionId}`, { chatHistory: [] });
  return { success: true };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});