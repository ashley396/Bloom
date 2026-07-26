@echo off
setlocal
TITLE Bloom Local AI - Lily and Rose
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE_EXE=%LocalAppData%\Programs\nodejs\node.exe"

if not defined NODE_EXE (
  echo.
  echo Node.js could not be found.
  echo Install the Windows LTS version of Node.js, restart Windows, and try again.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0local-ai-bridge\server.js" (
  echo.
  echo Bloom bridge file is missing:
  echo %~dp0local-ai-bridge\server.js
  echo.
  pause
  exit /b 1
)

echo Starting Lily and Rose...
echo.
"%NODE_EXE%" "%~dp0local-ai-bridge\server.js"

echo.
echo The Bloom AI Bridge stopped. Review any message above.
pause
