import Handlebars from 'handlebars';
import type { ApiChatMessage, ExtensionAPI } from '../../../types';
import { type ChatTranslationSettings, DEFAULT_PROMPT } from './types';

// Register helpers once
Handlebars.registerHelper('slice', (context, count) => {
  if (!Array.isArray(context)) return [];
  return context.slice(count);
});

Handlebars.registerHelper('add', (a, b) => {
  return Number(a) + Number(b);
});

export class Translator {
  constructor(private api: ExtensionAPI<ChatTranslationSettings>) {}

  private getSettings(): ChatTranslationSettings {
    return (
      this.api.settings.get() || {
        connectionProfile: undefined,
        sourceLang: 'Auto',
        targetLang: 'English',
        autoMode: 'none',
        prompt: DEFAULT_PROMPT,
      }
    );
  }

  async translateMessage(messageIndex: number): Promise<void> {
    const history = this.api.chat.getHistory();
    const message = history[messageIndex];

    if (!message) return;

    // Toggle Off Logic
    if (message.extra?.display_text) {
      await this.api.chat.updateMessageObject(messageIndex, {
        extra: { ...message.extra, display_text: undefined },
      });
      this.api.ui.showToast('Translation removed', 'info');
      return;
    }

    const settings = this.getSettings();

    if (!settings.connectionProfile) {
      this.api.ui.showToast('No connection profile selected for translation', 'error');
      return;
    }

    this.api.ui.showToast('Translating...', 'info');

    try {
      // Compile Prompt
      const template = Handlebars.compile(settings.prompt, { noEscape: true });
      const prompt = template({
        language: settings.targetLang, // Support legacy {{language}}
        targetLang: settings.targetLang,
        sourceLang: settings.sourceLang,
        prompt: message.mes,
        name: message.name,
        chat: history,
      });

      // Call LLM
      const messages: ApiChatMessage[] = [{ role: 'system', content: prompt, name: 'System' }];

      // Use type assertion if 'system' isn't strictly allowed in ApiChatMessage yet,
      // but usually translation is a direct instruction.

      const response = await this.api.llm.generate(messages, {
        connectionProfileName: settings.connectionProfile,
      });

      let translatedText = '';

      if (typeof response === 'function') {
        // Stream handling
        const generator = response();
        for await (const chunk of generator) {
          translatedText += chunk.delta;
        }
      } else {
        translatedText = response.content;
      }

      // Extract code block if present (as per default prompt instructions)
      const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
      const match = translatedText.match(codeBlockRegex);
      if (match && match[1]) {
        translatedText = match[1].trim();
      }

      // Update Message
      await this.api.chat.updateMessageObject(messageIndex, {
        extra: { ...message.extra, display_text: translatedText },
      });

      this.api.ui.showToast('Translation complete', 'success');
    } catch (error) {
      console.error('Translation failed', error);
      this.api.ui.showToast('Translation failed', 'error');
    }
  }
}
