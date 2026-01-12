import { markRaw } from 'vue';
import type { ExtensionAPI } from '../../../types';
import type { LlmUsageData } from '../../../types/events';
import { manifest } from './manifest';
import { UsageStorage } from './storage';
import UsageDashboard from './UsageDashboard.vue';

export { manifest };

// TODO: i18n

export function activate(api: ExtensionAPI) {
  const storage = new UsageStorage();

  // Listen for usage events
  const unbind = api.events.on('llm:usage', async (data: LlmUsageData) => {
    try {
      await storage.addLog(data);
    } catch (err) {
      console.error('[UsageTracker] Failed to save log:', err);
    }
  });

  // Register Dashboard Sidebar
  api.ui.registerSidebar('usage-dashboard', markRaw(UsageDashboard), 'right', {
    title: 'Usage Stats',
    icon: 'fa-chart-line',
    props: {
      api,
      storage,
    },
  });

  // Add nav item to open sidebar
  api.ui.registerNavBarItem('usage-tracker-nav', {
    icon: 'fa-chart-line',
    title: 'Usage Stats',
    onClick: () => {
      api.ui.openSidebar('usage-dashboard');
    },
    layout: 'default',
  });

  return () => {
    unbind();
    api.ui.unregisterNavBarItem('usage-tracker-nav');
  };
}
