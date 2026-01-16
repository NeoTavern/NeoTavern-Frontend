@echo off
SETLOCAL ENABLEDELAYEDEXPANSION
TITLE NeoTavern
CLS

ECHO ===================================================
ECHO   NeoTavern Launcher
ECHO ===================================================
ECHO.

:: 1. Check Node.js
node -v >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    ECHO Error: Node.js is not installed.
    PAUSE
    EXIT /B
)

:: 2. Strict Dependency Check
SET PKG_HASH_FILE=node_modules\.package-json.hash
SET NEED_INSTALL=0
SET LAST_PKG_HASH=none
SET CURRENT_PKG_HASH=

FOR /F "usebackq delims=" %%H IN (`node -p "require('crypto').createHash('sha256').update(require('fs').readFileSync('package.json')).digest('hex')"`) DO (
    SET CURRENT_PKG_HASH=%%H
)

IF EXIST "%PKG_HASH_FILE%" (
    SET /P LAST_PKG_HASH=<"%PKG_HASH_FILE%"
)

IF NOT EXIST "node_modules" (
    ECHO [1/2] Installing dependencies...
    SET NEED_INSTALL=1
) ELSE IF "!CURRENT_PKG_HASH!" NEQ "!LAST_PKG_HASH!" (
    ECHO [1/2] package.json changed. Reinstalling...
    SET NEED_INSTALL=1
)

IF "!NEED_INSTALL!"=="1" (
    call npm ci
    IF !ERRORLEVEL! NEQ 0 (
        ECHO [ERROR] npm ci failed. Your lockfile might be out of sync or corrupt.
        PAUSE
        EXIT /B
    )
    >"%PKG_HASH_FILE%" ECHO !CURRENT_PKG_HASH!
) ELSE (
    ECHO [1/2] Dependencies verified.
)

:: 3. Launch
ECHO [2/2] Starting...
node launcher.js

PAUSE