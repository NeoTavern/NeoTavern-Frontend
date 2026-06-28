import { OpenrouterMiddleoutType, SECRET_KEYS } from './constants';
import { api_providers, type AiConfigSection } from './types';

export const apiConnectionDefinition: AiConfigSection[] = [
  // OpenAI
  {
    id: 'openai',
    conditions: { provider: api_providers.OPENAI },
    items: [
      { widget: 'key-manager', label: 'apiConnections.openaiKey', secretKey: SECRET_KEYS.OPENAI },
      {
        id: 'api.selectedProviderModels.openai',
        widget: 'model-select',
        label: 'apiConnections.openaiModel',
        placeholder: 'gpt-5.5',
      },
    ],
  },
  // Claude
  {
    id: 'claude',
    conditions: { provider: api_providers.CLAUDE },
    items: [
      { widget: 'key-manager', label: 'apiConnections.claudeKey', secretKey: SECRET_KEYS.CLAUDE },
      {
        id: 'api.selectedProviderModels.claude',
        widget: 'model-select',
        label: 'apiConnections.claudeModel',
        placeholder: 'claude-opus-4-8',
      },
    ],
  },
  // OpenRouter
  {
    id: 'openrouter',
    conditions: { provider: api_providers.OPENROUTER },
    items: [
      { widget: 'key-manager', label: 'apiConnections.openrouterKey', secretKey: SECRET_KEYS.OPENROUTER },
      {
        id: 'api.selectedProviderModels.openrouter',
        widget: 'model-select',
        label: 'apiConnections.openrouterModel',
        placeholder: 'z-ai/glm-5.1',
      },
      { widget: 'header', label: 'apiConnections.openrouterOptions' },
      {
        id: 'api.providerSpecific.openrouter.useFallback',
        widget: 'checkbox',
        label: 'apiConnections.openrouterUseFallback',
      },
      {
        id: 'api.providerSpecific.openrouter.allowFallbacks',
        widget: 'checkbox',
        label: 'apiConnections.openrouterAllowFallbacks',
      },
      {
        id: 'api.providerSpecific.openrouter.providers',
        widget: 'text-input',
        label: 'apiConnections.openrouterFallbackProviders',
        valueType: 'array',
        arraySeparator: ',',
      },
      {
        id: 'api.providerSpecific.openrouter.middleout',
        widget: 'select',
        label: 'apiConnections.openrouterMiddleout',
        options: [
          { label: 'apiConnections.middleout.on', value: OpenrouterMiddleoutType.ON },
          { label: 'apiConnections.middleout.off', value: OpenrouterMiddleoutType.OFF },
          { label: 'apiConnections.middleout.auto', value: OpenrouterMiddleoutType.AUTO },
        ],
      },
    ],
  },
  // Mistral
  {
    id: 'mistral',
    conditions: { provider: api_providers.MISTRALAI },
    items: [
      { widget: 'key-manager', label: 'apiConnections.mistralaiKey', secretKey: SECRET_KEYS.MISTRALAI },
      {
        id: 'api.selectedProviderModels.mistralai',
        widget: 'model-select',
        label: 'apiConnections.mistralaiModel',
        placeholder: 'mistral-large-latest',
      },
    ],
  },
  // Groq
  {
    id: 'groq',
    conditions: { provider: api_providers.GROQ },
    items: [
      { widget: 'key-manager', label: 'apiConnections.groqKey', secretKey: SECRET_KEYS.GROQ },
      {
        id: 'api.selectedProviderModels.groq',
        widget: 'model-select',
        label: 'apiConnections.groqModel',
        placeholder: 'openai/gpt-oss-120b',
      },
    ],
  },
  // Custom
  {
    id: 'custom',
    conditions: { provider: api_providers.CUSTOM },
    items: [
      {
        id: 'api.providerSpecific.custom.url',
        widget: 'text-input',
        label: 'apiConnections.customUrl',
      },
      {
        id: 'api.selectedProviderModels.custom',
        widget: 'model-select',
        label: 'apiConnections.customModel',
      },
      { widget: 'key-manager', label: 'apiConnections.customKey', secretKey: SECRET_KEYS.CUSTOM },
    ],
  },
  // Azure OpenAI
  {
    id: 'azure',
    conditions: { provider: api_providers.AZURE_OPENAI },
    items: [
      { widget: 'key-manager', label: 'apiConnections.azureKey', secretKey: SECRET_KEYS.AZURE_OPENAI },
      {
        id: 'api.providerSpecific.azure_openai.baseUrl',
        widget: 'text-input',
        label: 'apiConnections.azureBaseUrl',
      },
      {
        id: 'api.providerSpecific.azure_openai.deploymentName',
        widget: 'text-input',
        label: 'apiConnections.azureDeploymentName',
      },
      {
        id: 'api.providerSpecific.azure_openai.apiVersion',
        widget: 'text-input',
        label: 'apiConnections.azureApiVersion',
      },
      {
        id: 'api.selectedProviderModels.azure_openai',
        widget: 'model-select',
        label: 'apiConnections.azureModel',
        placeholder: 'This is the model name inside your deployment',
      },
    ],
  },
  // Deepseek
  {
    id: 'deepseek',
    conditions: { provider: api_providers.DEEPSEEK },
    items: [
      { widget: 'key-manager', label: 'apiConnections.deepseekKey', secretKey: SECRET_KEYS.DEEPSEEK },
      {
        id: 'api.selectedProviderModels.deepseek',
        widget: 'model-select',
        label: 'apiConnections.deepseekModel',
        placeholder: 'deepseek-v4-flash',
      },
    ],
  },
  // AI21
  {
    id: 'ai21',
    conditions: { provider: api_providers.AI21 },
    items: [
      { widget: 'key-manager', label: 'apiConnections.ai21Key', secretKey: SECRET_KEYS.AI21 },
      {
        id: 'api.selectedProviderModels.ai21',
        widget: 'model-select',
        label: 'apiConnections.ai21Model',
        placeholder: 'jamba-large',
      },
    ],
  },
  // Google (MakerSuite)
  {
    id: 'makersuite',
    conditions: { provider: api_providers.MAKERSUITE },
    items: [
      { widget: 'key-manager', label: 'apiConnections.googleKey', secretKey: SECRET_KEYS.MAKERSUITE },
      {
        id: 'api.selectedProviderModels.makersuite',
        widget: 'model-select',
        label: 'apiConnections.googleModel',
        placeholder: 'gemini-3.5-flash',
      },
    ],
  },
  // VertexAI
  {
    id: 'vertexai',
    conditions: { provider: api_providers.VERTEXAI },
    items: [
      { widget: 'key-manager', label: 'apiConnections.vertexaiKey', secretKey: SECRET_KEYS.VERTEXAI },
      {
        id: 'api.selectedProviderModels.vertexai',
        widget: 'model-select',
        label: 'apiConnections.vertexaiModel',
        placeholder: 'gemini-3.5-flash',
      },
      {
        id: 'api.providerSpecific.vertexai.express_project_id',
        widget: 'text-input',
        label: 'apiConnections.vertexaiProjectId',
      },
      {
        id: 'api.providerSpecific.vertexai.region',
        widget: 'text-input',
        label: 'apiConnections.vertexaiRegion',
        placeholder: 'us-central1',
      },
    ],
  },
  // Cohere
  {
    id: 'cohere',
    conditions: { provider: api_providers.COHERE },
    items: [
      { widget: 'key-manager', label: 'apiConnections.cohereKey', secretKey: SECRET_KEYS.COHERE },
      {
        id: 'api.selectedProviderModels.cohere',
        widget: 'model-select',
        label: 'apiConnections.cohereModel',
        placeholder: 'command-a-plus-05-2026',
      },
    ],
  },
  // Perplexity
  {
    id: 'perplexity',
    conditions: { provider: api_providers.PERPLEXITY },
    items: [
      { widget: 'key-manager', label: 'apiConnections.perplexityKey', secretKey: SECRET_KEYS.PERPLEXITY },
      {
        id: 'api.selectedProviderModels.perplexity',
        widget: 'model-select',
        label: 'apiConnections.perplexityModel',
        placeholder: 'sonar-pro',
      },
    ],
  },
  // ElectronHub
  {
    id: 'electronhub',
    conditions: { provider: api_providers.ELECTRONHUB },
    items: [
      { widget: 'key-manager', label: 'apiConnections.electronhubKey', secretKey: SECRET_KEYS.ELECTRONHUB },
      {
        id: 'api.selectedProviderModels.electronhub',
        widget: 'model-select',
        label: 'apiConnections.electronhubModel',
        placeholder: 'gpt-4o-mini',
      },
    ],
  },
  // NanoGPT
  {
    id: 'nanogpt',
    conditions: { provider: api_providers.NANOGPT },
    items: [
      { widget: 'key-manager', label: 'apiConnections.nanogptKey', secretKey: SECRET_KEYS.NANOGPT },
      {
        id: 'api.selectedProviderModels.nanogpt',
        widget: 'model-select',
        label: 'apiConnections.nanogptModel',
        placeholder: 'zai-org/glm-5.1',
      },
    ],
  },
  // AIMLAPI
  {
    id: 'aimlapi',
    conditions: { provider: api_providers.AIMLAPI },
    items: [
      { widget: 'key-manager', label: 'apiConnections.aimlapiKey', secretKey: SECRET_KEYS.AIMLAPI },
      {
        id: 'api.selectedProviderModels.aimlapi',
        widget: 'text-input',
        label: 'apiConnections.aimlapiModel',
        placeholder: 'chatgpt-4o-latest',
      },
    ],
  },
  // XAI
  {
    id: 'xai',
    conditions: { provider: api_providers.XAI },
    items: [
      { widget: 'key-manager', label: 'apiConnections.xapiKey', secretKey: SECRET_KEYS.XAI },
      {
        id: 'api.selectedProviderModels.xai',
        widget: 'text-input',
        label: 'apiConnections.xaiModel',
        placeholder: 'grok-4.3',
      },
    ],
  },
  // Pollinations
  {
    id: 'pollinations',
    conditions: { provider: api_providers.POLLINATIONS },
    items: [
      {
        id: 'api.selectedProviderModels.pollinations',
        widget: 'text-input',
        label: 'apiConnections.pollinationsModel',
        placeholder: 'openai',
      },
    ],
  },
  // Moonshot
  {
    id: 'moonshot',
    conditions: { provider: api_providers.MOONSHOT },
    items: [
      { widget: 'key-manager', label: 'apiConnections.moonshotKey', secretKey: SECRET_KEYS.MOONSHOT },
      {
        id: 'api.selectedProviderModels.moonshot',
        widget: 'text-input',
        label: 'apiConnections.moonshotModel',
        placeholder: 'kimi-latest',
      },
    ],
  },
  // Fireworks
  {
    id: 'fireworks',
    conditions: { provider: api_providers.FIREWORKS },
    items: [
      { widget: 'key-manager', label: 'apiConnections.fireworksKey', secretKey: SECRET_KEYS.FIREWORKS },
      {
        id: 'api.selectedProviderModels.fireworks',
        widget: 'text-input',
        label: 'apiConnections.fireworksModel',
        placeholder: 'accounts/fireworks/models/kimi-k2p6',
      },
    ],
  },
  // CometAPI
  {
    id: 'cometapi',
    conditions: { provider: api_providers.COMETAPI },
    items: [
      { widget: 'key-manager', label: 'apiConnections.cometapiKey', secretKey: SECRET_KEYS.COMETAPI },
      {
        id: 'api.selectedProviderModels.cometapi',
        widget: 'text-input',
        label: 'apiConnections.cometapiModel',
        placeholder: 'gpt-4o',
      },
    ],
  },
  // ZAI
  {
    id: 'zai',
    conditions: { provider: api_providers.ZAI },
    items: [
      { widget: 'key-manager', label: 'apiConnections.zaiKey', secretKey: SECRET_KEYS.ZAI },
      {
        id: 'api.providerSpecific.zai.endpoint',
        widget: 'text-input',
        label: 'apiConnections.zaiEndpoint',
        placeholder: 'common',
      },
      {
        id: 'api.selectedProviderModels.zai',
        widget: 'text-input',
        label: 'apiConnections.zaiModel',
        placeholder: 'glm-5.1',
      },
    ],
  },
  // KoboldCPP
  {
    id: 'koboldcpp',
    conditions: { provider: api_providers.KOBOLDCPP },
    items: [
      {
        id: 'api.providerSpecific.koboldcpp.url',
        widget: 'text-input',
        label: 'apiConnections.koboldUrl',
        placeholder: 'http://localhost:5001/v1',
      },
      {
        id: 'api.selectedProviderModels.koboldcpp',
        widget: 'model-select',
        label: 'apiConnections.koboldModel',
        placeholder: 'Select a model',
      },
    ],
  },
  // Ollama
  {
    id: 'ollama',
    conditions: { provider: api_providers.OLLAMA },
    items: [
      {
        id: 'api.providerSpecific.ollama.url',
        widget: 'text-input',
        label: 'apiConnections.ollamaUrl',
        placeholder: 'http://localhost:11434/v1',
      },
      {
        id: 'api.selectedProviderModels.ollama',
        widget: 'model-select',
        label: 'apiConnections.ollamaModel',
        placeholder: 'llama3.2',
      },
    ],
  },
];
