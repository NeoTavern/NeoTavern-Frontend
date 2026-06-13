import type { ChatMessage } from '../../../types';
import type { ApiChatMessage, GenerationResponse, StructuredResponseOptions } from '../../../types/generation';
import { manifest } from './manifest';
import PhonePanel from './PhonePanel.vue';
import SettingsPanel from './SettingsPanel.vue';
import {
  DEFAULT_SETTINGS,
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  return {
    format,
    schema: {
      name: 'phone_contacts',
      strict: true,
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
    },
  };
}

function getSmsStructuredResponse(format: PhoneSettings['structuredRequestFormat']): StructuredResponseOptions {
  return {
    format,
    schema: {
      name: 'phone_sms_replies',
      strict: true,
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
    },
  };
}

function getPhoneExtraFromMessage(message: ChatMessage): PhoneMessageExtraData {
  return clone((message.extra?.[EXTENSION_ID] as PhoneMessageExtraData | undefined) ?? {});
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
    return { ...DEFAULT_SETTINGS, ...this.api.settings.get() };
  }

  public getChatExtra(): PhoneChatExtraData {
    return clone(this.api.chat.metadata.get()?.extra?.[EXTENSION_ID] ?? {});
  }

  public getContacts(): PhoneContact[] {
    return this.getChatExtra().contacts ?? [];
  }

  private async setChatExtra(data: PhoneChatExtraData): Promise<void> {
    const currentExtra = this.api.chat.metadata.get()?.extra ?? {};
    this.api.chat.metadata.update({
      extra: {
        ...currentExtra,
        [EXTENSION_ID]: data,
      } as Record<string, unknown> & PhoneChatExtra,
    });
    await this.api.events.emit(PHONE_UPDATED_EVENT);
  }

  public getMessageExtra(messageIndex: number): PhoneMessageExtraData {
    const message = this.api.chat.getHistory()[messageIndex];
    return message ? getPhoneExtraFromMessage(message) : {};
  }

  private async setMessageExtra(messageIndex: number, data: PhoneMessageExtraData): Promise<void> {
    const message = this.api.chat.getHistory()[messageIndex];
    if (!message) throw new Error('Selected chat message was not found.');
    await this.api.chat.updateMessageObject(messageIndex, {
      extra: {
        ...message.extra,
        [EXTENSION_ID]: data,
      } as ChatMessage['extra'] & PhoneMessageExtra,
    });
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
  ): Promise<StructuredGenerationResult<T>> {
    const settings = this.getSettings();
    const connectionProfile =
      settings.connectionProfile || this.api.settings.getGlobal('api.selectedConnectionProfile');
    if (!connectionProfile) throw new Error('No connection profile selected for Phone.');

    let completionStructuredContent: object | undefined;
    let completionParseError: Error | undefined;
    const response = await this.api.llm.generate(messages, {
      connectionProfile,
      samplerOverrides: { max_tokens: settings.maxResponseTokens, stream: false },
      structuredResponse,
      onCompletion({ structured_content, parse_error }) {
        completionStructuredContent = structured_content;
        completionParseError = parse_error;
      },
    });

    if (Symbol.asyncIterator in response) {
      for await (const chunk of response) void chunk;
      return { rawContent: '', parseError: 'Phone generation unexpectedly returned a stream.' };
    }

    const generationResponse = response as GenerationResponse;
    const structured = (generationResponse.structured_content ?? completionStructuredContent) as T | undefined;
    return {
      structured,
      rawContent: generationResponse.content,
      parseError: structured
        ? undefined
        : (completionParseError?.message ?? 'Phone generation returned no structured content.'),
    };
  }

  private async repairStructured<T>(
    originalMessages: ApiChatMessage[],
    rawContent: string,
    parseError: string,
    structuredResponse: StructuredResponseOptions,
    label: string,
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
    const repaired = await this.generateStructured<T>(repairMessages, structuredResponse);
    return { ...repaired, messages: repairMessages };
  }

  private async generateWithRepair<T>(
    messages: ApiChatMessage[],
    structuredResponse: StructuredResponseOptions,
    label: string,
  ): Promise<T> {
    let generation = await this.generateStructured<T>(messages, structuredResponse);
    let repairMessages = messages;
    let repairCount = 0;

    while (
      !generation.structured &&
      generation.parseError &&
      generation.rawContent.trim() &&
      repairCount < MAX_SCHEMA_REPAIRS
    ) {
      repairCount += 1;
      generation = await this.repairStructured<T>(
        repairMessages,
        generation.rawContent,
        generation.parseError,
        structuredResponse,
        label,
      );
      repairMessages = generation.messages ?? repairMessages;
    }

    if (!generation.structured) throw new Error(generation.parseError ?? `Phone ${label} returned no structured data.`);
    return generation.structured;
  }

  public async refreshContacts(): Promise<void> {
    if (this.pendingContacts) {
      this.api.ui.showToast('Phone contact refresh is already running.', 'info');
      return;
    }

    const settings = this.getSettings();
    if (!settings.enabled) {
      this.api.ui.showToast('Phone is disabled in settings.', 'info');
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
          content: this.api.macro.process(settings.contactPrompt),
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
      this.api.ui.showToast('Phone contacts refreshed.', 'success');
    } catch (error) {
      console.error('Phone contact refresh failed:', error);
      this.api.ui.showToast(error instanceof Error ? error.message : 'Phone contact refresh failed.', 'error');
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
    if (!settings.enabled) {
      this.api.ui.showToast('Phone is disabled in settings.', 'info');
      return;
    }

    const contact = this.getContacts().find((item) => item.id === contactId);
    if (!contact) {
      this.api.ui.showToast('Select a phone contact first.', 'error');
      return;
    }

    const pendingKey = `${messageIndex}:${contactId}`;
    if (this.pendingSms.has(pendingKey)) {
      this.api.ui.showToast('SMS generation is already running for this contact.', 'info');
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
          content: this.api.macro.process(settings.smsPrompt),
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
      const result = await this.generateWithRepair<PhoneSmsResponse>(messages, structuredResponse, 'SMS replies');
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
      this.api.ui.showToast(replies.length > 0 ? 'SMS reply received.' : 'SMS sent.', 'success');
    } catch (error) {
      console.error('Phone SMS generation failed:', error);
      const failedData = this.getMessageExtra(messageIndex);
      await this.setMessageExtra(messageIndex, {
        ...failedData,
        messages: (failedData.messages ?? []).map(
          (message): PhoneMessage => (message.id === outbound.id ? { ...message, status: 'failed' } : message),
        ),
      });
      this.api.ui.showToast(error instanceof Error ? error.message : 'SMS generation failed.', 'error');
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
      this.api.ui.registerChatQuickAction(QUICK_ACTION_GROUP_ID, 'Context AI', {
        id: 'phone-open',
        icon: 'fa-solid fa-mobile-screen-button',
        label: 'Phone',
        onClick: () => this.openPanel(),
      }),
    );
    this.unregisterChatUiFns.push(
      this.api.ui.registerChatFormOptionsMenuItem({
        id: 'phone-open',
        icon: 'fa-solid fa-mobile-screen-button',
        label: 'Phone',
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
    title: 'Phone',
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
