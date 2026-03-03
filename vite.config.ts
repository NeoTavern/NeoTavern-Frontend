import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { DevOverrides } from './vite-dev-overrides';
import { defaultDevOverrides } from './vite-dev-overrides';

// Android 14+ blocks /proc/stat, causing os.cpus() to return empty.
// This crashes Terser/Rollup. We fake a single CPU core to fix it.
try {
  if (!os.cpus() || os.cpus().length === 0) {
    os.cpus = () => [
      {
        model: 'Termux Fix',
        speed: 1000,
        times: { user: 100, nice: 0, sys: 100, idle: 100, irq: 0 },
      },
    ];
  }
} catch (e) {
  console.warn('Failed to apply Termux CPU fix:', e);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadDevOverrides(): Promise<DevOverrides> {
  const localPath = resolve(__dirname, 'vite.config.local.ts');
  try {
    const mod = await import(pathToFileURL(localPath).href);
    const o = mod.devOverrides ?? mod.default;
    return { ...defaultDevOverrides, ...o };
  } catch {
    return defaultDevOverrides;
  }
}

function createBasicAuthMiddleware(overrides: DevOverrides) {
  if (!overrides.auth) return (server: { middlewares: { use: (fn: (req: unknown, res: unknown, next: () => void) => void) => void } }) => {};
  const auth = overrides.auth;
  const checkCredentials =
    auth === true
      ? () => true
      : (user: string, pass: string) => user === auth.user && pass === auth.pass;

  return (server: { middlewares: { use: (fn: (req: unknown, res: unknown, next: () => void) => void) => void } }) => {
    server.middlewares.use((req: { url?: string; headers?: { authorization?: string } }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void }, next: () => void) => {
      const isAsset =
        req.url?.includes('/assets/') ||
        req.url?.includes('/img/') ||
        req.url?.includes('/node_modules/') ||
        req.url?.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json)(\?.*)?$/);
      if (isAsset) {
        next();
        return;
      }
      const header = req.headers?.authorization ?? '';
      if (!header) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
        res.end('Unauthorized');
        return;
      }
      const [type, credentials] = header.split(' ');
      const [user, pass] = Buffer.from(credentials ?? '', 'base64').toString().split(':');
      if (type !== 'Basic' || !checkCredentials(user, pass)) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
        res.end('Access denied');
        return;
      }
      next();
    });
  };
}

const PROXY_PATHS = [
  '/backgrounds',
  '/characters',
  '/personas',
  '/api',
  '/csrf-token',
  '/thumbnail',
  '/user',
] as const;

function buildProxyRules(proxyTarget: string) {
  const rules: Record<string, { target: string; changeOrigin: boolean; rewrite?: (path: string) => string }> = {};
  for (const p of PROXY_PATHS) {
    rules[p] = { target: proxyTarget, changeOrigin: true };
  }
  rules['/login-check'] = {
    target: proxyTarget,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/login-check/, '/'),
  };
  return rules;
}

export default defineConfig(async ({ mode }) => {
  const overrides = await loadDevOverrides();
  const isDevBuild = mode !== 'production';
  const proxyTarget = overrides.proxyTarget ?? defaultDevOverrides.proxyTarget!;
  const proxyRules = buildProxyRules(proxyTarget);
  const httpsOptions = overrides.https
    ? {
        cert: readFileSync(overrides.https.certPath),
        key: readFileSync(overrides.https.keyPath),
      }
    : undefined;
  const setupAuth = createBasicAuthMiddleware(overrides);

  const plugins = [
    vue(),
    VueI18nPlugin({
      include: resolve(__dirname, './locales/**'),
      strictMessage: false,
    }),
    VitePWA({
      registerType: 'prompt',
      minify: false,
      includeAssets: ['favicon.ico', 'img/*.svg'],
      manifest: {
        name: 'NeoTavern',
        short_name: 'NeoTavern',
        description: 'A modern, experimental frontend for SillyTavern',
        theme_color: '#171717',
        background_color: '#171717',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        navigateFallbackDenylist: [
          /^\/api/,
          /^\/characters/,
          /^\/backgrounds/,
          /^\/personas/,
          /^\/login-check/,
          /^\/user/,
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
      },
    }),
  ];
  if (overrides.auth) {
    plugins.push({
      name: 'basic-auth',
      configureServer(server) {
        setupAuth(server);
      },
      configurePreviewServer(server) {
        setupAuth(server);
      },
    });
  }

  return {
    plugins,
    resolve: {
      alias: {
        vue: 'vue/dist/vue.esm-bundler.js',
      },
    },
    server: {
      port: overrides.server?.port ?? defaultDevOverrides.server?.port ?? 3000,
      host: overrides.server?.host ?? defaultDevOverrides.server?.host ?? false,
      allowedHosts: true,
      proxy: proxyRules,
      ...(httpsOptions && { https: httpsOptions }),
    },
    preview: {
      port: overrides.preview?.port ?? defaultDevOverrides.preview?.port ?? 4173,
      host: overrides.preview?.host ?? defaultDevOverrides.preview?.host ?? true,
      allowedHosts: true,
      proxy: proxyRules,
      ...(httpsOptions && { https: httpsOptions }),
    },
    build: {
      minify: isDevBuild ? false : 'esbuild',
      sourcemap: isDevBuild,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('vue') || id.includes('pinia') || id.includes('@intlify')) {
                return 'vendor-core';
              }
              if (id.includes('codemirror') || id.includes('@codemirror')) {
                return 'vendor-editor';
              }
              if (id.includes('marked') || id.includes('dompurify') || id.includes('yaml')) {
                return 'vendor-utils';
              }
              if (id.includes('fortawesome')) {
                return 'vendor-icons';
              }
              return 'vendor-common';
            }
          },
        },
      },
    },
  };
});
