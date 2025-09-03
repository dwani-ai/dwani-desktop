async function sendPrompt() {
  const input = document.getElementById('input').value;
  const temperature = parseFloat(document.getElementById('temperature').value);
  const maxTokens = parseInt(document.getElementById('maxTokens').value);
  document.getElementById('output').innerText = 'Processing...';
  try {
    const result = await window.api.runInference(input, temperature, maxTokens);
    document.getElementById('output').innerText = result.output || result.error;
  } catch (err) {
    document.getElementById('output').innerText = `Error: ${err.message}`;
  }
}

async function saveConfig() {
  const apiKey = document.getElementById('apiKey').value;
  const apiEndpoint = document.getElementById('apiEndpoint').value;
  const model = document.getElementById('model').value;
  try {
    const result = await window.api.saveConfig(apiKey, apiEndpoint, model);
    alert(result.success ? 'Configuration saved' : 'Failed to save configuration');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}