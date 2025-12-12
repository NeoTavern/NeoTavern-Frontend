[![Discord](https://img.shields.io/badge/Discord-SillyTavern-5865F2?logo=discord&logoColor=white)](https://discord.gg/sillytavern)

A modern, experimental frontend for [SillyTavern](https://github.com/SillyTavern/SillyTavern).

> [!IMPORTANT]  
> This is a pre-alpha release. Features may be incomplete, and bugs are expected.

> [!WARNING]  
> If you are highly dependent on STScript or existing SillyTavern extensions, we do not recommend using this yet.

## Intro

Why another frontend for [SillyTavern?](https://github.com/SillyTavern/SillyTavern) For detailed reasoning, see the hackmd post: [NeoTavern](https://hackmd.io/@NlF71k9KQAS4hhlzE42UJQ/SJ3UMOGbbl)

**Features compared to the SillyTavern:**

- New UI. See [screenshots](https://imgur.com/a/puRlyQO)
- There is no Chat/Text Completion separation.
- There is a single prompt manager.
- All chats are group chats. Add/remove a member anytime.
- Assigning multiple lorebooks per persona/chat.
- Assigning a connection profile per chat.

**What things did not implement:**

- Multi-user support. If multi-user is enabled in your ST, you will get lots of connection errors.
- STScript, QRs, slash commands, detailed macro system.
- More built-in extensions.
- NovelAI/Horde/KoboldClassic. If they have OpenAI compatible API, we can add later. If not, we are not planning to add them.
- Reasoning for text completion.
- Media attachments. Such as images, files, audio, video.
- Tool calling / structured outputs.

**Thing that not implemented fully:**

- Mobile Support: Basic layout is responsive, but there are still some rough edges.
- UI/UX: It needs polish and improvements.
- World Info: Outlets and timed effects are not implemented.
- Local Providers: Currently, there is only koboldcpp support. There is no Text Completion provider. Ollama/LM Studio support is planned.
- Instruct Templates: We can import/edit/use them. But we have not implemented the whole field, such as `wrap`.

**For extension developers:**

- Read the above HackMD post for design philosophy. Currently, there is no documentation or NPM package for types. Because extensions are not prioritized yet.

## Prerequisites

- **Node.js:** Version 20 or higher is required.
- **SillyTavern:** You must have a running instance of the [SillyTavern](https://github.com/SillyTavern/SillyTavern). Make sure the branch is set to `staging`.
- **NeoTavern-Server-Plugin:** You must install the [NeoTavern-Server-Plugin](https://github.com/NeoTavern/NeoTavern-Server-Plugin).

## Installation and Usage

### Windows

Make sure [SillyTavern(staging branch)](https://github.com/SillyTavern/SillyTavern) is running in the background and [NeoTavern-Server-Plugin](https://github.com/NeoTavern/NeoTavern-Server-Plugin) installed.

1. Clone the repository or download the source code.
   ```bash
   git clone https://github.com/NeoTavern/NeoTavern-Frontend.git
   ```
2. Navigate to the folder.
3. Double-click `start.bat`.

The script will automatically install dependencies, build the project, and launch the server at `http://localhost:4173`.

### Linux / macOS

Make sure [SillyTavern(staging branch)](https://github.com/SillyTavern/SillyTavern) is running in the background and [NeoTavern-Server-Plugin](https://github.com/NeoTavern/NeoTavern-Server-Plugin) installed.

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

This guide contains from scratch installation of SillyTavern, NeoTavern-Server-Plugin, and NeoTavern-Frontend, unlike others. Because mobile users are something special.

#### 1. Prepare Termux

1. Install Termux from [GitHub releases](https://github.com/termux/termux-app/releases) or **F-Droid**. (The Google Play Store version is outdated.)
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

## Updating

To update to the latest version, we provide a helper script that pulls the latest code and rebuilds the application automatically.

- **Windows**: Double-click `update-and-start.bat`.
- **Linux / macOS / Android**: Run the updater script:
  ```bash
  chmod +x update-and-start.sh
  ./update-and-start.sh
  ```

## Installing as an App (PWA)

NeoTavern supports **Progressive Web App (PWA)** functionality. This allows you to install it as a native application on your device, removing the browser address bar and giving you a full-screen experience.

**On Android:**

1. Start the app and open Chrome to `http://localhost:4173`.
2. Tap the **Three Dots Menu** (top right).
3. Tap **"Add to Home screen"** or **"Install App"**.
4. The NeoTavern icon will appear in your app drawer. You can now launch it directly without opening Chrome first.

**On Desktop (Chrome/Edge):**

1. Open the app in your browser.
2. Click the **Install icon** in the right side of the address bar.

## FAQ

> Can I use my existing ST backend?

Yes. NeoTavern-Frontend is not overriding the existing `settings.json`. However; using the same characters, instruct templates, backgrounds, and WI folders. If you are worried about your data, feel free to use a fresh ST backend.

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
