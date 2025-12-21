import { markRaw } from 'vue';
import type { ExtensionAPI } from '../../../types';
import { MountableComponent } from '../../../types/ExtensionAPI';
import type { CodeMirrorTarget } from '../../../types/settings';
import { manifest } from './manifest';
import RewritePopup from './RewritePopup.vue';
import SettingsPanel from './SettingsPanel.vue';
import type { RewriteSettings } from './types';

export { manifest };

// TODO: i18n

export function activate(api: ExtensionAPI<RewriteSettings>) {
  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  // --- Helper to open Popup ---
  const handleRewrite = async (
    originalText: string,
    setValue: (val: string) => void,
    identifier: string,
    // Context messages are now calculated inside the popup based on settings,
    // but we can pass the reference index/context if needed for specific logic.
    referenceMessageIndex?: number,
  ) => {
    await api.ui.showPopup({
      title: 'Magic Rewrite',
      component: markRaw(RewritePopup),
      componentProps: {
        api,
        originalText,
        identifier,
        referenceMessageIndex,
        onApply: (newText: string) => {
          setValue(newText);
          api.ui.showToast('Text updated', 'success');
        },
        onCancel: () => {},
      },
      // Hide default buttons to control flow from within component
      okButton: false,
      cancelButton: false,
      large: true,
      wide: true,
    });
  };

  // 1. Register Tools for Textareas
  const targets: CodeMirrorTarget[] = [
    'character.description',
    'character.first_mes',
    'character.personality',
    'character.scenario',
    'character.note',
    'character.mes_example',
    'character.post_history_instructions',
    'character.creator_notes',
    'character.alternate_greeting',
    'persona.description',
    'world_info.content',
    'prompt.content',
  ];

  const unbinds: Array<() => void> = [];

  targets.forEach((target) => {
    unbinds.push(
      api.ui.registerTextareaTool(target, {
        id: 'rewrite-wand',
        icon: 'fa-solid fa-wand-magic-sparkles',
        title: 'Magic Rewrite',
        onClick: ({ value, setValue }) => {
          handleRewrite(value, setValue, target);
        },
      }),
    );
  });

  // 2. Chat Message Toolbar Injection
  const injectSingleButton = async (messageElement: HTMLElement, messageIndex: number) => {
    const buttonsContainer = messageElement.querySelector('.message-buttons');
    if (!buttonsContainer) return;
    if (buttonsContainer.querySelector('.rewrite-button-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'rewrite-button-wrapper';
    wrapper.style.display = 'inline-flex';
    buttonsContainer.appendChild(wrapper);

    await api.ui.mountComponent(wrapper, MountableComponent.Button, {
      icon: 'fa-wand-magic-sparkles',
      title: 'Rewrite Message',
      variant: 'ghost',
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        const history = api.chat.getHistory();
        const msg = history[messageIndex];
        if (!msg) return;

        handleRewrite(
          msg.mes,
          (newVal) => {
            api.chat.updateMessage(messageIndex, newVal);
          },
          'chat.message',
          messageIndex,
        );
      },
    });
  };

  const injectButtons = () => {
    const messageElements = document.querySelectorAll('.message');
    messageElements.forEach((el) => {
      const indexAttr = el.getAttribute('data-message-index');
      if (indexAttr === null) return;
      const messageIndex = parseInt(indexAttr, 10);
      if (!isNaN(messageIndex)) injectSingleButton(el as HTMLElement, messageIndex);
    });
  };

  // 3. Input Options Injection
  const injectInputOption = () => {
    const menu = document.querySelector('#chat-form .options-menu');
    if (!menu || menu.querySelector('.rewrite-input-option')) return;

    const item = document.createElement('a');
    item.className = 'options-menu-item rewrite-input-option';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = 0;
    item.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>Rewrite Input</span>';

    item.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const input = api.chat.getChatInput();
      if (!input || !input.value) return;

      handleRewrite(
        input.value,
        (newVal) => {
          api.chat.setChatInput(newVal);
        },
        'chat.input',
        api.chat.getHistory().length, // Implicit end of chat
      );

      const btn = document.getElementById('chat-options-button');
      if (btn && getComputedStyle(menu).display !== 'none') {
        btn.click(); // Close menu
      }
    };
    menu.appendChild(item);
  };

  // Listeners
  unbinds.push(
    api.events.on('chat:entered', () => {
      injectButtons();
      injectInputOption();
    }),
  );

  unbinds.push(
    api.events.on('message:created', (message) => {
      let messageIndex = api.chat.getHistory().indexOf(message);
      messageIndex = messageIndex >= 0 ? messageIndex : api.chat.getHistory().length - 1;
      const messageElement = document.querySelector(`.message[data-message-index="${messageIndex}"]`);
      if (messageElement) injectSingleButton(messageElement as HTMLElement, messageIndex);
    }),
  );

  // Init
  injectButtons();
  injectInputOption();

  return () => {
    unbinds.forEach((u) => u());
    document.querySelectorAll('.rewrite-button-wrapper').forEach((el) => el.remove());
    document.querySelectorAll('.rewrite-input-option').forEach((el) => el.remove());
  };
}
