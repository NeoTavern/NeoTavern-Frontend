import Showdown from 'showdown';
import DOMPurify from 'dompurify';
import type { ChatMessage } from '../types';

const converter = new Showdown.Converter({
  // See https://github.com/showdownjs/showdown/wiki/Showdown-Options
  ghCompatibleHeaderId: true,
  parseImgDimensions: true,
  strikethrough: true,
  tables: true,
  tasklists: true,
  smartIndentationFix: true,
  simpleLineBreaks: true,
  openLinksInNewWindow: true,
});

/**
 * Formats a raw string with Markdown and sanitizes it.
 * @param text The raw string to format.
 * @param options Formatting options.
 * @returns An HTML string.
 */
export function formatText(text: string, options?: { isSystem?: boolean }): string {
  if (!text) return '';
  let formattedText = text;

  // TODO: Add more complex logic from original messageFormatting, like param substitution, regex, etc.

  if (!options?.isSystem) {
    // Basic quote handling similar to original
    formattedText = formattedText.replace(/"(.*?)"/g, '<q>"$1"</q>');
    formattedText = converter.makeHtml(formattedText);
  }

  const config: DOMPurify.Config = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    ADD_TAGS: ['custom-style', 'q'], // Allow <q> for quotes
  };

  return DOMPurify.sanitize(formattedText, config);
}

/**
 * A wrapper for `formatText` that specifically handles a ChatMessage object,
 * accounting for properties like `display_text`.
 * @param message The ChatMessage object.
 * @returns An HTML string.
 */
export function formatMessage(message: ChatMessage): string {
  const textToFormat = message?.extra?.display_text || message.mes;
  return formatText(textToFormat, { isSystem: message.is_system });
}

/**
 * A wrapper for `formatText` that specifically handles the reasoning part of a ChatMessage,
 * accounting for `reasoning_display_text`.
 * @param message The ChatMessage object.
 * @returns An HTML string.
 */
export function formatReasoning(message: ChatMessage): string {
  if (!message.extra?.reasoning) return '';
  const textToFormat = message.extra.reasoning_display_text || message.extra.reasoning;
  return formatText(textToFormat, { isSystem: message.is_system });
}
