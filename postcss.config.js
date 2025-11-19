import purgecssWrapper from '@fullhuman/postcss-purgecss';
import reporter from 'postcss-reporter';

const purgeCssPlugin = purgecssWrapper.default || purgecssWrapper;

export default {
  plugins: [
    process.env.NODE_ENV === 'production' &&
      purgeCssPlugin({
        content: ['./index.html', './src/**/*.vue', './src/**/*.ts', './src/**/*.js'],

        rejected: true,

        safelist: {
          standard: [
            /^body$/,
            /^html$/,
            /data-v-.*/, // Scoped styles
            /-(leave|enter|appear)(|-(to|from|active))$/, // Transitions
            /^router-link(|-exact)-active$/, // Vue Router

            /^fa-/,
            /^svg-/,
            'fas',
            'far',
            'fab',
          ],
        },
      }),

    process.env.NODE_ENV === 'production' &&
      reporter({
        filter: (message) => message.plugin === 'postcss-purgecss',
        clearReportedMessages: true,
        formatter: (input) => {
          if (input.messages.length === 0) return '';

          let output = `\n🔍 PurgeCSS Report:\n`;
          input.messages.forEach((msg) => {
            output += `   ⚠️  Removed: ${msg.text}\n`;
          });
          return output;
        },
      }),
  ],
};
