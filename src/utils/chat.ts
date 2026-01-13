import DOMPurify, { type Config } from 'dompurify';
import hljs from 'highlight.js';
import { Marked, type Token, type TokenizerAndRendererExtension } from 'marked';
import { macroService, type MacroContextData } from '../services/macro-service';
import type { ChatMediaItem, ChatMessage } from '../types';
import { getMessageTimeStamp } from './commons';
import { scopeHtml } from './style-scoper';

/**
 * Heuristic to check if a string is a self-contained HTML block.
 * This is used to decide whether to parse as Markdown or treat as raw HTML.
 * It helps preserve structure and <style> tags that Markdown might mangle.
 * @param text The string to check.
 */
function isHtmlBlock(text: string): boolean {
  const trimmed = text.trim();
  // Regex Breakdown:
  // ^<([a-z][a-z0-9-]*)\b  : Starts with <tagname (word boundary ensures strict match)
  // [\s\S]*                : Any content in between
  // <\/\1>$                : Ends with </tagname> (matching the captured tag name)
  return /^<([a-z][a-z0-9-]*)\b[\s\S]*<\/\1>$/i.test(trimmed);
}

// --- Markdown & Formatting ---

const marked = new Marked({
  async: false,
  gfm: true,
  breaks: true,
  pedantic: false,
});

const renderer = {
  link({ href, title, text }: { href: string; title?: string | null; text: string }): string {
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
  },
  code({ text, lang }: { text: string; lang?: string }): string {
    if (lang) {
      try {
        const highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true });
        return `<pre><code class="hljs language-${lang}">${highlighted.value}</code></pre>`;
      } catch {
        console.warn(`Failed to highlight code for language: ${lang}`);
      }
    }
    try {
      const highlighted = hljs.highlightAuto(text);
      return `<pre><code class="hljs">${highlighted.value}</code></pre>`;
    } catch {
      return `<pre><code>${text}</code></pre>`;
    }
  },
};

const createDialogueExtension = (name: string, startChar: string, endChar: string): TokenizerAndRendererExtension => ({
  name,
  level: 'inline',
  start(src: string) {
    return src.indexOf(startChar);
  },
  tokenizer(src: string) {
    const escapedStart = startChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedEnd = endChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(`^${escapedStart}([^${escapedEnd}]*?)${escapedEnd}`);
    const match = rule.exec(src);
    if (match) {
      return {
        type: name,
        raw: match[0],
        text: match[0],
        tokens: this.lexer.inlineTokens(match[1]),
      };
    }
    return undefined;
  },
  renderer(token) {
    return `<q>${startChar}${this.parser.parseInline(token.tokens || [])}${endChar}</q>`;
  },
});

const dialogue1Extension = createDialogueExtension('dialogue1', '"', '"');
const dialogue2Extension = createDialogueExtension('dialogue2', '❝', '❞');
const dialogue3Extension = createDialogueExtension('dialogue3', '“', '”');

marked.use({
  renderer,
  extensions: [dialogue1Extension, dialogue2Extension, dialogue3Extension],
});

const MEDIA_TAGS = ['img', 'video', 'audio', 'iframe', 'embed', 'object', 'picture', 'source', 'track'];
const PLACEHOLDER_TAG = 'x-style-placeholder';

// Helper to handle DOMPurify in both Browser and Test (Node/JSDOM) environments
let sanitizerInstance: typeof DOMPurify | null = null;

function getSanitizer(): typeof DOMPurify {
  if (sanitizerInstance) return sanitizerInstance;

  if (typeof DOMPurify === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sanitizerInstance = (DOMPurify as any)(window);
  } else {
    sanitizerInstance = DOMPurify;
  }
  return sanitizerInstance as typeof DOMPurify;
}

export function formatText(text: string, forbidExternalMedia: boolean = false, ignoredMedia: string[] = []): string {
  if (!text) return '';

  let rawHtml: string;

  const customRenderer = new marked.Renderer();
  Object.assign(customRenderer, renderer);

  customRenderer.image = ({ href, title, text }) => {
    if (!href) return text;

    const sanitizedHref = getSanitizer().sanitize(href) as string;
    const isIgnored = ignoredMedia.includes(sanitizedHref);

    const sanitizedTitle = title ? (getSanitizer().sanitize(title) as string) : '';
    const sanitizedText = getSanitizer().sanitize(text) as string;
    const ignoredClass = isIgnored ? 'is-ignored' : '';

    return `<img src="${sanitizedHref}" alt="${sanitizedText}" title="${
      sanitizedTitle || sanitizedText
    }" class="message-content-image ${ignoredClass}">`;
  };

  if (isHtmlBlock(text)) {
    rawHtml = text;
  } else {
    rawHtml = marked.parse(text, { renderer: customRenderer }) as string;
  }

  // Mask <style> tags to prevent DOMPurify from stripping them (e.g. due to @keyframes or other complex CSS)
  // We use a custom placeholder tag to temporarily hold the style content.
  const styleMatches: string[] = [];
  const protectedHtml = rawHtml.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (match) => {
    styleMatches.push(match);
    return `<${PLACEHOLDER_TAG} data-index="${styleMatches.length - 1}"></${PLACEHOLDER_TAG}>`;
  });

  const config: Config = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    ADD_TAGS: ['style', 'custom-style', 'q', PLACEHOLDER_TAG],
    ADD_ATTR: ['target', 'class', 'id', 'data-index'],
    FORBID_TAGS: forbidExternalMedia ? MEDIA_TAGS : [],
  };

  const sanitizer = getSanitizer();
  if (!sanitizer || typeof sanitizer.sanitize !== 'function') {
    console.warn('DOMPurify sanitizer not initialized correctly.');
    return rawHtml;
  }

  let sanitizedHtml = sanitizer.sanitize(protectedHtml, config) as string;

  // Restore <style> tags
  sanitizedHtml = sanitizedHtml.replace(
    new RegExp(`<${PLACEHOLDER_TAG} data-index="(\\d+)"><\\/${PLACEHOLDER_TAG}>`, 'gi'),
    (_, index) => {
      const i = parseInt(index, 10);
      return styleMatches[i] || '';
    },
  );

  return scopeHtml(sanitizedHtml);
}

export function formatMessage(message: ChatMessage, forbidExternalMedia: boolean = false): string {
  const textToFormat = message?.extra?.display_text || message.mes;
  const ignored = message.extra?.ignored_media ?? [];
  return formatText(textToFormat, forbidExternalMedia, ignored);
}

export function formatReasoning(message: ChatMessage, forbidExternalMedia: boolean = false): string {
  if (!message.extra?.reasoning) return '';
  const textToFormat = message.extra.reasoning_display_text || message.extra.reasoning;
  const ignored = message.extra?.ignored_media ?? [];
  return formatText(textToFormat, forbidExternalMedia, ignored);
}

export function extractMediaFromMarkdown(text: string): ChatMediaItem[] {
  if (isHtmlBlock(text)) {
    return [];
  }

  const tokens = marked.lexer(text);
  const mediaItems: ChatMediaItem[] = [];
  const seenUrls = new Set<string>();

  function walkTokens(tokens: Token[]) {
    for (const token of tokens) {
      if (token.type === 'image' && token.href && !seenUrls.has(token.href)) {
        mediaItems.push({
          source: 'inline',
          type: 'image',
          url: token.href,
          title: token.title ?? token.text,
        });
        seenUrls.add(token.href);
      }
      if ('tokens' in token && token.tokens) {
        walkTokens(token.tokens);
      }
    }
  }

  walkTokens(tokens);
  return mediaItems;
}

// --- Chat Initialization ---

export function getFirstMessage(context: MacroContextData): ChatMessage | null {
  if (!context.characters) {
    return null;
  }
  const firstCharacter = context.activeCharacter || context.characters[0];
  const firstMes = macroService.process(firstCharacter.first_mes || '', context);
  const alternateGreetings = firstCharacter?.data?.alternate_greetings;

  const message: ChatMessage = {
    name: firstCharacter.name || '',
    is_user: false,
    is_system: false,
    send_date: getMessageTimeStamp(),
    mes: firstMes,
    extra: {},
    original_avatar: firstCharacter.avatar,
    swipe_id: 0,
    swipes: firstMes ? [firstMes] : [],
    swipe_info: firstMes ? [{ extra: {}, send_date: getMessageTimeStamp() }] : [],
  };

  const inlineMedia = extractMediaFromMarkdown(firstMes);
  if (inlineMedia.length > 0) {
    message.extra.media = inlineMedia;
  }

  if (Array.isArray(alternateGreetings) && alternateGreetings.length > 0) {
    const swipes = [message.mes, ...alternateGreetings.map((greeting) => macroService.process(greeting, context))];
    if (!message.mes) {
      swipes.shift();
      message.mes = swipes[0] ?? '';
    }
    message.swipe_id = 0;
    message.swipes = swipes.filter(Boolean);
    message.swipe_info = message.swipes.map(() => ({
      send_date: message.send_date,
      extra: {},
    }));
  }

  return message;
}
