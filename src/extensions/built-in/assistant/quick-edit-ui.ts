import { markRaw } from 'vue';
import type { CodeMirrorTarget, ExtensionAPI } from '../../../types';
import type { I18nKey } from '../../../types/i18n';
import FloatingQuickEdit from './components/FloatingQuickEdit.vue';
import PopupQuickEdit from './components/PopupQuickEdit.vue';
import type { QuickEditContext, QuickEditTarget } from './quick-edit';
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

/** The field textareas Rewrite puts a wand on, with their label keys. `extension.*` fields come from `EXTENSION_FIELD_PATTERN`. */
export const FIELD_TARGETS = {
  'character.description': 'extensionsBuiltin.assistant.quickEdit.fields.characterDescription',
  'character.first_mes': 'extensionsBuiltin.assistant.quickEdit.fields.characterFirstMes',
  'character.personality': 'extensionsBuiltin.assistant.quickEdit.fields.characterPersonality',
  'character.scenario': 'extensionsBuiltin.assistant.quickEdit.fields.characterScenario',
  'character.note': 'extensionsBuiltin.assistant.quickEdit.fields.characterNote',
  'character.mes_example': 'extensionsBuiltin.assistant.quickEdit.fields.characterMesExample',
  'character.post_history_instructions':
    'extensionsBuiltin.assistant.quickEdit.fields.characterPostHistoryInstructions',
  'character.creator_notes': 'extensionsBuiltin.assistant.quickEdit.fields.characterCreatorNotes',
  'character.alternate_greeting': 'extensionsBuiltin.assistant.quickEdit.fields.characterAlternateGreeting',
  'persona.description': 'extensionsBuiltin.assistant.quickEdit.fields.personaDescription',
  'world_info.content': 'extensionsBuiltin.assistant.quickEdit.fields.worldInfoContent',
  'prompt.content': 'extensionsBuiltin.assistant.quickEdit.fields.promptContent',
} as const satisfies Partial<Record<CodeMirrorTarget, I18nKey>>;

export const EXTENSION_FIELD_PATTERN = /^extension\..+/;

function fieldContext(api: ExtensionAPI<AssistantSettings>, identifier: string): QuickEditContext {
  if (identifier.startsWith('character.')) {
    const character = api.character.getEditing();
    return character
      ? { kind: 'character', avatar: character.avatar, field: identifier.slice('character.'.length) }
      : { kind: 'none' };
  }
  if (identifier === 'world_info.content') {
    const selected = api.worldInfo.getSelectedEntry();
    return selected ? { kind: 'world-info', book: selected.bookName, uid: selected.entry.uid } : { kind: 'none' };
  }
  if (identifier === 'persona.description') return { kind: 'persona' };
  return { kind: 'none' };
}

/** A field textarea target; `identifier` is a `FIELD_TARGETS` key or `extension.generic` for `extension.*` fields. */
export function createFieldTarget(
  api: ExtensionAPI<AssistantSettings>,
  identifier: string,
  label: string,
  payload: { value: string; setValue: (value: string) => void },
): QuickEditTarget {
  return {
    identifier,
    label,
    text: payload.value,
    context: fieldContext(api, identifier),
    apply: (text) => payload.setValue(text),
  };
}

/** Opens quick edit in a popup, for textareas whose tool click gives no element to anchor to. */
export function openQuickEditPopup(api: ExtensionAPI<AssistantSettings>, target: QuickEditTarget) {
  return api.ui.showPopup({
    component: markRaw(PopupQuickEdit),
    componentProps: { api, target },
    okButton: false,
    cancelButton: false,
  });
}
