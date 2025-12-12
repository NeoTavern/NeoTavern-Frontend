import { aiConfigDefinition } from '../ai-config-definition';
import { CustomPromptPostProcessing } from '../constants';
import type { ApiChatMessage, ApiProvider, ChatCompletionPayload, GenerationResponse, StreamedChunk } from '../types';
import { api_providers } from '../types';
import type { BuildChatCompletionPayloadOptions } from '../types/generation';
import type { ApiFormatter, SamplerSettings, SettingsPath } from '../types/settings';
import { getRequestHeaders } from '../utils/client';
import { convertMessagesToInstructString } from '../utils/instruct';
import {
  getProviderHandler,
  MODEL_INJECTIONS,
  PARAMETER_DEFINITIONS,
  PROVIDER_CONFIG,
  PROVIDER_INJECTIONS,
  type ParamHandling,
} from './provider-definitions';

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
    signal?: AbortSignal,
  ): Promise<GenerationResponse | (() => AsyncGenerator<StreamedChunk>)> {
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
      signal,
    } satisfies RequestInit;

    // Response Handling Helpers
    const responseHandler = getProviderHandler(providerKey);

    if (!payload.stream) {
      const response = await fetch(endpoint, commonOptions);
      const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON response' }));

      if (!response.ok) {
        handleApiError(responseData);
        throw new Error(`Request failed with status ${response.status}`);
      }
      handleApiError(responseData);

      const messageContent = responseHandler.extractMessage(responseData);
      const reasoning = responseHandler.extractReasoning ? responseHandler.extractReasoning(responseData) : undefined;

      return {
        content: messageContent.trim(),
        reasoning: reasoning?.trim(),
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

    return async function* streamData(): AsyncGenerator<StreamedChunk> {
      let reasoning = '';
      let buffer = '';
      let isFirstChunk = true;

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
                return;
              }
              try {
                const parsed = JSON.parse(data);

                if (parsed.error) {
                  throw new Error(parsed.error.message || 'Unknown stream error');
                }

                const chunk = responseHandler.getStreamingReply(parsed, formatter);

                const hasNewReasoning = chunk.reasoning && chunk.reasoning.length > 0;
                const hasNewDelta = chunk.delta && chunk.delta.length > 0;

                if (hasNewReasoning) {
                  reasoning += chunk.reasoning;
                  reasoning.trim();
                }

                if (hasNewDelta || hasNewReasoning) {
                  let delta = chunk.delta || '';
                  if (isFirstChunk && delta) {
                    delta = delta.trimStart();
                    isFirstChunk = false;
                  }
                  yield { delta, reasoning: reasoning };
                }
              } catch (e) {
                console.error('Error parsing stream chunk:', data, e);
              }
            }
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
  }
}
