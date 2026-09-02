import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activate, type CustomAgentsHostAPI } from '../src/extensions/built-in/custom-agents';
import { registerChatLifecycleHooks } from '../src/services/chat-lifecycle';

const cleanups: Array<() => void> = [];
beforeEach(() => vi.stubGlobal('document', { getElementById: vi.fn(() => null) }));
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
});

function hostApi(): CustomAgentsHostAPI {
  let settings: unknown = { presets: [] };
  const services = new Map<string, object>();
  return {
    meta: {
      id: 'core.custom-agents',
      name: 'Custom Agents',
      version: '1',
      description: '',
      containerId: 'custom-agents',
    },
    settings: {
      get: () => structuredClone(settings),
      set: (_path, value) => {
        settings = structuredClone(value);
      },
      save: vi.fn(),
    },
    events: { on: vi.fn(() => vi.fn()) },
    extensions: {
      registerService: vi.fn((id: string, service: object) => services.set(id, service)),
      unregisterService: vi.fn((id: string) => services.delete(id)),
      getService: vi.fn((id: string) => services.get(id) ?? null),
    },
    ui: {
      registerSidebar: vi.fn(async () => undefined),
      unregisterSidebar: vi.fn(),
      mount: vi.fn(() => ({ unmount: vi.fn() })),
    },
    i18n: { t: (key: string) => key },
  } as unknown as CustomAgentsHostAPI;
}

describe('Custom Agents extension activation', () => {
  it('registers one runtime service and removes hooks, listeners, and sidebar on dispose', async () => {
    const api = hostApi();
    const dispose = await activate(api);
    cleanups.push(dispose);
    expect(api.extensions.registerService).toHaveBeenCalledOnce();
    expect(api.ui.registerSidebar).toHaveBeenCalledOnce();

    dispose();
    expect(api.extensions.unregisterService).toHaveBeenCalledOnce();
    expect(api.ui.unregisterSidebar).toHaveBeenCalledOnce();
  });

  it('fails cleanly when another lifecycle provider already owns the seam', async () => {
    const release = registerChatLifecycleHooks({});
    cleanups.push(release);
    const api = hostApi();
    await expect(activate(api)).rejects.toThrow('already registered');
    expect(api.extensions.registerService).not.toHaveBeenCalled();
    expect(api.ui.registerSidebar).not.toHaveBeenCalled();
  });
});
