const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const axios = require('axios');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { webUtils } = require('electron'); // For potential main-side utils, but we'll use in renderer primarily

const store = new Store({ encryptionKey: 'dwani-secret-key' });
const MAX_FILE_SIZE_MB = 10;
let API_URL_PDF = 'http://0.0.0.0:18889/process_pdf';
let API_URL_MESSAGE = 'http://0.0.0.0:18889/process_message';
let API_URL_HEALTH = 'http://0.0.0.0:18889/health';
let CURRENT_MODEL = 'gemma3'; // Default
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
    //mainWindow.webContents.openDevTools(); // Auto-open DevTools for debugging

    // Enable drag-and-drop (fallback, but primary handling in renderer)
    mainWindow.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  } catch (err) {
    console.error('Failed to create window:', err);
    app.quit();
  }
}).catch((err) => {
  console.error('App failed to start:', err);
  app.quit();
});

function validatePdf(filePath) {
  console.log('Validating PDF:', filePath);
  if (!filePath || typeof filePath !== 'string') {
    const error = 'No file selected or invalid path';
    console.error(error);
    return { valid: false, error };
  }
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    const error = 'Please select a PDF file';
    console.error(error);
    return { valid: false, error };
  }
  try {
    const stats = fs.statSync(filePath);
    const fileSizeMb = stats.size / (1024 * 1024);
    console.log(`File size: ${fileSizeMb.toFixed(2)}MB`);
    if (fileSizeMb > MAX_FILE_SIZE_MB) {
      const error = `File is too large (max ${MAX_FILE_SIZE_MB}MB)`;
      console.error(error);
      return { valid: false, error };
    }
    if (fileSizeMb === 0) {
      const error = 'File is empty';
      console.error(error);
      return { valid: false, error };
    }
    console.log('PDF validation passed');
    return { valid: true };
  } catch (err) {
    const error = `Cannot access file: ${err.message}`;
    console.error(error);
    return { valid: false, error };
  }
}

async function processSinglePdf(filePath, sessionId) {
  console.log(`Starting PDF processing for: ${filePath}, session: ${sessionId}`);
  const validation = validatePdf(filePath);
  if (!validation.valid) {
    console.error('Validation failed:', validation.error);
    return { error: validation.error, sessionId };
  }

  const pdfHash = require('crypto').createHash('md5').update(filePath).digest('hex');
  const sessionData = store.get(`sessions.${sessionId}`, {});
  const cached = sessionData.cache?.[pdfHash];

  if (cached && (Date.now() / 1000 - cached.timestamp) < CACHE_TTL) {
    console.log(`Returning cached text for session ${sessionId}`);
    return { extractedText: cached.text, sessionId };
  }

  try {
    console.log('Reading file content...');
    const fileContent = fs.readFileSync(filePath);
    console.log(`File read successfully, size: ${fileContent.length} bytes`);
    
    // Use FormData for multipart upload
    const FormData = require('form-data'); // Ensure form-data is installed: npm install form-data
    const formData = new FormData();
    formData.append('file', fileContent, { filename: path.basename(filePath), contentType: 'application/pdf' });
    formData.append('prompt', 'Extract all text from this PDF.');
    formData.append('model', CURRENT_MODEL); // Include model if API supports it

    console.log(`Sending API request to ${API_URL_PDF}`);
    const response = await axios.post(API_URL_PDF, formData, {
      headers: formData.getHeaders(),
      timeout: 90000,
    });
    console.log('API response received:', response.status, response.data);
    
    const extractedText = response.data.extracted_text || {};
    // Cache the result
    store.set(`sessions.${sessionId}`, {
      cache: { [pdfHash]: { text: extractedText, timestamp: Date.now() / 1000 } },
      timestamp: Date.now() / 1000,
      pdfPath: filePath,
      chatHistory: store.get(`sessions.${sessionId}.chatHistory`, []),
    });
    return { extractedText, sessionId };
  } catch (err) {
    console.error(`Failed to extract text from ${filePath}:`, err.message, err.response?.status, err.response?.data);
    const errorMsg = `Failed to process PDF: ${err.message}. Response: ${err.response?.data ? JSON.stringify(err.response.data) : 'No response'}`;
    return { error: errorMsg, sessionId };
  }
}

ipcMain.handle('select-pdfs', async () => {
  try {
    console.log('Opening file dialog');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'PDFs', extensions: ['pdf'] }],
      buttonLabel: 'Select PDF',
      title: 'Select PDF File',
    });
    if (result.canceled) {
      console.log('Dialog canceled');
      return { error: 'No PDF selected' };
    }
    console.log('Selected file:', result.filePaths[0]);
    return { pdfPaths: result.filePaths };
  } catch (err) {
    console.error('File dialog error:', err);
    return { error: `Failed to open file picker: ${err.message}` };
  }
});

ipcMain.handle('update-config', async (event, { apiEndpoint, model }) => {
  API_URL_PDF = `${apiEndpoint}/process_pdf`;
  API_URL_MESSAGE = `${apiEndpoint}/process_message`;
  API_URL_HEALTH = `${apiEndpoint}/health`;
  CURRENT_MODEL = model;
  console.log('Updated config:', { apiEndpoint, model });
  return { success: true };
});

ipcMain.handle('health-check', async () => {
  try {
    console.log(`Health check to ${API_URL_HEALTH}`);
    const response = await axios.get(API_URL_HEALTH, { timeout: 30000 });
    console.log('Health check success:', response.data);
    return response.data;
  } catch (err) {
    console.error('Health check failed:', err.message);
    return { error: `API health check failed: ${err.message}` };
  }
});

ipcMain.handle('process-pdfs', async (event, { pdfPath, sessionId }) => {
  console.log('Processing PDF IPC:', { pdfPath, sessionId: sessionId || 'new' });
  const newSessionId = sessionId || uuidv4();
  const result = await processSinglePdf(pdfPath, newSessionId);
  console.log('PDF processing result:', result);
  return result;
});

ipcMain.handle('process-message', async (event, { prompt, extractedText, sessionId }) => {
  console.log('Processing message:', { prompt: prompt.substring(0, 50) + '...', sessionId });
  if (!prompt.trim()) {
    return { error: 'Please enter a question', sessionId };
  }
  if (!Object.keys(extractedText).length) {
    return { error: 'No PDF text available', sessionId };
  }
  try {
    console.log(`Sending message to ${API_URL_MESSAGE}`);
    const response = await axios.post(API_URL_MESSAGE, {
      prompt,
      extracted_text: JSON.stringify(extractedText),
      model: CURRENT_MODEL,
    }, { timeout: 90000 });
    console.log('Message response:', response.data);
    const chatHistory = store.get(`sessions.${sessionId}.chatHistory`, []);
    chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: response.data.response || response.data.error });
    store.set(`sessions.${sessionId}.chatHistory`, chatHistory);
    return { ...response.data, sessionId };
  } catch (err) {
    console.error('Message processing failed:', err.message);
    return { error: `Failed to process question: ${err.message}`, sessionId };
  }
});

ipcMain.handle('clear-session', async (event, sessionId) => {
  console.log('Clearing session:', sessionId);
  store.delete(`sessions.${sessionId}`); // Full delete for reset
  return { success: true, sessionId: uuidv4() };
});

ipcMain.on('show-error', (event, title, message) => {
  console.error(`Dialog error: ${title} - ${message}`);
  dialog.showErrorBox(title, message);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});