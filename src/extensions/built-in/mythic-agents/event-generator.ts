import type { Expression } from 'jsep';
import jsep from 'jsep';
import type { EventFocus, EventGenerationData, EventMeaningResult, MythicCharacter, Scene, UNESettings } from './types';
import { genUNENpc } from './une';

/**
 * min and max are inclusive
 */
export function diceRoll(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getEventFocusEntry(focuses: EventFocus[]): EventFocus {
  const roll = diceRoll(1, 100);
  for (const entry of focuses) {
    if (roll >= entry.min && roll <= entry.max) {
      return entry;
    }
  }
  // Fallback in case of misconfiguration
  return { min: 0, max: 0, focus: 'Ambiguous event' };
}

export function generateEventMeaning(data: EventGenerationData): { action: string; subject: string } {
  const actionIndex = diceRoll(0, data.actions.length - 1);
  const subjectIndex = diceRoll(0, data.subjects.length - 1);
  return {
    action: data.actions[actionIndex],
    subject: data.subjects[subjectIndex],
  };
}

/**
 * Parses a complex action string (e.g., "(random_npc or random_pc) and new_warrior")
 * using an Abstract Syntax Tree (AST) and returns a list of simple actions to execute.
 * This handles nested parentheses and complex and/or logic.
 */
function parseActionString(actionString: string): string[] {
  // Add custom binary operators for 'and' and 'or' to jsep if they don't exist.
  if (!jsep.binary_ops['or']) {
    jsep.addBinaryOp('or', 1); // Low precedence
  }
  if (!jsep.binary_ops['and']) {
    jsep.addBinaryOp('and', 2); // Higher precedence than 'or'
  }

  const parseTree = jsep(actionString);

  /**
   * Recursively traverses the AST to resolve the final actions.
   */
  function resolveNode(node: Expression): string[] {
    switch (node.type) {
      case 'LogicalExpression':
      case 'BinaryExpression': {
        const binExpr = node as jsep.BinaryExpression;
        const op = binExpr.operator;
        const left = binExpr.left;
        const right = binExpr.right;

        if (op === 'or') {
          // For 'or', randomly pick one branch to resolve.
          return diceRoll(0, 1) === 0 ? resolveNode(left) : resolveNode(right);
        } else if (op === 'and') {
          // For 'and', resolve both branches and combine their results.
          return [...resolveNode(left), ...resolveNode(right)];
        }
        throw new Error(`Unsupported binary operator: ${op}`);
      }

      case 'Identifier':
        // An identifier is a simple action like 'random_npc'.
        return [(node as jsep.Identifier).name];

      default:
        throw new Error(`Unsupported expression type in action string: ${node.type}`);
    }
  }

  const resolvedActions = resolveNode(parseTree);
  return resolvedActions.filter(Boolean);
}

export function generateFullRandomEvent(
  scene: Scene,
  eventGenerationData: EventGenerationData,
  uneSettings: UNESettings,
): EventMeaningResult {
  const focusEntry = getEventFocusEntry(eventGenerationData.focuses);
  const meaning = generateEventMeaning(eventGenerationData);

  const result: EventMeaningResult = {
    focus: focusEntry.focus,
    action: meaning.action,
    subject: meaning.subject,
    characters: [],
    threads: [],
    new_npcs: [],
  };

  if (focusEntry.action) {
    let actionsToExecute: string[] = [];
    try {
      actionsToExecute = parseActionString(focusEntry.action);
    } catch (e) {
      console.error('Failed to parse event action:', e);
      // Fallback
      actionsToExecute = [];
    }

    const availableCharacters = [...scene.characters];
    const availableThreads = [...scene.threads];

    for (const action of actionsToExecute) {
      if (action.startsWith('new_')) {
        const type = action.substring('new_'.length);
        const une_profile = genUNENpc(
          uneSettings.modifiers,
          uneSettings.nouns,
          uneSettings.motivation_verbs,
          uneSettings.motivation_nouns,
        );

        // Map underscores back to spaces if needed or treat as type directly
        // The user settings might define complex types, but usually they are simple.
        const characterType = type.replace(/_/g, ' ');

        result.new_npcs!.push({
          id: `npc_${Date.now()}_${Math.random()}`,
          name: `${une_profile.modifier} ${une_profile.noun}`, // Placeholder name
          type: characterType.toUpperCase(),
          une_profile,
        });
      } else if (action === 'random_thread') {
        if (availableThreads.length > 0) {
          const randomIndex = diceRoll(0, availableThreads.length - 1);
          result.threads!.push(availableThreads[randomIndex]);
          availableThreads.splice(randomIndex, 1); // Ensure it's not picked again
        }
      } else if (action.startsWith('random_')) {
        const typeToFind = action.substring('random_'.length).replace(/_/g, ' ');
        let matchingCharacters: MythicCharacter[];

        if (typeToFind === 'npc') {
          matchingCharacters = availableCharacters.filter((c) => !['pc', 'player'].includes(c.type.toLowerCase()));
        } else if (typeToFind === 'pc') {
          matchingCharacters = availableCharacters.filter((c) => ['pc', 'player'].includes(c.type.toLowerCase()));
        } else {
          matchingCharacters = availableCharacters.filter((c) => c.type.toLowerCase() === typeToFind);
        }

        if (matchingCharacters.length > 0) {
          const randomIndex = diceRoll(0, matchingCharacters.length - 1);
          const selectedChar = matchingCharacters[randomIndex];
          result.characters!.push({ name: selectedChar.name, type: selectedChar.type });
          const indexInAvailable = availableCharacters.findIndex(
            (c) => c.name === selectedChar.name && c.type === selectedChar.type,
          );
          if (indexInAvailable > -1) {
            availableCharacters.splice(indexInAvailable, 1);
          }
        }
      }
    }
  }

  // Clean up empty arrays
  if (result.characters?.length === 0) delete result.characters;
  if (result.threads?.length === 0) delete result.threads;
  if (result.new_npcs?.length === 0) delete result.new_npcs;

  return result;
}
