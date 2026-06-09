import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import { merge } from 'lodash-es';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ProxyOptions, UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { isErrnoException } from './server/typeguards.ts';
import type { DevOverrides } from './server/vite-dev-overrides.ts';
import {
  defaultDevOverrides,
  launcherConfigAsDevOverrides,
} from './server/vite-dev-overrides.ts';
import { applyEnvironmentVariables, ConfigNotFoundError, loadLauncherConfig } from './server/laucher-config.ts';
import { BasicAuthPlugin } from './server/vite-plugins.ts';

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
    applyEnvironmentVariables(launcherConfig);
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
  return merge({}, ...overrideSources) as DevOverrides;
}

const PROXY_PATHS = ['/backgrounds', '/characters', '/personas', '/api', '/csrf-token', '/thumbnail', '/user'] as const;

function buildProxyRules(proxyTarget: string, extraOptions?: Partial<ProxyOptions>): Record<string, ProxyOptions> {
  /* Note proxy configuration code is currently not shared with launcher.js because its
     http-proxy-middleware uses legacy http-proxy library, whereas vite uses http-proxy-3.
     This may change in the near future:
       - using http-proxy-3: https://github.com/chimurai/http-proxy-middleware/pull/1159
       - using httpxy: https://github.com/chimurai/http-proxy-middleware/pull/1160

     Practically speaking, the feature gap is that http-proxy does not give easy access to
     CA customization, which is one of the use cases for proxy option overrides. 
  */

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
  const isDevBuild = mode !== 'production';
  const overrides = await loadMergedOverrides();
  const proxyRules = buildProxyRules(overrides.proxyTarget ?? 'http://localhost:8000', overrides.proxyOptions);
  const httpsOptions = overrides.https
    ? {
        cert: readFileSync(overrides.https.certPath),
        key: readFileSync(overrides.https.keyPath),
      }
    : undefined;

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
    plugins.push(new BasicAuthPlugin(overrides.auth.user, overrides.auth.pass));
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
