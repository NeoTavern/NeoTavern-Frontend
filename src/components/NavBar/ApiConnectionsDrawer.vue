<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useApiStore } from '../../stores/api.store';
import { chat_completion_sources, type ConnectionProfile } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import ConnectionProfilePopup from './ConnectionProfilePopup.vue';
import ConnectionProfileSelector from '../Common/ConnectionProfileSelector.vue';
import { OpenrouterMiddleoutType, TokenizerType } from '../../constants';
import { AppButton, AppCheckbox, AppIconButton, AppInput, AppSelect } from '../UI';
import AppFormItem from '../UI/AppFormItem.vue';

const { t } = useStrictI18n();

const apiStore = useApiStore();
const settingsStore = useSettingsStore();

const isProfilePopupVisible = ref(false);

const staticOpenAIModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
const dynamicOpenAIModels = computed(() => {
  return apiStore.modelList.filter((model) => !staticOpenAIModels.includes(model.id));
});

const hasOpenRouterGroupedModels = computed(() => {
  return apiStore.groupedOpenRouterModels && Object.keys(apiStore.groupedOpenRouterModels).length > 0;
});

function handleProfileSave(profile: Omit<ConnectionProfile, 'id'>) {
  apiStore.createConnectionProfile(profile);
}

const openrouterProvidersString = computed({
  get: () => settingsStore.settings.api.providerSpecific.openrouter.providers.join(','),
  set: (value) => {
    const newProviders = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    settingsStore.settings.api.providerSpecific.openrouter.providers = newProviders;
  },
});

const mainApiOptions = computed(() => [
  { label: t('apiConnections.chatCompletion'), value: 'openai' },
  { label: t('apiConnections.textCompletion'), value: 'textgenerationwebui', disabled: true },
  { label: t('apiConnections.novel'), value: 'novel', disabled: true },
  { label: t('apiConnections.horde'), value: 'koboldhorde', disabled: true },
  { label: t('apiConnections.kobold'), value: 'kobold', disabled: true },
]);

const claudeModelOptions = [
  { label: 'claude-3-5-sonnet-20240620', value: 'claude-3-5-sonnet-20240620' },
  { label: 'claude-3-opus-20240229', value: 'claude-3-opus-20240229' },
  { label: 'claude-3-haiku-20240307', value: 'claude-3-haiku-20240307' },
];

const mistralModelOptions = [
  { label: 'mistral-large-latest', value: 'mistral-large-latest' },
  { label: 'mistral-small-latest', value: 'mistral-small-latest' },
];

const groqModelOptions = [
  { label: 'llama3-70b-8192', value: 'llama3-70b-8192' },
  { label: 'llama3-8b-8192', value: 'llama3-8b-8192' },
  { label: 'gemma-7b-it', value: 'gemma-7b-it' },
  { label: 'mixtral-8x7b-32768', value: 'mixtral-8x7b-32768' },
];

const middleoutOptions = computed(() => [
  { label: t('apiConnections.middleout.on'), value: OpenrouterMiddleoutType.ON },
  { label: t('apiConnections.middleout.off'), value: OpenrouterMiddleoutType.OFF },
  { label: t('apiConnections.middleout.auto'), value: OpenrouterMiddleoutType.AUTO },
]);

const tokenizerOptions = computed(() => [
  { label: t('apiConnections.tokenizers.auto'), value: TokenizerType.AUTO },
  { label: t('apiConnections.tokenizers.none'), value: TokenizerType.NONE },
  { label: t('apiConnections.tokenizers.gpt4o'), value: TokenizerType.GPT4O },
  { label: t('apiConnections.tokenizers.gpt35'), value: TokenizerType.GPT35 },
  { label: t('apiConnections.tokenizers.gpt2'), value: TokenizerType.GPT2 },
  { label: t('apiConnections.tokenizers.gemma'), value: TokenizerType.GEMMA },
  { label: t('apiConnections.tokenizers.deepseek'), value: TokenizerType.DEEPSEEK },
  { label: t('apiConnections.tokenizers.llama'), value: TokenizerType.LLAMA },
  { label: t('apiConnections.tokenizers.llama3'), value: TokenizerType.LLAMA3 },
  { label: t('apiConnections.tokenizers.mistral'), value: TokenizerType.MISTRAL },
  { label: t('apiConnections.tokenizers.nemo'), value: TokenizerType.NEMO },
  { label: t('apiConnections.tokenizers.claude'), value: TokenizerType.CLAUDE },
  { label: t('apiConnections.tokenizers.jamba'), value: TokenizerType.JAMBA },
  { label: t('apiConnections.tokenizers.commandr'), value: TokenizerType.COMMANDR },
  { label: t('apiConnections.tokenizers.commanda'), value: TokenizerType.COMMANDA },
  { label: t('apiConnections.tokenizers.qwen2'), value: TokenizerType.QWEN2 },
  { label: t('apiConnections.tokenizers.yi'), value: TokenizerType.YI },
]);

onMounted(() => {
  apiStore.initialize();
});
</script>

<template>
  <div class="api-connections-drawer">
    <div class="api-connections-drawer-wrapper">
      <div class="api-connections-drawer-section">
        <h3>{{ t('apiConnections.profile') }}</h3>
        <div class="preset-manager-controls">
          <ConnectionProfileSelector v-model="apiStore.selectedConnectionProfileName" />
          <AppIconButton
            icon="fa-file-circle-plus"
            :title="t('apiConnections.profileManagement.create')"
            @click="isProfilePopupVisible = true"
          />
          <AppIconButton
            icon="fa-pencil"
            :title="t('apiConnections.profileManagement.rename')"
            @click="apiStore.renameConnectionProfile"
          />
          <AppIconButton
            icon="fa-trash-can"
            :title="t('apiConnections.profileManagement.delete')"
            @click="apiStore.deleteConnectionProfile"
          />
          <AppIconButton
            icon="fa-file-import"
            :title="t('apiConnections.profileManagement.import')"
            @click="apiStore.importConnectionProfiles"
          />
          <AppIconButton
            icon="fa-file-export"
            :title="t('apiConnections.profileManagement.export')"
            @click="apiStore.exportConnectionProfile"
          />
        </div>
      </div>

      <hr />

      <div class="api-connections-drawer-section">
        <AppFormItem :label="t('apiConnections.api')">
          <AppSelect v-model="settingsStore.settings.api.main" :options="mainApiOptions" />
        </AppFormItem>
      </div>

      <div v-show="settingsStore.settings.api.main === 'openai'">
        <div class="api-connections-drawer-section">
          <AppFormItem :label="t('apiConnections.source')">
            <!-- Native select required for optgroup support -->
            <select
              class="text-pole"
              :value="settingsStore.settings.api.chatCompletionSource"
              @change="
                settingsStore.settings.api.chatCompletionSource = ($event.target as HTMLSelectElement).value as any
              "
            >
              <optgroup>
                <option :value="chat_completion_sources.OPENAI">{{ t('apiConnections.sources.openai') }}</option>
                <option :value="chat_completion_sources.CUSTOM">{{ t('apiConnections.sources.custom') }}</option>
              </optgroup>
              <optgroup>
                <option :value="chat_completion_sources.AI21">{{ t('apiConnections.sources.ai21') }}</option>
                <option :value="chat_completion_sources.AIMLAPI">{{ t('apiConnections.sources.aimlapi') }}</option>
                <option :value="chat_completion_sources.AZURE_OPENAI">
                  {{ t('apiConnections.sources.azure_openai') }}
                </option>
                <option :value="chat_completion_sources.CLAUDE">{{ t('apiConnections.sources.claude') }}</option>
                <option :value="chat_completion_sources.COHERE">{{ t('apiConnections.sources.cohere') }}</option>
                <option :value="chat_completion_sources.DEEPSEEK">{{ t('apiConnections.sources.deepseek') }}</option>
                <option :value="chat_completion_sources.ELECTRONHUB">
                  {{ t('apiConnections.sources.electronhub') }}
                </option>
                <option :value="chat_completion_sources.FIREWORKS">{{ t('apiConnections.sources.fireworks') }}</option>
                <option :value="chat_completion_sources.GROQ">{{ t('apiConnections.sources.groq') }}</option>
                <option :value="chat_completion_sources.MAKERSUITE">
                  {{ t('apiConnections.sources.makersuite') }}
                </option>
                <option :value="chat_completion_sources.VERTEXAI">{{ t('apiConnections.sources.vertexai') }}</option>
                <option :value="chat_completion_sources.MISTRALAI">{{ t('apiConnections.sources.mistralai') }}</option>
                <option :value="chat_completion_sources.MOONSHOT">{{ t('apiConnections.sources.moonshot') }}</option>
                <option :value="chat_completion_sources.NANOGPT">{{ t('apiConnections.sources.nanogpt') }}</option>
                <option :value="chat_completion_sources.OPENROUTER">
                  {{ t('apiConnections.sources.openrouter') }}
                </option>
                <option :value="chat_completion_sources.PERPLEXITY">
                  {{ t('apiConnections.sources.perplexity') }}
                </option>
                <option :value="chat_completion_sources.POLLINATIONS">
                  {{ t('apiConnections.sources.pollinations') }}
                </option>
                <option :value="chat_completion_sources.XAI">{{ t('apiConnections.sources.xai') }}</option>
                <option :value="chat_completion_sources.ZAI">{{ t('apiConnections.sources.zai') }}</option>
              </optgroup>
            </select>
          </AppFormItem>
        </div>

        <!-- OpenAI Form -->
        <div v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.OPENAI">
          <AppFormItem :label="t('apiConnections.openaiKey')">
            <div class="api-connections-drawer-input-group">
              <AppButton icon="fa-key" :title="t('apiConnections.manageKeys')" />
            </div>
            <div class="neutral_warning">
              {{ t('apiConnections.keyPrivacy') }}
            </div>
          </AppFormItem>

          <AppFormItem :label="t('apiConnections.openaiModel')">
            <select
              class="text-pole"
              :value="settingsStore.settings.api.selectedProviderModels.openai"
              @change="
                settingsStore.setSetting(
                  'api.selectedProviderModels.openai',
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <optgroup :label="t('apiConnections.modelGroups.gpt4o')">
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
              </optgroup>
              <optgroup :label="t('apiConnections.modelGroups.gpt4turbo')">
                <option value="gpt-4-turbo">gpt-4-turbo</option>
              </optgroup>
              <optgroup v-show="dynamicOpenAIModels.length > 0" :label="t('apiConnections.modelGroups.other')">
                <option v-for="model in dynamicOpenAIModels" :key="model.id" :value="model.id">
                  {{ model.id }}
                </option>
              </optgroup>
            </select>
          </AppFormItem>
        </div>

        <!-- Claude Form -->
        <div v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.CLAUDE">
          <AppFormItem :label="t('apiConnections.claudeKey')">
            <div class="api-connections-drawer-input-group">
              <AppButton icon="fa-key" :title="t('apiConnections.manageKeys')" />
            </div>
            <div class="neutral_warning">
              {{ t('apiConnections.keyPrivacy') }}
            </div>
          </AppFormItem>

          <AppFormItem :label="t('apiConnections.claudeModel')">
            <AppSelect
              :model-value="settingsStore.settings.api.selectedProviderModels.claude"
              :options="claudeModelOptions"
              @update:model-value="settingsStore.setSetting('api.selectedProviderModels.claude', $event as string)"
            />
          </AppFormItem>
        </div>

        <!-- OpenRouter Form -->
        <div v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.OPENROUTER">
          <AppFormItem :label="t('apiConnections.openrouterKey')">
            <div class="api-connections-drawer-input-group">
              <AppButton icon="fa-key" :title="t('apiConnections.manageKeys')" />
            </div>
            <div class="neutral_warning">
              {{ t('apiConnections.keyPrivacy') }}
            </div>
          </AppFormItem>

          <AppFormItem :label="t('apiConnections.openrouterModel')">
            <select
              v-show="hasOpenRouterGroupedModels"
              class="text-pole"
              :value="settingsStore.settings.api.selectedProviderModels.openrouter"
              @change="
                settingsStore.setSetting(
                  'api.selectedProviderModels.openrouter',
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="OR_Website">{{ t('apiConnections.openrouterWebsite') }}</option>
              <optgroup v-for="(models, vendor) in apiStore.groupedOpenRouterModels" :key="vendor" :label="vendor">
                <option v-for="model in models" :key="model.id" :value="model.id">{{ model.name }}</option>
              </optgroup>
            </select>
            <AppInput
              v-show="!hasOpenRouterGroupedModels"
              :model-value="settingsStore.settings.api.selectedProviderModels.openrouter"
              placeholder="google/gemini-pro-1.5"
              @update:model-value="settingsStore.setSetting('api.selectedProviderModels.openrouter', String($event))"
            />
          </AppFormItem>

          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.openrouterOptions') }}</h4>
            <AppCheckbox
              :model-value="settingsStore.settings.api.providerSpecific.openrouter.useFallback"
              :label="t('apiConnections.openrouterUseFallback')"
              @update:model-value="
                settingsStore.setSetting('api.providerSpecific.openrouter.useFallback', Boolean($event))
              "
            />
            <AppCheckbox
              :model-value="settingsStore.settings.api.providerSpecific.openrouter.allowFallbacks"
              :label="t('apiConnections.openrouterAllowFallbacks')"
              @update:model-value="
                settingsStore.setSetting('api.providerSpecific.openrouter.allowFallbacks', Boolean($event))
              "
            />
            <AppFormItem :label="t('apiConnections.openrouterFallbackProviders')">
              <AppInput v-model="openrouterProvidersString" />
            </AppFormItem>

            <AppFormItem :label="t('apiConnections.openrouterMiddleout')">
              <AppSelect
                :model-value="settingsStore.settings.api.providerSpecific.openrouter.middleout"
                :options="middleoutOptions"
                @update:model-value="
                  settingsStore.setSetting('api.providerSpecific.openrouter.middleout', $event as any)
                "
              />
            </AppFormItem>
          </div>
        </div>

        <!-- MistralAI Form -->
        <div v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.MISTRALAI">
          <AppFormItem :label="t('apiConnections.mistralaiKey')">
            <div class="api-connections-drawer-input-group">
              <AppButton icon="fa-key" :title="t('apiConnections.manageKeys')" />
            </div>
          </AppFormItem>

          <AppFormItem :label="t('apiConnections.mistralaiModel')">
            <AppSelect
              :model-value="settingsStore.settings.api.selectedProviderModels.mistralai"
              :options="mistralModelOptions"
              @update:model-value="settingsStore.setSetting('api.selectedProviderModels.mistralai', $event as string)"
            />
          </AppFormItem>
        </div>

        <!-- Groq Form -->
        <div v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.GROQ">
          <AppFormItem :label="t('apiConnections.groqKey')">
            <div class="api-connections-drawer-input-group">
              <AppButton icon="fa-key" :title="t('apiConnections.manageKeys')" />
            </div>
          </AppFormItem>

          <AppFormItem :label="t('apiConnections.groqModel')">
            <AppSelect
              :model-value="settingsStore.settings.api.selectedProviderModels.groq"
              :options="groqModelOptions"
              @update:model-value="settingsStore.setSetting('api.selectedProviderModels.groq', $event as string)"
            />
          </AppFormItem>
        </div>

        <!-- Custom Form -->
        <div v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.CUSTOM">
          <AppFormItem :label="t('apiConnections.customUrl')">
            <AppInput
              :model-value="settingsStore.settings.api.providerSpecific.custom.url"
              @update:model-value="settingsStore.settings.api.providerSpecific.custom.url = String($event)"
            />
          </AppFormItem>
          <AppFormItem :label="t('apiConnections.customModel')">
            <AppInput
              :model-value="settingsStore.settings.api.selectedProviderModels.custom"
              @update:model-value="settingsStore.settings.api.selectedProviderModels.custom = String($event)"
            />
          </AppFormItem>
          <AppFormItem :label="t('apiConnections.customKey')">
            <div class="api-connections-drawer-input-group">
              <AppButton icon="fa-key" :title="t('apiConnections.manageKeys')" />
            </div>
          </AppFormItem>
        </div>

        <!-- Azure OpenAI Form -->
        <div v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.AZURE_OPENAI">
          <AppFormItem :label="t('apiConnections.azureKey')">
            <div class="api-connections-drawer-input-group">
              <AppButton icon="fa-key" :title="t('apiConnections.manageKeys')" />
            </div>
          </AppFormItem>

          <AppFormItem :label="t('apiConnections.azureBaseUrl')">
            <AppInput
              :model-value="settingsStore.settings.api.providerSpecific.azure_openai.baseUrl"
              @update:model-value="
                settingsStore.setSetting('api.providerSpecific.azure_openai.baseUrl', String($event))
              "
            />
          </AppFormItem>
          <AppFormItem :label="t('apiConnections.azureDeploymentName')">
            <AppInput
              :model-value="settingsStore.settings.api.providerSpecific.azure_openai.deploymentName"
              @update:model-value="
                settingsStore.setSetting('api.providerSpecific.azure_openai.deploymentName', String($event))
              "
            />
          </AppFormItem>
          <AppFormItem :label="t('apiConnections.azureApiVersion')">
            <AppInput
              :model-value="settingsStore.settings.api.providerSpecific.azure_openai.apiVersion"
              @update:model-value="
                settingsStore.setSetting('api.providerSpecific.azure_openai.apiVersion', String($event))
              "
            />
          </AppFormItem>
          <AppFormItem :label="t('apiConnections.azureModel')">
            <AppInput
              :model-value="settingsStore.settings.api.selectedProviderModels.azure_openai"
              placeholder="This is the model name inside your deployment"
              @update:model-value="settingsStore.setSetting('api.selectedProviderModels.azure_openai', String($event))"
            />
          </AppFormItem>
        </div>

        <!-- TODO: Add forms for other sources -->

        <!-- Tokenizer Selection -->
        <AppFormItem :label="t('apiConnections.tokenizer')">
          <AppSelect
            :model-value="settingsStore.settings.api.tokenizer"
            :options="tokenizerOptions"
            @update:model-value="settingsStore.settings.api.tokenizer = $event as any"
          />
        </AppFormItem>

        <div class="api-connections-drawer-section">
          <div class="api-connections-drawer-actions">
            <AppButton
              :loading="apiStore.isConnecting"
              :disabled="apiStore.isConnecting"
              @click.prevent="apiStore.connect"
            >
              {{ apiStore.isConnecting ? t('apiConnections.connecting') : t('apiConnections.connect') }}
            </AppButton>
          </div>
          <div class="online_status">
            <div
              class="online_status_indicator"
              :class="{ success: apiStore.onlineStatus === 'Valid' || apiStore.onlineStatus.includes('bypassed') }"
            ></div>
            <div class="online_status_text">{{ apiStore.onlineStatus }}</div>
          </div>
        </div>
      </div>
    </div>
    <ConnectionProfilePopup
      :visible="isProfilePopupVisible"
      @close="isProfilePopupVisible = false"
      @save="handleProfileSave"
    />
  </div>
</template>
