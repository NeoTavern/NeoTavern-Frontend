#!/bin/bash

echo "==================================================="
echo "  SillyTavern Experimental Frontend (Pre-Alpha)"
echo "==================================================="

# 1. Install dependencies if missing
if [ ! -d "node_modules" ]; then
    echo "[1/3] First run detected. Installing dependencies..."
    npm ci
    if [ $? -ne 0 ]; then
        echo "Error installing dependencies."
        exit 1
    fi
else
    echo "[1/3] Dependencies found."
fi

# 2. Build the app
# In pre-alpha, we force build to ensure the user sees the latest changes after a git pull
echo "[2/3] Building application..."
npm run build
if [ $? -ne 0 ]; then
    echo "Error building application."
    exit 1
fi

# 3. Run Preview
echo "[3/3] Starting server..."
echo "App running at http://localhost:4173"
npm run preview