/**
 * Schema and defaults for optional vite.config.local.ts dev overrides.
 * Local file exports DevOverrides (or default); all logic lives in vite.config.ts.
 */

import type { ProxyOptions } from 'vite';
import { z } from 'zod';

/** Zod schema for launcher-config.json (used by launcher.js). */
export const launcherConfigSchema = z.object({
  appPort: z.number().int().min(1).max(65535),
  appHost: z.string(),
  useInternalBackend: z.boolean(),
  internalBackendPort: z.number().int().min(1).max(65535),
  externalBackendUrl: z.string().url(),
  autoUpdateBackend: z.boolean(),
  exposeInternalBackend: z.boolean(),
  basicAuth: z.object({
    enabled: z.boolean(),
    username: z.string(),
    password: z.string(),
  }),
});

export type LauncherConfig = z.infer<typeof launcherConfigSchema>;

export interface DevOverrides {
  /** Proxy target for dev/preview (default: http://localhost:8000) */
  proxyTarget?: string;
  /** Extra options merged into every proxy rule (e.g. `ca` for self-signed backend certs). */
  proxyOptions?: Partial<ProxyOptions>;
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
