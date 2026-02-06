import { markRaw } from 'vue';
import type { ExtensionAPI } from '../../../types';
import { MountableComponent, type TextareaToolDefinition } from '../../../types/ExtensionAPI';
import type { CodeMirrorTarget } from '../../../types/settings';
import { manifest } from './manifest';
import RewritePopup from './RewritePopup.vue';
import SettingsPanel from './SettingsPanel.vue';
import type { FieldChange, RewriteField, RewriteSettings } from './types';

export { manifest };

export function activate(api: ExtensionAPI<RewriteSettings>) {
  const t = api.i18n.t;

  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  // --- Helper to open Popup ---
  const handleRewrite = async (
    scope: { fields: RewriteField[]; onApply: (changes: FieldChange[]) => void },
    identifier: string,
    referenceMessageIndex?: number,
  ) => {
    let title = t('extensionsBuiltin.rewrite.popupTitle');

    if (identifier.startsWith('character.global.')) {
      const charAvatar = identifier.replace('character.global.', '');
      const char = api.character.getEditing();
      if (char && char.avatar === charAvatar) {
        title = t('extensionsBuiltin.rewrite.popupTitleCharacter', { name: char.name || 'Character' });
      } else {
        title = t('extensionsBuiltin.rewrite.popupTitleCharacter', { name: 'Character' });
      }
    } else if (identifier.startsWith('character.')) {
      const fieldName = identifier.replace('character.', '');
      title = t('extensionsBuiltin.rewrite.popupTitleField', { field: fieldName });
    } else if (identifier === 'chat.message') {
      title = t('extensionsBuiltin.rewrite.popupTitleMessage');
    } else if (identifier === 'chat.input') {
      title = t('extensionsBuiltin.rewrite.popupTitleInput');
    } else if (identifier.startsWith('extension.')) {
      title = t('extensionsBuiltin.rewrite.popupTitleExtension');
    } else if (scope.fields.length === 1) {
      title = t('extensionsBuiltin.rewrite.popupTitleField', { field: scope.fields[0].label });
    }

    await api.ui.showPopup({
      title,
      component: markRaw(RewritePopup),
      componentProps: {
        api,
        initialFields: scope.fields,
        identifier,
        referenceMessageIndex,
        onApply: (changes: FieldChange[]) => {
          scope.onApply(changes);
          api.ui.showToast(t('extensionsBuiltin.rewrite.messages.textUpdated'), 'success');
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

  // Helper for global character rewrite
  const handleGlobalCharacterRewrite = () => {
    const char = api.character.getEditing();
    if (!char) return;

    const fields: RewriteField[] = [
      { id: 'description', label: 'Description', value: char.description },
      { id: 'personality', label: 'Personality', value: char.personality },
      { id: 'scenario', label: 'Scenario', value: char.scenario },
      { id: 'first_mes', label: 'First Message', value: char.first_mes },
      { id: 'mes_example', label: 'Example Messages', value: char.mes_example },
    ]
      .filter((f) => f.value)
      .map((f) => ({ ...f, value: f.value! }));

    if (fields.length === 0) {
      api.ui.showToast(t('extensionsBuiltin.rewrite.errors.noCharFields'), 'info');
      return;
    }

    handleRewrite(
      {
        fields,
        onApply: (changes) => {
          const updates: Record<string, string> = {};
          changes.forEach((change) => {
            updates[change.fieldId] = change.newValue;
          });
          api.character.update(char.avatar, updates);
        },
      },
      `character.global.${char.avatar}`,
    );
  };

  // 1. Register Tools for Textareas
  const coreTargets: (CodeMirrorTarget | string)[] = [
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

  const extensionPattern = /^extension\..+/;
  const unbinds: Array<() => void> = [];

  const singleFieldTool: TextareaToolDefinition = {
    id: 'rewrite-wand',
    icon: 'fa-solid fa-wand-magic-sparkles',
    title: t('extensionsBuiltin.rewrite.popupTitle'),
    onClick: ({ value, setValue }) => {
      const field: RewriteField = { id: 'extension', label: 'Extension Field', value };
      handleRewrite(
        {
          fields: [field],
          onApply: (changes) => {
            if (changes.length > 0) setValue(changes[0].newValue);
          },
        },
        'extension.generic',
      );
    },
  };

  // Register Core Targets
  coreTargets.forEach((target) => {
    const tool: TextareaToolDefinition = {
      id: 'rewrite-wand',
      icon: 'fa-solid fa-wand-magic-sparkles',
      title: t('extensionsBuiltin.rewrite.popupTitle'),
      onClick: ({ value, setValue }) => {
        const field: RewriteField = { id: target, label: target, value };
        handleRewrite(
          {
            fields: [field],
            onApply: (changes) => {
              const change = changes.find((c) => c.fieldId === target);
              if (change) setValue(change.newValue);
            },
          },
          target,
        );
      },
    };
    unbinds.push(api.ui.registerTextareaTool(target as CodeMirrorTarget, tool));
  });

  // Register Pattern for Extension settings
  unbinds.push(api.ui.registerTextareaTool(extensionPattern, singleFieldTool));

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
      title: t('extensionsBuiltin.rewrite.buttons.rewriteMessage'),
      variant: 'ghost',
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        const history = api.chat.getHistory();
        const msg = history[messageIndex];
        if (!msg) return;

        const field: RewriteField = { id: 'chat.message', label: 'Chat Message', value: msg.mes };
        handleRewrite(
          {
            fields: [field],
            onApply: (changes) => {
              if (changes.length > 0) api.chat.updateMessage(messageIndex, changes[0].newValue);
            },
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
    const onClick = () => {
      const input = api.chat.getChatInput();
      if (!input || !input.value) return;

      const field: RewriteField = { id: 'chat.input', label: 'Chat Input', value: input.value };
      handleRewrite(
        {
          fields: [field],
          onApply: (changes) => {
            if (changes.length > 0) api.chat.setChatInput(changes[0].newValue);
          },
        },
        'chat.input',
        api.chat.getHistory().length,
      );
    };
    api.ui.registerChatFormOptionsMenuItem({
      id: 'rewrite-input-option',
      icon: 'fa-solid fa-wand-magic-sparkles',
      label: t('extensionsBuiltin.rewrite.buttons.rewriteInput'),
      onClick,
    });
    api.ui.registerChatQuickAction('core.input-message', '', {
      id: 'rewrite-input-option',
      icon: 'fa-solid fa-wand-magic-sparkles',
      label: t('extensionsBuiltin.rewrite.buttons.rewriteInput'),
      onClick,
    });
  };

  // 4. Character Edit Form Button Injection
  const injectCharacterButton = () => {
    const containers = document.querySelectorAll('.character-edit-form-buttons');
    if (containers.length === 0) return;

    containers.forEach((container) => {
      if (container.querySelector('.rewrite-character-global-wrapper')) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'rewrite-character-global-wrapper';
      container.appendChild(wrapper);

      api.ui.mountComponent(wrapper, MountableComponent.Button, {
        icon: 'fa-wand-magic',
        title: t('extensionsBuiltin.rewrite.buttons.rewriteCharacter'),
        variant: 'ghost',
        onClick: handleGlobalCharacterRewrite,
      });
    });

    // Disconnect observer once buttons are injected
    observer.disconnect();
  };
  // Use MutationObserver to watch for character edit form buttons appearing
  const observer = new MutationObserver((mutations) => {
    let shouldInject = false;
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (
            element.classList?.contains('character-edit-form-buttons') ||
            element.querySelector('.character-edit-form-buttons')
          ) {
            shouldInject = true;
          }
        }
      });
    });
    if (shouldInject) {
      injectCharacterButton();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
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
  injectCharacterButton();

  return () => {
    unbinds.forEach((u) => u());
    document.querySelectorAll('.rewrite-button-wrapper').forEach((el) => el.remove());
    document.querySelectorAll('.rewrite-character-global-wrapper').forEach((el) => el.remove());
    api.ui.unregisterChatFormOptionsMenuItem('rewrite-input-option');
    api.ui.unregisterChatQuickAction('core.input-message', 'rewrite-input-option');
    observer.disconnect();
  };
}
