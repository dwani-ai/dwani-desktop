async function sendPrompt() {
  const input = document.getElementById('input').value;
  document.getElementById('output').innerText = 'Processing...';
  try {
    const result = await window.api.runInference(input);
    document.getElementById('output').innerText = result.output || result.error;
  } catch (err) {
    document.getElementById('output').innerText = `Error: ${err.message}`;
  }
}

window.api.onInferenceResult((result) => {
  document.getElementById('output').innerText = result.output || result.error;
});