import type { ChatMessage, ExtensionAPI } from '../../../types';
import { findChatMessageIndex, isFinishedAssistantMessage } from '../_shared/runtime/chat-message';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { Translator } from './translator';
import { AutoTranslateMode, type ChatTranslationMessageExtra, type ChatTranslationSettings } from './types';

export { manifest };
export { migrateChatTranslationSettings as migrateSettings } from './types';

export function activate(
  api: ExtensionAPI<ChatTranslationSettings, Record<string, unknown>, ChatTranslationMessageExtra>,
) {
  const t = api.i18n.t;
  const translator = new Translator(api);

  api.ui.registerSettingsPanel(SettingsPanel, { api });

  const injectInputOption = () => {
    const onClick = () => {
      translator.translateInput();
    };
    api.ui.registerChatFormOptionsMenuItem({
      id: 'chat-translation-translate-input',
      icon: 'fa-solid fa-language',
      label: t('extensionsBuiltin.chatTranslation.translateInput'),
      onClick,
      visible: api.chat.getChatInfo() !== null,
    });
    api.ui.registerChatQuickAction('core.input-message', '', {
      id: 'chat-translation-translate-input',
      icon: 'fa-solid fa-language',
      label: t('extensionsBuiltin.chatTranslation.translateInput'),
      onClick,
      disabled: api.chat.getChatInfo() === null,
    });
  };

  const shouldTranslate = (message: ChatMessage, autoMode: AutoTranslateMode): boolean => {
    const isSystem = message.is_system;
    const isUser = message.is_user;

    switch (autoMode) {
      case AutoTranslateMode.RESPONSES:
        return !isSystem && !isUser;
      case AutoTranslateMode.INPUTS:
        return !isSystem && !!isUser;
      case AutoTranslateMode.BOTH:
        return !isSystem;
      default:
        return false;
    }
  };

  const getMessageIndex = (message: ChatMessage, generationId?: string): number =>
    findChatMessageIndex(api.chat.getHistory(), message, generationId);

  api.ui.registerMessageButton({
    id: 'chat-translation.translate',
    icon: 'fa-globe',
    title: t('extensionsBuiltin.chatTranslation.translateMessage'),
    onClick: (messageIndex) => translator.translateMessage(messageIndex),
  });

  api.events.on('chat:entered', () => {
    injectInputOption();
  });

  // Listen for new messages for injection and user-input auto-translation.
  api.events.on('message:created', (message: ChatMessage) => {
    const messageIndex = getMessageIndex(message);
    if (messageIndex === -1) return;

    const settings = api.settings.get();

    if (settings && message.is_user && shouldTranslate(message, settings.autoMode)) {
      translator.translateMessage(messageIndex); // fire and forget
    }
  });

  api.events.on('generation:finished', (result: { message: ChatMessage | null; error?: Error }, context) => {
    const settings = api.settings.get();
    const message = result.message;
    if (
      !settings ||
      result.error ||
      !isFinishedAssistantMessage(message) ||
      !shouldTranslate(message, settings.autoMode)
    ) {
      return;
    }

    const messageIndex = getMessageIndex(message, context.generationId);
    if (messageIndex === -1) return;
    translator.translateMessage(messageIndex); // fire and forget
  });

  injectInputOption();
}
