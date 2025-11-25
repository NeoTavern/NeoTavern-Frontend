import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    vue(),
    VueI18nPlugin({
      include: resolve(__dirname, './locales/**'),
      strictMessage: false,
    }),
    dts({
      rollupTypes: false,
      beforeWriteFile: (filePath, content) => ({
        filePath,
        content: `/**\n * SillyTavern Experimental Frontend - Extension Types\n * Version: ${process.env.npm_package_version}\n */\n\n${content}`,
      }),
    }),
  ],
  build: {
    outDir: 'dist/types',
    lib: {
      entry: resolve(__dirname, 'src/public-api.ts'),
      name: 'SillyTavernAPI', // A name for the library
      formats: ['es'],
      fileName: 'public-api',
    },
  },
});
