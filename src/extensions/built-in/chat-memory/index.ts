import { markRaw } from 'vue';
import type { ExtensionAPI } from '../../../types';
import { manifest } from './manifest';
import MemoryPopup from './MemoryPopup.vue';
import { type ExtensionSettings } from './types';

export { manifest };

export function activate(api: ExtensionAPI<ExtensionSettings>) {
  const injectMenuOption = () => {
    const menu = document.querySelector('#chat-form .options-menu');
    if (!menu) return;

    if (menu.querySelector('.chat-memory-option')) return;

    const item = document.createElement('a');
    item.className = 'options-menu-item chat-memory-option';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    item.innerHTML = '<i class="fa-solid fa-brain"></i><span>Chat Memory</span>';

    item.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const btn = document.getElementById('chat-options-button');
      if (btn && getComputedStyle(menu).display !== 'none') {
        btn.click();
      }

      await api.ui.showPopup({
        title: 'Chat Memory Manager',
        component: markRaw(MemoryPopup),
        componentProps: { api },
        wide: true,
        large: true,
        okButton: false,
        cancelButton: 'common.close',
      });
    };

    menu.insertBefore(item, menu.firstChild);
  };

  const unbinds: Array<() => void> = [];

  unbinds.push(
    api.events.on('chat:entered', () => {
      injectMenuOption();
    }),
  );

  if (api.chat.getChatInfo()) {
    injectMenuOption();
  }

  return () => {
    unbinds.forEach((u) => u());
    document.querySelectorAll('.chat-memory-option').forEach((el) => el.remove());
  };
}
