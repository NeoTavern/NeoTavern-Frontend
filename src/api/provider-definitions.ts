import YAML from 'yaml';
import type { ChatCompletionPayload } from '../types';
import { api_providers } from '../types';
import type { BuildChatCompletionPayloadOptions } from '../types/generation';
import type { SamplerSettings } from '../types/settings';

/**
 * Defines how a setting maps to an API payload parameter.
 */
export interface ParamHandling {
  /**
   * The key to use in the final API payload.
   * If omitted, uses the key from SamplerSettings.
   */
  remoteKey?: keyof ChatCompletionPayload | string;

  /**
   * If defined, the value will be clamped to this minimum.
   */
  min?: number;

  /**
   * If defined, the value will be clamped to this maximum.
   */
  max?: number;

  /**
   * Optional transform function to modify the value before sending.
   * Useful for slicing arrays (stop sequences) or type conversion.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform?: (value: any, context: BuildChatCompletionPayloadOptions) => any;
}

/**
 * Configuration for a specific parameter.
 */
export interface ParamConfiguration {
  /**
   * Default handling for this parameter.
   * Use this only if there is global logic (like checking for valid seeds).
   * If set to `null`, the parameter is NOT sent by default unless a provider overrides it.
   */
  defaults?: ParamHandling | null;

  /**
   * Per-provider overrides.
   * Set to `null` to explicitly disable this parameter for a provider.
   */
  providers?: Partial<Record<string, ParamHandling | null>>;

  /**
   * Model-specific overrides.
   * These take precedence over provider overrides.
   */
  modelRules?: Array<{
    pattern: RegExp;
    rule: ParamHandling | null;
  }>;
}

/**
 * Function to inject custom logic into the payload.
 */
export type InjectionFunction = (
  payload: ChatCompletionPayload & Record<string, unknown>,
  context: BuildChatCompletionPayloadOptions,
) => void;

/**
 * Global model rule for logic that cannot be handled by simple parameter mapping.
 */
export interface ModelInjection {
  pattern: RegExp;
  inject: InjectionFunction;
}

// --- Capability Definitions ---

export interface ProviderCapability {
  supportsChat: boolean;
  supportsText: boolean;
}

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapability> = {
  [api_providers.OPENROUTER]: { supportsChat: true, supportsText: true },
  [api_providers.OPENAI]: { supportsChat: true, supportsText: false },
  [api_providers.CLAUDE]: { supportsChat: true, supportsText: false },
  [api_providers.AI21]: { supportsChat: true, supportsText: false },
  [api_providers.MAKERSUITE]: { supportsChat: true, supportsText: false },
  [api_providers.VERTEXAI]: { supportsChat: true, supportsText: false },
  [api_providers.MISTRALAI]: { supportsChat: true, supportsText: false },
  [api_providers.CUSTOM]: { supportsChat: true, supportsText: false },
  [api_providers.COHERE]: { supportsChat: true, supportsText: false },
  [api_providers.PERPLEXITY]: { supportsChat: true, supportsText: false },
  [api_providers.GROQ]: { supportsChat: true, supportsText: false },
  [api_providers.ELECTRONHUB]: { supportsChat: true, supportsText: false },
  [api_providers.NANOGPT]: { supportsChat: true, supportsText: false },
  [api_providers.DEEPSEEK]: { supportsChat: true, supportsText: false },
  [api_providers.AIMLAPI]: { supportsChat: true, supportsText: false },
  [api_providers.XAI]: { supportsChat: true, supportsText: false },
  [api_providers.POLLINATIONS]: { supportsChat: true, supportsText: false },
  [api_providers.MOONSHOT]: { supportsChat: true, supportsText: false },
  [api_providers.FIREWORKS]: { supportsChat: true, supportsText: false },
  [api_providers.COMETAPI]: { supportsChat: true, supportsText: false },
  [api_providers.AZURE_OPENAI]: { supportsChat: true, supportsText: false },
  [api_providers.ZAI]: { supportsChat: true, supportsText: false },
  [api_providers.KOBOLDCPP]: { supportsChat: true, supportsText: false },
};

// --- Helper Transforms ---

const googleStopTransform = (v: string[]) => v?.slice(0, 5).filter((x) => x.length >= 1 && x.length <= 16);
const cohereStopTransform = (v: string[]) => v?.slice(0, 5);
const zaiStopTransform = (v: string[]) => v?.slice(0, 1);

// --- Parameter Definitions ---

export const PARAMETER_DEFINITIONS: Partial<Record<keyof SamplerSettings, ParamConfiguration>> = {
  show_thoughts: {
    defaults: null,
  },
  max_tokens: {
    providers: {
      [api_providers.POLLINATIONS]: null,
    },
    modelRules: [
      { pattern: /^(o1|o3|o4)/, rule: { remoteKey: 'max_completion_tokens' } },
      { pattern: /^gpt-5/, rule: { remoteKey: 'max_completion_tokens' } },
    ],
  },

  temperature: {
    modelRules: [{ pattern: /^(o1|o3|o4)/, rule: null }],
  },

  frequency_penalty: {
    providers: {
      [api_providers.COHERE]: { min: 0, max: 1 },
      [api_providers.ZAI]: null,
    },
    modelRules: [
      { pattern: /^(o1|o3|o4)/, rule: null },
      { pattern: /grok-3-mini/, rule: null },
      { pattern: /(grok-4|grok-code)/, rule: null },
      { pattern: /gpt-5(\.1)?/, rule: null },
    ],
  },

  presence_penalty: {
    providers: {
      [api_providers.COHERE]: { min: 0, max: 1 },
      [api_providers.ZAI]: null,
    },
    modelRules: [
      { pattern: /^(o1|o3|o4)/, rule: null },
      { pattern: /grok-3-mini/, rule: null },
      { pattern: /(grok-4|grok-code)/, rule: null },
      { pattern: /gpt-5(\.1)?/, rule: null },
    ],
  },

  top_p: {
    providers: {
      [api_providers.COHERE]: { min: 0.01, max: 0.99 },
      [api_providers.ZAI]: { transform: (v) => v || 0.01 },
      [api_providers.DEEPSEEK]: { transform: (v) => v || Number.EPSILON },
    },
    modelRules: [{ pattern: /^(o1|o3|o4)/, rule: null }],
  },

  top_k: {
    // Disabled by default (OpenAI doesn't support it)
    defaults: null,
    providers: {
      [api_providers.CLAUDE]: {},
      [api_providers.OPENROUTER]: {},
      [api_providers.MAKERSUITE]: {},
      [api_providers.VERTEXAI]: {},
      [api_providers.COHERE]: {},
      [api_providers.PERPLEXITY]: {},
      [api_providers.ELECTRONHUB]: {},
      [api_providers.KOBOLDCPP]: {},
    },
  },

  top_a: {
    // Disabled by default (OpenAI doesn't support it)
    defaults: null,
    providers: {
      [api_providers.OPENROUTER]: {},
      [api_providers.KOBOLDCPP]: {},
    },
  },

  min_p: {
    // Disabled by default (OpenAI doesn't support it)
    defaults: null,
    providers: {
      [api_providers.OPENROUTER]: {},
      [api_providers.KOBOLDCPP]: {},
    },
  },

  repetition_penalty: {
    // Disabled by default (OpenAI doesn't support it)
    defaults: null,
    providers: {
      [api_providers.OPENROUTER]: {},
      [api_providers.KOBOLDCPP]: { remoteKey: 'rep_pen' },
    },
  },

  seed: {
    defaults: {
      transform: (v) => (typeof v === 'number' && v >= 0 ? v : undefined),
    },
  },

  stop: {
    defaults: {
      transform: (v: string[]) => (v && v.length > 0 ? v : undefined),
    },
    providers: {
      [api_providers.COHERE]: { transform: cohereStopTransform },
      [api_providers.MAKERSUITE]: { transform: googleStopTransform },
      [api_providers.VERTEXAI]: { transform: googleStopTransform },
      [api_providers.PERPLEXITY]: null,
      [api_providers.ZAI]: { transform: zaiStopTransform },
    },
    modelRules: [
      { pattern: /^(o1|o3|o4)/, rule: null },
      { pattern: /(?=.*gpt)(?=.*vision)/, rule: null },
      { pattern: /grok-3-mini/, rule: null },
      { pattern: /grok-4(?!.*fast-non-reasoning)/, rule: null },
      { pattern: /^gpt-5/, rule: null },
    ],
  },

  n: {
    providers: {
      [api_providers.GROQ]: null,
      [api_providers.XAI]: null,
    },
    modelRules: [{ pattern: /^(o1|o3|o4)/, rule: null }],
  },
};

// --- Provider Injections ---

export const PROVIDER_INJECTIONS: Partial<Record<string, InjectionFunction>> = {
  [api_providers.CLAUDE]: (payload, { samplerSettings }) => {
    payload.claude_use_sysprompt = samplerSettings.providers.claude?.use_sysprompt;
    payload.assistant_prefill = samplerSettings.providers.claude?.assistant_prefill;
    payload.top_k = samplerSettings.top_k;
  },

  [api_providers.MISTRALAI]: (payload) => {
    payload.safe_prompt = false;
  },

  [api_providers.MAKERSUITE]: (payload, { samplerSettings }) => {
    payload.use_makersuite_sysprompt = samplerSettings.providers.google?.use_makersuite_sysprompt;
  },

  [api_providers.VERTEXAI]: (payload, { samplerSettings, providerSpecific }) => {
    payload.use_makersuite_sysprompt = samplerSettings.providers.google?.use_makersuite_sysprompt;
    if (providerSpecific?.vertexai) {
      payload.vertexai_auth_mode = providerSpecific.vertexai.auth_mode;
      payload.vertexai_region = providerSpecific.vertexai.region;
      payload.vertexai_express_project_id = providerSpecific.vertexai.express_project_id;
    }
  },

  [api_providers.OPENROUTER]: (payload, { providerSpecific }) => {
    payload.use_fallback = providerSpecific.openrouter.useFallback;
    payload.provider = providerSpecific.openrouter?.providers;
    payload.allow_fallbacks = providerSpecific.openrouter.allowFallbacks;
    payload.middleout = providerSpecific.openrouter.middleout;
  },

  [api_providers.CUSTOM]: (payload, { providerSpecific, proxy }) => {
    payload.custom_url = providerSpecific.custom?.url;
    payload.custom_include_body = providerSpecific.custom?.include_body;
    payload.custom_exclude_body = providerSpecific.custom?.exclude_body;
    payload.custom_include_headers = providerSpecific.custom?.include_headers;
    if (proxy?.url) {
      payload.reverse_proxy = proxy.url;
    }
    if (proxy?.password) {
      payload.proxy_password = proxy.password;
    }
  },

  [api_providers.AZURE_OPENAI]: (payload, { providerSpecific }) => {
    if (providerSpecific.azure_openai) {
      payload.azure_base_url = providerSpecific.azure_openai.baseUrl;
      payload.azure_deployment_name = providerSpecific.azure_openai.deploymentName;
      payload.azure_api_version = providerSpecific.azure_openai.apiVersion;
    }
  },

  [api_providers.ZAI]: (payload, { providerSpecific }) => {
    if (providerSpecific?.zai?.endpoint) {
      payload.zai_endpoint = providerSpecific.zai.endpoint;
    }
  },

  [api_providers.GROQ]: (payload) => {
    delete payload.logprobs;
    delete payload.logit_bias;
    delete payload.top_logprobs;
    delete payload.n;
  },

  [api_providers.KOBOLDCPP]: (payload, { providerSpecific, samplerSettings }) => {
    payload.chat_completion_source = api_providers.CUSTOM;
    payload.custom_url = providerSpecific.koboldcpp?.url;

    const disabledGroups = samplerSettings.providers.disabled_fields?.koboldcpp || [];

    // Inject KoboldCpp specific settings
    const kSettings = samplerSettings.providers.koboldcpp;
    if (kSettings) {
      // Basic
      if (!disabledGroups.includes('koboldcpp_basic')) {
        if (kSettings.rep_pen_range !== undefined) payload.rep_pen_range = kSettings.rep_pen_range;
        if (kSettings.sampler_order && kSettings.sampler_order.length > 0)
          payload.sampler_order = kSettings.sampler_order;
      }

      // Dynatemp
      if (!disabledGroups.includes('koboldcpp_dynatemp')) {
        if (kSettings.dynatemp_range !== undefined) payload.dynatemp_range = kSettings.dynatemp_range;
        if (kSettings.dynatemp_exponent !== undefined) payload.dynatemp_exponent = kSettings.dynatemp_exponent;
        if (kSettings.smoothing_factor !== undefined) payload.smoothing_factor = kSettings.smoothing_factor;
      }

      // Mirostat
      if (!disabledGroups.includes('koboldcpp_mirostat')) {
        if (kSettings.mirostat !== undefined) payload.mirostat = kSettings.mirostat;
        if (kSettings.mirostat_tau !== undefined) payload.mirostat_tau = kSettings.mirostat_tau;
        if (kSettings.mirostat_eta !== undefined) payload.mirostat_eta = kSettings.mirostat_eta;
      }

      // Grammar & Bans
      if (!disabledGroups.includes('koboldcpp_grammar')) {
        if (kSettings.grammar) payload.grammar = kSettings.grammar;
        if (kSettings.grammar_retain_state !== undefined) payload.grammar_retain_state = kSettings.grammar_retain_state;
        if (kSettings.use_default_badwordsids !== undefined)
          payload.use_default_badwordsids = kSettings.use_default_badwordsids;
        // Arrays
        if (kSettings.banned_tokens) {
          const val = kSettings.banned_tokens;
          if (typeof val === 'string') {
            payload.banned_tokens = (val as string)
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
          } else if (Array.isArray(val)) {
            payload.banned_tokens = val;
          }
        }
      }

      // TFS
      if (!disabledGroups.includes('koboldcpp_tfs')) {
        if (kSettings.tfs !== undefined) payload.tfs = kSettings.tfs;
        if (kSettings.typical !== undefined) payload.typical = kSettings.typical;
      }

      // DRY
      if (!disabledGroups.includes('koboldcpp_dry')) {
        if (kSettings.dry_multiplier !== undefined) payload.dry_multiplier = kSettings.dry_multiplier;
        if (kSettings.dry_base !== undefined) payload.dry_base = kSettings.dry_base;
        if (kSettings.dry_allowed_length !== undefined) payload.dry_allowed_length = kSettings.dry_allowed_length;
        if (kSettings.dry_penalty_last_n !== undefined) payload.dry_penalty_last_n = kSettings.dry_penalty_last_n;

        if (kSettings.dry_sequence_breakers) {
          const val = kSettings.dry_sequence_breakers;
          if (typeof val === 'string') {
            payload.dry_sequence_breakers = (val as string)
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
          } else if (Array.isArray(val)) {
            payload.dry_sequence_breakers = val;
          }
        }
      }

      // XTC
      if (!disabledGroups.includes('koboldcpp_xtc')) {
        if (kSettings.xtc_threshold !== undefined) payload.xtc_threshold = kSettings.xtc_threshold;
        if (kSettings.xtc_probability !== undefined) payload.xtc_probability = kSettings.xtc_probability;
        if (kSettings.nsigma !== undefined) payload.nsigma = kSettings.nsigma;
      }
    }

    const body: Record<string, unknown> = {};

    const ignoredPayloadKeys = [
      'chat_completion_source',
      'custom_url',
      'custom_include_body',
      'custom_exclude_body',
      'custom_include_headers',
      'model',
      'include_reasoning',
    ];
    const allowedRootKeys = ['stream'];
    for (const [key, value] of Object.entries(payload)) {
      if (!ignoredPayloadKeys.includes(key)) {
        body[key] = value;
        if (!allowedRootKeys.includes(key)) {
          delete payload[key];
        }
      }
    }

    delete payload.model;
    delete payload.include_reasoning;
    payload.custom_include_body = YAML.stringify(body);
  },
};

// --- Global Model Injections ---

export const MODEL_INJECTIONS: ModelInjection[] = [
  {
    // o1 / o3 / o4 reasoning models
    pattern: /^(o1|o3|o4)/,
    inject: (payload) => {
      if (payload.model?.startsWith('o1')) {
        payload.messages?.forEach((msg) => {
          if (msg.role === 'system') msg.role = 'user';
        });
      }
      // Clean up params not supported by O-series
      delete payload.n;
      delete payload.tools;
      delete payload.tool_choice;
      delete payload.logprobs;
      delete payload.top_logprobs;
    },
  },
  {
    // GPT-5 constraints
    pattern: /^gpt-5/,
    inject: (payload) => {
      // Common GPT-5 removals

      delete payload.logprobs;
      delete payload.top_logprobs;

      if (/chat-latest/.test(payload.model || '')) {
        // Strict exclusions for chat-latest

        delete payload.tools;
        delete payload.tool_choice;
      } else {
        // Exclusions for other GPT-5 variants
        delete payload.temperature;
        delete payload.top_p;
        delete payload.frequency_penalty;
        delete payload.presence_penalty;
        delete payload.stop;

        delete payload.logit_bias;
      }
    },
  },
  {
    // Grok-4 / Grok-Code constraints
    pattern: /(grok-4|grok-code)/,
    inject: (payload, { model }) => {
      if (!model.includes('grok-4-fast-non-reasoning')) {
        delete payload.stop;
      }
    },
  },
  {
    // Vision model constraints (GPT-4 Vision, etc.)
    pattern: /(?=.*gpt)(?=.*vision)/,
    inject: (payload) => {
      delete payload.logit_bias;
      delete payload.stop;
      delete payload.logprobs;
    },
  },
];
