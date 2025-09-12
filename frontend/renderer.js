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
  setStatus('Configuration saved');
}

function toggleSettings() {
  const settings = document.getElementById('settings');
  settings.classList.toggle('visible');
}

async function healthCheck() {
  const result = await window.api.healthCheck();
  if (result.error) {
    setStatus(`API unavailable: ${result.error}`);
    ipcRenderer.send('show-error', 'API Error', `API Health Check Failed: ${result.error}`);
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
    document.getElementById('selected-file').innerText = `Selected: ${pdfPath.split(/[\\/]/).pop()}`;
    const processResult = await window.api.processPdfs(pdfPath, sessionId);
    if (processResult.error) {
      setStatus(`Error: ${processResult.error}`);
      ipcRenderer.send('show-error', 'Processing Error', processResult.error);
      return;
    }
    extractedText = processResult.extractedText || {};
    setStatus('PDF processed successfully!');
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
  document.getElementById('loading').style.display = 'block';
  setStatus('Processing question...');
  try {
    const result = await window.api.processMessage(prompt, extractedText, sessionId);
    chatHistory.push({ role: 'assistant', content: result.response || result.error });
    document.getElementById('input').value = '';
    setStatus('');
  } catch (err) {
    setStatus('Failed to process question');
    chatHistory.push({ role: 'assistant', content: '⚠️ Error processing question' });
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
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('apiEndpoint').value = localStorage.getItem('apiEndpoint') || 'http://0.0.0.0:18889';
  document.getElementById('model').value = localStorage.getItem('model') || 'gemma3';
  healthCheck();

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
    const pdfPath = e.dataTransfer.files[0]?.path;
    if (pdfPath) processPdf(pdfPath);
  });

  window.api.onPdfDropped((pdfPath) => processPdf(pdfPath));

  ipcRenderer.on('show-error', (event, title, message) => {
    alert(`${title}: ${message}`);
  });
});