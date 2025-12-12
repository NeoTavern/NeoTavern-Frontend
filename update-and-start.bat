@echo off
TITLE NeoTavern Updater
CLS

ECHO ===================================================
ECHO   NeoTavern Updater
ECHO ===================================================
ECHO.

:: 1. Pull the latest changes
ECHO [1/2] Pulling latest changes...
call git pull --rebase --autostash

:: 2. Hand over control to the main start script
ECHO [2/2] Launching start script...
call start.bat