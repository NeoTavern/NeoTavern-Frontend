import { aiConfigDefinition } from '../ai-config-definition';
import { CustomPromptPostProcessing } from '../constants';
import { useApiStore } from '../stores/api.store';
import { useSettingsStore } from '../stores/settings.store';
import type {
  ApiChatMessage,
  ApiProvider,
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
import {
  extractMessageGeneric,
  getProviderHandler,
  MODEL_INJECTIONS,
  PARAMETER_DEFINITIONS,
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
  customPromptPostProcessing?: CustomPromptPostProcessing;
}

/**
 * Resolves connection profile settings by merging profile overrides with global settings.
 * Handles apiUrl overrides, secret rotation, and sampler preset loading.
 */
export async function resolveConnectionProfileSettings(options: {
  profileName?: string;
  samplerOverrides?: Partial<SamplerSettings>;
  effectiveProvider?: ApiProvider;
}): Promise<ResolvedConnectionProfileSettings> {
  const settingsStore = useSettingsStore();
  const apiStore = useApiStore();
  const { profileName, samplerOverrides, effectiveProvider: providedProvider } = options;

  // Get connection profile if specified
  let profileSettings: ConnectionProfile | null = null;
  if (profileName) {
    profileSettings = apiStore.connectionProfiles.find((p) => p.name === profileName) || null;
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
  const effectiveFormatter = profileSettings?.formatter || settingsStore.settings.api.formatter;
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
    customPromptPostProcessing: profileSettings?.customPromptPostProcessing,
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
  const { samplerSettings, messages, model, provider, formatter, instructTemplate, playerName, activeCharacter } =
    options;

  const payload: ChatCompletionPayload = {
    model,
    chat_completion_source: provider,
    include_reasoning: !!samplerSettings.show_thoughts,
  };

  // Handle Formatter (Chat vs Text)
  if (formatter === 'text' && instructTemplate && activeCharacter) {
    // Text Completion Mode
    const prompt = convertMessagesToInstructString(
      messages,
      instructTemplate,
      playerName || 'User',
      activeCharacter.name,
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
      // Stop sequence might be single string or multiple
      // In the type we defined it as string, but JSON can implies list logic sometimes.
      // Based on reference logic, we merge various sequences.
      if (instructTemplate.stop_sequence) stop.push(instructTemplate.stop_sequence);
      if (instructTemplate.input_sequence) stop.push(instructTemplate.input_sequence);
      if (instructTemplate.system_sequence) stop.push(instructTemplate.system_sequence);
      // Remove empty strings
      payload.stop = stop.filter((s) => s && s.trim());
    } else {
      payload.stop = stop;
    }
  } else {
    // Default Chat Mode
    payload.messages = messages;
    payload.stop = samplerSettings.stop;
  }

  // 1. Map Parameters (Per-Param Logic)
  for (const key in samplerSettings) {
    const samplerKey = key as keyof SamplerSettings;

    // Explicitly skip internal/non-payload settings
    if (
      samplerKey === 'prompts' ||
      samplerKey === 'providers' ||
      samplerKey === 'max_context_unlocked' ||
      samplerKey === 'reasoning_effort' ||
      samplerKey === 'stop' || // Handled above
      samplerKey === 'disabled_fields'
    ) {
      continue;
    }

    // For top-level sampler keys, ID is typically "api.samplers.{key}"
    const settingsId = `api.samplers.${samplerKey}`;
    if (isParameterDisabled(settingsId, provider, samplerSettings)) {
      continue;
    }

    const config = PARAMETER_DEFINITIONS[samplerKey];
    if (!config) continue;

    const providerRule = config.providers?.[provider];
    if (providerRule === undefined || providerRule === null) {
      // Not allowed for this provider
      continue;
    }

    let rule: ParamHandling = config.defaults || {};
    rule = { ...rule, ...providerRule };

    // Apply Formatter-specific overrides
    if (config.formatterRules && formatter) {
      for (const fmtRule of config.formatterRules) {
        if (fmtRule.formatter.includes(formatter)) {
          // If providers constraint is present, check it
          if (fmtRule.providers && !fmtRule.providers.includes(provider)) {
            continue;
          }

          if (fmtRule.rule === null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rule = null as any; // Treat as disabled
          } else if (fmtRule.rule) {
            rule = { ...rule, ...fmtRule.rule };
          }
        }
      }
    }

    // Apply model specific overrides
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

    // If the rule is explicitly null (via formatter/model override), skip this parameter.
    if (rule === null) continue;

    let value = samplerSettings[samplerKey];

    // Transform / Validation
    if (rule.transform) {
      value = rule.transform(value, options);
    }

    // Clamping
    if (typeof value === 'number') {
      if (rule.min !== undefined) value = Math.max(value, rule.min);
      if (rule.max !== undefined) value = Math.min(value, rule.max);
    }

    // Assignment (ignoring undefined)
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

  // 2. Apply Provider Specific Injections (auth tokens, strict deletions, etc.)
  const providerInject = PROVIDER_INJECTIONS[provider];
  if (providerInject) {
    providerInject(payload, options);
  }

  // 3. Apply Model Specific Injections (O1 role swaps, GPT-5 cleanups, Reasoning Effort)
  for (const rule of MODEL_INJECTIONS) {
    if (rule.pattern.test(model)) {
      rule.inject(payload, options);
    }
  }

  // 4. ToolManager integration (placeholder)
  // if (!canMultiSwipe && ToolManager.canPerformToolCalls(type)) { ... }

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

    // If template is invalid (empty prefix/suffix), effectively disable logic by setting state to DONE immediately.
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

    // Loop to handle cases where multiple transitions happen in one chunk
    // Use a 'processed' flag to continue loop as long as we have state changes,
    // even if buffer becomes empty (to handle zero-length transitions if needed).
    let processed = true;
    while (processed) {
      processed = false;

      if (this.state === 'SEARCHING_PREFIX') {
        const prefixIndex = this.buffer.indexOf(this.prefix);
        if (prefixIndex !== -1) {
          // Found prefix
          // Content before prefix is valid output
          deltaOut += this.buffer.substring(0, prefixIndex);
          // Remove prefix from buffer, switch state
          this.buffer = this.buffer.substring(prefixIndex + this.prefix.length);
          this.state = 'IN_REASONING';
          processed = true;
        } else {
          // Optimization: flush non-matching parts immediately
          let matchLen = 0;
          // Max possible partial match is prefix.length - 1.
          const checkLen = Math.min(this.buffer.length, this.prefix.length - 1);

          // Check for partial matches at the end of buffer
          for (let i = checkLen; i > 0; i--) {
            // Check if buffer ends with the first i chars of prefix
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
          // Found suffix
          // Everything before is reasoning
          reasoningOut += this.buffer.substring(0, suffixIndex);
          // Remove suffix
          this.buffer = this.buffer.substring(suffixIndex + this.suffix.length);
          this.state = 'DONE';
          processed = true;
        } else {
          // Optimization: flush confirmed reasoning immediately
          // Check for partial matches of suffix at end of buffer
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
        // DONE
        deltaOut += this.buffer;
        this.buffer = '';
      }
    }

    return { delta: deltaOut, reasoning: reasoningOut };
  }

  /**
   * Called when stream ends to flush any remaining buffer.
   */
  public flush(): { delta: string; reasoning: string } {
    const result = { delta: '', reasoning: '' };
    if (this.state === 'IN_REASONING') {
      // Stream ended while in reasoning -> assume rest is reasoning
      result.reasoning = this.buffer;
    } else {
      // Stream ended while searching or done -> assume content
      result.delta = this.buffer;
    }
    this.buffer = '';
    return result;
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
  ): Promise<GenerationResponse | (() => AsyncGenerator<StreamedChunk>)> {
    const startTime = Date.now();
    let endpoint = '/api/backends/chat-completions/generate';
    let body: string = JSON.stringify(payload);

    const providerKey = payload.chat_completion_source as ApiProvider;
    const providerConfig = PROVIDER_CONFIG[providerKey];

    if (providerConfig?.textCompletionEndpoint && formatter === 'text') {
      endpoint = providerConfig.textCompletionEndpoint;
      const genericPayload = {
        ...payload,
        api_type: providerKey, // 'ollama', 'koboldcpp', etc.
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
    const finalizeUsage = async (finalContent: string) => {
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
        options.onCompletion({ outputTokens, duration });
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

      // Fallback to generic extraction if specific handler fails to find content
      if (!messageContent) {
        messageContent = extractMessageGeneric(responseData);
      }

      let reasoning = responseHandler.extractReasoning ? responseHandler.extractReasoning(responseData) : undefined;
      let finalContent = messageContent.trim();
      const images = responseHandler.extractImages ? responseHandler.extractImages(responseData) : undefined;

      // Apply Reasoning Template if provided and reasoning wasn't already extracted (or even if it was, maybe additional reasoning in content)
      if (options.reasoningTemplate && options.reasoningTemplate.prefix && options.reasoningTemplate.suffix) {
        const extracted = extractReasoningWithTemplate(messageContent, options.reasoningTemplate);
        // If we found reasoning in content, prioritize it or append?
        // Usually if model supports native reasoning, content is clean.
        // If model puts reasoning in content, we extract it.
        if (extracted.reasoning) {
          finalContent = extracted.content.trim();
          reasoning = reasoning ? `${reasoning}\n${extracted.reasoning}` : extracted.reasoning;
        }
      }

      const tokenCount = await finalizeUsage(finalContent);

      return {
        content: finalContent,
        reasoning: reasoning?.trim(),
        token_count: tokenCount,
        images,
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

    // Streaming Logic
    // We wrap the generator to intercept chunks for token counting
    const originalGenerator = async function* streamData(): AsyncGenerator<StreamedChunk> {
      let reasoning = '';
      let buffer = '';
      let isFirstChunk = true;
      let stopStream = false;

      // Only enable parser if template is fully valid
      const shouldParseReasoning =
        options.reasoningTemplate && options.reasoningTemplate.prefix && options.reasoningTemplate.suffix;
      const reasoningParser = shouldParseReasoning ? new StreamReasoningParser(options.reasoningTemplate!) : null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep the last, possibly incomplete, line

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

                // Accumulate native reasoning
                if (chunk.reasoning) {
                  reasoning += chunk.reasoning;
                }

                let deltaToYield = chunk.delta || '';
                let reasoningDelta = ''; // From parser

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

                if (hasContentChange || hasReasoningChange || hasImages) {
                  if (isFirstChunk && deltaToYield) {
                    deltaToYield = deltaToYield.trimStart();
                    isFirstChunk = false;
                  }

                  yield { delta: deltaToYield, reasoning: reasoning, images: chunk.images };
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

        // Flush reasoning parser if needed
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

    // Return a wrapped generator that handles usage tracking upon completion
    return async function* () {
      let fullContent = '';
      try {
        for await (const chunk of originalGenerator()) {
          fullContent += chunk.delta;
          yield chunk;
        }
      } finally {
        // This runs when the stream is exhausted or the consumer breaks the loop
        await finalizeUsage(fullContent);
      }
    };
  }
}
