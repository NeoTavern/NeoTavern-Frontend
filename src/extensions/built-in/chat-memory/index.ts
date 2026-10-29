import { markRaw } from 'vue';
import type { StrictT } from '../../../composables/useStrictI18n';
import i18n from '../../../i18n';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import { resolveConnectionProfile } from '../_shared/runtime/connection-profile';
import { mergeMessageExtra } from '../_shared/runtime/extension-extra';
import { manifest } from './manifest';
import MemoryPopup from './MemoryPopup.vue';
import {
  EXTENSION_KEY,
  type ChatMemoryMetadata,
  type ExtensionSettings,
  type MemoryMessageExtra,
  resolveChatMemoryPrompts,
} from './types';
import { collectResponseText, extractCodeBlock } from '../_shared/runtime/llm-text';

export { manifest };
export { migrateChatMemorySettings as migrateSettings } from './types';

// @ts-expect-error 'i18n.global' is of type 'unknown'
const t = i18n.global.t as StrictT;

export function activate(api: ExtensionAPI<ExtensionSettings, ChatMemoryMetadata, MemoryMessageExtra>) {
  // --- Styles ---
  const injectStyles = () => {
    if (document.getElementById('chat-memory-styles')) return;
    const style = document.createElement('style');
    style.id = 'chat-memory-styles';
    style.innerHTML = `
      .message-content.content-dimmed {
        opacity: 0.6;
        font-size: 0.9em;
        max-height: 150px;
        overflow-y: auto;
        mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        transition: all 0.2s ease;
      }
      .message-content.content-dimmed:hover {
        opacity: 0.9;
        mask-image: none;
        -webkit-mask-image: none;
      }
      .memory-summary-injection {
        margin-top: 8px;
        padding: 8px 12px;
        background-color: var(--black-30a);
        border-left: 3px solid var(--color-info-cobalt);
        border-radius: var(--base-border-radius);
        display: flex;
        gap: 10px;
        align-items: flex-start;
        font-size: 0.95em;
        color: var(--theme-text-color);
        animation: fadeIn 0.3s ease;
      }
      .memory-summary-injection i {
        color: var(--color-info-cobalt);
        margin-top: 2px;
      }
      .memory-summary-injection span {
        flex: 1;
        line-height: 1.4;
      }
    `;
    document.head.appendChild(style);
  };

  // --- Message Summarization Logic ---

  const summarizeMessage = async (messageIndex: number) => {
    const history = api.chat.getHistory();
    const message = history[messageIndex];
    if (!message) return;

    const settings = api.settings.get();
    const promptTemplate = resolveChatMemoryPrompts(settings).messageSummaryPrompt;
    const connectionProfile = resolveConnectionProfile(api, settings?.connectionProfile);

    if (!connectionProfile) {
      api.ui.showToast(t('extensionsBuiltin.chatMemory.noProfile'), 'error');
      return;
    }

    try {
      api.ui.showToast(t('extensionsBuiltin.chatMemory.summarizing'), 'info');

      const prompt = api.macro.process(promptTemplate, undefined, {
        text: message.mes,
      });

      const response = await api.llm.generate(
        [
          {
            role: 'system',
            content: prompt,
            name: 'System',
          },
        ],
        {
          connectionProfile,
          captureMessageIndex: messageIndex,
        },
      );

      const summaryText = extractCodeBlock(await collectResponseText(response));

      await mergeMessageExtra<MemoryMessageExtra>(api, messageIndex, EXTENSION_KEY, { summary: summaryText });

      api.ui.showToast(t('extensionsBuiltin.chatMemory.summarized'), 'success');
    } catch (error) {
      console.error('Message summarization failed', error);
      api.ui.showToast(t('extensionsBuiltin.chatMemory.failed'), 'error');
    }
  };

  // --- DOM Manipulation ---

  const injectSummaryDisplay = (messageElement: HTMLElement, summaryText: string) => {
    // 1. Dim the content
    const contentEl = messageElement.querySelector('.message-content');
    if (contentEl) {
      contentEl.classList.add('content-dimmed');
    }

    // 2. Inject Summary Component
    const mainEl = messageElement.querySelector('.message-main');
    if (!mainEl) return;

    // Remove existing if any
    const existing = mainEl.querySelector('.memory-summary-injection');
    if (existing) existing.remove();

    const summaryContainer = document.createElement('div');
    summaryContainer.className = 'memory-summary-injection';
    summaryContainer.innerHTML = `<i class="fa-solid fa-brain"></i><span>${summaryText}</span>`;

    // Insert before footer (swipes) or edit area, but after content
    const editArea = mainEl.querySelector('.message-edit-area');
    const footer = mainEl.querySelector('.message-footer');

    if (editArea) {
      mainEl.insertBefore(summaryContainer, editArea);
    } else if (footer) {
      mainEl.insertBefore(summaryContainer, footer);
    } else {
      mainEl.appendChild(summaryContainer);
    }
  };

  const removeSummaryDisplay = (messageElement: HTMLElement) => {
    const contentEl = messageElement.querySelector('.message-content');
    if (contentEl) {
      contentEl.classList.remove('content-dimmed');
    }
    const existing = messageElement.querySelector('.memory-summary-injection');
    if (existing) existing.remove();
  };

  const processMessageElement = (element: HTMLElement, message?: ChatMessage) => {
    if (!message) return;

    const settings = api.settings.get();
    const extra = message.extra['core.chat-memory'];

    if (settings?.enableMessageSummarization && extra?.summary) {
      injectSummaryDisplay(element, extra.summary);
    } else {
      removeSummaryDisplay(element);
    }
  };

  const updateAllMessages = () => {
    const settings = api.settings.get();
    const history = api.chat.getHistory();

    const messageElements = document.querySelectorAll('.message');
    messageElements.forEach((el) => {
      const indexAttr = el.getAttribute('data-message-index');
      if (indexAttr === null) return;
      const messageIndex = parseInt(indexAttr, 10);
      if (isNaN(messageIndex)) return;
      processMessageElement(el as HTMLElement, history[messageIndex]);
    });

    // Clean up if message summarization is disabled
    if (!settings?.enableMessageSummarization) {
      document.querySelectorAll('.message').forEach((el) => {
        removeSummaryDisplay(el as HTMLElement);
      });
    }
  };

  const injectMenuOption = () => {
    const onClick = () => {
      api.ui.showPopup({
        title: t('extensionsBuiltin.chatMemory.popupTitle'),
        component: markRaw(MemoryPopup),
        componentProps: { api },
        wide: true,
        large: true,
        okButton: false,
        cancelButton: 'common.close',
      });
    };
    api.ui.registerChatFormOptionsMenuItem({
      id: 'chat-memory-option',
      icon: 'fa-solid fa-brain',
      label: t('extensionsBuiltin.chatMemory.menuItem'),
      visible: api.chat.getChatInfo() !== null,
      onClick,
    });
    api.ui.registerChatQuickAction('core.context-ai', '', {
      id: 'chat-memory-quick-action',
      icon: 'fa-solid fa-brain',
      label: t('extensionsBuiltin.chatMemory.menuItem'),
      disabled: api.chat.getChatInfo() === null,
      onClick,
    });
  };

  api.ui.registerMessageButton({
    id: 'chat-memory.summarize',
    placement: 'start',
    icon: 'fa-brain',
    title: t('extensionsBuiltin.chatMemory.summarizeButton'),
    visible: () => !!api.settings.get('enableMessageSummarization'),
    onClick: (messageIndex) => summarizeMessage(messageIndex),
  });

  // --- Event Listeners ---

  api.events.on('chat:entered', () => {
    injectMenuOption();
    updateAllMessages();
  });

  api.events.on('message:created', (message: ChatMessage) => {
    const history = api.chat.getHistory();
    const messageIndex = history.length - 1;

    const el = document.querySelector(`.message[data-message-index="${messageIndex}"]`);
    if (el) processMessageElement(el as HTMLElement, message);

    // Auto Summarize
    const settings = api.settings.get();
    if (settings?.enableMessageSummarization && settings?.autoMessageSummarize) {
      if (message.is_system || !message.mes.trim()) return;
      summarizeMessage(messageIndex);
    }
  });

  api.events.on('message:updated', async (index: number) => {
    const el = document.querySelector(`.message[data-message-index="${index}"]`);
    if (el) processMessageElement(el as HTMLElement, api.chat.getMessage(index));

    // Handle Content Changes vs Summary
    // const extra = message.extra?.[EXTENSION_KEY] as MemoryMessageExtra | undefined;
    // // If content changed (logic handled by core triggering update), we might want to clear summary or re-summarize
    // // But we need to distinguish between update caused by US (setting summary) and USER (editing text)
    // // This is hard without comparing old vs new message content.
    // // For now, we rely on manual re-summarize or bulk if user edits text.
  });

  // Prompt Injection: Replace content with summary
  api.events.on('prompt:history-message-processing', (payload, context) => {
    const settings = api.settings.get();
    if (!settings?.enableMessageSummarization) return;

    const ignoreCount = settings.ignoreSummaryCount || 100;

    if (ignoreCount > 0) {
      if (context.index >= context.chatLength - ignoreCount) {
        return;
      }
    }

    const extra = context.originalMessage.extra[EXTENSION_KEY] as MemoryMessageExtra['core.chat-memory'] | undefined;
    if (payload.apiMessages.length >= 1 && extra?.summary && extra.summary.trim().length > 0) {
      payload.apiMessages[0].content = extra.summary;
    }
  });

  // @ts-expect-error extension event
  api.events.on('chat-memory:refresh-ui', () => {
    updateAllMessages();
  });

  // Initial Boot
  injectStyles();
  injectMenuOption();
  if (api.chat.getChatInfo()) {
    updateAllMessages();
  }

  return () => {
    document.querySelectorAll('.memory-summary-injection').forEach((el) => el.remove());
    document.querySelectorAll('.content-dimmed').forEach((el) => el.classList.remove('content-dimmed'));
    document.getElementById('chat-memory-styles')?.remove();
  };
}
