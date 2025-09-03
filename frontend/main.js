const { app, BrowserWindow, ipcMain } = require('electron');
const { exec } = require('child_process');
const path = require('path');

let mainWindow;

app.whenReady().then(() => {
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
});

ipcMain.on('run-inference', (event, prompt) => {
  exec(`./bin/main -m ./models/gpt-oss-20b.gguf --prompt "${prompt}"`, (err, stdout) => {
    if (err) {
      event.reply('inference-result', { error: err.message });
      return;
    }
    event.reply('inference-result', { output: stdout });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});