const sessionId = `session_${Date.now()}`;
let chatHistory = [];
let extractedText = {};
let pdfFiles = [];

async function saveConfig() {
  const apiEndpoint = document.getElementById('apiEndpoint').value;
  const model = document.getElementById('model').value;
  localStorage.setItem('apiEndpoint', apiEndpoint);
  localStorage.setItem('model', model);
  alert('Configuration saved');
}

async function healthCheck() {
  const result = await window.api.healthCheck();
  if (result.error) {
    alert(`API Health Check Failed: ${result.error}`);
  } else {
    alert('API is healthy');
  }
}

async function processPdfs() {
  const pdfInput = document.getElementById('pdf-input');
  pdfFiles = Array.from(pdfInput.files).map(file => file.path);
  if (!pdfFiles.length) {
    alert('Please upload at least one PDF');
    return;
  }
  const result = await window.api.processPdfs(pdfFiles, sessionId);
  if (result.error) {
    alert(`Error: ${result.error}`);
  } else if (result.errors) {
    alert(`Some PDFs failed: ${result.errors.join(', ')}`);
  }
  extractedText = result.extractedText || {};
  updateChatDisplay();
}

async function sendPrompt() {
  const prompt = document.getElementById('input').value;
  if (!prompt.trim()) {
    chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: '⚠️ Please enter a valid question!' });
    updateChatDisplay();
    return;
  }
  if (!Object.keys(extractedText).length) {
    chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: '⚠️ Please upload at least one PDF first!' });
    updateChatDisplay();
    return;
  }
  chatHistory.push({ role: 'user', content: prompt });
  updateChatDisplay();
  document.getElementById('input').value = '';
  const result = await window.api.processMessage(prompt, extractedText, sessionId);
  chatHistory.push({ role: 'assistant', content: result.response || result.error });
  updateChatDisplay();
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

async function clearChat() {
  chatHistory = [];
  updateChatDisplay();
}

async function newChat() {
  chatHistory = [];
  extractedText = {};
  pdfFiles = [];
  document.getElementById('pdf-input').value = '';
  await window.api.clearSession(sessionId);
  updateChatDisplay();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pdf-input').addEventListener('change', processPdfs);
  healthCheck();
  document.getElementById('apiEndpoint').value = localStorage.getItem('apiEndpoint') || 'http://0.0.0.0:18889';
  document.getElementById('model').value = localStorage.getItem('model') || 'gemma3';
});