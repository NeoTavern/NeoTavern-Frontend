import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import { merge } from 'lodash-es';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Connect, ProxyOptions, UserConfig, ViteDevServer, PreviewServer } from 'vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { DevOverrides } from './vite-dev-overrides';
import { ConfigNotFoundError, defaultDevOverrides, isErrnoException, launcherConfigAsDevOverrides, loadLauncherConfig } from './vite-dev-overrides';

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

const CONFIG_LOCAL_FILE = 'vite.config.local.ts';

async function loadConfigLocal(): Promise<DevOverrides> {
  try {
    const localPath = resolve(__dirname, CONFIG_LOCAL_FILE);
    const configLocal = await import(pathToFileURL(localPath).href);
    console.log('Applying local config from', CONFIG_LOCAL_FILE);
    return configLocal.devOverrides ?? configLocal.default;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      // No local config file, this is normal.
      return {};
    } else {
      throw error;
    }
  }
}

async function loadMergedOverrides(): Promise<DevOverrides> {
  const overrideSources: DevOverrides[] = [defaultDevOverrides];
  try {
    const launcherConfig = loadLauncherConfig();
    console.log('Applying launcher config.');
    overrideSources.push(launcherConfigAsDevOverrides(launcherConfig));
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      // No launcher config file, that's okay.
    } else {
      throw error;
    }
  }
  overrideSources.push(await loadConfigLocal());
  console.log("override sources", overrideSources);
  return merge({}, ...overrideSources) as DevOverrides;
}

function createBasicAuthMiddleware<R extends ViteDevServer | PreviewServer>(overrides: DevOverrides): (server: R) => void {
  if (!overrides.auth) return (server) => void server;

  const { user: authUser, pass: authPass } = overrides.auth;
  const checkCredentials = (user: string, pass: string) => user === authUser && pass === authPass;

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
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
    const [user, pass] = Buffer.from(credentials ?? '', 'base64')
      .toString()
      .split(':');
    if (type !== 'Basic' || !checkCredentials(user, pass)) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
      res.end('Access denied');
      return;
    }
    next();
  };

  return (server) => server.middlewares.use(middleware);
}

const PROXY_PATHS = ['/backgrounds', '/characters', '/personas', '/api', '/csrf-token', '/thumbnail', '/user'] as const;

function buildProxyRules(proxyTarget: string, extraOptions?: Partial<ProxyOptions>): Record<string, ProxyOptions> {
  const base: Partial<ProxyOptions> = { target: proxyTarget, changeOrigin: true, ...extraOptions };
  const rules: Record<string, ProxyOptions> = {};
  for (const p of PROXY_PATHS) {
    rules[p] = { ...base } as ProxyOptions;
  }
  rules['/login-check'] = {
    ...base,
    rewrite: (path) => path.replace(/^\/login-check/, '/'),
  } as ProxyOptions;
  return rules;
}

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  const overrides = await loadMergedOverrides();
  const isDevBuild = mode !== 'production';
  const proxyTarget = overrides.proxyTarget ?? 'http://localhost:8000';
  const proxyRules = buildProxyRules(proxyTarget, overrides.proxyOptions);
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
      port: overrides.server?.port ?? 3000,
      host: overrides.server?.host ?? false,
      allowedHosts: true,
      proxy: proxyRules,
      ...(httpsOptions && { https: httpsOptions }),
    },
    preview: {
      port: overrides.preview?.port ?? 4173,
      host: overrides.preview?.host ?? true,
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
