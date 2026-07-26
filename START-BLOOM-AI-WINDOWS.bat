@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo       BLOOM LOCAL AI - LILY AND ROSE
echo ==============================================
echo.

if not exist "local-ai-bridge\package.json" (
  echo ERROR: Bloom AI files were not found.
  echo Please right-click the ZIP, choose Extract All, then run this file
  echo from the extracted Bloom folder. Do not run it inside the ZIP.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or Windows has not refreshed PATH.
  echo Install Node.js LTS, restart Windows, then run this file again.
  pause
  exit /b 1
)

where ollama >nul 2>nul
if errorlevel 1 (
  echo ERROR: Ollama is not installed.
  echo Install Ollama and download llama3.1 first.
  pause
  exit /b 1
)

cd /d "%~dp0local-ai-bridge"

echo Checking Lily's model...
ollama list | findstr /i "llama3.1" >nul
if errorlevel 1 (
  echo llama3.1 is not installed. Downloading it now...
  ollama pull llama3.1
  if errorlevel 1 (
    echo ERROR: Lily's model could not be downloaded.
    pause
    exit /b 1
  )
)

echo.
echo Starting Lily and Rose...
echo Keep this window open while using Bloom.
echo Health page: http://127.0.0.1:11435/health
echo.
start "" "http://127.0.0.1:11435/health"
node server.js
pause
