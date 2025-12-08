# SillyTavern Experimental Frontend

A modern, experimental frontend for SillyTavern, built with Vue 3 and Vite.

**Note:** This is a pre-alpha release. Features may be incomplete and bugs are expected.

## Prerequisites

- **Node.js:** Version 20 or higher is required.
- **SillyTavern Backend:** You must have a running instance of the SillyTavern backend.
- **V2-Server Plugin:** You must install the [V2-Server](https://github.com/bmen25124/SillyTavern-V2-Server) plugin.

## Installation and Usage

### Windows

1. Clone the repository or download the source code.
   ```bash
   git clone https://github.com/bmen25124/SillyTavern-Experimental-Frontend.git
   ```
2. Navigate to the folder.
3. Double-click `start.bat`.

The script will automatically install dependencies, build the project, and launch the server at `http://localhost:4173`.

### Linux / macOS

1. Clone the repository.
   ```bash
   git clone https://github.com/bmen25124/SillyTavern-Experimental-Frontend.git
   cd SillyTavern-Experimental-Frontend
   ```
2. Make the script executable and run it:
   ```bash
   chmod +x start.sh
   ./start.sh
   ```

## Development

If you wish to modify the code or run in development mode:

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the development server:
   ```bash
   npm run dev
   ```
   This will start the server at `http://localhost:3000` with hot-module reloading enabled.

## Configuration

By default, the application expects the SillyTavern backend to be running on **port 8000**.

If your backend is running on a different port, open `vite.config.ts` and update the `target` URLs in the `proxyRules` object. You must restart the application for these changes to take effect.
