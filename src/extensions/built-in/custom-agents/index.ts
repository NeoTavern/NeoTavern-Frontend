import { manifest } from './manifest';
import AgentManager from './settings/AgentManager.vue';
import ViewsPanel from './views/ViewsPanel.vue';
import type { CustomAgentsHostAPI } from './host/api';
import { activateGraphCustomAgentsHost } from './host/runtime';
import { emptyInstalledGraphAgents, loadInstalledGraphAgents, saveInstalledGraphAgents } from './settings/store';

export { manifest };
export * from './graph/contracts';
export * from './host/api';
export * from './host/contracts';
export * from './views/contracts';
export * from './settings/configuration-controls';
export * from './settings/named-map-transfer';
export * from './host/lifecycle';
export * from './host/generation';
export * from './host/prompt';
export * from './host/runtime';
export * from './settings/store';
export * from './settings/management';
export * from './settings/transfer';
export * from './settings/catalog';
export * from './views/actions';
export * from './registry/tools';

export async function activate(api: CustomAgentsHostAPI): Promise<() => void> {
  if (api.settings.get() === undefined) saveInstalledGraphAgents(api, emptyInstalledGraphAgents());
  loadInstalledGraphAgents(api);

  const cleanups: Array<() => void> = [];
  let active = true;
  const cleanupAll = (): void => {
    const errors: unknown[] = [];
    while (cleanups.length > 0) {
      try {
        cleanups.pop()!();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Failed to clean up Custom Agents activation');
  };

  try {
    const host = activateGraphCustomAgentsHost(api, () => loadInstalledGraphAgents(api).presets);
    const runtime = host.runtime;
    cleanups.push(() => host.dispose());

    api.extensions.registerService(api.meta.id, runtime);
    cleanups.push(() => api.extensions.unregisterService(api.meta.id));

    const settingsContainer = document.getElementById(api.meta.containerId);
    if (settingsContainer) {
      const settingsApp = api.ui.mount(settingsContainer, AgentManager, { api, runtime });
      cleanups.push(() => settingsApp.unmount());
    }

    const sidebarRegistration = api.ui.registerSidebar('custom-agents-views', ViewsPanel, 'right', {
      icon: 'fa-solid fa-robot',
      title: api.i18n.t('extensionsBuiltin.customAgents.views'),
      props: { api, runtime },
    });
    cleanups.push(() => api.ui.unregisterSidebar('custom-agents-views', 'right'));
    await sidebarRegistration;
  } catch (error) {
    active = false;
    try {
      cleanupAll();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Custom Agents activation failed during cleanup');
    }
    throw error;
  }

  return () => {
    if (!active) return;
    active = false;
    cleanupAll();
  };
}
