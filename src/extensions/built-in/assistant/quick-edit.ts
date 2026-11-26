import type { ApiChatMessage, ExtensionAPI } from '../../../types';
import { resolveConnectionProfile } from '../_shared/runtime/connection-profile';
import { collectResponseText, extractCodeBlock } from '../_shared/runtime/llm-text';
import type { AssistantCommand, AssistantSettings } from './types';

export type QuickEditContext =
  /** chat.message (its index), chat.input (history length). */
  | { kind: 'chat'; beforeIndex: number }
  /** character.* textareas: the character in the editor. */
  | { kind: 'character'; avatar: string; field: string }
  /** world_info.content: the selected entry. */
  | { kind: 'world-info'; book: string; uid: number }
  /** persona.description: the active persona. */
  | { kind: 'persona' }
  /** prompt.content, extension.* */
  | { kind: 'none' };

export interface QuickEditTarget {
  identifier: string;
  label: string;
  text: string;
  context: QuickEditContext;
  apply: (text: string) => void | Promise<void>;
}

export type ResolvedQuickEditContext =
  | { kind: 'chat'; characterName?: string; personaName?: string; messages: { name: string; mes: string }[] }
  | { kind: 'character'; name: string; fields: { label: string; value: string }[] }
  | { kind: 'world-info'; book: string; title: string; keys: string[] }
  | { kind: 'persona'; name: string }
  | { kind: 'none' };

/** One popover instruction, with the `[Referenced]` block of its mentions ('' when none). */
export interface QuickEditRequest {
  instruction: string;
  referenced?: string;
}

/** One earlier popover turn: the request sent and the code-block text the model returned. */
export interface QuickEditTurn extends QuickEditRequest {
  output: string;
}

type ContextAPI = {
  chat: Pick<ExtensionAPI['chat'], 'getHistory'>;
  character: Pick<ExtensionAPI['character'], 'get' | 'getActives'>;
  persona: Pick<ExtensionAPI['persona'], 'getActive'>;
  worldInfo: Pick<ExtensionAPI['worldInfo'], 'getBook'>;
};

const CHARACTER_CONTEXT_FIELDS = [
  { field: 'description', label: 'Description' },
  { field: 'personality', label: 'Personality' },
  { field: 'scenario', label: 'Scenario' },
  { field: 'first_mes', label: 'First message' },
] as const;

export async function resolveContext(
  api: ContextAPI,
  context: QuickEditContext,
  contextMessageCount: number,
): Promise<ResolvedQuickEditContext> {
  switch (context.kind) {
    case 'chat': {
      const history = api.chat.getHistory();
      const end = Math.min(context.beforeIndex, history.length);
      const start = Math.max(0, end - Math.max(0, contextMessageCount));
      return {
        kind: 'chat',
        characterName: api.character.getActives()[0]?.name,
        personaName: api.persona.getActive()?.name,
        messages: history.slice(start, end).map((message) => ({ name: message.name, mes: message.mes })),
      };
    }
    case 'character': {
      const character = api.character.get(context.avatar);
      if (!character) return { kind: 'none' };
      return {
        kind: 'character',
        name: character.name,
        fields: CHARACTER_CONTEXT_FIELDS.flatMap(({ field, label }) => {
          const value = character[field];
          return field !== context.field && value ? [{ label, value }] : [];
        }),
      };
    }
    case 'world-info': {
      const book = await api.worldInfo.getBook(context.book);
      const entry = book?.entries.find((candidate) => candidate.uid === context.uid);
      if (!entry) return { kind: 'none' };
      return { kind: 'world-info', book: context.book, title: entry.comment, keys: entry.key };
    }
    case 'persona': {
      const persona = api.persona.getActive();
      return persona ? { kind: 'persona', name: persona.name } : { kind: 'none' };
    }
    case 'none':
      return { kind: 'none' };
  }
}

const SYSTEM_PROMPT = [
  'You edit or write text for a roleplay chat app.',
  "Apply the user's instruction to the given text, or write new text when asked to.",
  'Keep `{{...}}` macros, names, markdown and *actions* exactly as written unless the instruction says otherwise.',
  'Reply with only the resulting text inside one code block, with no explanation.',
].join('\n');

function formatContextBlock(context: ResolvedQuickEditContext): string {
  switch (context.kind) {
    case 'chat': {
      const lines: string[] = [];
      if (context.characterName) lines.push(`Character: ${context.characterName}`);
      if (context.personaName) lines.push(`User persona: ${context.personaName}`);
      if (context.messages.length > 0) {
        lines.push('Recent messages:', ...context.messages.map((message) => `${message.name}: ${message.mes}`));
      }
      return lines.length > 0 ? `Context:\n${lines.join('\n')}` : '';
    }
    case 'character':
      return [
        'Context: a character card.',
        `Name: ${context.name}`,
        ...context.fields.map((field) => `${field.label}: ${field.value}`),
      ].join('\n');
    case 'world-info':
      return [
        'Context: a lorebook entry.',
        `Lorebook: ${context.book}`,
        `Entry title: ${context.title}`,
        `Keys: ${context.keys.join(', ')}`,
      ].join('\n');
    case 'persona':
      return `Context: the description of the user's persona "${context.name}".`;
    case 'none':
      return '';
  }
}

function fence(text: string): string {
  return '```\n' + text + '\n```';
}

/**
 * Builds the request for a quick edit. The first user message carries the first instruction;
 * each later instruction (earlier turns in `history`, then `request`) is a follow-up revision.
 * An instruction's referenced block goes right before it, after the context block.
 */
export function buildQuickEditMessages(
  target: Pick<QuickEditTarget, 'label' | 'text'>,
  context: ResolvedQuickEditContext,
  request: string | QuickEditRequest,
  history: QuickEditTurn[] = [],
): ApiChatMessage[] {
  const current = typeof request === 'string' ? { instruction: request } : request;
  const first = history.length > 0 ? history[0] : current;
  const firstUser = [
    formatContextBlock(context),
    first.referenced ?? '',
    `Instruction: ${first.instruction}`,
    target.text
      ? `Text (${target.label}):\n${fence(target.text)}`
      : `The field "${target.label}" is empty. Write new text for this field.`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');

  const messages: ApiChatMessage[] = [
    { role: 'system', name: 'System', content: SYSTEM_PROMPT },
    { role: 'user', name: 'User', content: firstUser },
  ];

  history.forEach((turn, index) => {
    if (index > 0) messages.push(revision(turn));
    messages.push({ role: 'assistant', name: 'Assistant', content: fence(turn.output) });
  });
  if (history.length > 0) messages.push(revision(current));

  return messages;
}

function revision(request: QuickEditRequest): ApiChatMessage {
  const content = `Revise your latest version: ${request.instruction}`;
  return { role: 'user', name: 'User', content: request.referenced ? `${request.referenced}\n\n${content}` : content };
}

/** The command's profile, else the extension default, else the global selected profile. */
export function resolveQuickEditProfile(
  api: Pick<ExtensionAPI, 'settings'>,
  settings: Pick<AssistantSettings, 'connectionProfile'>,
  command?: Pick<AssistantCommand, 'connectionProfile'>,
): string | undefined {
  return resolveConnectionProfile(api, command?.connectionProfile || settings.connectionProfile);
}

/** Sends the request and returns the code-block text; `onText` receives it as it streams. */
export async function runQuickEdit(
  api: Pick<ExtensionAPI, 'llm'>,
  options: { messages: ApiChatMessage[]; profile: string; signal?: AbortSignal; onText?: (text: string) => void },
): Promise<string> {
  const response = await api.llm.generate(options.messages, {
    connectionProfile: options.profile,
    signal: options.signal,
  });
  const text = await collectResponseText(response, {
    onText: options.onText && ((collected) => options.onText!(extractCodeBlock(collected))),
  });
  return extractCodeBlock(text);
}

/** Remembers `commandId` as the last command applied to `identifier`, so it's offered first next time. */
export function recordLastCommand(api: ExtensionAPI<AssistantSettings>, identifier: string, commandId: string) {
  api.settings.set('lastCommandByTarget', { ...api.settings.get('lastCommandByTarget'), [identifier]: commandId });
  api.settings.save();
}

export function commandIcon(command: Pick<AssistantCommand, 'autoAccept'>): string {
  return command.autoAccept ? 'fa-bolt' : 'fa-wand-magic-sparkles';
}

/**
 * Runs `command` on `target` and applies the result without review (a pinned auto-accept click).
 * A chat change while it runs cancels it, so a message index from the old chat is never applied to the new one.
 */
export async function runCommandAndApply(
  api: ExtensionAPI<AssistantSettings>,
  target: QuickEditTarget,
  command: AssistantCommand,
): Promise<void> {
  const t = api.i18n.t;
  const settings = api.settings.get();
  const profile = resolveQuickEditProfile(api, settings, command);
  if (!profile) {
    api.ui.showToast(t('extensionsBuiltin.assistant.quickEdit.noProfile'), 'error');
    return;
  }

  const controller = new AbortController();
  const offChatEntered = api.events.on('chat:entered', () => controller.abort());
  const cancelled = () =>
    api.ui.showToast(t('extensionsBuiltin.assistant.pinned.cancelled', { name: command.name }), 'info');
  try {
    const context = await resolveContext(api, target.context, settings.contextMessageCount);
    const result = await runQuickEdit(api, {
      messages: buildQuickEditMessages(target, context, command.prompt),
      profile,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      cancelled();
      return;
    }
    if (!result.trim()) {
      api.ui.showToast(t('extensionsBuiltin.assistant.pinned.emptyResult', { name: command.name }), 'error');
      return;
    }
    await target.apply(result);
    recordLastCommand(api, target.identifier, command.id);
    api.ui.showToast(t('extensionsBuiltin.assistant.pinned.applied', { name: command.name }), 'success');
  } catch (error) {
    if (controller.signal.aborted) {
      cancelled();
      return;
    }
    console.error(error);
    api.ui.showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    offChatEntered();
  }
}
