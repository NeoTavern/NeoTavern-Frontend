import type { UNENpcProfile } from './types';

export function genUNENpc(
  modifiers: string[],
  nouns: string[],
  motivationVerbs: string[],
  motivationNouns: string[],
): UNENpcProfile {
  return {
    modifier: modifiers[Math.floor(Math.random() * modifiers.length)],
    noun: nouns[Math.floor(Math.random() * nouns.length)],
    motivation_verb: motivationVerbs[Math.floor(Math.random() * motivationVerbs.length)],
    motivation_noun: motivationNouns[Math.floor(Math.random() * motivationNouns.length)],
  };
}
