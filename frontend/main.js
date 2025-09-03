const { app, BrowserWindow, ipcMain } = require('electron');
const axios = require('axios');
const Store = require('electron-store');
const path = require('path');

const store = new Store();

let mainWindow;

app.whenReady().then(() => {
  try {
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
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

ipcMain.handle('run-inference', async (event, { prompt, temperature, maxTokens }) => {
  try {
    const apiKey = store.get('apiKey', '');
    const apiEndpoint = store.get('apiEndpoint', 'https://api.dwani.ai');
    if (!apiKey) throw new Error('API key not configured');

    const response = await axios.post(
      `${apiEndpoint}/chat/completions`,
      {
        model: store.get('model', 'gpt-3.5-turbo'),
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 256
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return { output: response.data.choices[0].message.content };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('save-config', async (event, { apiKey, apiEndpoint, model }) => {
  try {
    store.set('apiKey', apiKey);
    store.set('apiEndpoint', apiEndpoint);
    store.set('model', model);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});