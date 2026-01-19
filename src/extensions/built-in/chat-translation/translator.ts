import Handlebars from 'handlebars';
import type { ApiChatMessage, ExtensionAPI } from '../../../types';
import { type ChatTranslationSettings, DEFAULT_PROMPT } from './types';

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
        extra: { display_text: undefined },
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
        connectionProfile: settings.connectionProfile,
      });

      let translatedText = '';

      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
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
        extra: { display_text: translatedText },
      });

      this.api.ui.showToast('Translation complete', 'success');
    } catch (error) {
      console.error('Translation failed', error);
      this.api.ui.showToast('Translation failed', 'error');
    }
  }

  async translateInput(): Promise<void> {
    const input = this.api.chat.getChatInput();
    if (!input) return;

    const { value, selectionStart, selectionEnd } = input;
    const hasSelection = selectionStart !== selectionEnd;
    const textToTranslate = hasSelection ? value.slice(selectionStart, selectionEnd) : value;

    if (!textToTranslate.trim()) return;

    const settings = this.getSettings();

    if (!settings.connectionProfile) {
      this.api.ui.showToast('No connection profile selected for translation', 'error');
      return;
    }

    const sourceLang = settings.targetLang;
    const targetLang = settings.sourceLang;

    if (targetLang.toLowerCase() === 'auto') {
      this.api.ui.showToast(
        'Cannot reverse translate when Source Language is "Auto". Please set a specific Source Language.',
        'warning',
      );
      return;
    }

    this.api.ui.showToast('Translating input...', 'info');

    try {
      const template = Handlebars.compile(settings.prompt, { noEscape: true });
      const prompt = template({
        language: targetLang,
        targetLang: targetLang,
        sourceLang: sourceLang,
        prompt: textToTranslate,
        name: 'User',
        chat: this.api.chat.getHistory(),
      });

      const messages: ApiChatMessage[] = [{ role: 'system', content: prompt, name: 'System' }];

      const response = await this.api.llm.generate(messages, {
        connectionProfile: settings.connectionProfile,
      });

      let translatedText = '';

      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
          translatedText += chunk.delta;
        }
      } else {
        translatedText = response.content;
      }

      const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
      const match = translatedText.match(codeBlockRegex);
      if (match && match[1]) {
        translatedText = match[1].trim();
      }

      let newValue = '';
      if (hasSelection) {
        newValue = value.substring(0, selectionStart) + translatedText + value.substring(selectionEnd);
      } else {
        newValue = translatedText;
      }

      this.api.chat.setChatInput(newValue);
      this.api.ui.showToast('Input translated', 'success');
    } catch (error) {
      console.error('Input translation failed', error);
      this.api.ui.showToast('Input translation failed', 'error');
    }
  }
}
