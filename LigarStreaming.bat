@echo off
title CineHome - Iniciar Streaming
echo.
echo ========================================
echo    CineHome - Iniciando Streaming...
echo ========================================
echo.

:: 1. Inicia o Servidor (Backend)
echo [1/3] Abrindo Servidor...
start "CineHome: Servidor (Backend)" cmd /k "cd /d "%~dp0server" && node index.js"

:: 2. Inicia o Frontend (Web)
echo [2/3] Abrindo Web...
start "CineHome: Web (Frontend)" cmd /k "cd /d "%~dp0web" && npm run dev"

:: 3. Aguarda o Vite carregar e abre o navegador
echo [3/3] Aguardando 5 segundos para carregar...
timeout /t 5 /nobreak > nul

set "chromePath=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%chromePath%" set "chromePath=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if exist "%chromePath%" (
    start "" "%chromePath%" http://localhost:3000
) else (
    start http://localhost:3000
)

echo.
echo ========================================
echo [OK] Tudo pronto! 
echo.
echo Mantenha as janelas pretas abertas 
echo enquanto assiste.
echo ========================================
echo.
pause
