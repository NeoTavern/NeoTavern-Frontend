import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
    vue(),
    VueI18nPlugin({
      include: resolve(__dirname, './locales/**'),
      strictMessage: false, //bypassing html error
    }),
  ],
  test: {
    setupFiles: ['./test/vitest.setup.ts'],
    include: ['test/**/*'],
    exclude: ['./test/vitest.setup.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/i18n.ts'],
      thresholds: {
        branches: 75,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
  },
});
