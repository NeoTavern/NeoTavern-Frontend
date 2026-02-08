import { aiConfigDefinition } from '../ai-config-definition';
import { CustomPromptPostProcessing } from '../constants';
import { ToolService } from '../services/tool.service';
import { useApiStore } from '../stores/api.store';
import { useSettingsStore } from '../stores/settings.store';
import type {
  ApiChatMessage,
  ApiChatToolCall,
  ApiChatToolCallDelta,
  ApiProvider,
  ApiToolDefinition,
  ChatCompletionPayload,
  ConnectionProfile,
  GenerationOptions,
  GenerationResponse,
  StreamedChunk,
} from '../types';
import { api_providers } from '../types';
import type { BuildChatCompletionPayloadOptions } from '../types/generation';
import type { InstructTemplate } from '../types/instruct';
import type { ApiFormatter, ReasoningTemplate, SamplerSettings, Settings, SettingsPath } from '../types/settings';
import { getRequestHeaders } from '../utils/client';
import { eventEmitter } from '../utils/extensions';
import { convertMessagesToInstructString } from '../utils/instruct';
import { parseResponse } from '../utils/structured-response';
import {
  extractMessageGeneric,
  getProviderHandler,
  MODEL_INJECTIONS,
  PARAMETER_DEFINITIONS,
  PROVIDER_CAPABILITIES,
  PROVIDER_CONFIG,
  PROVIDER_INJECTIONS,
  type ParamHandling,
} from './provider-definitions';

export interface ResolvedConnectionProfileSettings {
  provider: ApiProvider;
  model: string;
  samplerSettings: SamplerSettings;
  formatter: ApiFormatter;
  instructTemplate?: InstructTemplate;
  reasoningTemplate?: ReasoningTemplate;
  providerSpecific: Settings['api']['providerSpecific'];
  customPromptPostProcessing: CustomPromptPostProcessing;
}

/**
 * Resolves connection profile settings by merging profile overrides with global settings.
 * Handles apiUrl overrides, secret rotation, and sampler preset loading.
 */
export async function resolveConnectionProfileSettings(options: {
  profile?: string;
  samplerOverrides?: Partial<SamplerSettings>;
  effectiveProvider?: ApiProvider;
}): Promise<ResolvedConnectionProfileSettings> {
  const settingsStore = useSettingsStore();
  const apiStore = useApiStore();
  const { profile, samplerOverrides, effectiveProvider: providedProvider } = options;

  // Get connection profile if specified
  let profileSettings: ConnectionProfile | null = null;
  if (profile) {
    profileSettings = apiStore.connectionProfiles.find((p) => p.id === profile) || null;
  }

  // Determine effective provider
  const effectiveProvider = providedProvider || profileSettings?.provider || settingsStore.settings.api.provider;

  // Determine effective model
  let effectiveModel = profileSettings?.model;
  if (!effectiveModel) {
    effectiveModel = settingsStore.settings.api.selectedProviderModels[effectiveProvider] || apiStore.activeModel || '';
  }

  // Determine effective sampler settings
  let effectiveSamplerSettings = { ...settingsStore.settings.api.samplers };
  if (profileSettings?.sampler) {
    if (apiStore.presets.length === 0) await apiStore.loadPresetsForApi();
    const preset = apiStore.presets.find((p) => p.name === profileSettings!.sampler);
    if (preset) effectiveSamplerSettings = { ...preset.preset };
  }

  // Apply sampler overrides
  if (samplerOverrides) {
    effectiveSamplerSettings = { ...effectiveSamplerSettings, ...samplerOverrides };
  }

  // Determine formatter and instruct template
  let effectiveFormatter = profileSettings?.formatter || settingsStore.settings.api.formatter;

  // Validate formatter support
  const providerCaps = PROVIDER_CAPABILITIES[effectiveProvider];
  if (providerCaps) {
    if (!providerCaps.supportsText && effectiveFormatter === 'text') {
      effectiveFormatter = 'chat';
    } else if (!providerCaps.supportsChat && effectiveFormatter === 'chat') {
      effectiveFormatter = 'text';
    }
  }

  const effectiveTemplateName = profileSettings?.instructTemplate || settingsStore.settings.api.instructTemplateName;
  const effectiveTemplate = apiStore.instructTemplates.find((t) => t.name === effectiveTemplateName);

  // Determine reasoning template
  const effectiveReasoningTemplateName =
    profileSettings?.reasoningTemplate || settingsStore.settings.api.reasoningTemplateName;
  const effectiveReasoningTemplate = apiStore.reasoningTemplates.find((t) => t.name === effectiveReasoningTemplateName);

  // Apply profile-specific API URL if set
  const effectiveProviderSpecific = JSON.parse(
    JSON.stringify(settingsStore.settings.api.providerSpecific),
  ) as Settings['api']['providerSpecific'];
  if (profileSettings?.apiUrl !== undefined) {
    if (effectiveProvider === 'custom') {
      effectiveProviderSpecific.custom.url = profileSettings.apiUrl;
    } else if (effectiveProvider === 'koboldcpp') {
      effectiveProviderSpecific.koboldcpp.url = profileSettings.apiUrl;
    } else if (effectiveProvider === 'ollama') {
      effectiveProviderSpecific.ollama.url = profileSettings.apiUrl;
    }
  }

  // TODO: /generate endpoint should accept secretId directly, so rotation here is not needed.
  // if (profileSettings?.secretId) {
  //   const secretStore = useSecretStore();
  //   const secretKey = PROVIDER_SECRET_KEYS[effectiveProvider];
  //   if (secretKey) {
  //     await secretStore.rotateSecret(secretKey, profileSettings.secretId);
  //   }
  // }

  return {
    provider: effectiveProvider,
    model: effectiveModel,
    samplerSettings: effectiveSamplerSettings,
    formatter: effectiveFormatter,
    instructTemplate: effectiveTemplate,
    reasoningTemplate: effectiveReasoningTemplate,
    providerSpecific: effectiveProviderSpecific,
    customPromptPostProcessing: profileSettings?.customPromptPostProcessing ?? CustomPromptPostProcessing.NONE,
  };
}

export async function processMessagesWithPrefill(
  messages: ApiChatMessage[],
  postProcessingType: CustomPromptPostProcessing,
): Promise<ApiChatMessage[]> {
  if (postProcessingType === CustomPromptPostProcessing.NONE) {
    return messages;
  }

  let processedMessages = [...messages];
  const lastMsg = processedMessages.length > 0 ? processedMessages[processedMessages.length - 1] : null;
  let isPrefill = false;

  if (lastMsg && lastMsg.role === 'assistant') {
    const contentStr =
      typeof lastMsg.content === 'string'
        ? lastMsg.content
        : Array.isArray(lastMsg.content) &&
            lastMsg.content.length > 0 &&
            lastMsg.content[lastMsg.content.length - 1].type === 'text'
          ? lastMsg.content[lastMsg.content.length - 1].text || ''
          : '';
    isPrefill = contentStr.trim().endsWith(':');
  }

  const lastPrefillMessage = isPrefill ? processedMessages.pop() : null;

  processedMessages = await ChatCompletionService.formatMessages(processedMessages, postProcessingType);

  if (lastPrefillMessage) {
    if (
      typeof lastPrefillMessage.content === 'string' &&
      !lastPrefillMessage.content.startsWith(`${lastPrefillMessage.name}: `)
    ) {
      lastPrefillMessage.content = `${lastPrefillMessage.name}: ${lastPrefillMessage.content}`;
    } else if (Array.isArray(lastPrefillMessage.content)) {
      const textPart = lastPrefillMessage.content.find((p) => p.type === 'text');
      if (textPart && textPart.text && !textPart.text.startsWith(`${lastPrefillMessage.name}: `)) {
        textPart.text = `${lastPrefillMessage.name}: ${textPart.text}`;
      }
    }
    processedMessages.push(lastPrefillMessage);
  }

  return processedMessages;
}

const PARAM_TO_GROUP_MAP: Record<string, string> = {};
let isMapInitialized = false;

function initParamGroupMap() {
  if (isMapInitialized) return;
  for (const section of aiConfigDefinition) {
    for (const item of section.items) {
      if (item.widget === 'group' && item.items && item.id) {
        for (const subItem of item.items) {
          if (subItem.id) {
            PARAM_TO_GROUP_MAP[subItem.id] = item.id;
          }
        }
      }
    }
  }
  isMapInitialized = true;
}

function isParameterDisabled(
  key: SettingsPath | string,
  provider: ApiProvider,
  samplerSettings: SamplerSettings,
): boolean {
  initParamGroupMap();

  // 1. Check Global Disabled Fields
  if (samplerSettings.disabled_fields?.includes(key)) return true;

  // 2. Check Provider Specific Disabled Fields
  const providerDisabled = samplerSettings.providers.disabled_fields?.[provider];
  if (providerDisabled) {
    // Check direct ID match
    if (providerDisabled.includes(key)) return true;

    // Check Group ID match (if this param belongs to a group)
    const groupId = PARAM_TO_GROUP_MAP[key];
    if (groupId && providerDisabled.includes(groupId)) return true;
  }

  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setDeep(obj: any, path: string, value: any) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

export function buildChatCompletionPayload(options: BuildChatCompletionPayloadOptions): ChatCompletionPayload {
  const {
    samplerSettings,
    messages,
    model,
    provider,
    formatter,
    instructTemplate,
    playerName,
    activeCharacter,
    structuredResponse,
    customPromptPostProcessing,
    toolConfig,
  } = options;

  const payload: ChatCompletionPayload = {
    model,
    chat_completion_source: provider,
    include_reasoning: !!samplerSettings.show_thoughts,
  };

  const finalMessages = [...messages];

  // Handle Structured Response
  if (structuredResponse) {
    const { format = 'native' } = structuredResponse;
    if (format === 'native' && formatter === 'chat') {
      payload.json_schema = structuredResponse.schema;
    }
  }

  // Handle Tools
  if (
    toolConfig &&
    ToolService.isToolCallingSupported(provider, model, customPromptPostProcessing, toolConfig.bypassGlobalCheck)
  ) {
    const finalTools: ApiToolDefinition[] = [];

    // 1. Registered Tools (Default: true)
    if (toolConfig.includeRegisteredTools !== false) {
      const registeredTools = ToolService.getTools();
      finalTools.push(...registeredTools);
    }

    // 2. Additional Tools
    if (toolConfig.additionalTools && toolConfig.additionalTools.length > 0) {
      const additionalApiTools = toolConfig.additionalTools.map((t) => ToolService.toApiTool(t));
      finalTools.push(...additionalApiTools);
    }

    // 3. Exclude Tools
    let effectiveTools = finalTools;
    if (toolConfig.excludeTools && toolConfig.excludeTools.length > 0) {
      effectiveTools = finalTools.filter((t) => !toolConfig.excludeTools!.includes(t.function.name));
    }

    if (effectiveTools.length > 0) {
      payload.tools = effectiveTools;
      payload.tool_choice = toolConfig.toolChoice || 'auto';
    }
  }

  // Handle Formatter (Chat vs Text)
  if (formatter === 'text' && instructTemplate && activeCharacter) {
    // Text Completion Mode
    // Check if this is continuation or prefill (both should not add suffix to last assistant message)
    let isContinuation = options.mode === 'continue';

    // Also check for prefill (last message ending with ':')
    if (!isContinuation) {
      const lastMsg = finalMessages.length > 0 ? finalMessages[finalMessages.length - 1] : null;
      if (lastMsg) {
        const contentStr =
          typeof lastMsg.content === 'string'
            ? lastMsg.content
            : Array.isArray(lastMsg.content) &&
                lastMsg.content.length > 0 &&
                lastMsg.content[lastMsg.content.length - 1].type === 'text'
              ? lastMsg.content[lastMsg.content.length - 1].text || ''
              : '';
        isContinuation = contentStr.trim().endsWith(':');
      }
    }

    const prompt = convertMessagesToInstructString(
      finalMessages,
      instructTemplate,
      playerName || 'User',
      activeCharacter.name,
      isContinuation,
    );
    if (provider === api_providers.OPENROUTER) {
      // @ts-expect-error for openrouter
      payload.messages = prompt;
    } else {
      payload.prompt = prompt;
    }

    // Inject stopping strings from template
    const stop = [...(samplerSettings.stop || [])];
    if (instructTemplate.stop_sequence && instructTemplate.sequences_as_stop_strings) {
      if (instructTemplate.stop_sequence) stop.push(instructTemplate.stop_sequence);
      if (instructTemplate.input_sequence) stop.push(instructTemplate.input_sequence);
      if (instructTemplate.system_sequence) stop.push(instructTemplate.system_sequence);
      payload.stop = stop.filter((s) => s && s.trim());
    } else {
      payload.stop = stop;
    }
  } else {
    // Default Chat Mode
    payload.messages = finalMessages;
    payload.stop = samplerSettings.stop;
  }

  // 1. Map Parameters (Per-Param Logic)
  for (const key in samplerSettings) {
    const samplerKey = key as keyof SamplerSettings;

    if (
      samplerKey === 'prompts' ||
      samplerKey === 'providers' ||
      samplerKey === 'max_context_unlocked' ||
      samplerKey === 'reasoning_effort' ||
      samplerKey === 'disabled_fields'
    ) {
      continue;
    }

    const settingsId = `api.samplers.${samplerKey}`;
    if (isParameterDisabled(settingsId, provider, samplerSettings)) {
      continue;
    }

    const config = PARAMETER_DEFINITIONS[samplerKey];
    if (!config) continue;

    const providerRule = config.providers?.[provider];
    if (providerRule === undefined || providerRule === null) {
      continue;
    }

    let rule: ParamHandling = config.defaults || {};
    rule = { ...rule, ...providerRule };

    if (config.formatterRules && formatter) {
      for (const fmtRule of config.formatterRules) {
        if (fmtRule.formatter.includes(formatter)) {
          if (fmtRule.providers && !fmtRule.providers.includes(provider)) {
            continue;
          }

          if (fmtRule.rule === null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rule = null as any;
          } else if (fmtRule.rule) {
            rule = { ...rule, ...fmtRule.rule };
          }
        }
      }
    }

    if (config.modelRules) {
      for (const modelRule of config.modelRules) {
        if (modelRule.pattern.test(model)) {
          if (modelRule.rule === null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rule = null as any;
          } else if (modelRule.rule) {
            rule = { ...rule, ...modelRule.rule };
          }
        }
      }
    }

    if (rule === null) continue;

    let value = samplerSettings[samplerKey];

    if (rule.transform) {
      value = rule.transform(value, options);
    }

    if (typeof value === 'number') {
      if (rule.min !== undefined) value = Math.max(value, rule.min);
      if (rule.max !== undefined) value = Math.min(value, rule.max);
    }

    if (value !== undefined) {
      const payloadKey = (rule.remoteKey || samplerKey) as string;
      if (payloadKey.includes('.')) {
        setDeep(payload, payloadKey, value);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload as any)[payloadKey] = value;
      }
    }
  }

  // 2. Apply Provider Specific Injections
  const providerInject = PROVIDER_INJECTIONS[provider];
  if (providerInject) {
    providerInject(payload, options);
  }

  // 3. Apply Model Specific Injections
  for (const rule of MODEL_INJECTIONS) {
    if (rule.pattern.test(model)) {
      rule.inject(payload, options);
    }
  }

  return payload;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleApiError(data: any): void {
  if (data?.error) {
    const errorMessage = data.error.message || data.error.type || 'An unknown API error occurred.';
    if (data.error.code === 'insufficient_quota') {
      throw new Error('You have exceeded your current quota. Please check your plan and billing details.');
    }
    throw new Error(errorMessage);
  }
}

/**
 * A helper class to parse reasoning content from a stream based on a template.
 */
class StreamReasoningParser {
  private buffer = '';
  private state: 'SEARCHING_PREFIX' | 'IN_REASONING' | 'DONE' = 'SEARCHING_PREFIX';
  private prefix: string;
  private suffix: string;

  constructor(template: ReasoningTemplate) {
    this.prefix = template.prefix;
    this.suffix = template.suffix;

    if (!this.prefix || !this.suffix) {
      this.state = 'DONE';
    }
  }

  public process(delta: string): { delta: string; reasoning: string } {
    if (this.state === 'DONE') {
      return { delta, reasoning: '' };
    }

    this.buffer += delta;
    let deltaOut = '';
    let reasoningOut = '';

    let processed = true;
    while (processed) {
      processed = false;

      if (this.state === 'SEARCHING_PREFIX') {
        const prefixIndex = this.buffer.indexOf(this.prefix);
        if (prefixIndex !== -1) {
          deltaOut += this.buffer.substring(0, prefixIndex);
          this.buffer = this.buffer.substring(prefixIndex + this.prefix.length);
          this.state = 'IN_REASONING';
          processed = true;
        } else {
          let matchLen = 0;
          const checkLen = Math.min(this.buffer.length, this.prefix.length - 1);

          for (let i = checkLen; i > 0; i--) {
            if (this.buffer.endsWith(this.prefix.substring(0, i))) {
              matchLen = i;
              break;
            }
          }

          const flushLen = this.buffer.length - matchLen;
          if (flushLen > 0) {
            deltaOut += this.buffer.substring(0, flushLen);
            this.buffer = this.buffer.substring(flushLen);
          }
        }
      } else if (this.state === 'IN_REASONING') {
        const suffixIndex = this.buffer.indexOf(this.suffix);
        if (suffixIndex !== -1) {
          reasoningOut += this.buffer.substring(0, suffixIndex);
          this.buffer = this.buffer.substring(suffixIndex + this.suffix.length);
          this.state = 'DONE';
          processed = true;
        } else {
          let matchLen = 0;
          const checkLen = Math.min(this.buffer.length, this.suffix.length - 1);

          for (let i = checkLen; i > 0; i--) {
            if (this.buffer.endsWith(this.suffix.substring(0, i))) {
              matchLen = i;
              break;
            }
          }

          const flushLen = this.buffer.length - matchLen;
          if (flushLen > 0) {
            reasoningOut += this.buffer.substring(0, flushLen);
            this.buffer = this.buffer.substring(flushLen);
          }
        }
      } else {
        deltaOut += this.buffer;
        this.buffer = '';
      }
    }

    return { delta: deltaOut, reasoning: reasoningOut };
  }

  public flush(): { delta: string; reasoning: string } {
    const result = { delta: '', reasoning: '' };
    if (this.state === 'IN_REASONING') {
      result.reasoning = this.buffer;
    } else {
      result.delta = this.buffer;
    }
    this.buffer = '';
    return result;
  }
}

/**
 * Accumulates tool call deltas from a stream into a complete list of tool calls.
 * Uses a recursive merge strategy to handle nested objects and string concatenation.
 */
class ToolCallAccumulator {
  private tools: ApiChatToolCall[] = [];

  /**
   * Deeply merges a delta object into a target object.
   * @param target The object to merge into.
   * @param delta The partial object to merge.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mergeDelta(target: any, delta: any) {
    for (const key in delta) {
      if (!Object.prototype.hasOwnProperty.call(delta, key)) continue;

      const deltaValue = delta[key];
      const targetValue = target[key];

      if (deltaValue === null || deltaValue === undefined) {
        if (!targetValue) {
          target[key] = deltaValue;
        }
        continue;
      }

      if (typeof deltaValue === 'string') {
        target[key] = (typeof targetValue === 'string' ? targetValue : '') + deltaValue;
      } else if (typeof deltaValue === 'object' && !Array.isArray(deltaValue)) {
        if (typeof targetValue !== 'object' || targetValue === null || Array.isArray(targetValue)) {
          target[key] = {};
        }
        this.mergeDelta(target[key], deltaValue);
      } else {
        target[key] = deltaValue;
      }
    }
  }

  /**
   * Processes an array of tool call deltas from the API.
   * @param deltas An array of partial tool call updates.
   */
  public add(deltas: ApiChatToolCallDelta[]) {
    if (!Array.isArray(deltas)) return;

    for (const delta of deltas) {
      const index = delta.index;
      if (typeof index !== 'number') continue;

      // Ensure the array is large enough
      while (this.tools.length <= index) {
        this.tools.push({
          id: '',
          // @ts-expect-error yeah yeah
          type: '',
          function: { name: '', arguments: '' },
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { index: _, ...deltaData } = delta;
      this.mergeDelta(this.tools[index], deltaData);
    }
  }

  /**
   * Returns the current state of accumulated tool calls.
   * @returns A fresh array of the complete tool calls.
   */
  public getCalls(): ApiChatToolCall[] {
    return JSON.parse(JSON.stringify(this.tools));
  }
}

export class ChatCompletionService {
  static async formatMessages(messages: ApiChatMessage[], type: CustomPromptPostProcessing): Promise<ApiChatMessage[]> {
    const payload = {
      messages,
      type,
    };

    const response = await fetch('/api/backends/chat-completions/process', {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to post-process messages: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (data.messages && Array.isArray(data.messages)) {
      return data.messages;
    }

    return messages;
  }

  static async generate(
    payload: ChatCompletionPayload,
    formatter: ApiFormatter,
    options: GenerationOptions = {},
  ): Promise<GenerationResponse | AsyncGenerator<StreamedChunk>> {
    const startTime = Date.now();
    let endpoint = '/api/backends/chat-completions/generate';
    let body: string = JSON.stringify(payload);

    const providerKey = payload.chat_completion_source as ApiProvider;
    const providerConfig = PROVIDER_CONFIG[providerKey];

    if (providerConfig?.textCompletionEndpoint && formatter === 'text') {
      endpoint = providerConfig.textCompletionEndpoint;
      const genericPayload = {
        ...payload,
        api_type: providerKey,
        api_server: payload.api_server || payload.ollama_server || payload.koboldcpp_server,
      };
      body = JSON.stringify(genericPayload);
    }

    const commonOptions = {
      method: 'POST',
      headers: getRequestHeaders(),
      body: body,
      cache: 'no-cache',
      signal: options.signal,
    } satisfies RequestInit;

    // Response Handling Helpers
    const responseHandler = getProviderHandler(providerKey);

    // --- Usage Tracking Helper ---
    const finalizeUsage = async (finalContent: string, structured_content?: object, parse_error?: Error) => {
      const duration = Date.now() - startTime;
      let outputTokens = 0;

      if (options.tokenizer && finalContent) {
        try {
          outputTokens = await options.tokenizer.getTokenCount(finalContent);
        } catch (e) {
          console.warn('[Generation] Failed to count output tokens:', e);
        }
      }

      if (options.tracking) {
        await eventEmitter.emit('llm:usage', {
          source: options.tracking.source,
          model: options.tracking.model,
          inputTokens: options.tracking.inputTokens,
          outputTokens: outputTokens,
          timestamp: Date.now(),
          duration: duration,
          context: options.tracking.context,
        });
      }

      if (options.onCompletion) {
        options.onCompletion({ outputTokens, duration, structured_content, parse_error });
      }

      return outputTokens;
    };

    // Helper to extract reasoning via template
    const extractReasoningWithTemplate = (
      content: string,
      template: ReasoningTemplate,
    ): { content: string; reasoning?: string } => {
      const { prefix, suffix } = template;
      if (!prefix || !suffix) return { content };

      const prefixIndex = content.indexOf(prefix);
      if (prefixIndex !== -1) {
        const suffixIndex = content.indexOf(suffix, prefixIndex + prefix.length);
        if (suffixIndex !== -1) {
          const reasoning = content.substring(prefixIndex + prefix.length, suffixIndex);
          const newContent = content.substring(0, prefixIndex) + content.substring(suffixIndex + suffix.length);
          return { content: newContent, reasoning };
        }
      }
      return { content };
    };

    if (!payload.stream) {
      const response = await fetch(endpoint, commonOptions);
      const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON response' }));

      if (!response.ok) {
        handleApiError(responseData);
        throw new Error(`Request failed with status ${response.status}`);
      }
      handleApiError(responseData);

      let messageContent = responseHandler.extractMessage(responseData);

      if (!messageContent) {
        messageContent = extractMessageGeneric(responseData);
      }

      let reasoning = responseHandler.extractReasoning ? responseHandler.extractReasoning(responseData) : undefined;
      const toolCalls = responseHandler.extractToolCalls ? responseHandler.extractToolCalls(responseData) : undefined;
      let finalContent = options.isContinuation ? messageContent.trimEnd() : messageContent.trim();
      const images = responseHandler.extractImages ? responseHandler.extractImages(responseData) : undefined;

      if (options.reasoningTemplate && options.reasoningTemplate.prefix && options.reasoningTemplate.suffix) {
        const extracted = extractReasoningWithTemplate(messageContent, options.reasoningTemplate);
        if (extracted.reasoning) {
          finalContent = extracted.content.trim();
          reasoning = reasoning ? `${reasoning}\n${extracted.reasoning}` : extracted.reasoning;
        }
      }

      let structured_content: object | undefined;
      let parse_error: Error | undefined;

      if (options.structuredResponse) {
        const format = options.structuredResponse.format;
        const parseAs = format === 'xml' ? 'xml' : 'json';

        try {
          const parsed = parseResponse(finalContent, parseAs, {
            schema: options.structuredResponse.schema.value,
          });
          if (typeof parsed === 'object' && parsed !== null) {
            structured_content = parsed;
          } else {
            structured_content = { response: parsed };
          }
        } catch (e) {
          parse_error = e as Error;
          console.error(`Failed to parse structured response as ${parseAs}:`, e);
        }
      }

      const tokenCount = await finalizeUsage(finalContent, structured_content, parse_error);

      return {
        content: finalContent,
        reasoning: reasoning?.trim(),
        token_count: tokenCount,
        images,
        structured_content,
        tool_calls: toolCalls,
      };
    }

    const response = await fetch(endpoint, commonOptions);

    if (!response.ok || !response.body) {
      let errorMessage = `Request failed with status ${response.status}`;
      try {
        const errorText = await response.text();
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
      } catch {
        // TODO: Not a JSON error, use the status text
      }
      throw new Error(errorMessage);
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

    // Internal Generator: Handles parsing the raw stream into chunks
    const rawStreamGenerator = async function* (): AsyncGenerator<StreamedChunk> {
      let reasoning = '';
      let buffer = '';
      let isFirstChunk = true;
      let stopStream = false;

      const shouldParseReasoning =
        options.reasoningTemplate && options.reasoningTemplate.prefix && options.reasoningTemplate.suffix;
      const reasoningParser = shouldParseReasoning ? new StreamReasoningParser(options.reasoningTemplate!) : null;
      const toolAccumulator = new ToolCallAccumulator();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim().startsWith('data: ')) {
              const data = line.trim().substring(6);
              if (data === '[DONE]') {
                stopStream = true;
                break;
              }
              try {
                const parsed = JSON.parse(data);

                if (parsed.error) {
                  throw new Error(parsed.error.message || 'Unknown stream error');
                }

                const chunk = responseHandler.getStreamingReply(parsed, formatter);

                if (chunk.reasoning) {
                  reasoning += chunk.reasoning;
                }

                if (chunk.tool_call_deltas) {
                  toolAccumulator.add(chunk.tool_call_deltas);
                }

                let deltaToYield = chunk.delta || '';
                let reasoningDelta = '';

                if (reasoningParser) {
                  const parsed = reasoningParser.process(deltaToYield);
                  deltaToYield = parsed.delta;
                  reasoningDelta = parsed.reasoning;
                  if (reasoningDelta) {
                    reasoning += reasoningDelta;
                  }
                }

                const hasContentChange = deltaToYield.length > 0;
                const hasReasoningChange = (chunk.reasoning && chunk.reasoning.length > 0) || reasoningDelta.length > 0;
                const hasImages = chunk.images && chunk.images.length > 0;
                const hasToolCalls = chunk.tool_call_deltas && chunk.tool_call_deltas.length > 0;

                if (hasContentChange || hasReasoningChange || hasImages || hasToolCalls) {
                  if (isFirstChunk && deltaToYield) {
                    // Only trim leading whitespace if NOT in continuation/prefill mode
                    if (!options.isContinuation) {
                      deltaToYield = deltaToYield.trimStart();
                    }
                    isFirstChunk = false;
                  }

                  yield {
                    delta: deltaToYield,
                    reasoning: reasoning,
                    images: chunk.images,
                    tool_calls: toolAccumulator.getCalls(), // Send cumulative state
                  };
                }
              } catch (e) {
                console.error('Error parsing stream chunk:', data, e);
              }
            }
          }

          if (stopStream) {
            break;
          }
        }

        if (reasoningParser) {
          const flushed = reasoningParser.flush();
          if (flushed.delta || flushed.reasoning) {
            if (flushed.reasoning) reasoning += flushed.reasoning;
            yield { delta: flushed.delta, reasoning: reasoning };
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.debug('Stream aborted by user.');
        } else {
          throw error;
        }
      }
    };

    return (async function* () {
      let fullContent = '';
      let structured_content: object | undefined;
      let parse_error: Error | undefined;

      try {
        for await (const chunk of rawStreamGenerator()) {
          fullContent += chunk.delta;
          yield chunk;
        }
      } finally {
        // This block runs when:
        // 1. Stream finishes successfully
        // 2. Consumer breaks the loop
        // 3. Error is thrown (including Abort)

        if (options.structuredResponse) {
          const format = options.structuredResponse.format;
          const parseAs = format === 'xml' ? 'xml' : 'json';

          try {
            const parsed = parseResponse(fullContent, parseAs, {
              schema: options.structuredResponse.schema.value,
            });
            if (typeof parsed === 'object' && parsed !== null) {
              structured_content = parsed;
            } else {
              structured_content = { response: parsed };
            }
          } catch (e) {
            parse_error = e as Error;
            console.error(`Failed to parse structured response from stream as ${parseAs}:`, e);
          }
        }
        await finalizeUsage(fullContent, structured_content, parse_error);
      }
    })();
  }
}
