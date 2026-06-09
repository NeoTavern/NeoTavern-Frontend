/**
 * Example local dev overrides. Copy to vite.config.local.ts and customize.
 * vite.config.local.ts is gitignored; never commit real secrets or paths.
 *
 * @see server/vite-dev-overrides.ts for the full DevOverrides shape.
 */

import type { DevOverrides } from './server/vite-dev-overrides.ts';

export const devOverrides: DevOverrides = {
  // Proxy target for dev/preview (default: http://localhost:8000)
  proxyTarget: 'http://localhost:8000',
  // Optional: trust a CA for backend TLS (self-signed or internal). Pass PEM content, e.g. readFileSync('/path/to/ca.pem', 'utf-8').
  // proxyOptions: { ca: '<PEM string>' },

  server: { port: 3000, host: false },
  preview: { port: 4173, host: true },

  // Uncomment to enable HTTPS (paths to PEM cert and key)
  // https: { certPath: '/path/to/cert.pem', keyPath: '/path/to/key.pem' },

  // Uncomment for Basic auth (validates against user/pass)
  // auth: { user: 'your-user', pass: 'your-pass' },
};
