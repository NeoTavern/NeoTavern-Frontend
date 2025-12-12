#!/bin/bash

echo "==================================================="
echo "  NeoTavern Updater"
echo "==================================================="

# 1. Tell git to ignore permission changes for the whole repo.
# This ensures that if the user ran 'chmod +x' on this file,
# git won't complain about local modifications during the pull.
git config core.fileMode false

# 2. Pull changes
# --autostash: Saves any actual code changes the user might have made.
# --rebase: Keeps history cleaner.
echo "[1/2] Pulling latest changes..."
git pull --rebase --autostash

# 3. Ensure start.sh is runnable
# We re-apply permission just in case the pull reset it.
chmod +x start.sh

# 4. Launch using bash
# Explicitly using bash ensures it runs even if permissions failed.
echo "[2/2] Launching start script..."
bash start.sh