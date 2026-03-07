import { COPYFILE_EXCL } from 'constants';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';
import { isEqual } from 'lodash-es';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { isErrnoException } from './typeguards.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'launcher-config.json');

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
        enabled: z.literal([false, undefined]).default(false),
      }),
      z.object({
        enabled: z.literal(true),
        username: z.string(),
        password: z.string(),
      }),
    ])
    .default({ enabled: false })
    .meta({ description: 'Use HTTP Basic Auth' }),
});

/** Zod schema for launcher-config.json (used by launcher.js). */
export const LauncherConfig = z.discriminatedUnion('useInternalBackend', [
  z.looseObject({
    ...launcherConfigSchemaWithoutBackend.shape,
    useInternalBackend: z
      .literal([true, undefined])
      .default(true)
      .meta({ description: 'Use bundled SillyTavern backend' }),
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

export type LauncherConfig = z.infer<typeof LauncherConfig>;
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
  return LauncherConfig.parse(data);
}

/**
 * Loads the configuration from the default path and saves it if it is missing any keys from the default config.
 * Then applies the environment variables to the config.
 * @returns Validated config with defaults and environment variables applied
 */
export function loadConfigAndSaveIfNeeded(
  path: string = CONFIG_PATH,
  { applyEnvironment }: { applyEnvironment: boolean } = { applyEnvironment: true },
): LauncherConfig {
  let loadedAsString: string;
  try {
    loadedAsString = readFileSync(path, 'utf8');
  } catch (e) {
    if (isErrnoException(e) && e.code === 'ENOENT') {
      loadedAsString = '{}';
    } else {
      throw e;
    }
  }
  const unvalidatedConfig = JSON.parse(loadedAsString);
  let config = LauncherConfig.parse(unvalidatedConfig);

  if (!isEqual(unvalidatedConfig, config)) {
    backupFile(path, { ignoreAbsent: true });
    writeFileSync(path, JSON.stringify(config, null, 2));
  }

  if (applyEnvironment) {
    config = applyEnvironmentVariables(config);
  }
  return config;
}

function applyEnvironmentVariables(config: LauncherConfig): LauncherConfig {
  if (process.env.NEO_APP_PORT) config.appPort = parseInt(process.env.NEO_APP_PORT, 10);
  if (process.env.NEO_APP_HOST) config.appHost = process.env.NEO_APP_HOST;
  if (process.env.NEO_BACKEND_PORT) config.internalBackendPort = parseInt(process.env.NEO_BACKEND_PORT, 10);
  if (process.env.NEO_USE_INTERNAL_BACKEND)
    config.useInternalBackend = process.env.NEO_USE_INTERNAL_BACKEND.toLowerCase() === 'true';
  if (process.env.NEO_EXTERNAL_BACKEND_URL) config.externalBackendUrl = process.env.NEO_EXTERNAL_BACKEND_URL;
  if (process.env.NEO_AUTO_UPDATE_BACKEND)
    config.autoUpdateBackend = process.env.NEO_AUTO_UPDATE_BACKEND.toLowerCase() === 'true';
  if (process.env.NEO_EXPOSE_INTERNAL_BACKEND)
    config.exposeInternalBackend = process.env.NEO_EXPOSE_INTERNAL_BACKEND.toLowerCase() === 'true';
  if (process.env.NEO_BASIC_AUTH_ENABLED)
    config.basicAuth.enabled = process.env.NEO_BASIC_AUTH_ENABLED.toLowerCase() === 'true';
  if (process.env.NEO_BASIC_AUTH_USERNAME) config.basicAuth.username = process.env.NEO_BASIC_AUTH_USERNAME;
  if (process.env.NEO_BASIC_AUTH_PASSWORD) config.basicAuth.password = process.env.NEO_BASIC_AUTH_PASSWORD;

  return config;
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

function backupFile(path: string, { ignoreAbsent }: { ignoreAbsent: boolean } = { ignoreAbsent: false }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    copyFileSync(path, `${path}.${timestamp}.bak`, COPYFILE_EXCL);
  } catch (e) {
    if (ignoreAbsent && isErrnoException(e) && e.code === 'ENOENT') {
      return;
    }
    throw e;
  }
}
