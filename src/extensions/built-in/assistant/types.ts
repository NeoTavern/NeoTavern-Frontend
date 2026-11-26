import type { StructuredRequestFormat } from '../_shared/runtime/structured-request-format';

/** How the panel talks to the model: native tool calling, or `{ reply, calls }` as structured output. */
export type AssistantRequestFormat = 'tools' | StructuredRequestFormat;

export interface AssistantCommand {
  id: string;
  /** Slash name used by M2. Unique, matches `COMMAND_NAME_PATTERN`. */
  name: string;
  prompt: string;
  /** '' = the extension default. */
  connectionProfile: string;
  /** Own button on messages and the input box. */
  pinned: boolean;
  /** A pinned click applies without opening the popover. */
  autoAccept: boolean;
}

export interface AssistantSettings {
  /** '' = the global selected profile. */
  connectionProfile: string;
  contextMessageCount: number;
  commands: AssistantCommand[];
  /** Target identifier → command id. */
  lastCommandByTarget: Record<string, string>;
  requestFormat: AssistantRequestFormat;
}

export const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const DEFAULT_COMMANDS: AssistantCommand[] = [
  {
    id: 'grammar',
    name: 'grammar',
    prompt: 'Fix grammar, spelling and punctuation. Keep tone and formatting.',
    connectionProfile: '',
    pinned: false,
    autoAccept: false,
  },
  {
    id: 'concise',
    name: 'concise',
    prompt: 'Make it more concise. Keep meaning, tone and formatting.',
    connectionProfile: '',
    pinned: false,
    autoAccept: false,
  },
];

export function createDefaultSettings(): AssistantSettings {
  return {
    connectionProfile: '',
    contextMessageCount: 3,
    commands: DEFAULT_COMMANDS.map((command) => ({ ...command })),
    lastCommandByTarget: {},
    requestFormat: 'tools',
  };
}

export function migrateAssistantSettings(settings: Partial<AssistantSettings> = {}): AssistantSettings {
  return { ...createDefaultSettings(), ...settings };
}
