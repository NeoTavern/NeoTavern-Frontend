/**
 * Schema and defaults for optional vite.config.local.ts dev overrides.
 * Local file exports DevOverrides (or default); all logic lives in vite.config.ts.
 */
/// <reference types="node" />

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProxyOptions } from 'vite';
import { z } from 'zod';
import { isErrnoException } from './typeguards.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'launcher-config.json');

/** TCP/UDP port number (1–65535) */
const port = z.int().min(1).max(65535);

const launcherConfigSchemaWithoutBackend = z.object({
  appPort: port.default(8000).meta({ description: 'NeoTavern UI port' }),
  appHost: z
    .string()
    .default('0.0.0.0')
    .meta({ description: 'NeoTavern UI host to bind to (0.0.0.0 for all interfaces)' }),
  basicAuth: z
    .discriminatedUnion('enabled', [
      z.looseObject({
        enabled: z.literal(false).default(false), // default should be the first in the union
      }),
      z.object({
        enabled: z.literal(true),
        username: z.string(),
        password: z.string(),
      }),
    ])
    .meta({ description: 'Use HTTP Basic Auth' }),
});

/** Zod schema for launcher-config.json (used by launcher.js). */
export const launcherConfigSchema = z.discriminatedUnion('useInternalBackend', [
  z.looseObject({
    ...launcherConfigSchemaWithoutBackend.shape,
    useInternalBackend: z.literal(true).default(true).meta({ description: 'Use bundled SillyTavern backend' }),
    internalBackendPort: port.default(8001).meta({ description: 'Internal SillyTavern backend port' }),
    autoUpdateBackend: z.boolean().default(true).meta({ description: 'Auto-update internal SillyTavern backend' }),
    exposeInternalBackend: z
      .boolean()
      .default(false)
      .meta({ description: 'Expose internal SillyTavern backend to network' }),
  }),
  z.looseObject({
    ...launcherConfigSchemaWithoutBackend.shape,
    useInternalBackend: z.literal(false).meta({ description: 'Use external SillyTavern backend' }),
    externalBackendUrl: z
      .url()
      .default('http://127.0.0.1:8000')
      .meta({ description: 'External SillyTavern backend URL' }),
  }),
]);

export type LauncherConfig = z.infer<typeof launcherConfigSchema>;

/**
 * Load and parse launcher-config.json from CONFIG_PATH.
 * @returns Validated config with defaults applied
 * @throws If the file is missing, invalid JSON, or does not match launcherConfigSchema
 */
export function loadLauncherConfig(configPath: string = CONFIG_PATH): LauncherConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (error) {
    if (isErrnoException(error)) {
      if (error.code === 'ENOENT') {
        throw new ConfigNotFoundError(configPath, { cause: error });
      }
    }
    throw new Error(`Failed to load launcher config from ${configPath}: ${error}`, { cause: error });
  }
  const data = JSON.parse(raw) as unknown;
  return launcherConfigSchema.parse(data);
}

export class ConfigNotFoundError extends Error {
  code: string;
  path: string;
  constructor(configPath: string, options?: { cause?: NodeJS.ErrnoException | Error }) {
    super(`Config file not found: ${configPath}`, options);
    this.name = 'ConfigNotFoundError';
    this.code = 'ENOENT';
    this.path = configPath;
  }
}

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
