@echo off
cd /d "%~dp0local-ai-bridge"
if not exist node_modules call npm install
call npm start
pause
