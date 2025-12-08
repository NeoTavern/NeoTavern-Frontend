import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

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
      minify: !isDevBuild,
      sourcemap: isDevBuild,
    },
  };
});
