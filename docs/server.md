./build/bin/llama-server -hf ggml-org/gemma-3-4b-it-GGUF --host 0.0.0.0 --port 18888 --n-gpu-layers 99 --ctx-size 8192 --alias gemma3


run discovery server at 18889 

sudo apt-get update
sudo apt-get install poppler-utils -y

git clone https://github.com/dwani-ai/discovery.git

cd discovery

python3.10 -m venv venv
source venv/bin/activate

pip install -r server-requirements.txt

export VLLM_IP="0.0.0.0"
uvicorn server.main:app --host 0.0.0.0 --port 18889