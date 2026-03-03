/**
 * Schema and defaults for optional vite.config.local.ts dev overrides.
 * Local file exports DevOverrides (or default); all logic lives in vite.config.ts.
 */

export interface DevOverrides {
  /** Proxy target for dev/preview (default: http://localhost:8000) */
  proxyTarget?: string;
  server?: { host?: boolean; port?: number };
  preview?: { host?: boolean; port?: number };
  /** When set, main config reads cert/key and sets server.https / preview.https */
  https?: { certPath: string; keyPath: string };
  /** When set, Basic auth is required; validate against this user/pass. Omit for no auth. */
  auth?: { user: string; pass: string };
}

export const defaultDevOverrides: DevOverrides = {
  proxyTarget: 'http://localhost:8000',
  server: { port: 3000, host: false },
  preview: { port: 4173, host: true },
};
