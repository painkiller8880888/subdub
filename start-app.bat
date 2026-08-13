@echo off
setlocal

cd /d "%~dp0"

start "subdub dev" cmd /d /k "corepack pnpm@11.17.0 dev"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173/"

endlocal
