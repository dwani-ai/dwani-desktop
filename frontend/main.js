const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const OpenAI = require('openai');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { fromPath } = require('pdf2pic'); // For PDF-to-image conversion
const log = require('electron-log'); // For logging

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = 'info';

// Initialize electron-store for session management
const store = new Store({ encryptionKey: 'dwani-secret-key' });
const MAX_FILE_SIZE_MB = 10;
const API_URL = 'http://localhost'; // Base URL for model endpoints
const MODEL_PORTS = { gemma3: '9000', 'gpt-oss': '9500' };
const CACHE_TTL = 3600; // 1 hour
let CURRENT_MODEL = 'gemma3'; // Default model

let mainWindow;

// Initialize OpenAI client
function getOpenAIClient(model) {
  const validModels = ['gemma3', 'gpt-oss'];
  if (!validModels.includes(model)) {
    throw new Error(`Invalid model: ${model}. Choose from: ${validModels.join(', ')}`);
  }
  return new OpenAI({
    apiKey: 'http', // Matches main.py
    baseURL: `${API_URL}:${MODEL_PORTS[model]}/v1`,
  });
}

app.whenReady().then(async () => {
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
    mainWindow.webContents.openDevTools(); // Auto-open DevTools for debugging
    mainWindow.webContents.on('will-prevent-unload', (event) => event.preventDefault());
  } catch (err) {
    log.error('Failed to create window:', err);
    app.quit();
  }
}).catch((err) => {
  log.error('App failed to start:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Validate PDF file
function validatePdf(filePath) {
  log.info('Validating PDF:', filePath);
  if (!filePath || typeof filePath !== 'string') {
    const error = 'No file selected or invalid path';
    log.error(error);
    return { valid: false, error };
  }
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    const error = 'Please select a PDF file';
    log.error(error);
    return { valid: false, error };
  }
  try {
    const stats = fs.statSync(filePath);
    const fileSizeMb = stats.size / (1024 * 1024);
    log.info(`File size: ${fileSizeMb.toFixed(2)}MB`);
    if (fileSizeMb > MAX_FILE_SIZE_MB) {
      const error = `File is too large (max ${MAX_FILE_SIZE_MB}MB)`;
      log.error(error);
      return { valid: false, error };
    }
    if (fileSizeMb === 0) {
      const error = 'File is empty';
      log.error(error);
      return { valid: false, error };
    }
    log.info('PDF validation passed');
    return { valid: true };
  } catch (err) {
    const error = `Cannot access file: ${err.message}`;
    log.error(error);
    return { valid: false, error };
  }
}

// Convert PDF to images (replaces pdf2image)
async function renderPdfToImages(filePath) {
  log.info(`Converting PDF to images: ${filePath}`);
  try {
    const outputDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    
    const options = {
      density: 100,
      format: 'jpeg',
      outputDir,
      outputName: 'page',
    };
    const convert = fromPath(filePath, options);
    const images = await convert.bulk(-1); // Convert all pages
    const imagePaths = images.map((img) => img.path);
    log.info(`Converted ${imagePaths.length} pages to images`);
    return imagePaths;
  } catch (err) {
    log.error(`PDF conversion failed: ${err.message}`);
    throw new Error(`Failed to convert PDF to images: ${err.message}`);
  }
}

// Clean up temporary images
function cleanupImages(imagePaths) {
  imagePaths.forEach((path) => {
    try {
      if (fs.existsSync(path)) fs.unlinkSync(path);
    } catch (err) {
      log.error(`Failed to delete image ${path}: ${err.message}`);
    }
  });
  const tempDir = path.dirname(imagePaths[0] || '');
  if (fs.existsSync(tempDir)) {
    try {
      fs.rmdirSync(tempDir);
    } catch (err) {
      log.error(`Failed to delete temp directory ${tempDir}: ${err.message}`);
    }
  }
}

// Encode image to base64
function encodeImage(imagePath) {
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
  } catch (err) {
    log.error(`Failed to encode image ${imagePath}: ${err.message}`);
    throw err;
  }
}

// Process single batch of images with external API
async function processSingleBatch(client, model, batchImages, batchStart, batchEnd) {
  log.info(`Processing batch ${batchStart}-${batchEnd - 1}`);
  try {
    const batchMessages = batchImages.map((imagePath, index) => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${encodeImage(imagePath)}` },
    }));
    batchMessages.push({
      type: 'text',
      text: `Extract plain text from these ${batchEnd - batchStart} PDF pages. Return the results as a valid JSON object where keys are page numbers (starting from ${batchStart}) and values are the extracted text for each page. Ensure the response is strictly JSON-formatted.`,
    });

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: batchMessages }],
      temperature: 0.2,
      max_tokens: 2024,
    });

    let rawResponse = response.choices[0].message.content;
    log.debug(`Raw response for batch ${batchStart}-${batchEnd - 1}: ${rawResponse.substring(0, 50)}...`);

    // Clean response (remove markdown code blocks)
    const cleanedResponse = rawResponse.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, '$1').trim();
    if (!cleanedResponse) {
      log.warn(`Empty response for batch ${batchStart}-${batchEnd - 1}`);
      return { data: null, skipped: Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i) };
    }

    try {
      const batchResults = JSON.parse(cleanedResponse);
      if (typeof batchResults !== 'object' || batchResults === null) {
        log.warn(`Response is not a JSON object for batch ${batchStart}-${batchEnd - 1}`);
        return { data: null, skipped: Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i) };
      }
      return { data: batchResults, skipped: [] };
    } catch (err) {
      log.error(`JSON parsing failed for batch ${batchStart}-${batchEnd - 1}: ${err.message}`);
      return { data: null, skipped: Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i) };
    }
  } catch (err) {
    log.error(`API request failed for batch ${batchStart}-${batchEnd - 1}: ${err.message}`);
    return { data: null, skipped: Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i) };
  }
}

// Process single page with external API
async function processSinglePage(client, model, imagePath, pageIdx) {
  log.info(`Processing single page ${pageIdx}`);
  try {
    const imageBase64 = encodeImage(imagePath);
    const singleMessage = [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      {
        type: 'text',
        text: `Extract plain text from this single PDF page (page number ${pageIdx}). Return the result as a valid JSON object where the key is the page number (${pageIdx}) and the value is the extracted text. Ensure the response is strictly JSON-formatted and does not include markdown code blocks.`,
      },
    ];

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: singleMessage }],
      temperature: 0.2,
      max_tokens: 2048,
    });

    let rawResponse = response.choices[0].message.content;
    log.debug(`Raw response for page ${pageIdx}: ${rawResponse.substring(0, 50)}...`);

    const cleanedResponse = rawResponse.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, '$1').trim();
    if (!cleanedResponse) {
      log.warn(`Empty response for page ${pageIdx}`);
      return { data: null, pageIdx };
    }

    try {
      const pageResult = JSON.parse(cleanedResponse);
      if (typeof pageResult !== 'object' || pageResult === null || !pageResult[pageIdx]) {
        log.warn(`Invalid JSON for page ${pageIdx}`);
        return { data: null, pageIdx };
      }
      return { data: pageResult, pageIdx: null };
    } catch (err) {
      log.error(`JSON parsing failed for page ${pageIdx}: ${err.message}`);
      return { data: null, pageIdx };
    }
  } catch (err) {
    log.error(`Failed to process page ${pageIdx}: ${err.message}`);
    return { data: null, pageIdx };
  }
}

// Process PDF (replaces /process_pdf endpoint)
async function processSinglePdf(filePath, sessionId, prompt) {
  log.info(`Starting PDF processing for: ${filePath}, session: ${sessionId}`);
  const validation = validatePdf(filePath);
  if (!validation.valid) {
    log.error('Validation failed:', validation.error);
    return { error: validation.error, sessionId };
  }

  const pdfHash = require('crypto').createHash('md5').update(filePath).digest('hex');
  const sessionData = store.get(`sessions.${sessionId}`, {});
  const cached = sessionData.cache?.[pdfHash];

  if (cached && (Date.now() / 1000 - cached.timestamp) < CACHE_TTL) {
    log.info(`Returning cached text for session ${sessionId}`);
    const client = getOpenAIClient(CURRENT_MODEL);
    const modelResponse = await processWithModel(client, prompt, cached.text, CURRENT_MODEL);
    return { response: modelResponse, extractedText: cached.text, skippedPages: [], sessionId };
  }

  try {
    const imagePaths = await renderPdfToImages(filePath);
    const numPages = imagePaths.length;
    let allResults = {};
    let skippedPages = [];
    const batchSize = 5;
    const client = getOpenAIClient(CURRENT_MODEL);

    // Process in batches
    const batchTasks = [];
    for (let batchStart = 0; batchStart < numPages; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, numPages);
      const batchImages = imagePaths.slice(batchStart, batchEnd);
      batchTasks.push(processSingleBatch(client, CURRENT_MODEL, batchImages, batchStart + 1, batchEnd + 1));
    }

    const batchResults = await Promise.all(batchTasks);
    batchResults.forEach(({ data, skipped }) => {
      if (data) allResults = { ...allResults, ...data };
      if (skipped) skippedPages = [...skippedPages, ...skipped];
    });

    // Retry skipped pages
    const retryTasks = [];
    const remainingSkipped = [...new Set(skippedPages)];
    for (const pageIdx of remainingSkipped) {
      const imageIndex = pageIdx - 1;
      if (imagePaths[imageIndex]) {
        retryTasks.push(processSinglePage(client, CURRENT_MODEL, imagePaths[imageIndex], pageIdx));
      }
    }

    const retryResults = await Promise.all(retryTasks);
    const successfullyProcessed = [];
    retryResults.forEach(({ data, pageIdx }) => {
      if (data) {
        allResults = { ...allResults, ...data };
        successfullyProcessed.push(pageIdx);
      }
    });
    skippedPages = remainingSkipped.filter((p) => !successfullyProcessed.includes(p));

    // Clean up images
    cleanupImages(imagePaths);

    if (!Object.keys(allResults).length && skippedPages.length) {
      const error = 'No valid text extracted from any pages';
      log.error(error);
      return { error, skippedPages, sessionId };
    }

    // Process prompt with extracted text
    const modelResponse = await processWithModel(client, prompt, allResults, CURRENT_MODEL);
    store.set(`sessions.${sessionId}`, {
      cache: { [pdfHash]: { text: allResults, timestamp: Date.now() / 1000 } },
      timestamp: Date.now() / 1000,
      pdfPath: filePath,
      chatHistory: store.get(`sessions.${sessionId}.chatHistory`, []),
    });

    return { response: modelResponse, extractedText: allResults, skippedPages, sessionId };
  } catch (err) {
    log.error(`Failed to process PDF: ${err.message}`);
    cleanupImages(fs.readdirSync(path.join(__dirname, 'temp')).map((f) => path.join(__dirname, 'temp', f)));
    return { error: `Failed to process PDF: ${err.message}`, sessionId };
  }
}

// Process prompt with model (replaces OpenAI client in main.py)
async function processWithModel(client, prompt, extractedText, model) {
  log.info(`Processing prompt with model ${model}: ${prompt.substring(0, 50)}...`);
  try {
    const dwaniPrompt = 'You are dwani, a helpful assistant. Provide a concise response in one sentence maximum.';
    const combinedPrompt = `${dwaniPrompt}\nUser prompt: ${prompt}\nExtracted text: ${JSON.stringify(extractedText)}`;

    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: combinedPrompt }],
      temperature: 0.3,
      max_tokens: 2048,
    });

    const generatedResponse = response.choices[0].message.content;
    log.debug(`Model response: ${generatedResponse.substring(0, 50)}...`);
    return generatedResponse;
  } catch (err) {
    log.error(`Model request failed: ${err.message}`);
    throw new Error(`Model request failed: ${err.message}`);
  }
}

// Process message (replaces /process_message endpoint)
async function processMessage(prompt, extractedText, sessionId, model) {
  log.info(`Processing message for session ${sessionId}: ${prompt.substring(0, 50)}...`);
  if (!prompt.trim()) {
    log.error('Empty prompt');
    return { error: 'Please enter a question', sessionId };
  }
  if (!Object.keys(extractedText).length) {
    log.error('No extracted text available');
    return { error: 'No PDF text available', sessionId };
  }

  try {
    const client = getOpenAIClient(model);
    const generatedResponse = await processWithModel(client, prompt, extractedText, model);
    const chatHistory = store.get(`sessions.${sessionId}.chatHistory`, []);
    chatHistory.push(
      { role: 'user', content: prompt },
      { role: 'assistant', content: generatedResponse }
    );
    store.set(`sessions.${sessionId}.chatHistory`, chatHistory);
    return { response: generatedResponse, extracted_text: extractedText, skipped_pages: [], sessionId };
  } catch (err) {
    log.error(`Message processing failed: ${err.message}`);
    const chatHistory = store.get(`sessions.${sessionId}.chatHistory`, []);
    chatHistory.push({ role: 'assistant', content: `⚠️ Error processing question: ${err.message}` });
    store.set(`sessions.${sessionId}.chatHistory`, chatHistory);
    return { error: `Failed to process question: ${err.message}`, sessionId };
  }
}

// Health check (replaces /health endpoint)
async function healthCheck() {
  log.info('Performing health check');
  try {
    const client = getOpenAIClient(CURRENT_MODEL);
    // Assuming the API has a health endpoint; adjust if needed
    await client.chat.completions.create({
      model: CURRENT_MODEL,
      messages: [{ role: 'user', content: 'Ping' }],
      max_tokens: 10,
    });
    return { status: 'healthy', message: 'API and model connectivity are operational' };
  } catch (err) {
    log.error(`Health check failed: ${err.message}`);
    return { error: `API health check failed: ${err.message}` };
  }
}

// IPC Handlers
ipcMain.handle('select-pdfs', async () => {
  try {
    log.info('Opening file dialog');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'PDFs', extensions: ['pdf'] }],
      buttonLabel: 'Select PDF',
      title: 'Select PDF File',
    });
    if (result.canceled) {
      log.info('Dialog canceled');
      return { error: 'No PDF selected' };
    }
    log.info('Selected file:', result.filePaths[0]);
    return { pdfPaths: result.filePaths };
  } catch (err) {
    log.error('File dialog error:', err);
    return { error: `Failed to open file picker: ${err.message}` };
  }
});

ipcMain.handle('update-config', async (event, { apiEndpoint, model }) => {
  CURRENT_MODEL = model;
  log.info('Updated config:', { apiEndpoint, model });
  return { success: true };
});

ipcMain.handle('health-check', async () => {
  return await healthCheck();
});

ipcMain.handle('process-pdfs', async (event, { pdfPath, sessionId }) => {
  log.info('Processing PDF IPC:', { pdfPath, sessionId: sessionId || 'new' });
  const newSessionId = sessionId || uuidv4();
  const prompt = 'Extract all text from this PDF.'; // Default prompt
  const result = await processSinglePdf(pdfPath, newSessionId, prompt);
  log.info('PDF processing result:', result);
  return result;
});

ipcMain.handle('process-message', async (event, { prompt, extractedText, sessionId }) => {
  return await processMessage(prompt, extractedText, sessionId, CURRENT_MODEL);
});

ipcMain.handle('clear-session', async (event, sessionId) => {
  log.info('Clearing session:', sessionId);
  store.delete(`sessions.${sessionId}`);
  return { success: true, sessionId: uuidv4() };
});

ipcMain.on('show-error', (event, title, message) => {
  log.error(`Dialog error: ${title} - ${message}`);
  dialog.showErrorBox(title, message);
});