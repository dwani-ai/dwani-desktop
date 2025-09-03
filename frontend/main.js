const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const axios = require('axios');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');

const store = new Store({ encryptionKey: 'dwani-secret-key' });
const MAX_FILE_SIZE_MB = 10; // 10MB limit
const MAX_CONCURRENT_PDFS = 5;
const CACHE_TTL = 3600; // 1 hour in seconds
const API_URL_PDF = 'http://0.0.0.0:18889/process_pdf';
const API_URL_MESSAGE = 'http://0.0.0.0:18889/process_message';
const API_URL_HEALTH = 'http://0.0.0.0:18889/health';

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

// Validate PDF file
function validatePdf(filePath) {
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    return { valid: false, error: 'Invalid file type: Must be a PDF' };
  }
  try {
    const stats = fs.statSync(filePath);
    const fileSizeMb = stats.size / (1024 * 1024);
    if (fileSizeMb > MAX_FILE_SIZE_MB) {
      return { valid: false, error: `File exceeds size limit of ${MAX_FILE_SIZE_MB}MB` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: `Error accessing file: ${err.message}` };
  }
}

// Process single PDF
async function processSinglePdf(filePath) {
  const validation = validatePdf(filePath);
  if (!validation.valid) {
    return { error: validation.error };
  }
  try {
    const fileContent = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append('file', new Blob([fileContent]), path.basename(filePath));
    formData.append('prompt', 'Extract all text from this PDF.');
    const response = await axios.post(API_URL_PDF, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 90000
    });
    return response.data.extracted_text || {};
  } catch (err) {
    return { error: `Failed to extract text: ${err.message}` };
  }
}

// IPC Handlers
ipcMain.handle('health-check', async () => {
  try {
    const response = await axios.get(API_URL_HEALTH, { timeout: 30000 });
    return response.data;
  } catch (err) {
    return { error: `API health check failed: ${err.message}` };
  }
});

ipcMain.handle('process-pdfs', async (event, { pdfPaths, sessionId }) => {
  const validPaths = pdfPaths.filter(path => validatePdf(path).valid);
  if (!validPaths.length) {
    return { error: 'No valid PDFs provided' };
  }

  // Generate cache key
  const pdfHash = require('crypto').createHash('md5').update(validPaths.sort().join('')).digest('hex');
  const sessionData = store.get(`sessions.${sessionId}`, {});
  const cached = sessionData.cache?.[pdfHash];

  // Check cache
  if (cached && (Date.now() / 1000 - cached.timestamp) < CACHE_TTL) {
    return { extractedText: cached.text };
  }

  // Process PDFs concurrently
  const chunkSize = MAX_CONCURRENT_PDFS;
  const results = [];
  for (let i = 0; i < validPaths.length; i += chunkSize) {
    const chunk = validPaths.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(processSinglePdf));
    results.push(...chunkResults);
  }

  const extractedText = {};
  const errors = [];
  results.forEach((result, index) => {
    if (result.error) {
      errors.push(`Error in ${validPaths[index]}: ${result.error}`);
    } else {
      Object.assign(extractedText, result);
    }
  });

  // Update cache
  store.set(`sessions.${sessionId}`, {
    cache: { [pdfHash]: { text: extractedText, timestamp: Date.now() / 1000 } },
    timestamp: Date.now() / 1000,
    pdfPaths: validPaths
  });

  return { extractedText, errors: errors.length ? errors : null };
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
    return response.data;
  } catch (err) {
    return { error: `Failed to process message: ${err.message}` };
  }
});

ipcMain.handle('clear-session', async (event, sessionId) => {
  store.delete(`sessions.${sessionId}`);
  return { success: true };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});