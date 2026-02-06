import localforage from 'localforage';
import type { ApiChatMessage, Character, ExtensionAPI, Persona, StructuredResponseOptions } from '../../../types';
import type {
  RewriteField,
  RewriteLLMResponse,
  RewriteSession,
  RewriteSessionMessage,
  RewriteSettings,
  RewriteTemplate,
  StructuredResponseFormat,
} from './types';

export class RewriteService {
  private store: LocalForage;

  constructor(private api: ExtensionAPI<RewriteSettings>) {
    this.store = localforage.createInstance({
      name: 'neotavern',
      storeName: 'rewrite-sessions',
    });
  }

  private getSettings(): RewriteSettings {
    const defaults: RewriteSettings = {
      templates: [],
      lastUsedTemplates: {},
      templateOverrides: {},
      defaultConnectionProfile: '',
    };
    const current = this.api.settings.get() || defaults;
    return current;
  }

  public getTemplates(): RewriteTemplate[] {
    const settings = this.getSettings();
    return settings.templates || [];
  }

  // --- Session Persistence ---

  public async getSessions(identifier: string): Promise<RewriteSession[]> {
    const sessions: RewriteSession[] = [];
    await this.store.iterate((value: RewriteSession) => {
      if (value.identifier === identifier) {
        sessions.push(value);
      }
    });
    // Sort by updated descending
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public async getSession(id: string): Promise<RewriteSession | null> {
    return (await this.store.getItem<RewriteSession>(id)) || null;
  }

  public async saveSession(session: RewriteSession): Promise<void> {
    session.updatedAt = Date.now();
    await this.store.setItem(session.id, session);
  }

  public async deleteSession(id: string): Promise<void> {
    await this.store.removeItem(id);
  }

  public async clearAllSessions(): Promise<void> {
    await this.store.clear();
  }

  public async createSession(
    templateId: string,
    identifier: string,
    initialFields: RewriteField[],
    contextData?: { activeCharacter?: Character; characters?: Character[]; persona?: Persona },
    additionalMacros?: Record<string, unknown>,
    argOverrides?: Record<string, boolean | number | string>,
  ): Promise<RewriteSession> {
    const settings = this.getSettings();
    const template = settings.templates.find((t) => t.id === templateId);

    if (!template) {
      throw new Error(this.api.i18n.t('extensionsBuiltin.rewrite.errors.templateNotFound'));
    }

    // Resolve custom args
    const args: Record<string, unknown> = {};
    if (template.args) {
      for (const arg of template.args) {
        args[arg.key] = argOverrides?.[arg.key] ?? arg.defaultValue;
      }
    }

    const macros = {
      input: initialFields.length > 0 ? initialFields[0].value : '',
      availableFields: initialFields.map((f) => f.id).join(', '),
      ...args,
      ...additionalMacros,
    };

    // Process system prompt (preamble)
    const resolvedSystemPrompt = this.api.macro.process(template.sessionPreamble, contextData, macros);

    const session: RewriteSession = {
      id: this.api.uuid(),
      templateId,
      identifier,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      initialFields,
      systemPrompt: resolvedSystemPrompt,
      messages: [
        {
          id: this.api.uuid(),
          role: 'system',
          content: resolvedSystemPrompt,
          timestamp: Date.now(),
        },
      ],
    };

    await this.saveSession(session);
    return session;
  }

  // --- Generation Logic ---

  public async generateRewrite(
    input: string,
    templateId: string,
    connectionProfile?: string,
    customPromptOverride?: string,
    contextData?: { activeCharacter?: Character; characters?: Character[]; persona?: Persona },
    additionalMacros?: Record<string, unknown>,
    argOverrides?: Record<string, boolean | number | string>,
    signal?: AbortSignal,
  ) {
    if (!connectionProfile) {
      throw new Error(this.api.i18n.t('extensionsBuiltin.rewrite.errors.noConnectionProfile'));
    }
    const settings = this.getSettings();
    const template = settings.templates.find((t) => t.id === templateId);
    if (!template && !customPromptOverride)
      throw new Error(this.api.i18n.t('extensionsBuiltin.rewrite.errors.templateNotFound'));

    const promptText = customPromptOverride || template?.prompt || '';
    const macroTemplate = template?.template || '{{input}}';

    // Resolve custom args
    const args: Record<string, unknown> = {};
    if (template?.args) {
      for (const arg of template.args) {
        args[arg.key] = argOverrides?.[arg.key] ?? arg.defaultValue;
      }
    }

    // Prepare macros
    const macros = {
      input: input,
      prompt: promptText,
      ...args,
      ...additionalMacros, // e.g. contextMessages
    };

    // Process the template string using the core macro processor
    const processedContent = this.api.macro.process(macroTemplate, contextData, macros);

    const messages: ApiChatMessage[] = [{ role: 'user', content: processedContent, name: 'User' }];

    const response = await this.api.llm.generate(messages, {
      connectionProfile,
      signal,
    });

    return response;
  }

  public async generateSessionResponse(
    messages: RewriteSessionMessage[],
    format: StructuredResponseFormat,
    availableFields: RewriteField[],
    connectionProfile?: string,
    signal?: AbortSignal,
  ): Promise<RewriteLLMResponse> {
    if (!connectionProfile) {
      throw new Error(this.api.i18n.t('extensionsBuiltin.rewrite.errors.noConnectionProfile'));
    }

    let apiMessages: ApiChatMessage[] = messages.map((m) => {
      let content = m.content;
      if (typeof content !== 'string') {
        content = JSON.stringify(content);
      }
      return {
        role: m.role,
        content: content as string,
        name: m.role === 'user' ? 'User' : 'Assistant',
      };
    });

    const isMultiField = availableFields.length > 1;

    const schema = {
      name: 'rewrite_response',
      strict: true,
      value: {
        type: 'object',
        properties: {
          justification: {
            type: 'string',
            description: 'A brief explanation of the changes made and the reasoning behind them.',
          },
          ...(isMultiField
            ? {
                changes: {
                  type: 'array',
                  description: 'An array of proposed changes to one or more fields.',
                  items: {
                    type: 'object',
                    properties: {
                      fieldId: {
                        type: 'string',
                        description: 'The ID of the field to change.',
                        enum: availableFields.map((f) => f.id),
                      },
                      newValue: {
                        type: 'string',
                        description: 'The new, rewritten content for the field.',
                      },
                    },
                    required: ['fieldId', 'newValue'],
                  },
                },
              }
            : {
                response: {
                  type: 'string',
                  description: 'The full, rewritten text for the single field.',
                },
              }),
        },
        required: ['justification'],
        additionalProperties: false,
      },
    };

    let structuredResponseOptions: StructuredResponseOptions | undefined;
    if (format !== 'text') {
      structuredResponseOptions =
        format === 'native'
          ? { schema, format: 'native' }
          : { schema, format, exampleResponse: true, jsonPrompt: undefined, xmlPrompt: undefined };
    }

    apiMessages = (
      await this.api.chat.buildPrompt({
        chatHistory: apiMessages,
        structuredResponse: structuredResponseOptions,
        samplerSettings: {
          prompts: [{ content: '', enabled: true, identifier: 'chatHistory', marker: true, name: 'Chat History' }],
        },
      })
    ).messages;

    if (format === 'text') {
      const response = await this.api.llm.generate(apiMessages, {
        connectionProfile,
        signal,
      });

      let content = '';
      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
          content += chunk.delta;
        }
      } else {
        content = response.content;
      }

      return {
        justification: content,
        response: undefined,
      };
    }

    return new Promise(async (resolve, reject) => {
      try {
        const response = await this.api.llm.generate(apiMessages, {
          connectionProfile,
          signal,
          structuredResponse: structuredResponseOptions,
          onCompletion: (data) => {
            if (data.parse_error) {
              reject(data.parse_error);
              return;
            }
            if (data.structured_content) {
              resolve(data.structured_content as RewriteLLMResponse);
            } else {
              reject(new Error('No structured content received'));
            }
          },
        });

        if (Symbol.asyncIterator in response) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          for await (const _ of response) {
          }
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  public extractCodeBlock(text: string): string {
    const completeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
    const completeMatch = text.match(completeBlockRegex);
    if (completeMatch && completeMatch[1]) {
      return completeMatch[1].trim();
    }

    const incompleteBlockRegex = /```(?:[\w]*\n)?([\s\S]*)/i;
    const incompleteMatch = text.match(incompleteBlockRegex);
    if (incompleteMatch && incompleteMatch[1]) {
      return incompleteMatch[1].trim();
    }

    return text.trim();
  }
}
