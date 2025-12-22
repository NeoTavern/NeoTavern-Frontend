import { talkativeness_default } from '../../../constants';
import type { Character, ChatMessage } from '../../../types';
import type { GroupChatConfig } from './types';
import { GroupReplyStrategy } from './types';

export function getMentions(text: string, characters: Character[]): string[] {
  const mentions: { index: number; avatar: string }[] = [];
  const lowerText = text.toLowerCase();

  characters.forEach((char) => {
    const name = char.name.trim().toLowerCase();
    if (!name) return;
    // Check for name occurrence
    const idx = lowerText.indexOf(name);
    if (idx !== -1) {
      mentions.push({ index: idx, avatar: char.avatar });
    }
  });

  // Sort by position in text
  mentions.sort((a, b) => a.index - b.index);

  const avatars = mentions.map((m) => m.avatar);
  // Remove duplicates
  return [...new Set(avatars)];
}

export function determineNextSpeaker(
  activeMembers: Character[],
  groupConfig: GroupChatConfig | null,
  chatMessages: ChatMessage[],
): Character[] {
  if (!groupConfig) {
    return activeMembers.length > 0 ? [activeMembers[0]] : [];
  }

  const validSpeakers = activeMembers.filter((c) => !groupConfig.members[c.avatar]?.muted);
  if (validSpeakers.length === 0) return [];

  const lastMessage = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
  const strategy = groupConfig.config.replyStrategy;

  if (strategy === GroupReplyStrategy.MANUAL) {
    return [];
  }

  if (strategy === GroupReplyStrategy.LIST_ORDER) {
    if (!lastMessage || lastMessage.is_user) return [validSpeakers[0]];
    const lastIndex = validSpeakers.findIndex((c) => c.avatar === lastMessage.original_avatar);
    const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % validSpeakers.length;
    return [validSpeakers[nextIndex]];
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
      return [available[Math.floor(Math.random() * available.length)]];
    }
    return [validSpeakers[Math.floor(Math.random() * validSpeakers.length)]];
  }

  if (strategy === GroupReplyStrategy.NATURAL_ORDER) {
    if (!lastMessage) return [validSpeakers[Math.floor(Math.random() * validSpeakers.length)]];

    // 1. Check Mentions
    const mentionedAvatars = getMentions(lastMessage.mes, validSpeakers);
    const validMentions = mentionedAvatars
      .filter((avatar) => groupConfig.config.allowSelfResponses || avatar !== lastMessage.original_avatar)
      .map((avatar) => validSpeakers.find((c) => c.avatar === avatar))
      .filter(Boolean) as Character[];

    if (validMentions.length > 0) {
      return validMentions;
    }

    // 2. Talkativeness RNG
    const candidates: Character[] = [];
    for (const char of validSpeakers) {
      if (!groupConfig.config.allowSelfResponses && lastMessage.original_avatar === char.avatar) continue;
      const chance = (char.talkativeness ?? talkativeness_default) * 100;
      if (Math.random() * 100 < chance) {
        candidates.push(char);
      }
    }

    if (candidates.length > 0) {
      // Shuffle to prevent deterministic order if talkativeness is high for multiple chars
      return candidates.sort(() => 0.5 - Math.random());
    }

    // 3. Fallback: Pick one random
    return [validSpeakers[Math.floor(Math.random() * validSpeakers.length)]];
  }

  return [];
}
