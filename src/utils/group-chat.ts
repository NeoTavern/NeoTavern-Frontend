import type { Character } from '../types';

/**
 * Joins a specific field from multiple characters into a single string,
 * prefixed with the character's name to distinguish them in the prompt.
 */
export function joinCharacterField(
  characters: Character[],
  fieldGetter: (char: Character) => string | undefined,
): string {
  return characters
    .map((char) => {
      const val = fieldGetter(char);
      if (!val || !val.trim()) return null;
      // For single character (if list has 1), strictly speaking we might not need the name prefix,
      // but for consistency in Join mode, we usually keep it or rely on prompt template.
      // However, standard ST behavior for Join mode puts: "Character Name: Field Content"
      // TODO: Configuration?
      return `${char.name}: ${val.trim()}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Determines which characters are "active" for the prompt context based on the handling mode.
 */
export function getCharactersForContext(
  allMembers: Character[],
  currentSpeaker: Character,
  isJoinMode: boolean,
  includeMuted: boolean,
  mutedStatus: Record<string, boolean>,
): Character[] {
  if (!isJoinMode) {
    // Swap mode: Only the current speaker is in context
    return [currentSpeaker];
  }

  // Join mode
  return allMembers.filter((char) => {
    // If it's the current speaker, always include (even if technically muted in UI, they are speaking now)
    if (char.avatar === currentSpeaker.avatar) return true;

    const isMuted = mutedStatus[char.avatar] ?? false;
    if (isMuted && !includeMuted) return false;

    return true;
  });
}
