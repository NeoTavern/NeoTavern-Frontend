import type { ExtensionAPI } from '../../../types';
import {
  migratePromptPresetState,
  resolvePromptPreset,
  type PromptPreset,
  type PromptPresetState,
} from '../prompt-presets';

export interface PhoneChatExtraData {
  contacts?: PhoneContact[];
  lastContactRefreshAt?: string;
}

export interface PhoneChatExtra {
  'core.phone'?: PhoneChatExtraData;
}

export interface PhoneMessageExtraData {
  conversations?: PhoneConversation[];
  messages?: PhoneMessage[];
  lastSmsGenerationAt?: string;
}

export interface PhoneMessageExtra {
  'core.phone'?: PhoneMessageExtraData;
}

export interface PhoneContact {
  id: string;
  displayName: string;
  handle: string;
  relationship?: string;
  avatarColor?: string;
  isAiControlled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PhoneConversation {
  id: string;
  contactId: string;
  title?: string;
  lastMessageAt?: string;
}

export interface PhoneMessage {
  id: string;
  conversationId: string;
  contactId: string;
  direction: 'outbound' | 'inbound';
  body: string;
  status: 'draft' | 'sending' | 'sent' | 'delivered' | 'failed' | 'received';
  createdAt: string;
  deliveredAt?: string;
  generationId?: string;
}

export type PhonePrompts = {
  contactPrompt: string;
  smsPrompt: string;
};

export interface PhoneSettings extends PromptPresetState<PhonePrompts> {
  enabled: boolean;
  connectionProfile: string;
  structuredRequestFormat: 'native' | 'json' | 'xml';
  includeLastXMessages: number;
  includeLastXSmsMessages: number;
  maxResponseTokens: number;
  contactPrompt?: string;
  smsPrompt?: string;
}

export interface PhoneContactInitResponse {
  contacts: Array<{
    displayName: string;
    handle: string;
    relationship?: string;
    avatarColor?: string;
  }>;
}

export interface PhoneSmsResponse {
  messages: Array<{
    contactId: string;
    body: string;
    delaySeconds: number;
  }>;
}

export type PhoneExtensionAPI = ExtensionAPI<PhoneSettings, PhoneChatExtra, PhoneMessageExtra>;

export const EXTENSION_ID = 'core.phone';
export const PHONE_UPDATED_EVENT = 'phone:updated';

export const DEFAULT_CONTACT_PROMPT = `You are preparing phone contacts for a roleplay chat.

Read the provided RP context and identify people the user could plausibly send SMS messages to.

Return grounded contact profiles only. Use stable lowercase handles and compact relationship labels that are useful for SMS tone.`;

export const DEFAULT_SMS_PROMPT = `You are generating SMS replies inside a roleplay chat.

Reply only as the contacted SMS participant. The message body must be plain SMS text, not narration. Use the contact profile, relationship, RP context, and SMS thread to decide whether and how the contact replies.

Return strict structured SMS reply data.`;

export const BUILT_IN_PROMPT_PRESETS: PromptPreset<PhonePrompts>[] = [
  {
    id: 'default',
    name: 'Default',
    builtIn: true,
    prompts: {
      contactPrompt: DEFAULT_CONTACT_PROMPT,
      smsPrompt: DEFAULT_SMS_PROMPT,
    },
  },
];

export const DEFAULT_SETTINGS: PhoneSettings = {
  enabled: true,
  connectionProfile: '',
  structuredRequestFormat: 'native',
  includeLastXMessages: 80,
  includeLastXSmsMessages: 40,
  maxResponseTokens: 2048,
  activePromptPresetId: 'default',
  promptPresets: [],
  promptPresetMigrationVersion: 1,
};

export function migratePhoneSettings(settings: Partial<PhoneSettings> = {}): PhoneSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...migratePromptPresetState({
      settings: { ...DEFAULT_SETTINGS, ...settings },
      builtInPresets: BUILT_IN_PROMPT_PRESETS,
      legacyPrompts: {
        contactPrompt: settings.contactPrompt,
        smsPrompt: settings.smsPrompt,
      },
      legacyDefaults: {
        contactPrompt: DEFAULT_CONTACT_PROMPT,
        smsPrompt: DEFAULT_SMS_PROMPT,
      },
    }),
  };
}

export function resolvePhonePrompts(settings: PhoneSettings): PhonePrompts {
  return resolvePromptPreset(settings, BUILT_IN_PROMPT_PRESETS).prompts;
}
