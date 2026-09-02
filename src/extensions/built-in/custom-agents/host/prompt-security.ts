const FORBIDDEN_AGENT_MACROS = new Set(['roll', 'setvar', 'addvar', 'incvar', 'decvar']);

function withoutRawBlocks(prompt: string): string {
  return prompt.replace(/{{#raw}}[\s\S]*?{{\/raw}}/g, '');
}

export function findForbiddenAgentPromptMacro(prompt: string): string | undefined {
  const source = withoutRawBlocks(prompt);
  for (const match of source.matchAll(/{{{?\s*([A-Za-z_][A-Za-z0-9_-]*)(?=\s|::|})/g)) {
    const name = match[1]!.toLowerCase();
    if (FORBIDDEN_AGENT_MACROS.has(name)) return name;
  }
  return undefined;
}

export function assertAgentPromptMacros(prompt: string): void {
  const name = findForbiddenAgentPromptMacro(prompt);
  if (name) throw new Error(`Custom Agent prompt macro '${name}' is forbidden`);
}

export const forbiddenAgentMacros = [...FORBIDDEN_AGENT_MACROS];
