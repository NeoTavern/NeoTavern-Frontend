import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import yaml from 'js-yaml';
import { execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PATHS = {
  CONFIG: path.join(__dirname, 'launcher-config.json'),
  BACKEND: path.join(__dirname, 'backend'),
  PLUGINS: path.join(__dirname, 'backend', 'plugins'),
  ST_CONFIG: path.join(__dirname, 'backend', 'config.yaml'),
  DIST: path.join(__dirname, 'dist'),
  BACKEND_HASH: path.join(__dirname, 'backend', 'node_modules', '.package-json.hash'),
  BUILD_HASH: path.join(__dirname, 'dist', '.build_hash'),
};

const REPO_URLS = {
  BACKEND: 'https://github.com/SillyTavern/SillyTavern',
  BACKEND_BRANCH: 'staging',
  PLUGIN: 'https://github.com/NeoTavern/NeoTavern-Server-Plugin',
};

// Default Config
const DEFAULT_CONFIG = {
  appPort: 8000,
  appHost: '0.0.0.0',
  useInternalBackend: true,
  internalBackendPort: 8001,
  externalBackendUrl: 'http://127.0.0.1:8000',
  autoUpdateBackend: true,
};

function loadConfig() {
  let config;
  if (!fs.existsSync(PATHS.CONFIG)) {
    fs.writeFileSync(PATHS.CONFIG, JSON.stringify(DEFAULT_CONFIG, null, 2));
    config = { ...DEFAULT_CONFIG };
  } else {
    try {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(PATHS.CONFIG, 'utf8')) };
    } catch {
      config = { ...DEFAULT_CONFIG };
    }
  }

  // Override with environment variables
  if (process.env.NEO_APP_PORT) config.appPort = parseInt(process.env.NEO_APP_PORT, 10);
  if (process.env.NEO_APP_HOST) config.appHost = process.env.NEO_APP_HOST;
  if (process.env.NEO_BACKEND_PORT) config.internalBackendPort = parseInt(process.env.NEO_BACKEND_PORT, 10);
  if (process.env.NEO_USE_INTERNAL_BACKEND)
    config.useInternalBackend = process.env.NEO_USE_INTERNAL_BACKEND.toLowerCase() === 'true';
  if (process.env.NEO_EXTERNAL_BACKEND_URL) config.externalBackendUrl = process.env.NEO_EXTERNAL_BACKEND_URL;
  if (process.env.NEO_AUTO_UPDATE_BACKEND)
    config.autoUpdateBackend = process.env.NEO_AUTO_UPDATE_BACKEND.toLowerCase() === 'true';

  return config;
}

const config = loadConfig();

// --- Utils ---

function log(msg, type = 'INFO') {
  console.log(`[NeoLauncher:${type}] ${msg}`);
}

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit', cwd, shell: true });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command} (Code: ${code})`));
    });
  });
}

function getHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function getGitHash() {
  try {
    return execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// --- Logic ---

async function setupInternalBackend() {
  // 1. Clone Backend (Only if missing package.json, assume fresh install)
  if (!fs.existsSync(path.join(PATHS.BACKEND, 'package.json'))) {
    log('Cloning SillyTavern Backend...', 'SETUP');

    // Clean up if invalid dir exists
    if (fs.existsSync(PATHS.BACKEND)) {
      try {
        fs.rmSync(PATHS.BACKEND, { recursive: true, force: true });
      } catch {}
    }

    await runCommand('git', ['clone', '-b', REPO_URLS.BACKEND_BRANCH, REPO_URLS.BACKEND, 'backend'], __dirname);
  } else if (config.autoUpdateBackend) {
    try {
      await runCommand('git', ['pull'], PATHS.BACKEND);
    } catch (e) {
      log('Backend update failed (potentially local changes). Continuing...', 'WARN');
    }
  }

  // 2. Strict Backend Install (npm ci)
  const pkgHash = getHash(path.join(PATHS.BACKEND, 'package.json'));
  let storedHash = fs.existsSync(PATHS.BACKEND_HASH) ? fs.readFileSync(PATHS.BACKEND_HASH, 'utf8') : null;

  if (!fs.existsSync(path.join(PATHS.BACKEND, 'node_modules')) || pkgHash !== storedHash) {
    log('Installing Backend dependencies (npm ci)...', 'SETUP');
    await runCommand('npm', ['ci'], PATHS.BACKEND);

    if (!fs.existsSync(path.join(PATHS.BACKEND, 'node_modules')))
      fs.mkdirSync(path.join(PATHS.BACKEND, 'node_modules'));
    fs.writeFileSync(PATHS.BACKEND_HASH, pkgHash);
  }

  // 3. Plugin Setup
  const pluginPath = path.join(PATHS.PLUGINS, 'NeoTavern-Server-Plugin');
  if (!fs.existsSync(pluginPath)) {
    log('Cloning NeoTavern Plugin...', 'SETUP');
    await runCommand('git', ['clone', REPO_URLS.PLUGIN], PATHS.PLUGINS);
  } else if (config.autoUpdateBackend) {
    try {
      await runCommand('git', ['pull'], pluginPath);
    } catch (e) {
      log('Plugin update failed. Continuing...', 'WARN');
    }
  }

  // 4. Config Enforcement
  if (!fs.existsSync(PATHS.ST_CONFIG)) {
    const def = path.join(PATHS.BACKEND, 'config-default.yaml');
    if (fs.existsSync(def)) fs.copyFileSync(def, PATHS.ST_CONFIG);
    else fs.writeFileSync(PATHS.ST_CONFIG, 'port: 8000\n');
  }

  let raw = fs.readFileSync(PATHS.ST_CONFIG, 'utf8');
  let stConf = yaml.load(raw) || {};
  let modified = false;

  // Enforce Port
  if (stConf.port !== config.internalBackendPort) {
    stConf.port = config.internalBackendPort;
    modified = true;
  }
  // Enforce Plugins
  if (stConf.enableServerPlugins !== true) {
    stConf.enableServerPlugins = true;
    modified = true;
  }
  // Enforce No Browser
  if (!stConf.browserLaunch) stConf.browserLaunch = {};
  if (stConf.browserLaunch.enabled !== false) {
    stConf.browserLaunch.enabled = false;
    modified = true;
  }

  if (modified) {
    log('Updating Backend config.yaml...', 'CONFIG');
    fs.writeFileSync(PATHS.ST_CONFIG, yaml.dump(stConf));
  }
}

async function ensureFrontendBuilt() {
  const currentHash = getGitHash() || getHash(path.join(__dirname, 'package.json'));
  const storedHash = fs.existsSync(PATHS.BUILD_HASH) ? fs.readFileSync(PATHS.BUILD_HASH, 'utf8') : null;

  if (!fs.existsSync(path.join(PATHS.DIST, 'index.html')) || currentHash !== storedHash) {
    log('Building Frontend...', 'BUILD');
    await runCommand('npm', ['run', 'build:deploy'], __dirname);

    if (!fs.existsSync(PATHS.DIST)) fs.mkdirSync(PATHS.DIST);
    if (currentHash) fs.writeFileSync(PATHS.BUILD_HASH, currentHash);
  }
}

// --- Main ---

async function start() {
  try {
    process.env.NEO_APP_PORT = config.appPort.toString();
    process.env.NEO_APP_HOST = config.appHost;
    process.env.NEO_BACKEND_PORT = config.internalBackendPort.toString();
    process.env.NEO_USE_INTERNAL_BACKEND = config.useInternalBackend.toString();
    process.env.NEO_EXTERNAL_BACKEND_URL = config.externalBackendUrl;

    // 1. Backend
    if (config.useInternalBackend) {
      await setupInternalBackend();
      log(`Starting Internal Backend (Port ${config.internalBackendPort})...`, 'START');

      const backend = spawn('node', ['server.js'], {
        cwd: PATHS.BACKEND,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      backend.stdout.on('data', (d) => process.stdout.write(`[ST] ${d}`));
      backend.stderr.on('data', (d) => process.stderr.write(`[ST-ERR] ${d}`));

      process.on('SIGINT', () => backend.kill());
      process.on('SIGTERM', () => backend.kill());
    } else {
      log(`External Backend Mode: ${config.externalBackendUrl}`, 'START');
    }

    // 2. Frontend
    await ensureFrontendBuilt();

    // 3. Serve
    const app = express();
    const proxyTarget = config.useInternalBackend
      ? `http://127.0.0.1:${config.internalBackendPort}`
      : config.externalBackendUrl;

    const routes = [
      '/api',
      '/files',
      '/characters',
      '/backgrounds',
      '/user',
      '/scripts',
      '/css',
      '/img',
      '/sounds',
      '/favicon.ico',
      '/plugins',
      '/login-check',
      '/csrf-token',
      '/thumbnail',
      '/personas',
    ];

    const proxy = createProxyMiddleware({
      target: proxyTarget,
      changeOrigin: true,
      ws: true,
      logLevel: 'error',
      pathFilter: routes,
    });

    app.use(proxy);
    app.use(express.static(PATHS.DIST));
    app.get('*', (req, res) => res.sendFile(path.join(PATHS.DIST, 'index.html')));

    app.listen(config.appPort, config.appHost, () => {
      console.log(`\n> NeoTavern UI: http://${config.appHost}:${config.appPort}\n`);
    });
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

start();
