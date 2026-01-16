[![Discord](https://img.shields.io/badge/Discord-SillyTavern-5865F2?logo=discord&logoColor=white)](https://discord.gg/sillytavern)

A modern, experimental frontend for [SillyTavern](https://github.com/SillyTavern/SillyTavern).

> [!IMPORTANT]  
> This is a pre-alpha release. Features may be incomplete, and bugs are expected.

> [!WARNING]  
> If you are highly dependent on STScript or existing SillyTavern extensions, we do not recommend using this yet.

## Intro

Why another frontend for [SillyTavern?](https://github.com/SillyTavern/SillyTavern) For detailed reasoning, see the hackmd post: [NeoTavern](https://hackmd.io/@NlF71k9KQAS4hhlzE42UJQ/SJ3UMOGbbl)

**Features compared to the SillyTavern:**

- New UI. See [screenshots.](https://imgur.com/a/puRlyQO) Screenshots are not covering the whole UI, but you can see the general layout and design.
- There is no Chat/Text Completion separation.
- There is a single prompt manager.
- All chats are group chats. Add/remove a member anytime.
- Assigning multiple lorebooks per persona/chat.
- Assigning a connection profile per chat.
- Tools: The ability to [enable/disable tools](https://imgur.com/F4rczat). 2 built-in tools: Web search and URL inspector.
- Media attachments: If the message has a markdown image link(`![alt](url)`), AI will see the image.

**Built-in extensions compared to SillyTavern:**

- Standard Tools: Web Search and URL Inspector.
- Chat Memory: It has 2 features. 1) The simpler version of [MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks). [Select the range of messages](https://imgur.com/DHXx2rd) -> summarize it with AI -> auto hide messages -> create a lorebook entry 2) The simpler version of [qvikn's memory](https://github.com/qvink/SillyTavern-MessageSummarize). [Select the range of messages](https://imgur.com/W4vXbyh) -> summarize each of them with AI -> summarized messages are [shown in the chat](https://imgur.com/AWf2BGJ) and they are used as context.
- Chat Translation: Translate messages in the chat with AI.
- Magic Rewrite: [Rewrite](https://imgur.com/TFDWOv5) most inputs with AI. Such as fixing grammer, changing tone, rewriting a chat message, character field, persona description, lorebook entry, etc. [Screenshot 1](https://imgur.com/otYwcgg) [Screenshot 2](https://imgur.com/rZg0ZSN). Think like the merge of [CREC](https://github.com/bmen25124/SillyTavern-Character-Creator), [WREC](https://github.com/bmen25124/SillyTavern-WorldInfo-Recommender), and [WeatherPack](https://github.com/bmen25124/SillyTavern-WeatherPack). Extension settings allow you to [customize](https://imgur.com/j8eZZdh) the templates.
- Usage Tracker: Show token/usage [statistics](https://imgur.com/9dSKaxg). (Price and cached tokens are not calculated yet.)

**What things did not implement:**

- STScript, QRs, slash commands, detailed macro system.
- More built-in extensions. E.g. NeoTavern don't have a TTS or image generation extension yet.
- NovelAI/Horde/KoboldClassic. If they have OpenAI compatible API, we can add later. If not, we are not planning to add them.

**Thing that not implemented fully:**

- Mobile Support: Basic layout is responsive, but there are still some rough edges.
- UI/UX: It needs polish and improvements.
- World Info: Outlets and timed effects are not implemented.
- Local Providers: Currently, there is only koboldcpp/ollama support. LM Studio/llamaserver/others are planned.
- Instruct Templates: We can import/edit/use them. But we have not implemented the whole field, such as `wrap`.
- Multi-user mode: We can select users in the beginning. But there is no user management system yet.

**For extension developers:**

- Read the above HackMD post for design philosophy. Currently, there is no documentation or NPM package for types. Because extensions are not prioritized yet.

## Prerequisites

- **Node.js:** Version 20 or higher.
- **Git:** Required to download the repository and managing the internal backend.

## Installation and Usage

NeoTavern acts as an "All-In-One" launcher. It will automatically download SillyTavern (as a submodule), install the necessary plugins, and run both the backend and frontend.

### Windows

1. Clone the repository:
   ```bash
   git clone https://github.com/NeoTavern/NeoTavern-Frontend.git
   ```
2. Navigate to the folder.
3. Double-click `start.bat`.

The script will setup the environment and launch the app at `http://localhost:8000`.

### Linux / macOS

1. Clone the repository:
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

NeoTavern runs in a single session. You do **not** need to run SillyTavern separately.

1. Install dependencies:
   ```bash
   pkg update && pkg upgrade
   pkg install git nodejs
   ```
2. Clone and run:
   ```bash
   cd ~
   git clone https://github.com/NeoTavern/NeoTavern-Frontend.git
   cd NeoTavern-Frontend
   chmod +x start.sh
   ./start.sh
   ```
3. Open your browser to `http://localhost:8000`.

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

1. Start the app and open Chrome to `http://localhost:8000`.
2. Tap the **Three Dots Menu** (top right).
3. Tap **"Add to Home screen"** or **"Install App"**.
4. The NeoTavern icon will appear in your app drawer. You can now launch it directly without opening Chrome first.

**On Desktop (Chrome/Edge):**

1. Open the app in your browser.
2. Click the **Install icon** in the right side of the address bar.

## FAQ

> Can I use my existing ST backend?

Yes.

1. Run NeoTavern once to generate `launcher-config.json`.
2. Edit the file: set `"useInternalBackend": false` and `"externalBackendUrl": "http://127.0.0.1:8000"`.
3. **Important:** You must install the [NeoTavern-Server-Plugin](https://github.com/NeoTavern/NeoTavern-Server-Plugin) manually in your existing backend.

> Where is my data saved?

If using the default internal backend, your data is in `backend/data/`. You can copy your existing characters/lorebooks there.

> How can I reset my NeoTavern data?

Remove these folders/files in your `backend/data/default-user/` directory and refresh the page:

- `NeoSettings.json`
- `NeoSamplers`
- `NeoThemes`

## Configuration

On the first run, `launcher-config.json` is generated in the root directory. You can use this file to configure:

- **Port**: Change the port NeoTavern runs on.
- **Host**: Change to `0.0.0.0` to allow access from other devices (LAN).
- **Backend Mode**: Switch between Internal (managed) or External SillyTavern instances.
