import { aiConfigDefinition } from '../ai-config-definition';
import { ReasoningEffort } from '../constants';
import type { ApiProvider, ChatCompletionPayload, GenerationResponse, StreamedChunk } from '../types';
import { api_providers } from '../types';
import type { BuildChatCompletionPayloadOptions } from '../types/generation';
import type { SamplerSettings, SettingsPath } from '../types/settings';
import { getRequestHeaders } from '../utils/client';
import { convertMessagesToInstructString } from '../utils/instruct';
import {
  MODEL_INJECTIONS,
  PARAMETER_DEFINITIONS,
  PROVIDER_INJECTIONS,
  type ParamHandling,
} from './provider-definitions';

const REASONING_EFFORT_PROVIDERS: ApiProvider[] = [
  api_providers.OPENAI,
  api_providers.AZURE_OPENAI,
  api_providers.CUSTOM,
  api_providers.XAI,
  api_providers.AIMLAPI,
  api_providers.OPENROUTER,
  api_providers.POLLINATIONS,
  api_providers.PERPLEXITY,
  api_providers.COMETAPI,
  api_providers.ELECTRONHUB,
];

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

    let rule: ParamHandling | null | undefined = config?.defaults;

    // Apply provider specific overrides
    if (config?.providers && provider in config.providers) {
      const providerRule = config.providers[provider];
      if (providerRule === null) {
        rule = null;
      } else if (providerRule) {
        rule = { ...rule, ...providerRule };
      }
    }

    // Apply model specific overrides
    if (config?.modelRules) {
      for (const modelRule of config.modelRules) {
        if (modelRule.pattern.test(model)) {
          if (modelRule.rule === null) {
            rule = null;
          } else if (modelRule.rule) {
            rule = { ...rule, ...modelRule.rule };
          }
        }
      }
    }

    // If the rule is explicitly null (either via defaults or override), skip this parameter.
    if (rule === null) continue;

    let value = samplerSettings[samplerKey];

    // Transform / Validation
    if (rule?.transform) {
      value = rule.transform(value, options);
    }

    // Clamping
    if (typeof value === 'number' && rule) {
      if (rule.min !== undefined) value = Math.max(value, rule.min);
      if (rule.max !== undefined) value = Math.min(value, rule.max);
    }

    // Assignment (ignoring undefined)
    if (value !== undefined) {
      const payloadKey = (rule?.remoteKey || samplerKey) as keyof ChatCompletionPayload;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload as any)[payloadKey] = value;
    }
  }

  // 2. Apply Provider Specific Injections (auth tokens, strict deletions, etc.)
  const providerInject = PROVIDER_INJECTIONS[provider];
  if (providerInject) {
    providerInject(payload, options);
  }

  // 3. Apply Model Specific Injections (O1 role swaps, GPT-5 cleanups)
  for (const rule of MODEL_INJECTIONS) {
    if (rule.pattern.test(model)) {
      rule.inject(payload, options);
    }
  }

  // 4. Apply Reasoning Effort Logic (Shared logic)
  applyReasoningEffort(payload, options);

  // 5. TODO: ToolManager integration
  // if (!canMultiSwipe && ToolManager.canPerformToolCalls(type)) { ... }

  return payload;
}

function applyReasoningEffort(payload: ChatCompletionPayload, options: BuildChatCompletionPayloadOptions) {
  const { samplerSettings, provider, model, modelList } = options;

  if (!samplerSettings.reasoning_effort) return;
  if (!REASONING_EFFORT_PROVIDERS.includes(provider)) return;

  // Azure Specific Constraint: Reasoning effort not supported on older GPT-3/4 models
  if (provider === api_providers.AZURE_OPENAI && /^gpt-[34]/.test(model)) {
    return;
  }
  // XAI Constraint: only grok-3-mini supports reasoning effort currently
  if (provider === api_providers.XAI && !model.includes('grok-3-mini')) {
    return;
  }

  let reasoningEffort: ReasoningEffort | string | undefined = samplerSettings.reasoning_effort;

  switch (samplerSettings.reasoning_effort) {
    case ReasoningEffort.AUTO:
      reasoningEffort = undefined;
      break;
    case ReasoningEffort.MIN:
      // Special case for GPT-5 on OpenAI/Azure
      if ((provider === api_providers.OPENAI || provider === api_providers.AZURE_OPENAI) && /^gpt-5/.test(model)) {
        reasoningEffort = ReasoningEffort.MIN;
      } else {
        reasoningEffort = ReasoningEffort.LOW;
      }
      break;
    case ReasoningEffort.MAX:
      reasoningEffort = ReasoningEffort.HIGH;
      break;
    default:
      reasoningEffort = samplerSettings.reasoning_effort;
  }

  // ElectronHub specific validation
  if (provider === api_providers.ELECTRONHUB && Array.isArray(modelList) && reasoningEffort) {
    const currentModel = modelList.find((m) => m.id === model);
    const supportedEfforts = currentModel?.metadata?.supported_reasoning_efforts;
    if (Array.isArray(supportedEfforts) && !supportedEfforts.includes(reasoningEffort as string)) {
      reasoningEffort = undefined;
    }
  }

  if (reasoningEffort) {
    payload.reasoning_effort = reasoningEffort;
  }
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMessage(data: any, provider: ApiProvider): string {
  if (typeof data === 'string') {
    return data;
  }

  switch (provider) {
    case api_providers.CLAUDE:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data?.content?.find((p: any) => p.type === 'text')?.text ?? '';
    case api_providers.OPENAI:
    case api_providers.OPENROUTER:
    case api_providers.KOBOLDCPP:
    // Fallback for most OpenAI-compatible APIs
    default:
      return (
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        data?.results?.[0]?.output?.text ??
        data?.content?.[0]?.text ??
        ''
      );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractReasoning(data: any, provider: ApiProvider): string | undefined {
  switch (provider) {
    case api_providers.CLAUDE:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data?.content?.find((p: any) => p.type === 'thinking')?.thinking;
    case api_providers.MAKERSUITE:
    case api_providers.VERTEXAI:
      return (
        data?.responseContent?.parts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.filter((p: any) => p.thought)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.map((p: any) => p.text)
          ?.join('\n\n') ?? ''
      );
    case api_providers.MISTRALAI:
      return (
        data?.choices?.[0]?.message?.content?.[0]?.thinking
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.map((p: any) => p.text)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?.filter((x: any) => x)
          ?.join('\n\n') ?? ''
      );
    case api_providers.OPENROUTER:
    case api_providers.DEEPSEEK:
    case api_providers.XAI:
    case api_providers.AIMLAPI:
    case api_providers.POLLINATIONS:
    case api_providers.MOONSHOT:
    case api_providers.COMETAPI:
    case api_providers.ELECTRONHUB:
    case api_providers.NANOGPT:
    case api_providers.ZAI:
    case api_providers.CUSTOM:
      return data?.choices?.[0]?.message?.reasoning_content ?? data?.choices?.[0]?.message?.reasoning;
    default:
      return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStreamingReply(data: any, provider: ApiProvider): { delta: string; reasoning?: string } {
  switch (provider) {
    case api_providers.CLAUDE:
      return {
        delta: data?.delta?.text || '',
        reasoning: data?.delta?.thinking || '',
      };
    case api_providers.MAKERSUITE:
    case api_providers.VERTEXAI:
      return {
        delta:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data?.candidates?.[0]?.content?.parts?.filter((x: any) => !x.thought)?.map((x: any) => x.text)?.[0] || '',
        reasoning:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data?.candidates?.[0]?.content?.parts?.filter((x: any) => x.thought)?.map((x: any) => x.text)?.[0] || '',
      };
    case api_providers.MISTRALAI:
      return {
        delta:
          data.choices?.[0]?.delta?.content
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?.map((x: any) => x.text)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((x: any) => x)
            .join('') || '',
        reasoning:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.choices?.filter((x: any) => x?.delta?.content?.[0]?.thinking)?.[0]?.delta?.content?.[0]?.thinking?.[0]
            ?.text || '',
      };
    case api_providers.OPENROUTER:
      return {
        delta:
          data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reasoning: data.choices?.filter((x: any) => x?.delta?.reasoning)?.[0]?.delta?.reasoning || '',
      };
    case api_providers.DEEPSEEK:
    case api_providers.XAI:
    case api_providers.CUSTOM:
    case api_providers.POLLINATIONS:
    case api_providers.AIMLAPI:
    case api_providers.MOONSHOT:
    case api_providers.COMETAPI:
    case api_providers.ELECTRONHUB:
    case api_providers.NANOGPT:
    case api_providers.ZAI:
      return {
        delta:
          data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
        reasoning:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.choices?.filter((x: any) => x?.delta?.reasoning_content)?.[0]?.delta?.reasoning_content ??
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data.choices?.filter((x: any) => x?.delta?.reasoning)?.[0]?.delta?.reasoning ??
          '',
      };
    // Fallback for OpenAI and compatible APIs
    case api_providers.KOBOLDCPP:
    case api_providers.OPENAI:
    default:
      return {
        delta:
          data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '',
      };
  }
}

export class ChatCompletionService {
  static async generate(
    payload: ChatCompletionPayload,
    signal?: AbortSignal,
  ): Promise<GenerationResponse | (() => AsyncGenerator<StreamedChunk>)> {
    const commonOptions = {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify(payload),
      cache: 'no-cache',
      signal,
    } satisfies RequestInit;

    const endpoint = '/api/backends/chat-completions/generate';

    if (!payload.stream) {
      const response = await fetch(endpoint, commonOptions);
      const responseData = await response.json().catch(() => ({ error: 'Failed to parse JSON response' }));

      if (!response.ok) {
        handleApiError(responseData);
        throw new Error(`Request failed with status ${response.status}`);
      }
      handleApiError(responseData);

      const provider = payload.chat_completion_source as ApiProvider;
      const messageContent = extractMessage(responseData, provider);
      const reasoning = extractReasoning(responseData, provider);

      return {
        content: messageContent,
        reasoning: reasoning,
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

                const provider = payload.chat_completion_source as ApiProvider;
                const chunk = getStreamingReply(parsed, provider);

                const hasNewReasoning = chunk.reasoning && chunk.reasoning.length > 0;
                const hasNewDelta = chunk.delta && chunk.delta.length > 0;

                if (hasNewReasoning) {
                  reasoning += chunk.reasoning;
                }

                if (hasNewDelta || hasNewReasoning) {
                  yield { delta: chunk.delta || '', reasoning: reasoning };
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
