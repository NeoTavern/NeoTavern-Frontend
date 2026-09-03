import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activate,
  persistPreparedInstalledGraphAgents,
  prepareInstalledGraphAgentsSettings,
  type CustomAgentsHostAPI,
  type GraphCustomAgentsRuntime,
  type PreparedInstalledGraphAgents,
} from '../src/extensions/built-in/custom-agents';
import { createGraphPreset } from '../src/extensions/built-in/custom-agents/settings/management';
import { registerChatLifecycleHooks } from '../src/services/chat-lifecycle';

const cleanups: Array<() => void> = [];
beforeEach(() => vi.stubGlobal('document', { getElementById: vi.fn(() => null) }));
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
});

function hostApi(initial: unknown = { presets: [] }): CustomAgentsHostAPI {
  let settings: unknown = initial;
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
      get: vi.fn(() => structuredClone(settings)),
      set: vi.fn((_path, value) => {
        settings = structuredClone(value);
      }),
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

  it('reuses one prepared activation snapshot for management and all runtime reads', async () => {
    const preset = createGraphPreset('retained', 'Retained');
    const api = hostApi({ presets: [preset] });
    vi.stubGlobal('document', { getElementById: vi.fn(() => ({})) });
    const dispose = await activate(api);
    cleanups.push(dispose);

    expect(api.settings.get).toHaveBeenCalledOnce();
    const mountProps = vi.mocked(api.ui.mount).mock.calls[0]![2] as {
      prepared: PreparedInstalledGraphAgents;
      runtime: GraphCustomAgentsRuntime;
    };
    const runtime = api.extensions.getService(api.meta.id) as GraphCustomAgentsRuntime;
    expect(runtime.getAgents()).toBe(mountProps.prepared.agents);
    expect(runtime.getAgents()).toBe(mountProps.prepared.agents);
    expect(runtime.getAgents()).toBe(mountProps.prepared.agents);
    expect(api.settings.get).toHaveBeenCalledOnce();
  });

  it('changes neither persisted nor runtime state for invalid preparation and reuses a valid replacement', async () => {
    const initial = createGraphPreset('retained', 'Retained');
    const api = hostApi({ presets: [initial] });
    const dispose = await activate(api);
    cleanups.push(dispose);
    const runtime = api.extensions.getService(api.meta.id) as GraphCustomAgentsRuntime;
    const original = runtime.getAgents();
    const invalid = structuredClone(initial);
    invalid.agent.flows.push({ id: 'invalid' } as never);

    expect(() => prepareInstalledGraphAgentsSettings({ presets: [invalid] })).toThrow();
    expect(api.settings.get()).toEqual({ presets: [initial] });
    expect(api.settings.save).not.toHaveBeenCalled();
    expect(runtime.getAgents()).toBe(original);

    const changed = structuredClone(initial);
    changed.agent.name = 'Changed';
    const replacement = prepareInstalledGraphAgentsSettings({ presets: [changed] });
    persistPreparedInstalledGraphAgents(api, replacement);
    runtime.replacePrepared(replacement);

    expect(api.settings.set).toHaveBeenCalledWith(undefined, replacement.settings);
    expect(api.settings.save).toHaveBeenCalledOnce();
    expect(runtime.getAgents()).toBe(replacement.agents);
    expect(runtime.getAgents()).toBe(replacement.agents);
    expect(runtime.getAgents()).not.toBe(original);
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
