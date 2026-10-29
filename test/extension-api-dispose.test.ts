import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { useComponentRegistryStore } from '../src/stores/component-registry.store';
import { createExtensionApi, disposeExtension } from '../src/utils/extensions';
import { eventEmitter } from '../src/utils/event-emitter';

const Panel = defineComponent({ render: () => null });

describe('extension API disposal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('removes everything registered through the API when the extension is disposed', async () => {
    const registry = useComponentRegistryStore();
    const api = createExtensionApi('core.test');
    const listener = vi.fn();

    api.events.on('chat:cleared', listener);
    await api.ui.registerNavBarItem('nav', { icon: 'fa-x', title: 'Nav' });
    await api.ui.registerSidebar('side', Panel, 'right');
    api.ui.registerChatQuickAction('group', 'Group', { id: 'quick', icon: 'fa-x', onClick: () => {} });
    api.ui.registerSettingsPanel(Panel, { api });
    api.ui.registerMessageButton({ id: 'button', icon: 'fa-x', onClick: () => {} });

    disposeExtension('core.test');

    await eventEmitter.emit('chat:cleared');
    expect(listener).not.toHaveBeenCalled();
    expect(registry.navBarRegistry.has('core.test.nav')).toBe(false);
    expect(registry.rightSidebarRegistry.has('core.test.side')).toBe(false);
    expect(registry.chatQuickActionsRegistry.has('group')).toBe(false);
    expect(registry.extensionSettingsPanelRegistry.has('core.test')).toBe(false);
    expect(registry.messageButtonRegistry.has('button')).toBe(false);
  });

  it('keeps a stale cleanup from removing a newer registration with the same id', () => {
    const registry = useComponentRegistryStore();
    const api = createExtensionApi('core.test');

    const removeFirst = api.ui.registerMessageButton({ id: 'button', icon: 'fa-a' });
    api.ui.registerMessageButton({ id: 'button', icon: 'fa-b' });
    removeFirst();

    expect(registry.messageButtonRegistry.get('button')?.icon).toBe('fa-b');

    disposeExtension('core.test');
    expect(registry.messageButtonRegistry.has('button')).toBe(false);
  });
});
