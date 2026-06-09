/**
 * Schema and defaults for optional vite.config.local.ts dev overrides.
 * Local file exports DevOverrides (or default); all logic lives in vite.config.ts.
 */
/// <reference types="node" />

import type { ProxyOptions } from 'vite';
import type { LauncherConfig } from './laucher-config.ts';

export function launcherConfigAsDevOverrides(config: LauncherConfig): DevOverrides {
  return {
    proxyTarget: config.useInternalBackend
      ? `http://127.0.0.1:${config.internalBackendPort}`
      : config.externalBackendUrl,
    server: {
      port: config.appPort,
      host: config.appHost,
    },
    preview: {
      port: config.appPort,
      host: config.appHost,
    },
    auth: config.basicAuth.enabled ? { user: config.basicAuth.username, pass: config.basicAuth.password } : undefined,
  };
}

export interface DevOverrides {
  /** Proxy target for dev/preview (default: http://localhost:8000) */
  proxyTarget?: string;
  /** Extra options merged into every proxy rule (e.g. `ca` for self-signed backend certs). */
  proxyOptions?: Partial<ProxyOptions>;
  server?: { host?: boolean | string; port?: number };
  preview?: { host?: boolean | string; port?: number };
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
