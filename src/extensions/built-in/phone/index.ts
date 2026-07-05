import type { ChatMessage } from '../../../types';
import type { ApiChatMessage, StructuredResponseOptions } from '../../../types/generation';
import { resolveConnectionProfile } from '../_shared/runtime/connection-profile';
import { cloneJson } from '../_shared/data-utils';
import { getChatExtra, setChatExtra, setMessageExtra } from '../_shared/runtime/extension-extra';
import { generateStructuredResult, repairStructuredGeneration } from '../_shared/runtime/structured-generation';
import { createStructuredResponse } from '../_shared/runtime/structured-request-format';
import { manifest } from './manifest';
import PhonePanel from './PhonePanel.vue';
import SettingsPanel from './SettingsPanel.vue';
import {
  EXTENSION_ID,
  PHONE_UPDATED_EVENT,
  type PhoneChatExtra,
  type PhoneChatExtraData,
  type PhoneContact,
  type PhoneContactInitResponse,
  type PhoneConversation,
  type PhoneExtensionAPI,
  type PhoneMessage,
  type PhoneMessageExtra,
  type PhoneMessageExtraData,
  type PhoneSettings,
  type PhoneSmsResponse,
  migratePhoneSettings,
  resolvePhonePrompts,
} from './types';

export { manifest };

const SIDEBAR_ID = 'phone-panel';
const QUICK_ACTION_GROUP_ID = 'core.context-ai';
const MAX_SCHEMA_REPAIRS = 3;

interface StructuredGenerationResult<T> {
  structured?: T;
  rawContent: string;
  parseError?: string;
  messages?: ApiChatMessage[];
}

function normalizeHandle(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || `contact-${Date.now()}`;
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatNamePair(userName: string, contact: PhoneContact): string {
  return `${userName} and ${contact.displayName}`;
}

function getContactStructuredResponse(format: PhoneSettings['structuredRequestFormat']): StructuredResponseOptions {
  return createStructuredResponse(format, {
    name: 'phone_contacts',
    value: {
      type: 'object',
      required: ['contacts'],
      additionalProperties: false,
      properties: {
        contacts: {
          type: 'array',
          items: {
            type: 'object',
            required: ['displayName', 'handle'],
            additionalProperties: false,
            properties: {
              displayName: { type: 'string', minLength: 1 },
              handle: { type: 'string', minLength: 1 },
              relationship: { type: 'string' },
              avatarColor: {
                type: 'string',
                pattern: '^#[0-9a-fA-F]{6}$',
                description: 'Optional hex color for the contact avatar.',
              },
            },
          },
        },
      },
    },
  });
}

function getSmsStructuredResponse(format: PhoneSettings['structuredRequestFormat']): StructuredResponseOptions {
  return createStructuredResponse(format, {
    name: 'phone_sms_replies',
    value: {
      type: 'object',
      required: ['messages'],
      additionalProperties: false,
      properties: {
        messages: {
          type: 'array',
          items: {
            type: 'object',
            required: ['contactId', 'body', 'delaySeconds'],
            additionalProperties: false,
            properties: {
              contactId: { type: 'string' },
              body: { type: 'string' },
              delaySeconds: { type: 'integer', minimum: 0, maximum: 120 },
            },
          },
        },
      },
    },
  });
}

function getPhoneExtraFromMessage(message: ChatMessage): PhoneMessageExtraData {
  return cloneJson((message.extra?.[EXTENSION_ID] as PhoneMessageExtraData | undefined) ?? {});
}

function getMessagesForConversation(data: PhoneMessageExtraData, conversationId: string): PhoneMessage[] {
  return (data.messages ?? [])
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function buildTranscript(
  contacts: PhoneContact[],
  data: PhoneMessageExtraData,
  userName: string,
  conversationFilter?: string,
  maxMessages = -1,
): string {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const conversations = (data.conversations ?? []).filter(
    (conversation) => !conversationFilter || conversation.id === conversationFilter,
  );
  const lines: string[] = [];

  for (const conversation of conversations) {
    const contact = contactsById.get(conversation.contactId);
    if (!contact) continue;
    const allMessages = getMessagesForConversation(data, conversation.id);
    const messages = maxMessages === -1 ? allMessages : allMessages.slice(-Math.max(0, maxMessages));
    if (messages.length === 0) continue;

    if (lines.length > 0) lines.push('');
    lines.push(`${formatNamePair(userName, contact)}:`);
    for (const message of messages) {
      const speaker = message.direction === 'outbound' ? userName : contact.displayName;
      lines.push(`[${speaker}]: ${message.body}`);
    }
  }

  return lines.join('\n');
}

function getPlayerName(api: PhoneExtensionAPI): string {
  return api.persona.getActive()?.name || 'You';
}

class PhoneManager {
  private pendingContacts = false;
  private pendingSms = new Set<string>();
  private injectedKeys = new Set<string>();
  private unregisterChatUiFns: Array<() => void> = [];

  constructor(private api: PhoneExtensionAPI) {}

  private getSettings(): PhoneSettings {
    const settings = migratePhoneSettings(this.api.settings.get());
    this.api.settings.set(undefined, settings);
    return settings;
  }

  public getChatExtra(): PhoneChatExtraData {
    return cloneJson(getChatExtra<PhoneChatExtraData>(this.api, EXTENSION_ID) ?? {});
  }

  public getContacts(): PhoneContact[] {
    return this.getChatExtra().contacts ?? [];
  }

  private async setChatExtra(data: PhoneChatExtraData): Promise<void> {
    setChatExtra<PhoneChatExtra>(this.api, EXTENSION_ID, data);
    await this.api.events.emit(PHONE_UPDATED_EVENT);
  }

  public getMessageExtra(messageIndex: number): PhoneMessageExtraData {
    const message = this.api.chat.getHistory()[messageIndex];
    return message ? getPhoneExtraFromMessage(message) : {};
  }

  private async setMessageExtra(messageIndex: number, data: PhoneMessageExtraData): Promise<void> {
    const message = this.api.chat.getHistory()[messageIndex];
    if (!message) throw new Error('Selected chat message was not found.');
    await setMessageExtra<PhoneMessageExtra>(this.api, messageIndex, EXTENSION_ID, data);
    await this.api.events.emit(PHONE_UPDATED_EVENT);
  }

  public getDefaultMessageIndex(): number {
    return Math.max(0, this.api.chat.getHistory().length - 1);
  }

  private async buildPrompt(
    generationId: string,
    structuredResponse: StructuredResponseOptions,
  ): Promise<ApiChatMessage[]> {
    const settings = this.getSettings();
    const history = this.api.chat.getHistory();
    const chatHistory =
      settings.includeLastXMessages === -1 ? history : history.slice(-Math.max(0, settings.includeLastXMessages));
    const prompt = await this.api.chat.buildPrompt({
      chatHistory,
      generationId,
      structuredResponse,
    });
    return prompt.messages;
  }

  private async generateStructured<T>(
    messages: ApiChatMessage[],
    structuredResponse: StructuredResponseOptions,
    captureMessageIndex?: number,
  ): Promise<StructuredGenerationResult<T>> {
    const settings = this.getSettings();
    const connectionProfile = resolveConnectionProfile(this.api, settings.connectionProfile);
    if (!connectionProfile) throw new Error('No connection profile selected for Phone.');

    const generation = await generateStructuredResult<T>(this.api, {
      messages,
      options: {
        connectionProfile,
        samplerOverrides: { max_tokens: settings.maxResponseTokens, stream: false },
        structuredResponse,
        captureMessageIndex,
      },
      streamErrorMessage: 'Phone generation unexpectedly returned a stream.',
      missingStructuredContentMessage: 'Phone generation returned no structured content.',
    });

    return {
      structured: generation.structuredContent,
      rawContent: generation.rawContent,
      parseError: generation.parseError,
    };
  }

  private async repairStructured<T>(
    originalMessages: ApiChatMessage[],
    rawContent: string,
    parseError: string,
    structuredResponse: StructuredResponseOptions,
    label: string,
    captureMessageIndex?: number,
  ): Promise<StructuredGenerationResult<T>> {
    const repairMessages: ApiChatMessage[] = [
      ...originalMessages,
      { role: 'assistant', name: 'Assistant', content: rawContent },
      {
        role: 'user',
        name: 'User',
        content: `[Schema validation error]\n${parseError}\n\nRepair your previous ${label} JSON. Return the complete corrected object, not a patch or prose explanation.`,
      },
    ];
    const repaired = await this.generateStructured<T>(repairMessages, structuredResponse, captureMessageIndex);
    return { ...repaired, messages: repairMessages };
  }

  private async generateWithRepair<T>(
    messages: ApiChatMessage[],
    structuredResponse: StructuredResponseOptions,
    label: string,
    captureMessageIndex?: number,
  ): Promise<T> {
    let generation = await this.generateStructured<T>(messages, structuredResponse, captureMessageIndex);
    generation = await repairStructuredGeneration({
      generation,
      messages,
      maxRepairs: MAX_SCHEMA_REPAIRS,
      getValue: (result) => result.structured,
      repair: ({ messages: repairMessages, rawContent, parseError }) =>
        this.repairStructured<T>(
          repairMessages,
          rawContent,
          parseError,
          structuredResponse,
          label,
          captureMessageIndex,
        ),
    });

    if (!generation.structured) throw new Error(generation.parseError ?? `Phone ${label} returned no structured data.`);
    return generation.structured;
  }

  public async refreshContacts(): Promise<void> {
    if (this.pendingContacts) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.phone.toasts.refreshAlreadyRunning'), 'info');
      return;
    }

    const settings = this.getSettings();
    const prompts = resolvePhonePrompts(settings);
    if (!settings.enabled) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.phone.toasts.disabled'), 'info');
      return;
    }

    this.pendingContacts = true;
    try {
      const structuredResponse = getContactStructuredResponse(settings.structuredRequestFormat);
      const generationId = `phone-contacts-${Date.now()}`;
      const promptMessages = await this.buildPrompt(generationId, structuredResponse);
      const existingContacts = this.getContacts();
      const messages: ApiChatMessage[] = [
        ...promptMessages,
        {
          role: 'system',
          name: 'System',
          content: this.api.macro.process(prompts.contactPrompt),
        },
        {
          role: 'user',
          name: 'User',
          content: `[Existing phone contacts]\n${JSON.stringify(existingContacts, null, 2)}`,
        },
      ];
      const result = await this.generateWithRepair<PhoneContactInitResponse>(messages, structuredResponse, 'contacts');
      const now = new Date().toISOString();
      const existingByHandle = new Map(existingContacts.map((contact) => [normalizeHandle(contact.handle), contact]));
      const existingByName = new Map(existingContacts.map((contact) => [normalizeName(contact.displayName), contact]));
      const nextById = new Map<string, PhoneContact>();

      for (const existing of existingContacts) {
        nextById.set(existing.id, existing);
      }

      for (const generated of result.contacts) {
        const displayName = generated.displayName.trim();
        if (!displayName) continue;
        const handle = normalizeHandle(generated.handle || displayName);
        const existing = existingByHandle.get(handle) ?? existingByName.get(normalizeName(displayName));
        const contact: PhoneContact = {
          id: existing?.id ?? this.api.uuid(),
          displayName,
          handle,
          relationship: generated.relationship?.trim() || existing?.relationship,
          avatarColor: generated.avatarColor?.trim() || existing?.avatarColor,
          isAiControlled: true,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        nextById.set(contact.id, contact);
      }

      await this.setChatExtra({
        ...this.getChatExtra(),
        contacts: [...nextById.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
        lastContactRefreshAt: now,
      });
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.phone.toasts.contactsRefreshed'), 'success');
    } catch (error) {
      console.error('Phone contact refresh failed:', error);
      this.api.ui.showToast(
        error instanceof Error ? error.message : this.api.i18n.t('extensionsBuiltin.phone.toasts.contactRefreshFailed'),
        'error',
      );
    } finally {
      this.pendingContacts = false;
    }
  }

  private getOrCreateConversation(data: PhoneMessageExtraData, contact: PhoneContact): PhoneConversation {
    const existing = data.conversations?.find((conversation) => conversation.contactId === contact.id);
    if (existing) return existing;
    return {
      id: this.api.uuid(),
      contactId: contact.id,
      title: contact.displayName,
    };
  }

  public async sendSms(messageIndex: number, contactId: string, body: string): Promise<void> {
    const text = body.trim();
    if (!text) return;

    const settings = this.getSettings();
    const prompts = resolvePhonePrompts(settings);
    if (!settings.enabled) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.phone.toasts.disabled'), 'info');
      return;
    }

    const contact = this.getContacts().find((item) => item.id === contactId);
    if (!contact) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.phone.toasts.selectContact'), 'error');
      return;
    }

    const pendingKey = `${messageIndex}:${contactId}`;
    if (this.pendingSms.has(pendingKey)) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.phone.toasts.smsAlreadyRunning'), 'info');
      return;
    }

    this.pendingSms.add(pendingKey);
    const generationId = `phone-sms-${Date.now()}`;
    const now = new Date().toISOString();
    const currentData = this.getMessageExtra(messageIndex);
    const conversation = this.getOrCreateConversation(currentData, contact);
    const outbound: PhoneMessage = {
      id: this.api.uuid(),
      conversationId: conversation.id,
      contactId: contact.id,
      direction: 'outbound',
      body: text,
      status: 'sending',
      createdAt: now,
      generationId,
    };

    const dataWithOutbound: PhoneMessageExtraData = {
      ...currentData,
      conversations: [
        ...(currentData.conversations ?? []).filter((item) => item.id !== conversation.id),
        { ...conversation, lastMessageAt: now },
      ],
      messages: [...(currentData.messages ?? []), outbound],
      lastSmsGenerationAt: now,
    };
    await this.setMessageExtra(messageIndex, dataWithOutbound);

    try {
      const structuredResponse = getSmsStructuredResponse(settings.structuredRequestFormat);
      const promptMessages = await this.buildPrompt(generationId, structuredResponse);
      const contacts = this.getContacts();
      const transcript = buildTranscript(
        contacts,
        dataWithOutbound,
        getPlayerName(this.api),
        conversation.id,
        settings.includeLastXSmsMessages,
      );
      const messages: ApiChatMessage[] = [
        ...promptMessages,
        {
          role: 'system',
          name: 'System',
          content: this.api.macro.process(prompts.smsPrompt),
        },
        {
          role: 'user',
          name: 'User',
          content: [
            `[Contact]\n${JSON.stringify(contact, null, 2)}`,
            `[SMS Conversation]\n${transcript || 'No previous SMS messages.'}`,
            `[Outgoing SMS]\n${text}`,
          ].join('\n\n'),
        },
      ];
      const result = await this.generateWithRepair<PhoneSmsResponse>(
        messages,
        structuredResponse,
        'SMS replies',
        messageIndex,
      );
      const deliveredAt = new Date().toISOString();
      const replies: PhoneMessage[] = result.messages
        .filter((reply) => reply.contactId === contact.id && reply.body.trim())
        .map((reply) => ({
          id: this.api.uuid(),
          conversationId: conversation.id,
          contactId: contact.id,
          direction: 'inbound',
          body: reply.body.trim(),
          status: 'received',
          createdAt: new Date(Date.now() + Math.min(Math.max(reply.delaySeconds, 0), 120) * 1000).toISOString(),
          deliveredAt,
          generationId,
        }));

      const latestData = this.getMessageExtra(messageIndex);
      await this.setMessageExtra(messageIndex, {
        ...latestData,
        conversations: (latestData.conversations ?? []).map((item) =>
          item.id === conversation.id ? { ...item, lastMessageAt: replies.at(-1)?.createdAt ?? deliveredAt } : item,
        ),
        messages: (latestData.messages ?? [])
          .map(
            (message): PhoneMessage =>
              message.id === outbound.id ? { ...message, status: 'delivered', deliveredAt } : message,
          )
          .concat(replies),
        lastSmsGenerationAt: deliveredAt,
      });
      this.api.ui.showToast(
        replies.length > 0
          ? this.api.i18n.t('extensionsBuiltin.phone.toasts.smsReplyReceived')
          : this.api.i18n.t('extensionsBuiltin.phone.toasts.smsSent'),
        'success',
      );
    } catch (error) {
      console.error('Phone SMS generation failed:', error);
      const failedData = this.getMessageExtra(messageIndex);
      await this.setMessageExtra(messageIndex, {
        ...failedData,
        messages: (failedData.messages ?? []).map(
          (message): PhoneMessage => (message.id === outbound.id ? { ...message, status: 'failed' } : message),
        ),
      });
      this.api.ui.showToast(
        error instanceof Error ? error.message : this.api.i18n.t('extensionsBuiltin.phone.toasts.smsGenerationFailed'),
        'error',
      );
    } finally {
      this.pendingSms.delete(pendingKey);
    }
  }

  public async deleteSmsMessage(messageIndex: number, smsMessageId: string): Promise<void> {
    const data = this.getMessageExtra(messageIndex);
    await this.setMessageExtra(messageIndex, {
      ...data,
      messages: (data.messages ?? []).filter((message) => message.id !== smsMessageId),
    });
  }

  public injectContext(
    apiMessages: ApiChatMessage[],
    originalMessage: ChatMessage,
    index: number,
    generationId: string,
  ): void {
    const settings = this.getSettings();
    if (!settings.enabled) return;
    const data = getPhoneExtraFromMessage(originalMessage);
    if (!data.conversations?.length || !data.messages?.length) return;

    const key = `${generationId}:${index}`;
    if (this.injectedKeys.has(key)) return;
    const transcript = buildTranscript(this.getContacts(), data, getPlayerName(this.api));
    if (!transcript) return;

    apiMessages.push({
      role: 'system',
      name: 'System',
      content: `[SMS]\n${transcript}`,
    });
    this.injectedKeys.add(key);
    if (this.injectedKeys.size > 250) this.injectedKeys.clear();
  }

  public async openPanel(): Promise<void> {
    this.api.ui.openSidebar(SIDEBAR_ID);
  }

  public injectChatUi(): void {
    this.unregisterChatUiFns.forEach((fn) => fn());
    this.unregisterChatUiFns = [];
    if (!this.api.chat.getChatInfo()) return;

    this.unregisterChatUiFns.push(
      this.api.ui.registerChatQuickAction(QUICK_ACTION_GROUP_ID, this.api.i18n.t('extensionsBuiltin.phone.contextAi'), {
        id: 'phone-open',
        icon: 'fa-solid fa-mobile-screen-button',
        label: this.api.i18n.t('extensionsBuiltin.phone.title'),
        onClick: () => this.openPanel(),
      }),
    );
    this.unregisterChatUiFns.push(
      this.api.ui.registerChatFormOptionsMenuItem({
        id: 'phone-open',
        icon: 'fa-solid fa-mobile-screen-button',
        label: this.api.i18n.t('extensionsBuiltin.phone.title'),
        onClick: () => this.openPanel(),
      }),
    );
  }

  public unmount(): void {
    this.unregisterChatUiFns.forEach((fn) => fn());
    this.unregisterChatUiFns = [];
    this.injectedKeys.clear();
  }
}

export function activate(api: PhoneExtensionAPI) {
  const settingsContainer = document.getElementById(api.meta.containerId);
  const settingsApp = settingsContainer ? api.ui.mount(settingsContainer, SettingsPanel, { api }) : null;
  const manager = new PhoneManager(api);

  api.ui.registerSidebar(SIDEBAR_ID, PhonePanel, 'right', {
    icon: 'fa-mobile-screen-button',
    title: api.i18n.t('extensionsBuiltin.phone.title'),
    props: {
      api,
      manager,
    },
  });

  const unbinds: Array<() => void> = [];
  unbinds.push(api.events.on('chat:entered', () => manager.injectChatUi()));
  unbinds.push(api.events.on('chat:cleared', () => manager.unmount()));
  unbinds.push(api.events.on('chat:deleted', () => manager.unmount()));
  unbinds.push(
    api.events.on('prompt:history-message-processing', (payload, context) =>
      manager.injectContext(payload.apiMessages, context.originalMessage, context.index, context.generationId),
    ),
  );

  if (api.chat.getChatInfo()) manager.injectChatUi();

  return () => {
    unbinds.forEach((unbind) => unbind());
    manager.unmount();
    settingsApp?.unmount();
    api.ui.unregisterSidebar(SIDEBAR_ID, 'right');
  };
}

export type { PhoneManager };
