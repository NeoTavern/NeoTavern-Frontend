import { Marked } from 'marked';
import DOMPurify, { type Config } from 'dompurify';
import type { ChatMessage } from '../types';

const marked = new Marked({
  async: false,
  gfm: true, // GitHub Flavored Markdown (Tables, Strikethrough, Tasklists)
  breaks: true, // Convert \n to <br>
  pedantic: false,
});

const renderer = {
  link({ href, title, text }: { href: string; title?: string | null; text: string }): string {
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
  },
  // TODO: Implement custom image handling if we need '![alt](url =100x100)' syntax support
  // Showdown supported parsing dimensions from the URL/alt text, whereas standard Markdown does not.
};

marked.use({ renderer });

/**
 * Formats a raw string with Markdown and sanitizes it.
 * @param text The raw string to format.
 * @param options Formatting options.
 * @returns An HTML string.
 */
export function formatText(text: string, options?: { isSystem?: boolean }): string {
  if (!text) return '';

  let contentToParse = text;

  // Legacy SillyTavern behavior: Wrap quotes in <q> tags.
  // TODO: This regex is simplistic and might break HTML attributes containing quotes.
  // A more robust solution would be a custom Tokenizer in marked.
  if (!options?.isSystem) {
    contentToParse = contentToParse.replace(/"(.*?)"/g, '<q>"$1"</q>');
  }

  const rawHtml = marked.parse(contentToParse) as string;

  const config: Config = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    ADD_TAGS: ['custom-style', 'q'], // Allow <q> for quotes
    ADD_ATTR: ['target'], // openLinksInNewWindow
  };

  return DOMPurify.sanitize(rawHtml, config);
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
