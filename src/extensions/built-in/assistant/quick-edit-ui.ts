import { markRaw } from 'vue';
import type { ExtensionAPI } from '../../../types';
import FloatingQuickEdit from './components/FloatingQuickEdit.vue';
import type { QuickEditTarget } from './quick-edit';
import type { AssistantSettings } from './types';

let closeCurrent: (() => void) | null = null;

/** Opens the quick-edit popover next to `anchor`, closing any other one. It closes when the chat changes. */
export function openQuickEditPopover(
  api: ExtensionAPI<AssistantSettings>,
  anchor: HTMLElement,
  target: QuickEditTarget,
  initialCommandId?: string,
) {
  closeCurrent?.();

  const container = document.createElement('div');
  document.body.appendChild(container);

  let offChatEntered = () => {};
  const close = () => {
    if (closeCurrent !== close) return;
    closeCurrent = null;
    offChatEntered();
    instance.unmount();
    container.remove();
  };
  closeCurrent = close;

  const instance = api.ui.mount(container, markRaw(FloatingQuickEdit), {
    api,
    target,
    anchor,
    initialCommandId,
    onClose: close,
  });
  offChatEntered = api.events.on('chat:entered', close);
}

export function createMessageTarget(api: ExtensionAPI<AssistantSettings>, index: number): QuickEditTarget | null {
  const message = api.chat.getHistory()[index];
  if (!message) return null;
  return {
    identifier: 'chat.message',
    label: api.i18n.t('extensionsBuiltin.assistant.quickEdit.messageLabel', { name: message.name }),
    text: message.mes,
    context: { kind: 'chat', beforeIndex: index },
    apply: (text) => api.chat.updateMessage(index, text),
  };
}

export function createInputTarget(api: ExtensionAPI<AssistantSettings>): QuickEditTarget {
  return {
    identifier: 'chat.input',
    label: api.i18n.t('extensionsBuiltin.assistant.quickEdit.inputLabel'),
    text: api.chat.getChatInput()?.value ?? '',
    context: { kind: 'chat', beforeIndex: api.chat.getHistory().length },
    apply: (text) => api.chat.setChatInput(text),
  };
}

/** The chat form, which the input-box popover is anchored to. */
export function findChatInputAnchor(): HTMLElement | null {
  return document.getElementById('chat-form');
}
