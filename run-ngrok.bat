@echo off
echo Killing any existing ngrok processes...
taskkill /F /IM ngrok.exe 2>nul

echo.
echo Starting ngrok on port 5000...
echo.

cd /d "%~dp0\node_modules\ngrok\bin"
ngrok.exe http 5000

pause
