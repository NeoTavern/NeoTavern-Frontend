@echo off
TITLE SillyTavern Experimental Frontend
CLS

ECHO ===================================================
ECHO   SillyTavern Experimental Frontend (Pre-Alpha)
ECHO ===================================================
ECHO.

:: 1. Check if node_modules exists
IF NOT EXIST "node_modules" (
    ECHO [1/3] First run detected. Installing dependencies...
    call npm ci
    IF %ERRORLEVEL% NEQ 0 (
        ECHO Error installing dependencies.
        PAUSE
        EXIT /B
    )
) ELSE (
    ECHO [1/3] Dependencies found. Skipping install.
)

:: 2. Check if dist folder exists (Build)
:: Since this is pre-alpha, we might want to rebuild often to ensure updates apply.
:: You can remove the "IF NOT EXIST" check if you want to force a rebuild every time.
ECHO [2/3] Building application for production...
call npm run build
IF %ERRORLEVEL% NEQ 0 (
    ECHO Error building the application.
    PAUSE
    EXIT /B
)

:: 3. Launch the Preview Server
ECHO [3/3] Starting server...
ECHO.
ECHO App should be running at: http://localhost:4173
ECHO Press Ctrl+C to stop.
ECHO.

call npm run preview
PAUSE