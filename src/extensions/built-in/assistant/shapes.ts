import type { Character, ChatMessage, Persona, WorldInfoEntry } from '../../../types';

/** The shapes the read tools return; `[Referenced]` blocks inline the same ones. */

export const CHARACTER_TEXT_FIELDS = ['description', 'personality', 'scenario', 'first_mes', 'mes_example'] as const;
export type CharacterTextField = (typeof CHARACTER_TEXT_FIELDS)[number];

export function characterShape(character: Character) {
  return {
    avatar: character.avatar,
    name: character.name,
    description: character.description ?? '',
    personality: character.personality ?? '',
    scenario: character.scenario ?? '',
    first_mes: character.first_mes ?? '',
    alternate_greetings: character.data?.alternate_greetings ?? [],
    mes_example: character.mes_example ?? '',
  };
}

export function entryShape(entry: WorldInfoEntry) {
  return { uid: entry.uid, comment: entry.comment, key: entry.key, content: entry.content, constant: entry.constant };
}

export function messageShape(message: Pick<ChatMessage, 'name' | 'is_user' | 'mes'>, index: number) {
  return { index, name: message.name, is_user: message.is_user, mes: message.mes };
}

export function personaShape(persona: Persona) {
  return { avatarId: persona.avatarId, name: persona.name, description: persona.description };
}

/** Inclusive range clamped to a history of `length` messages; null when nothing is left. */
export function clampRange(from: number, to: number, length: number): { from: number; to: number } | null {
  const start = Math.max(0, from);
  const end = Math.min(length - 1, to);
  return start <= end ? { from: start, to: end } : null;
}
