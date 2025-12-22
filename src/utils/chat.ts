import DOMPurify, { type Config } from 'dompurify';
import hljs from 'highlight.js';
import { Marked, type TokenizerAndRendererExtension } from 'marked';
import { macroService, type MacroContextData } from '../services/macro-service';
import type { ChatMessage } from '../types';
import { getMessageTimeStamp } from './commons';
import { scopeHtml } from './style-scoper';

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

// Helper to handle DOMPurify in both Browser and Test (Node/JSDOM) environments
let sanitizerInstance: typeof DOMPurify | null = null;

function getSanitizer() {
  if (sanitizerInstance) return sanitizerInstance;

  if (typeof DOMPurify === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sanitizerInstance = (DOMPurify as any)(window);
  } else {
    sanitizerInstance = DOMPurify;
  }
  return sanitizerInstance;
}

export function formatText(text: string, forbidExternalMedia: boolean = false): string {
  if (!text) return '';

  const rawHtml = marked.parse(text) as string;

  const config: Config = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    ADD_TAGS: ['style', 'custom-style', 'q'],
    ADD_ATTR: ['target', 'class', 'id'],
    FORBID_TAGS: forbidExternalMedia ? MEDIA_TAGS : [],
  };

  const sanitizer = getSanitizer();
  if (!sanitizer || typeof sanitizer.sanitize !== 'function') {
    console.warn('DOMPurify sanitizer not initialized correctly.');
    return rawHtml;
  }

  const sanitizedHtml = sanitizer.sanitize(rawHtml, config) as string;

  return scopeHtml(sanitizedHtml);
}

export function formatMessage(message: ChatMessage, forbidExternalMedia: boolean = false): string {
  const textToFormat = message?.extra?.display_text || message.mes;
  return formatText(textToFormat, forbidExternalMedia);
}

export function formatReasoning(message: ChatMessage, forbidExternalMedia: boolean = false): string {
  if (!message.extra?.reasoning) return '';
  const textToFormat = message.extra.reasoning_display_text || message.extra.reasoning;
  return formatText(textToFormat, forbidExternalMedia);
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
