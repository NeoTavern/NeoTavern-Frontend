import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { LATEST_SETTINGS_VERSION, migrateSettings } from '../src/services/settings-migration.service';
import { useSettingsStore } from '../src/stores/settings.store';
import type { Settings } from '../src/types';
import { createScopedApiProxy } from '../src/utils/extensions';

const nestedExtensionSettings = {
  core: {
    tracker: { autoMode: 'responses', schemaPresets: [{ name: 'Custom' }] },
    notebook: { notes: [{ id: 'n1', content: 'keep me' }] },
  },
  'third.party': { enabled: true },
};

describe('settings v2 migration', () => {
  it('runs for unversioned settings instead of being skipped', () => {
    const { migrated, hasChanged } = migrateSettings({
      extensionSettings: nestedExtensionSettings,
    } as unknown as Settings);

    expect(hasChanged).toBe(true);
    expect(migrated.version).toBe(LATEST_SETTINGS_VERSION);
    expect(migrated.extensionSettings['core.tracker']).toEqual(nestedExtensionSettings.core.tracker);
  });

  it('flattens extension settings nested under "core" into full extension ids', () => {
    const { migrated } = migrateSettings({
      version: 1,
      extensionSettings: nestedExtensionSettings,
    } as unknown as Settings);

    expect(migrated.extensionSettings).toEqual({
      'core.tracker': nestedExtensionSettings.core.tracker,
      'core.notebook': nestedExtensionSettings.core.notebook,
      'third.party': { enabled: true },
    });
  });
});

describe('scoped extension settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('stores settings under the full extension id', () => {
    const settingsStore = useSettingsStore();
    const api = createScopedApiProxy('core.tracker');

    api.settings.set(undefined, { autoMode: 'none', nested: { value: 1 } });
    api.settings.set('nested.value' as never, 2 as never);

    expect(settingsStore.settings.extensionSettings['core.tracker']).toEqual({
      autoMode: 'none',
      nested: { value: 2 },
    });
    expect(settingsStore.settings.extensionSettings).not.toHaveProperty('core');
    expect(api.settings.get('nested.value' as never)).toBe(2);
  });
});
