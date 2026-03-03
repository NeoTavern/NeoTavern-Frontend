/**
 * Example local dev overrides. Copy to vite.config.local.ts and customize.
 * vite.config.local.ts is gitignored; never commit real secrets or paths.
 *
 * @see vite-dev-overrides.ts for the full DevOverrides shape.
 */

import type { DevOverrides } from './vite-dev-overrides';

export const devOverrides: DevOverrides = {
  // Proxy target for dev/preview (default: http://localhost:8000)
  proxyTarget: 'http://localhost:8000',

  server: { port: 3000, host: false },
  preview: { port: 4173, host: true },

  // Uncomment to enable HTTPS (paths to PEM cert and key)
  // https: { certPath: '/path/to/cert.pem', keyPath: '/path/to/key.pem' },

  // Uncomment for Basic auth: true = any credentials, or { user, pass } to validate
  // auth: true,
  // auth: { user: 'your-user', pass: 'your-pass' },
};
