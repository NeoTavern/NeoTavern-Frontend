import DOMPurify, { type Config } from 'dompurify';
import { Marked, type TokenizerAndRendererExtension } from 'marked';
import { GroupReplyStrategy, talkativeness_default } from '../constants';
import { macroService, type MacroContextData } from '../services/macro-service';
import type { Character, ChatMessage, ChatMetadata } from '../types';
import { getMessageTimeStamp } from './commons';

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

export function formatText(text: string): string {
  if (!text) return '';
  const rawHtml = marked.parse(text) as string;
  const config: Config = {
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    ADD_TAGS: ['custom-style', 'q'],
    ADD_ATTR: ['target'],
  };
  return DOMPurify.sanitize(rawHtml, config);
}

export function formatMessage(message: ChatMessage): string {
  const textToFormat = message?.extra?.display_text || message.mes;
  return formatText(textToFormat);
}

export function formatReasoning(message: ChatMessage): string {
  if (!message.extra?.reasoning) return '';
  const textToFormat = message.extra.reasoning_display_text || message.extra.reasoning;
  return formatText(textToFormat);
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

// --- Group Dynamics ---

export function getCharactersForContext(
  allMembers: Character[],
  currentSpeaker: Character,
  isJoinMode: boolean,
  includeMuted: boolean,
  mutedStatus: Record<string, boolean>,
): Character[] {
  if (!isJoinMode) {
    return [currentSpeaker];
  }
  return allMembers.filter((char) => {
    if (char.avatar === currentSpeaker.avatar) return true;
    const isMuted = mutedStatus[char.avatar] ?? false;
    if (isMuted && !includeMuted) return false;
    return true;
  });
}

export function determineNextSpeaker(
  activeMembers: Character[],
  groupConfig: ChatMetadata['group'] | null,
  chatMessages: ChatMessage[],
): Character | null {
  if (!groupConfig) {
    return activeMembers.length > 0 ? activeMembers[0] : null;
  }

  const validSpeakers = activeMembers.filter((c) => !groupConfig.members[c.avatar]?.muted);
  if (validSpeakers.length === 0) return null;

  const lastMessage = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
  const strategy = groupConfig.config.replyStrategy;

  if (strategy === GroupReplyStrategy.LIST_ORDER) {
    if (!lastMessage || lastMessage.is_user) return validSpeakers[0];
    const lastIndex = validSpeakers.findIndex((c) => c.avatar === lastMessage.original_avatar);
    const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % validSpeakers.length;
    return validSpeakers[nextIndex];
  }

  if (strategy === GroupReplyStrategy.POOLED_ORDER) {
    let lastUserIndex = -1;
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      if (chatMessages[i].is_user) {
        lastUserIndex = i;
        break;
      }
    }
    const speakersSinceUser = new Set<string>();
    if (lastUserIndex > -1) {
      for (let i = lastUserIndex + 1; i < chatMessages.length; i++) {
        if (!chatMessages[i].is_user) speakersSinceUser.add(chatMessages[i].name);
      }
    }
    const available = validSpeakers.filter((c) => !speakersSinceUser.has(c.name));
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }
    return validSpeakers[Math.floor(Math.random() * validSpeakers.length)];
  }

  if (strategy === GroupReplyStrategy.NATURAL_ORDER) {
    if (!lastMessage) return validSpeakers[Math.floor(Math.random() * validSpeakers.length)];

    const textToCheck = lastMessage.mes.toLowerCase();
    const mentions: Character[] = [];

    // Check mentions
    for (const char of validSpeakers) {
      if (!groupConfig.config.allowSelfResponses && lastMessage.original_avatar === char.avatar) continue;
      const nameParts = char.name.toLowerCase().split(' ');
      for (const part of nameParts) {
        if (part.length > 2 && new RegExp(`\\b${part}\\b`).test(textToCheck)) {
          mentions.push(char);
          break;
        }
      }
    }
    if (mentions.length > 0) return mentions[0];

    // Talkativeness RNG
    const candidates: Character[] = [];
    for (const char of validSpeakers) {
      if (!groupConfig.config.allowSelfResponses && lastMessage.original_avatar === char.avatar) continue;
      const chance = (char.talkativeness ?? talkativeness_default) * 100;
      if (Math.random() * 100 < chance) {
        candidates.push(char);
      }
    }
    if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];

    return validSpeakers[Math.floor(Math.random() * validSpeakers.length)];
  }

  return null;
}
