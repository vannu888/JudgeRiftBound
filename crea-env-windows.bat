@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==================================================
echo    Configurazione chiave API - Judge Rift Bound
echo ==================================================
echo.
echo Crea una chiave GRATUITA su: https://aistudio.google.com/apikey
echo.
set /p "KEY=Incolla qui la tua chiave API Gemini e premi Invio: "
if "%KEY%"=="" (
  echo.
  echo Nessuna chiave inserita. Operazione annullata.
  echo.
  pause
  exit /b
)
(echo GEMINI_API_KEY=%KEY%)>".env"
echo.
echo File .env creato correttamente in questa cartella.
echo Ora avvia l'app con:   npm start
echo (poi apri http://localhost:3000 nel browser)
echo.
pause
