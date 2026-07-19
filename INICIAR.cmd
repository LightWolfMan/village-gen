@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado no PATH.
  echo Instale o Node.js 20 ou superior e tente novamente.
  pause
  exit /b 1
)
start "Vilarejo II - Servidor" /min cmd /c "node server.mjs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173"
endlocal
