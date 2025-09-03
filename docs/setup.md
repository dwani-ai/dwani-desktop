

sudo apt-get install nodejs npm

sudo apt-get install build-essential cmake



git clone --depth 1 https://github.com/ggerganov/llama.cpp
cd llama.cpp


-- For Desktop

npm init -y
npm install electron electron-builder

npm install node-addon-api

npm install node-gyp
node-gyp configure build

npx electron-builder --win --mac --linux