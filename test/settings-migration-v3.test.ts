import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dropInstance } = vi.hoisted(() => ({ dropInstance: vi.fn() }));
vi.mock('localforage', () => ({ default: { dropInstance } }));

import { LATEST_SETTINGS_VERSION, migrateSettings } from '../src/services/settings-migration.service';
import type { Settings } from '../src/types';

describe('settings v3 migration', () => {
  beforeEach(() => {
    dropInstance.mockReset();
    dropInstance.mockResolvedValue(undefined);
  });

  it('removes Rewrite settings and its disabled entry, keeping everything else', () => {
    const { migrated } = migrateSettings({
      version: 2,
      extensionSettings: {
        'core.rewrite': { templates: [{ id: 'custom' }] },
        'core.assistant': { commands: [{ name: 'grammar' }] },
      },
      disabledExtensions: ['core.rewrite', 'core.tracker'],
    } as unknown as Settings);

    expect(migrated.version).toBe(LATEST_SETTINGS_VERSION);
    expect(migrated.extensionSettings).toEqual({ 'core.assistant': { commands: [{ name: 'grammar' }] } });
    expect(migrated.disabledExtensions).toEqual(['core.tracker']);
  });

  it('drops the rewrite-sessions store once', () => {
    migrateSettings({ version: 2, extensionSettings: {}, disabledExtensions: [] } as unknown as Settings);

    expect(dropInstance).toHaveBeenCalledTimes(1);
    expect(dropInstance).toHaveBeenCalledWith({ name: 'neotavern', storeName: 'rewrite-sessions' });
  });

  it('does not run again on v3 settings', () => {
    const { hasChanged } = migrateSettings({
      version: 3,
      extensionSettings: {},
      disabledExtensions: [],
    } as unknown as Settings);

    expect(hasChanged).toBe(false);
    expect(dropInstance).not.toHaveBeenCalled();
  });
});
