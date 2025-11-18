import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    VueI18nPlugin({
      include: resolve(__dirname, './locales/**'),
      strictMessage: false, //bypassing html error
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/backgrounds': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/characters': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/personas': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/csrf-token': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/thumbnail': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    minify: false,
    sourcemap: true,
  },
});
