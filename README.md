# NeoTavern Frontend

A modern, experimental frontend for SillyTavern.

> [!IMPORTANT]  
> This is a pre-alpha release. Features may be incomplete and bugs are expected.

## Prerequisites

- **Node.js:** Version 20 or higher is required.
- **SillyTavern:** You must have a running instance of the [SillyTavern](https://github.com/SillyTavern/SillyTavern). Make sure the branch is set to `staging`.
- **NeoTavern-Server-Plugin:** You must install the [NeoTavern-Server-Plugin](https://github.com/NeoTavern/NeoTavern-Server-Plugin) plugin.

## Installation and Usage

### Windows

1. Clone the repository or download the source code.
   ```bash
   git clone https://github.com/NeoTavern/NeoTavern-Frontend.git
   ```
2. Navigate to the folder.
3. Double-click `start.bat`.

The script will automatically install dependencies, build the project, and launch the server at `http://localhost:4173`.

### Linux / macOS

1. Clone the repository.
   ```bash
   git clone https://github.com/NeoTavern/NeoTavern-Frontend.git
   cd NeoTavern-Frontend
   ```
2. Make the script executable and run it:
   ```bash
   chmod +x start.sh
   ./start.sh
   ```

### Android (Termux)

This guide is containing from scratch installation of SillyTavern, NeoTavern-Server-Plugin, and NeoTavern-Frontend unlike others. Because mobile users are something special.

#### 1. Prepare Termux

1. Install Termux from [GitHub releases](https://github.com/termux/termux-app/releases) or **F-Droid**. (the Google Play Store version is outdated).
2. Open Termux and install the required packages:
   ```bash
   pkg update && pkg upgrade
   pkg install git nodejs
   ```

#### 2. Install SillyTavern

1. Clone the main repository:
   ```bash
   cd ~
   git clone --branch staging https://github.com/SillyTavern/SillyTavern
   cd SillyTavern
   ```
2. Run the server once to generate the configuration files:
   ```bash
   chmod +x start.sh
   ./start.sh
   ```
3. Once you see `SillyTavern is listening on port 8000`, press **CTRL + C** to stop the server.

#### 3. Install NeoTavern-Server-Plugin

1. Enter the plugins folder and clone the NeoTavern-Server-Plugin:
   ```bash
   cd plugins
   git clone https://github.com/NeoTavern/NeoTavern-Server-Plugin
   ```
2. Go back to the main folder:
   ```bash
   cd ..
   ```
3. Enable plugins in the configuration file automatically:
   ```bash
   sed -i 's/enableServerPlugins: false/enableServerPlugins: true/' config.yaml
   ```
4. Start the Backend again:
   ```bash
   ./start.sh
   ```

#### 4. Install & Run the Frontend

**Do not close the Backend.** You need to open a second terminal session.

1. Swipe from the **left edge** of the screen to open the Termux drawer.
2. Tap **"New Session"**.
3. In this new session, clone and run the NeoTavern Frontend:
   ```bash
   cd ~
   git clone https://github.com/NeoTavern/NeoTavern-Frontend.git
   cd NeoTavern-Frontend
   chmod +x start.sh
   ./start.sh
   ```

#### 5. Access the App

Open your mobile browser and go to:
`http://localhost:4173`

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

By default, the application expects the SillyTavern to be running on **port 8000**.

If your backend is running on a different port, open `vite.config.ts` and update the `target` URLs in the `proxyRules` object. You must restart the application for these changes to take effect.
