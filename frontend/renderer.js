const { ipcRenderer } = require('electron');
const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
let chatHistory = [];
let extractedText = {};
let pdfFile = '';

async function saveConfig() {
  const apiEndpoint = document.getElementById('apiEndpoint').value;
  const model = document.getElementById('model').value;
  localStorage.setItem('apiEndpoint', apiEndpoint);
  localStorage.setItem('model', model);
  await window.api.updateConfig({ apiEndpoint, model }); // Send to main
  setStatus('Configuration saved and applied');
}

function toggleSettings() {
  const settings = document.getElementById('settings');
  settings.classList.toggle('visible');
}

async function healthCheck() {
  setStatus('Checking API health...');
  const result = await window.api.healthCheck();
  if (result.error) {
    setStatus(`API unavailable: ${result.error}`);
    ipcRenderer.send('show-error', 'API Error', result.error);
  } else {
    setStatus('Ready to use!');
  }
}

async function selectPdfs() {
  const pdfButton = document.getElementById('pdf-input');
  pdfButton.disabled = true;
  document.getElementById('loading').style.display = 'block';
  setStatus('Selecting PDF...');
  try {
    const result = await window.api.selectPdfs();
    if (result.error) {
      setStatus(result.error);
      ipcRenderer.send('show-error', 'Selection Error', result.error);
      return;
    }
    pdfFile = result.pdfPaths?.[0] || '';
    if (!pdfFile) {
      setStatus('No valid PDF selected');
      return;
    }
    await processPdf(pdfFile);
  } finally {
    document.getElementById('loading').style.display = 'none';
    pdfButton.disabled = false;
  }
}

async function processPdf(pdfPath) {
  document.getElementById('loading').style.display = 'block';
  setStatus('Processing PDF...');
  try {
    document.getElementById('selected-file').innerText = `Selected: ${path.basename(pdfPath)}`;
    const processResult = await window.api.processPdfs(pdfPath, sessionId);
    if (processResult.error) {
      setStatus(`Error: ${processResult.error}`);
      ipcRenderer.send('show-error', 'Processing Error', processResult.error);
      return;
    }
    extractedText = processResult.extractedText || {};
    sessionId = processResult.sessionId || sessionId; // Update if new
    setStatus('PDF processed successfully!');
    console.log('Extracted text keys:', Object.keys(extractedText));
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

async function sendPrompt() {
  const prompt = document.getElementById('input').value.trim();
  if (!prompt) {
    setStatus('Please enter a question');
    chatHistory.push({ role: 'assistant', content: '⚠️ Please enter a valid question!' });
    updateChatDisplay();
    return;
  }
  if (!Object.keys(extractedText).length) {
    setStatus('Please upload a PDF first');
    chatHistory.push({ role: 'assistant', content: '⚠️ Please upload a PDF first!' });
    updateChatDisplay();
    return;
  }
  chatHistory.push({ role: 'user', content: prompt });
  updateChatDisplay();
  document.getElementById('input').value = '';
  document.getElementById('loading').style.display = 'block';
  setStatus('Processing question...');
  try {
    const result = await window.api.processMessage(prompt, extractedText, sessionId);
    chatHistory.push({ role: 'assistant', content: result.response || result.error || 'No response' });
    sessionId = result.sessionId || sessionId;
    setStatus('');
  } catch (err) {
    setStatus('Failed to process question');
    chatHistory.push({ role: 'assistant', content: `⚠️ Error: ${err.message}` });
  } finally {
    document.getElementById('loading').style.display = 'none';
    updateChatDisplay();
  }
}

function suggestPrompt(prompt) {
  document.getElementById('input').value = prompt;
  sendPrompt();
}

async function resetChat() {
  chatHistory = [];
  extractedText = {};
  pdfFile = '';
  document.getElementById('selected-file').innerText = '';
  await window.api.clearSession(sessionId);
  updateChatDisplay();
  setStatus('Chat reset. Select a new PDF to start.');
}

function updateChatDisplay() {
  const chatbot = document.getElementById('chatbot');
  chatbot.innerHTML = chatHistory.map(msg => `
    <div class="message ${msg.role}">
      <strong>${msg.role === 'user' ? 'You' : 'Assistant'}:</strong> ${msg.content}
    </div>
  `).join('');
  chatbot.scrollTop = chatbot.scrollHeight;
}

function setStatus(message) {
  document.getElementById('status').innerText = message;
  console.log('Status:', message); // Log to console
}

document.addEventListener('DOMContentLoaded', () => {
  // Load saved config
  document.getElementById('apiEndpoint').value = localStorage.getItem('apiEndpoint') || 'http://0.0.0.0:18889';
  document.getElementById('model').value = localStorage.getItem('model') || 'gemma3';
  saveConfig(); // Apply initial config
  healthCheck();

  // Drag-and-drop handling in renderer (fixed for path extraction)
  const dropZone = document.getElementById('dropZone');
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      console.log('Dropped file:', file.name, 'Raw path:', file.path); // Likely undefined
      const pdfPath = window.api.webUtils.getPathForFile(file); // Fix: Get real path
      console.log('Extracted path:', pdfPath);
      if (pdfPath) {
        processPdf(pdfPath);
      } else {
        setStatus('Failed to get file path. Try "Select PDF".');
        ipcRenderer.send('show-error', 'Drop Error', 'Could not extract file path.');
      }
    } else {
      setStatus('Please drop a valid PDF file.');
    }
  });

  // Fallback listener for main-sent drops (if needed)
  ipcRenderer.on('pdf-dropped', (event, data) => {
    console.log('Received drop from main:', data.pdfPath);
    processPdf(data.pdfPath);
  });

  ipcRenderer.on('show-error', (event, title, message) => {
    setStatus(`${title}: ${message}`);
    alert(`${title}: ${message}`);
  });
});