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
  await window.api.updateConfig({ apiEndpoint, model }); // Update model in main process
}

function toggleSettings() {
  const settings = document.getElementById('settings');
  settings.classList.toggle('visible');
}

async function healthCheck() {
  const result = await window.api.healthCheck();
  if (result.error) {
    setStatus(`API unavailable: ${result.error}`);
    showError('API Error', `API Health Check Failed: ${result.error}`);
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
    console.log('Calling window.api.selectPdfs...');
    const result = await window.api.selectPdfs();
    console.log('Select PDFs result:', result);
    if (result.error) {
      setStatus(result.error);
      showError('Selection Error', result.error);
      return;
    }
    if (!result.pdfPaths || !result.pdfPaths.length) {
      setStatus('No valid PDF selected');
      showError('Selection Error', 'No PDF file selected');
      return;
    }
    pdfFile = result.pdfPaths[0];
    console.log('Selected PDF:', pdfFile);
    await processPdf(pdfFile);
  } catch (err) {
    console.error('Error in selectPdfs:', err);
    setStatus('Failed to select PDF');
    showError('Selection Error', err.message);
  } finally {
    document.getElementById('loading').style.display = 'none';
    pdfButton.disabled = false;
  }
}

async function processPdf(pdfPath) {
  console.log('Starting processPdf with:', pdfPath);
  document.getElementById('loading').style.display = 'block';
  setStatus('Processing PDF...');
  try {
    document.getElementById('selected-file').innerText = `Selected: ${pdfPath.split(/[\\/]/).pop()}`;
    console.log('Calling window.api.processPdfs with:', { pdfPath, sessionId });
    const processResult = await window.api.processPdfs(pdfPath, sessionId);
    console.log('Process PDFs result:', processResult);
    if (processResult.error) {
      setStatus(`Error: ${processResult.error}`);
      showError('Processing Error', processResult.error);
      return;
    }
    extractedText = processResult.extractedText || {};
    setStatus('PDF processed successfully!');
  } catch (err) {
    console.error('Error in processPdf:', err);
    setStatus('Failed to process PDF');
    showError('Processing Error', err.message);
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
    console.log('Calling window.api.processMessage with:', { prompt, sessionId });
    const result = await window.api.processMessage(prompt, extractedText, sessionId);
    console.log('Process message result:', result);
    chatHistory.push({ role: 'assistant', content: result.response || result.error });
    document.getElementById('input').value = '';
    setStatus('');
  } catch (err) {
    console.error('Error in sendPrompt:', err);
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
  console.log('Status:', message);
  document.getElementById('status').innerText = message;
}

function showError(title, message) {
  console.log('Showing error:', title, message);
  alert(`${title}: ${message}`);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('apiEndpoint').value = localStorage.getItem('apiEndpoint') || 'http://localhost:18889';
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
    console.log('Dropped PDF:', pdfPath);
    if (pdfPath) processPdf(pdfPath);
  });

  window.api.onPdfDropped((pdfPath) => {
    console.log('Received pdf-dropped event:', pdfPath);
    processPdf(pdfPath);
  });

  window.api.onShowError((title, message) => {
    showError(title, message);
  });
});