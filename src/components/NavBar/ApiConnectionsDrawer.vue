<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { apiConnectionDefinition } from '../../api-connection-definition';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { TokenizerType } from '../../constants';
import { useApiStore } from '../../stores/api.store';
import { useSettingsStore } from '../../stores/settings.store';
import {
  chat_completion_sources,
  type AiConfigCondition,
  type AiConfigItem,
  type ConnectionProfile,
} from '../../types';
import { ConnectionProfileSelector } from '../Common';
import { Button, Checkbox, FormItem, Input, Select } from '../UI';
import ConnectionProfilePopup from './ConnectionProfilePopup.vue';

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

function checkConditions(conditions?: AiConfigCondition): boolean {
  if (!conditions) return true;

  if (conditions.api) {
    const apis = Array.isArray(conditions.api) ? conditions.api : [conditions.api];
    if (!apis.includes(settingsStore.settings.api.main)) return false;
  }
  if (conditions.source) {
    const sources = Array.isArray(conditions.source) ? conditions.source : [conditions.source];
    if (
      !settingsStore.settings.api.chatCompletionSource ||
      !sources.includes(settingsStore.settings.api.chatCompletionSource)
    )
      return false;
  }
  return true;
}

const visibleSections = computed(() => {
  return apiConnectionDefinition.filter((section) => checkConditions(section.conditions));
});

function getVisibleItems(section: (typeof apiConnectionDefinition)[0]) {
  return section.items.filter((item) => checkConditions(item.conditions));
}

// Special computed for array-based settings (e.g. OpenRouter providers)
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

function getModelValue(item: AiConfigItem) {
  if (item.id === 'api.providerSpecific.openrouter.providers') {
    return openrouterProvidersString.value;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return item.id ? settingsStore.getSetting(item.id) : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setModelValue(item: AiConfigItem, value: any) {
  if (item.id === 'api.providerSpecific.openrouter.providers') {
    openrouterProvidersString.value = String(value);
    return;
  }
  if (item.id) {
    settingsStore.setSetting(item.id, value);
  }
}

const mainApiOptions = computed(() => [
  { label: t('apiConnections.chatCompletion'), value: 'openai' },
  { label: t('apiConnections.textCompletion'), value: 'textgenerationwebui', disabled: true },
  { label: t('apiConnections.novel'), value: 'novel', disabled: true },
  { label: t('apiConnections.horde'), value: 'koboldhorde', disabled: true },
  { label: t('apiConnections.kobold'), value: 'kobold', disabled: true },
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

// Helper to convert definitions options to component compatible options
function resolveOptions(item: AiConfigItem) {
  return (
    item.options?.map((opt) => ({
      // @ts-expect-error dynamic label
      label: opt.label.startsWith('apiConnections') ? t(opt.label) : opt.label,
      value: opt.value,
    })) || []
  );
}

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
          <Button
            variant="ghost"
            icon="fa-file-circle-plus"
            :title="t('apiConnections.profileManagement.create')"
            @click="isProfilePopupVisible = true"
          />
          <Button
            variant="ghost"
            icon="fa-pencil"
            :title="t('apiConnections.profileManagement.rename')"
            @click="apiStore.renameConnectionProfile"
          />
          <Button
            variant="ghost"
            icon="fa-trash-can"
            :title="t('apiConnections.profileManagement.delete')"
            @click="apiStore.deleteConnectionProfile"
          />
          <Button
            variant="ghost"
            icon="fa-file-import"
            :title="t('apiConnections.profileManagement.import')"
            @click="apiStore.importConnectionProfiles"
          />
          <Button
            variant="ghost"
            icon="fa-file-export"
            :title="t('apiConnections.profileManagement.export')"
            @click="apiStore.exportConnectionProfile"
          />
        </div>
      </div>

      <hr />

      <div class="api-connections-drawer-section">
        <FormItem :label="t('apiConnections.api')">
          <Select v-model="settingsStore.settings.api.main" :options="mainApiOptions" />
        </FormItem>
      </div>

      <div v-show="settingsStore.settings.api.main === 'openai'">
        <div class="api-connections-drawer-section">
          <FormItem :label="t('apiConnections.source')">
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
          </FormItem>
        </div>

        <!-- Data-Driven Provider Forms -->
        <template v-for="section in visibleSections" :key="section.id">
          <div class="api-connections-drawer-section">
            <template v-for="item in getVisibleItems(section)" :key="item.id || item.label">
              <!-- Key Manager -->
              <FormItem v-if="item.widget === 'key-manager'" :label="item.label ? t(item.label) : ''">
                <div class="api-connections-drawer-input-group">
                  <Button icon="fa-key" :title="t('apiConnections.manageKeys')" />
                </div>
                <!-- Warning only for direct keys -->
                <div v-if="['openai', 'claude', 'openrouter'].includes(section.id)" class="neutral_warning">
                  {{ t('apiConnections.keyPrivacy') }}
                </div>
              </FormItem>

              <!-- Model Select -->
              <FormItem v-else-if="item.widget === 'model-select'" :label="item.label ? t(item.label) : ''">
                <!-- OpenAI Specific Grouped Select -->
                <select
                  v-if="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.OPENAI"
                  class="text-pole"
                  :value="getModelValue(item)"
                  @change="setModelValue(item, ($event.target as HTMLSelectElement).value)"
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

                <!-- OpenRouter Specific Grouped Select -->
                <template
                  v-else-if="settingsStore.settings.api.chatCompletionSource === chat_completion_sources.OPENROUTER"
                >
                  <select
                    v-show="hasOpenRouterGroupedModels"
                    class="text-pole"
                    :value="getModelValue(item)"
                    @change="setModelValue(item, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="OR_Website">{{ t('apiConnections.openrouterWebsite') }}</option>
                    <optgroup
                      v-for="(models, vendor) in apiStore.groupedOpenRouterModels"
                      :key="vendor"
                      :label="vendor"
                    >
                      <option v-for="model in models" :key="model.id" :value="model.id">{{ model.name }}</option>
                    </optgroup>
                  </select>
                  <Input
                    v-show="!hasOpenRouterGroupedModels"
                    :model-value="getModelValue(item) as string"
                    :placeholder="item.placeholder"
                    @update:model-value="setModelValue(item, String($event))"
                  />
                </template>

                <!-- Fallback to simple select if simple list exists, or text input? Actually model-select implies complexity.
                     For now only OpenAI and OpenRouter use 'model-select'. Others use 'select' or 'text-input' -->
              </FormItem>

              <!-- Standard Select -->
              <FormItem v-else-if="item.widget === 'select'" :label="item.label ? t(item.label) : ''">
                <Select
                  :model-value="getModelValue(item) as string"
                  :options="resolveOptions(item)"
                  @update:model-value="setModelValue(item, $event)"
                />
              </FormItem>

              <!-- Text Input -->
              <FormItem v-else-if="item.widget === 'text-input'" :label="item.label ? t(item.label) : ''">
                <Input
                  :model-value="getModelValue(item) as string"
                  :placeholder="item.placeholder"
                  @update:model-value="setModelValue(item, String($event))"
                />
              </FormItem>

              <!-- Checkbox -->
              <div v-else-if="item.widget === 'checkbox'">
                <Checkbox
                  :model-value="Boolean(getModelValue(item))"
                  :label="item.label ? t(item.label) : ''"
                  @update:model-value="setModelValue(item, $event)"
                />
              </div>

              <!-- Header -->
              <h4 v-else-if="item.widget === 'header'">{{ item.label ? t(item.label) : '' }}</h4>
            </template>
          </div>
        </template>

        <!-- Tokenizer Selection -->
        <FormItem :label="t('apiConnections.tokenizer')">
          <Select v-model="settingsStore.settings.api.tokenizer" :options="tokenizerOptions" />
        </FormItem>

        <div class="api-connections-drawer-section">
          <div class="api-connections-drawer-actions">
            <Button
              :loading="apiStore.isConnecting"
              :disabled="apiStore.isConnecting"
              @click.prevent="apiStore.connect"
            >
              {{ apiStore.isConnecting ? t('apiConnections.connecting') : t('apiConnections.connect') }}
            </Button>
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
