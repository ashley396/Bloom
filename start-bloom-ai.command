#!/bin/bash
cd "$(dirname "$0")/local-ai-bridge"
[ -d node_modules ] || npm install
npm start
