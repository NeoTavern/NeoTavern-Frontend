import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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

// const AUTH_USER = 'test';
// const AUTH_PASS = 'test';

const proxyRules = {
  '/backgrounds': { target: 'http://localhost:8000', changeOrigin: true },
  '/characters': { target: 'http://localhost:8000', changeOrigin: true },
  '/personas': { target: 'http://localhost:8000', changeOrigin: true },
  '/api': { target: 'http://localhost:8000', changeOrigin: true },
  '/csrf-token': { target: 'http://localhost:8000', changeOrigin: true },
  '/thumbnail': { target: 'http://localhost:8000', changeOrigin: true },
  '/user': { target: 'http://localhost:8000', changeOrigin: true },
  '/login-check': {
    target: 'http://localhost:8000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/login-check/, '/'),
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const setupAuth = (_server) => {
  // server.middlewares.use((req, res, next) => {
  //   const isAsset =
  //     req.url?.includes('/assets/') ||
  //     req.url?.includes('/img/') ||
  //     req.url?.includes('/node_modules/') ||
  //     req.url?.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json)(\?.*)?$/);
  //   if (isAsset) {
  //     next();
  //     return;
  //   }
  //   const header = req.headers.authorization || '';
  //   if (!header) {
  //     res.statusCode = 401;
  //     res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
  //     res.end('Unauthorized');
  //     return;
  //   }
  //   const [type, credentials] = header.split(' ');
  //   const [user, pass] = Buffer.from(credentials, 'base64').toString().split(':');
  //   if (type !== 'Basic' || user !== AUTH_USER || pass !== AUTH_PASS) {
  //     res.statusCode = 401;
  //     res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
  //     res.end('Access denied');
  //     return;
  //   }
  //   next();
  // });
};

export default defineConfig(({ mode }) => {
  const isDevBuild = mode !== 'production';

  return {
    plugins: [
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
      {
        name: 'basic-auth',
        configureServer(server) {
          setupAuth(server);
        },
        configurePreviewServer(server) {
          setupAuth(server);
        },
      },
    ],
    resolve: {
      alias: {
        vue: 'vue/dist/vue.esm-bundler.js',
      },
    },
    server: {
      port: 3000,
      host: false,
      allowedHosts: true,
      proxy: proxyRules,
    },
    preview: {
      port: 4173,
      host: true,
      allowedHosts: true,
      proxy: proxyRules,
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
