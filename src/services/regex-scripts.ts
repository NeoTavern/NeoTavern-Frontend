import type { LegacyRegexScript, RegexScript, RegexScriptPlacement } from '../types/settings';

const placementByNumber: Record<number, RegexScriptPlacement> = {
  0: 'markdown',
  1: 'user',
  2: 'assistant',
  3: 'slash-command',
  5: 'world-info',
  6: 'reasoning',
};

const validPlacements = new Set<RegexScriptPlacement>(Object.values(placementByNumber));

export type RegexScriptInput = LegacyRegexScript &
  Partial<Pick<RegexScript, 'identifier' | 'pattern' | 'replacement' | 'flags'>> & {
    identifier?: string;
    pattern?: string;
    replacement?: string;
    flags?: string;
  };

export type RegexApplicationContext = {
  placement: RegexScriptPlacement;
  depth?: number;
};

export type RegexApplicationPass = 'prompt' | 'markdown';

function scriptLabel(input: RegexScriptInput): string {
  return input.scriptName || input.identifier || '<unnamed regex script>';
}

function parsePattern(script: RegexScriptInput): { pattern: string; flags: string } {
  const rawPattern = script.pattern ?? script.findRegex;
  if (typeof rawPattern !== 'string' || rawPattern.length === 0) {
    throw new Error(`Invalid regex pattern for script "${scriptLabel(script)}"`);
  }

  const explicitFlags = script.flags ?? '';
  if (rawPattern.startsWith('/')) {
    const delimiter = rawPattern.lastIndexOf('/');
    if (delimiter <= 0) {
      throw new Error(`Invalid slash-delimited regex pattern for script "${scriptLabel(script)}"`);
    }

    const pattern = rawPattern.slice(1, delimiter);
    const embeddedFlags = rawPattern.slice(delimiter + 1);
    if (explicitFlags && explicitFlags !== embeddedFlags) {
      throw new Error(`Conflicting regex flags for script "${scriptLabel(script)}"`);
    }
    return { pattern, flags: embeddedFlags || explicitFlags };
  }

  return { pattern: rawPattern, flags: explicitFlags };
}

function normalizePlacement(value: number | string, script: RegexScriptInput): RegexScriptPlacement {
  const placement = typeof value === 'number' ? placementByNumber[value] : value;
  if (!placement || !validPlacements.has(placement as RegexScriptPlacement)) {
    throw new Error(`Invalid placement for script "${scriptLabel(script)}": ${String(value)}`);
  }
  return placement as RegexScriptPlacement;
}

function normalizeDepth(value: number | null | undefined, field: 'minDepth' | 'maxDepth', script: RegexScriptInput) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${field} for script "${scriptLabel(script)}": ${String(value)}`);
  }
  return value;
}

export function normalizeRegexScript(input: RegexScriptInput): RegexScript {
  const label = scriptLabel(input);
  const { pattern, flags } = parsePattern(input);
  try {
    new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`Invalid regex pattern or flags for script "${label}": ${String(error)}`);
  }

  const rawPlacements = input.placement;
  if (!Array.isArray(rawPlacements) || rawPlacements.length === 0) {
    throw new Error(`Invalid placement for script "${label}": expected a non-empty array`);
  }
  const placement = rawPlacements.map((value) => normalizePlacement(value, input));
  const minDepth = normalizeDepth(input.minDepth, 'minDepth', input);
  const maxDepth = normalizeDepth(input.maxDepth, 'maxDepth', input);
  if (minDepth !== undefined && maxDepth !== undefined && minDepth > maxDepth) {
    throw new Error(`Invalid depth range for script "${label}": minDepth exceeds maxDepth`);
  }

  const trimStrings = input.trimStrings ?? [];
  if (!Array.isArray(trimStrings) || trimStrings.some((value) => typeof value !== 'string')) {
    throw new Error(`Invalid trimStrings for script "${label}"`);
  }

  return {
    identifier: input.identifier ?? input.id ?? label,
    scriptName: input.scriptName ?? input.identifier ?? input.id ?? label,
    pattern,
    replacement: input.replacement ?? input.replaceString ?? '',
    flags,
    enabled: input.enabled ?? !input.disabled,
    promptOnly: input.promptOnly ?? false,
    markdownOnly: input.markdownOnly ?? false,
    placement,
    minDepth,
    maxDepth,
    trimStrings: [...trimStrings],
  };
}

function trimCapture(value: string, trimStrings: string[]): string {
  return trimStrings.reduce((result, trimString) => result.split(trimString).join(''), value);
}

function replacementForMatch(
  replacement: string,
  match: string,
  captures: string[],
  groups: Record<string, string> | undefined,
  trimStrings: string[],
): string {
  return replacement.replace(/\{\{match\}\}|\$(\d+)|\$<([^>]+)>/gi, (token, number, groupName) => {
    const capture =
      token.toLowerCase() === '{{match}}'
        ? match
        : groupName
          ? groups?.[groupName]
          : Number(number) === 0
            ? match
            : captures[Number(number) - 1];
    return capture === undefined ? '' : trimCapture(capture, trimStrings);
  });
}

export function runRegexScript(script: RegexScript, value: string): string {
  let regex: RegExp;
  try {
    regex = new RegExp(script.pattern, script.flags);
  } catch (error) {
    throw new Error(`Invalid regex pattern or flags for script "${script.scriptName}": ${String(error)}`);
  }

  return value.replace(regex, (match, ...args: unknown[]) => {
    const groups = args.at(-1);
    const hasNamedGroups = groups !== null && typeof groups === 'object';
    const captures = (hasNamedGroups ? args.slice(0, -3) : args.slice(0, -2)) as (string | undefined)[];
    return replacementForMatch(
      script.replacement,
      match,
      captures.map((capture) => capture ?? ''),
      hasNamedGroups ? (groups as Record<string, string>) : undefined,
      script.trimStrings,
    );
  });
}

export function applyRegexScripts(
  value: string,
  scripts: RegexScript[] | undefined,
  context: RegexApplicationContext,
  pass: RegexApplicationPass,
): string {
  if (!scripts || scripts.length === 0) return value;

  const normalizedScripts = scripts.map((script) => normalizeRegexScript(script));
  return normalizedScripts.reduce((result, script) => {
    const selected = pass === 'prompt' ? script.promptOnly : script.markdownOnly;
    if (
      !script.enabled ||
      !selected ||
      !script.placement.includes(context.placement) ||
      (context.depth !== undefined && script.minDepth !== undefined && context.depth < script.minDepth) ||
      (context.depth !== undefined && script.maxDepth !== undefined && context.depth > script.maxDepth)
    ) {
      return result;
    }
    return runRegexScript(script, result);
  }, value);
}

export function applyPromptRegexScripts(
  value: string,
  scripts: RegexScript[] | undefined,
  context: RegexApplicationContext,
): string {
  return applyRegexScripts(value, scripts, context, 'prompt');
}

export function applyMarkdownRegexScripts(
  value: string,
  scripts: RegexScript[] | undefined,
  context: RegexApplicationContext,
): string {
  return applyRegexScripts(value, scripts, context, 'markdown');
}
