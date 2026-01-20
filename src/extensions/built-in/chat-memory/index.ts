import { markRaw } from 'vue';
import type { StrictT } from '../../../composables/useStrictI18n';
import i18n from '../../../i18n';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import { MountableComponent } from '../../../types/ExtensionAPI';
import { manifest } from './manifest';
import MemoryPopup from './MemoryPopup.vue';
import {
  DEFAULT_MESSAGE_SUMMARY_PROMPT,
  EXTENSION_KEY,
  type ChatMemoryMetadata,
  type ExtensionSettings,
  type MemoryMessageExtra,
} from './types';

export { manifest };

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
    const promptTemplate = settings?.messageSummaryPrompt || DEFAULT_MESSAGE_SUMMARY_PROMPT;
    const connectionProfile = settings?.connectionProfile;

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
        },
      );

      let fullContent = '';
      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
          fullContent += chunk.delta;
        }
      } else {
        fullContent = response.content;
      }

      // Extract from code block if present
      const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
      const match = fullContent.match(codeBlockRegex);
      const summaryText = match && match[1] ? match[1].trim() : fullContent.trim();

      await api.chat.updateMessageObject(messageIndex, {
        extra: {
          'core.chat-memory': {
            summary: summaryText,
          },
        },
      });

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

  const processMessageElement = (element: HTMLElement, index: number) => {
    const history = api.chat.getHistory();
    const message = history[index];
    if (!message) return;

    const extra = message.extra['core.chat-memory'];

    // Summary Display
    if (extra?.summary) {
      injectSummaryDisplay(element, extra.summary);
    } else {
      removeSummaryDisplay(element);
    }

    // Button Injection
    injectSummarizeButton(element, index);
  };

  const injectSummarizeButton = async (messageElement: HTMLElement, messageIndex: number) => {
    const settings = api.settings.get();
    if (!settings?.enableMessageSummarization) return;

    const buttonsContainer = messageElement.querySelector('.message-buttons');
    if (!buttonsContainer) return;

    if (buttonsContainer.querySelector('.summary-button-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'summary-button-wrapper';
    wrapper.style.display = 'inline-flex';

    buttonsContainer.insertBefore(wrapper, buttonsContainer.firstChild);

    await api.ui.mountComponent(wrapper, MountableComponent.Button, {
      icon: 'fa-brain',
      title: t('extensionsBuiltin.chatMemory.summarizeButton'),
      variant: 'ghost',
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        summarizeMessage(messageIndex);
      },
    });
  };

  const updateAllMessages = () => {
    const settings = api.settings.get();
    if (!settings?.enableMessageSummarization) {
      document.querySelectorAll('.message').forEach((el) => {
        removeSummaryDisplay(el as HTMLElement);
        el.querySelector('.summary-button-wrapper')?.remove();
      });
      return;
    }

    const messageElements = document.querySelectorAll('.message');
    messageElements.forEach((el) => {
      const indexAttr = el.getAttribute('data-message-index');
      if (indexAttr === null) return;
      const messageIndex = parseInt(indexAttr, 10);
      if (isNaN(messageIndex)) return;
      processMessageElement(el as HTMLElement, messageIndex);
    });
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
      visible: api.chat.getChatInfo() !== null,
      onClick,
    });
  };

  // --- Event Listeners ---

  const unbinds: Array<() => void> = [];

  unbinds.push(
    api.events.on('chat:entered', () => {
      injectMenuOption();
      updateAllMessages();
    }),
  );

  unbinds.push(
    api.events.on('message:created', (message: ChatMessage) => {
      const history = api.chat.getHistory();
      const messageIndex = history.length - 1;

      const el = document.querySelector(`.message[data-message-index="${messageIndex}"]`);
      if (el) processMessageElement(el as HTMLElement, messageIndex);

      // Auto Summarize
      const settings = api.settings.get();
      if (settings?.enableMessageSummarization && settings?.autoMessageSummarize) {
        if (message.is_system || !message.mes.trim()) return;
        summarizeMessage(messageIndex);
      }
    }),
  );

  unbinds.push(
    api.events.on('message:updated', async (index: number) => {
      const el = document.querySelector(`.message[data-message-index="${index}"]`);
      if (el) processMessageElement(el as HTMLElement, index);

      // Handle Content Changes vs Summary
      // const extra = message.extra?.[EXTENSION_KEY] as MemoryMessageExtra | undefined;
      // // If content changed (logic handled by core triggering update), we might want to clear summary or re-summarize
      // // But we need to distinguish between update caused by US (setting summary) and USER (editing text)
      // // This is hard without comparing old vs new message content.
      // // For now, we rely on manual re-summarize or bulk if user edits text.
    }),
  );

  // Prompt Injection: Replace content with summary
  unbinds.push(
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
    }),
  );

  unbinds.push(
    // @ts-expect-error extension event
    api.events.on('chat-memory:refresh-ui', () => {
      updateAllMessages();
    }),
  );

  // Initial Boot
  injectStyles();
  injectMenuOption();
  if (api.chat.getChatInfo()) {
    updateAllMessages();
  }

  return () => {
    unbinds.forEach((u) => u());
    document.querySelectorAll('.summary-button-wrapper').forEach((el) => el.remove());
    document.querySelectorAll('.memory-summary-injection').forEach((el) => el.remove());
    document.querySelectorAll('.content-dimmed').forEach((el) => el.classList.remove('content-dimmed'));
    document.getElementById('chat-memory-styles')?.remove();
    api.ui.unregisterChatFormOptionsMenuItem('chat-memory-option');
    api.ui.unregisterChatQuickAction('core.context-ai', 'chat-memory-quick-action');
  };
}
