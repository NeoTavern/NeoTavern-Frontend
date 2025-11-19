<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useApiStore } from '../../stores/api.store';
import { chat_completion_sources, type ConnectionProfile } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import ConnectionProfilePopup from './ConnectionProfilePopup.vue';
import ConnectionProfileSelector from '../Common/ConnectionProfileSelector.vue';
import { OpenrouterMiddleoutType, TokenizerType } from '../../constants';

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
          <div
            class="menu-button-icon fa-solid fa-file-circle-plus"
            :title="t('apiConnections.profileManagement.create')"
            @click="isProfilePopupVisible = true"
          ></div>
          <div
            class="menu-button-icon fa-solid fa-pencil"
            :title="t('apiConnections.profileManagement.rename')"
            @click="apiStore.renameConnectionProfile"
          ></div>
          <div
            class="menu-button-icon fa-solid fa-trash-can"
            :title="t('apiConnections.profileManagement.delete')"
            @click="apiStore.deleteConnectionProfile"
          ></div>
          <div
            class="menu-button-icon fa-solid fa-file-import"
            :title="t('apiConnections.profileManagement.import')"
            @click="apiStore.importConnectionProfiles"
          ></div>
          <div
            class="menu-button-icon fa-solid fa-file-export"
            :title="t('apiConnections.profileManagement.export')"
            @click="apiStore.exportConnectionProfile"
          ></div>
        </div>
      </div>

      <hr />

      <div class="api-connections-drawer-section">
        <h3>{{ t('apiConnections.api') }}</h3>
        <select
          class="text-pole"
          :value="settingsStore.settings.api.main"
          @change="settingsStore.settings.api.main = ($event.target as HTMLSelectElement).value"
        >
          <option value="openai">{{ t('apiConnections.chatCompletion') }}</option>
          <option value="textgenerationwebui" disabled>{{ t('apiConnections.textCompletion') }}</option>
          <option value="novel" disabled>{{ t('apiConnections.novel') }}</option>
          <option value="koboldhorde" disabled>{{ t('apiConnections.horde') }}</option>
          <option value="kobold" disabled>{{ t('apiConnections.kobold') }}</option>
        </select>
      </div>

      <div v-show="settingsStore.settings.api.main === 'openai'">
        <div class="api-connections-drawer-section">
          <h4>{{ t('apiConnections.source') }}</h4>
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
              <option :value="chat_completion_sources.MAKERSUITE">{{ t('apiConnections.sources.makersuite') }}</option>
              <option :value="chat_completion_sources.VERTEXAI">{{ t('apiConnections.sources.vertexai') }}</option>
              <option :value="chat_completion_sources.MISTRALAI">{{ t('apiConnections.sources.mistralai') }}</option>
              <option :value="chat_completion_sources.MOONSHOT">{{ t('apiConnections.sources.moonshot') }}</option>
              <option :value="chat_completion_sources.NANOGPT">{{ t('apiConnections.sources.nanogpt') }}</option>
              <option :value="chat_completion_sources.OPENROUTER">{{ t('apiConnections.sources.openrouter') }}</option>
              <option :value="chat_completion_sources.PERPLEXITY">{{ t('apiConnections.sources.perplexity') }}</option>
              <option :value="chat_completion_sources.POLLINATIONS">
                {{ t('apiConnections.sources.pollinations') }}
              </option>
              <option :value="chat_completion_sources.XAI">{{ t('apiConnections.sources.xai') }}</option>
              <option :value="chat_completion_sources.ZAI">{{ t('apiConnections.sources.zai') }}</option>
            </optgroup>
          </select>
        </div>

        <!-- OpenAI Form -->
        <form v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.OPENAI">
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.openaiKey') }}</h4>
            <div class="api-connections-drawer-input-group">
              <!-- TODO: Add secret management -->
              <div class="menu-button fa-solid fa-key fa-fw" :title="t('apiConnections.manageKeys')"></div>
            </div>
            <div class="neutral_warning">
              {{ t('apiConnections.keyPrivacy') }}
            </div>
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.openaiModel') }}</h4>
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
          </div>
        </form>

        <!-- Claude Form -->
        <form v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.CLAUDE">
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.claudeKey') }}</h4>
            <div class="api-connections-drawer-input-group">
              <!-- TODO: Add secret management -->
              <div class="menu-button fa-solid fa-key fa-fw" :title="t('apiConnections.manageKeys')"></div>
            </div>
            <div class="neutral_warning">
              {{ t('apiConnections.keyPrivacy') }}
            </div>
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.claudeModel') }}</h4>
            <select
              class="text-pole"
              :value="settingsStore.settings.api.selectedProviderModels.claude"
              @change="
                settingsStore.setSetting(
                  'api.selectedProviderModels.claude',
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="claude-3-5-sonnet-20240620">claude-3-5-sonnet-20240620</option>
              <option value="claude-3-opus-20240229">claude-3-opus-20240229</option>
              <option value="claude-3-haiku-20240307">claude-3-haiku-20240307</option>
            </select>
          </div>
        </form>

        <!-- OpenRouter Form -->
        <div v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.OPENROUTER">
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.openrouterKey') }}</h4>
            <div class="api-connections-drawer-input-group">
              <!-- TODO: Add secret management -->
              <div class="menu-button fa-solid fa-key fa-fw" :title="t('apiConnections.manageKeys')"></div>
            </div>
            <div class="neutral_warning">
              {{ t('apiConnections.keyPrivacy') }}
            </div>
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.openrouterModel') }}</h4>
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
            <input
              v-show="!hasOpenRouterGroupedModels"
              type="text"
              class="text-pole"
              placeholder="google/gemini-pro-1.5"
              :value="settingsStore.settings.api.selectedProviderModels.openrouter"
              @input="
                settingsStore.setSetting(
                  'api.selectedProviderModels.openrouter',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.openrouterOptions') }}</h4>
            <label class="checkbox-label">
              <input
                type="checkbox"
                :checked="settingsStore.settings.api.providerSpecific.openrouter.useFallback"
                @change="
                  settingsStore.setSetting(
                    'api.providerSpecific.openrouter.useFallback',
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span>{{ t('apiConnections.openrouterUseFallback') }}</span>
            </label>
            <label class="checkbox-label">
              <input
                type="checkbox"
                :checked="settingsStore.settings.api.providerSpecific.openrouter.allowFallbacks"
                @change="
                  settingsStore.setSetting(
                    'api.providerSpecific.openrouter.allowFallbacks',
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span>{{ t('apiConnections.openrouterAllowFallbacks') }}</span>
            </label>
            <!-- TODO: Provider list -->
            <div class="range-block">
              <div class="range-block-title">{{ t('apiConnections.openrouterFallbackProviders') }}</div>
              <input v-model="openrouterProvidersString" type="text" class="text-pole" />
            </div>
            <div class="range-block">
              <div class="range-block-title">{{ t('apiConnections.openrouterMiddleout') }}</div>
              <select
                class="text-pole"
                :value="settingsStore.settings.api.providerSpecific.openrouter.middleout"
                @change="
                  settingsStore.setSetting(
                    'api.providerSpecific.openrouter.middleout',
                    ($event.target as HTMLSelectElement).value as any,
                  )
                "
              >
                <option :value="OpenrouterMiddleoutType.ON">{{ t('apiConnections.middleout.on') }}</option>
                <option :value="OpenrouterMiddleoutType.OFF">{{ t('apiConnections.middleout.off') }}</option>
                <option :value="OpenrouterMiddleoutType.AUTO">{{ t('apiConnections.middleout.auto') }}</option>
              </select>
            </div>
          </div>
        </div>

        <!-- MistralAI Form -->
        <form v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.MISTRALAI">
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.mistralaiKey') }}</h4>
            <div class="api-connections-drawer-input-group">
              <!-- TODO: Add secret management -->
              <div class="menu-button fa-solid fa-key fa-fw" :title="t('apiConnections.manageKeys')"></div>
            </div>
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.mistralaiModel') }}</h4>
            <select
              class="text-pole"
              :value="settingsStore.settings.api.selectedProviderModels.mistralai"
              @change="
                settingsStore.setSetting(
                  'api.selectedProviderModels.mistralai',
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="mistral-large-latest">mistral-large-latest</option>
              <option value="mistral-small-latest">mistral-small-latest</option>
            </select>
          </div>
        </form>

        <!-- Groq Form -->
        <form v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.GROQ">
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.groqKey') }}</h4>
            <div class="api-connections-drawer-input-group">
              <!-- TODO: Add secret management -->
              <div class="menu-button fa-solid fa-key fa-fw" :title="t('apiConnections.manageKeys')"></div>
            </div>
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.groqModel') }}</h4>
            <select
              class="text-pole"
              :value="settingsStore.settings.api.selectedProviderModels.groq"
              @change="
                settingsStore.settings.api.selectedProviderModels.groq = ($event.target as HTMLSelectElement).value
              "
            >
              <option value="llama3-70b-8192">llama3-70b-8192</option>
              <option value="llama3-8b-8192">llama3-8b-8192</option>
              <option value="gemma-7b-it">gemma-7b-it</option>
              <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
            </select>
          </div>
        </form>

        <!-- Custom Form -->
        <form v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.CUSTOM">
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.customUrl') }}</h4>
            <input
              type="text"
              class="text-pole"
              :value="settingsStore.settings.api.providerSpecific.custom.url"
              @input="
                settingsStore.settings.api.providerSpecific.custom.url = ($event.target as HTMLInputElement).value
              "
            />
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.customModel') }}</h4>
            <input
              type="text"
              class="text-pole"
              :value="settingsStore.settings.api.selectedProviderModels.custom"
              @input="
                settingsStore.settings.api.selectedProviderModels.custom = ($event.target as HTMLInputElement).value
              "
            />
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.customKey') }}</h4>
            <div class="api-connections-drawer-input-group">
              <!-- TODO: Add secret management -->
              <div class="menu-button fa-solid fa-key fa-fw" :title="t('apiConnections.manageKeys')"></div>
            </div>
          </div>
        </form>

        <!-- Azure OpenAI Form -->
        <form v-show="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.AZURE_OPENAI">
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.azureKey') }}</h4>
            <div class="api-connections-drawer-input-group">
              <!-- TODO: Add secret management -->
              <div class="menu-button fa-solid fa-key fa-fw" :title="t('apiConnections.manageKeys')"></div>
            </div>
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.azureBaseUrl') }}</h4>
            <input
              type="text"
              class="text-pole"
              :value="settingsStore.settings.api.providerSpecific.azure_openai.baseUrl"
              @input="
                settingsStore.setSetting(
                  'api.providerSpecific.azure_openai.baseUrl',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.azureDeploymentName') }}</h4>
            <input
              type="text"
              class="text-pole"
              :value="settingsStore.settings.api.providerSpecific.azure_openai.deploymentName"
              @input="
                settingsStore.setSetting(
                  'api.providerSpecific.azure_openai.deploymentName',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.azureApiVersion') }}</h4>
            <input
              type="text"
              class="text-pole"
              :value="settingsStore.settings.api.providerSpecific.azure_openai.apiVersion"
              @input="
                settingsStore.setSetting(
                  'api.providerSpecific.azure_openai.apiVersion',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
          <div class="api-connections-drawer-section">
            <h4>{{ t('apiConnections.azureModel') }}</h4>
            <input
              type="text"
              class="text-pole"
              placeholder="This is the model name inside your deployment"
              :value="settingsStore.settings.api.selectedProviderModels.azure_openai"
              @input="
                settingsStore.setSetting(
                  'api.selectedProviderModels.azure_openai',
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </div>
        </form>

        <!-- TODO: Add forms for other sources -->

        <!-- Tokenizer Selection -->
        <div class="api-connections-drawer-section">
          <h4>{{ t('apiConnections.tokenizer') }}</h4>
          <select
            class="text-pole"
            :value="settingsStore.settings.api.tokenizer"
            @change="settingsStore.settings.api.tokenizer = ($event.target as HTMLSelectElement).value as any"
          >
            <option :value="TokenizerType.AUTO">{{ t('apiConnections.tokenizers.auto') }}</option>
            <option :value="TokenizerType.NONE">{{ t('apiConnections.tokenizers.none') }}</option>
            <option :value="TokenizerType.GPT4O">{{ t('apiConnections.tokenizers.gpt4o') }}</option>
            <option :value="TokenizerType.GPT35">{{ t('apiConnections.tokenizers.gpt35') }}</option>
            <option :value="TokenizerType.GPT2">{{ t('apiConnections.tokenizers.gpt2') }}</option>
            <option :value="TokenizerType.GEMMA">{{ t('apiConnections.tokenizers.gemma') }}</option>
            <option :value="TokenizerType.DEEPSEEK">{{ t('apiConnections.tokenizers.deepseek') }}</option>
            <option :value="TokenizerType.LLAMA">{{ t('apiConnections.tokenizers.llama') }}</option>
            <option :value="TokenizerType.LLAMA3">{{ t('apiConnections.tokenizers.llama3') }}</option>
            <option :value="TokenizerType.MISTRAL">{{ t('apiConnections.tokenizers.mistral') }}</option>
            <option :value="TokenizerType.NEMO">{{ t('apiConnections.tokenizers.nemo') }}</option>
            <option :value="TokenizerType.CLAUDE">{{ t('apiConnections.tokenizers.claude') }}</option>
            <option :value="TokenizerType.JAMBA">{{ t('apiConnections.tokenizers.jamba') }}</option>
            <option :value="TokenizerType.COMMANDR">{{ t('apiConnections.tokenizers.commandr') }}</option>
            <option :value="TokenizerType.COMMANDA">{{ t('apiConnections.tokenizers.commanda') }}</option>
            <option :value="TokenizerType.QWEN2">{{ t('apiConnections.tokenizers.qwen2') }}</option>
            <option :value="TokenizerType.YI">{{ t('apiConnections.tokenizers.yi') }}</option>
          </select>
        </div>

        <div class="api-connections-drawer-section">
          <div class="api-connections-drawer-actions">
            <button
              class="menu-button"
              :disabled="apiStore.isConnecting"
              :class="{ disabled: apiStore.isConnecting }"
              @click.prevent="apiStore.connect"
            >
              <i v-show="apiStore.isConnecting" class="fa-solid fa-spinner fa-spin"></i>
              <span v-show="!apiStore.isConnecting">{{
                apiStore.isConnecting ? t('apiConnections.connecting') : t('apiConnections.connect')
              }}</span>
            </button>
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
