const sessionId = `session_${Date.now()}`;
let chatHistory = [];
let extractedText = {};
let pdfFile = '';

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
    console.log('API is healthy:', result);
  }
}

async function selectPdfs() {
  const pdfButton = document.getElementById('pdf-input');
  pdfButton.disabled = true;
  document.getElementById('loading').style.display = 'block';
  try {
    const result = await window.api.selectPdfs();
    if (result.error) {
      alert(result.error);
      return;
    }
    pdfFile = result.pdfPath && typeof result.pdfPath === 'string' ? result.pdfPath : '';
    console.log('Selected PDF path:', pdfFile);
    if (!pdfFile) {
      alert('No valid PDF file selected');
      return;
    }
    document.getElementById('selected-file').innerText = `Selected: ${pdfFile.split(/[\\/]/).pop()}`;
    const processResult = await window.api.processPdfs(pdfFile, sessionId);
    if (processResult.error) {
      alert(`Error: ${processResult.error}`);
      return;
    }
    extractedText = processResult.extractedText || {};
    updateChatDisplay();
  } finally {
    document.getElementById('loading').style.display = 'none';
    pdfButton.disabled = false;
  }
}

async function sendPrompt() {
  const prompt = document.getElementById('input').value;
  if (!prompt.trim()) {
    chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: '⚠️ Please enter a valid question!' });
    updateChatDisplay();
    return;
  }
  if (!Object.keys(extractedText).length) {
    chatHistory.push({ role: 'user', content: prompt }, { role: 'assistant', content: '⚠️ Please upload a PDF first!' });
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
  pdfFile = '';
  document.getElementById('selected-file').innerText = '';
  await window.api.clearSession(sessionId);
  updateChatDisplay();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pdf-input').addEventListener('click', selectPdfs);
  healthCheck();
  document.getElementById('apiEndpoint').value = localStorage.getItem('apiEndpoint') || 'http://0.0.0.0:18889';
  document.getElementById('model').value = localStorage.getItem('model') || 'gemma3';
});