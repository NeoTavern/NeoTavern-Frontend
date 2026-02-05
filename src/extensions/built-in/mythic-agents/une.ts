import { DEFAULT_UNE_SETTINGS } from './defaults';
import type { UNENpcProfile } from './types';

export function genUNENpc(
  modifiers: string[] = DEFAULT_UNE_SETTINGS.modifiers,
  nouns: string[] = DEFAULT_UNE_SETTINGS.nouns,
  motivationVerbs: string[] = DEFAULT_UNE_SETTINGS.motivation_verbs,
  motivationNouns: string[] = DEFAULT_UNE_SETTINGS.motivation_nouns,
): UNENpcProfile {
  return {
    modifier: modifiers[Math.floor(Math.random() * modifiers.length)],
    noun: nouns[Math.floor(Math.random() * nouns.length)],
    motivation_verb: motivationVerbs[Math.floor(Math.random() * motivationVerbs.length)],
    motivation_noun: motivationNouns[Math.floor(Math.random() * motivationNouns.length)],
  };
}
