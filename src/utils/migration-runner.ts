import { cloneDeep } from 'lodash-es';

/**
 * Defines the structure for a single migration step.
 * @template T The type of the object being migrated.
 */
export interface Migration<T> {
  /** The version number this migration upgrades TO. */
  version: number;
  /** The function that transforms the object to the next version. */
  migrate: (data: T) => T;
}

/**
 * Result object returned by the migration runner.
 */
export interface MigrationResult<T> {
  migrated: T;
  hasChanged: boolean;
}

/**
 * A generic function that runs a migration chain on an object.
 * It identifies the current version, filters applicable migrations,
 * sorts them, and applies them sequentially.
 *
 * @param data The object to migrate. Must have a 'version' property.
 * @param migrations The registry of available migration functions.
 * @param latestVersion The target version number to reach.
 * @returns An object containing the migrated data and a flag indicating if changes occurred.
 */
export function runMigrations<T extends { version: number }>(
  data: T,
  migrations: Migration<T>[],
  latestVersion: number,
): MigrationResult<T> {
  // Default to version 0 if the property is missing or 0
  const currentVersion = data.version || 0;

  if (currentVersion >= latestVersion) {
    return { migrated: data, hasChanged: false };
  }

  console.log(`[MigrationRunner] Migrating data from v${currentVersion} to v${latestVersion}...`);

  // Filter for applicable migrations (version > current) and sort ascending
  const applicableMigrations = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  // Clone data to avoid mutating the input reference directly during the process
  let migratedData = cloneDeep(data);

  for (const migration of applicableMigrations) {
    console.log(`[MigrationRunner] Applying migration v${migration.version}...`);
    try {
      migratedData = migration.migrate(migratedData);
    } catch (error) {
      console.error(`[MigrationRunner] Migration v${migration.version} failed:`, error);
      throw error; // Re-throw to prevent saving corrupted state
    }
  }

  // Update the version number to the target version
  migratedData.version = latestVersion;

  return { migrated: migratedData, hasChanged: true };
}
