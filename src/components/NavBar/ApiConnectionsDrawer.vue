<script setup lang="ts">
import { computed, ref } from 'vue';
import { apiConnectionDefinition } from '../../api-connection-definition';
import { buildChatCompletionPayload, ChatCompletionService } from '../../api/generation';
import { useModelCapabilities } from '../../composables/useModelCapabilities';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { CustomPromptPostProcessing, TokenizerType } from '../../constants';
import { useApiStore } from '../../stores/api.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSecretStore } from '../../stores/secret.store';
import { useSettingsStore } from '../../stores/settings.store';
import { type AiConfigCondition, api_providers, type ConnectionProfile, POPUP_RESULT, POPUP_TYPE } from '../../types';
import { uuidv4 } from '../../utils/commons';
import AiConfigItemRenderer from '../AiConfig/AiConfigItemRenderer.vue';
import ApiFormattingPanel from '../AiConfig/ApiFormattingPanel.vue';
import { ConnectionProfileSelector, PresetControl } from '../common';
import { Button, CollapsibleSection, FormItem, Input, Select } from '../UI';
import ConnectionProfilePopup from './ConnectionProfilePopup.vue';

const { t } = useStrictI18n();
const { capabilities } = useModelCapabilities();

const apiStore = useApiStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const secretStore = useSecretStore();

const isProfilePopupVisible = ref(false);
const provider = computed(() => settingsStore.settings.api.provider);
const formatter = computed(() => settingsStore.settings.api.formatter);

function handleProfileSave(profile: Omit<ConnectionProfile, 'id'>) {
  apiStore.createConnectionProfile(profile);
}

function checkConditions(conditions?: AiConfigCondition | AiConfigCondition[]): boolean {
  if (!conditions) return true;
  const conditionsList = Array.isArray(conditions) ? conditions : [conditions];

  // OR Logic: If ANY condition object in the list matches, return true.
  return conditionsList.some((cond) => {
    // AND Logic within object
    const { provider, formatter } = cond;

    if (provider) {
      const providers = Array.isArray(provider) ? provider : [provider];
      const current = settingsStore.settings.api.provider;
      if (!current || !providers.includes(current)) return false;
    }

    if (formatter) {
      const formatters = Array.isArray(formatter) ? formatter : [formatter];
      const current = settingsStore.settings.api.formatter;
      if (!current || !formatters.includes(current)) return false;
    }

    return true;
  });
}

const visibleSections = computed(() => {
  return apiConnectionDefinition.filter((section) => checkConditions(section.conditions));
});

// Tokenizer Options
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

// Provider Options
const providerOptions = computed(() => [
  {
    label: '',
    options: [{ label: t('apiConnections.providers.custom'), value: api_providers.CUSTOM }],
  },
  {
    label: '',
    options: [
      { label: t('apiConnections.providers.ai21'), value: api_providers.AI21 },
      { label: t('apiConnections.providers.aimlapi'), value: api_providers.AIMLAPI },
      { label: t('apiConnections.providers.azure_openai'), value: api_providers.AZURE_OPENAI },
      { label: t('apiConnections.providers.claude'), value: api_providers.CLAUDE },
      { label: t('apiConnections.providers.cohere'), value: api_providers.COHERE },
      { label: t('apiConnections.providers.deepseek'), value: api_providers.DEEPSEEK },
      { label: t('apiConnections.providers.electronhub'), value: api_providers.ELECTRONHUB },
      { label: t('apiConnections.providers.fireworks'), value: api_providers.FIREWORKS },
      { label: t('apiConnections.providers.groq'), value: api_providers.GROQ },
      { label: t('apiConnections.providers.makersuite'), value: api_providers.MAKERSUITE },
      { label: t('apiConnections.providers.vertexai'), value: api_providers.VERTEXAI },
      { label: t('apiConnections.providers.mistralai'), value: api_providers.MISTRALAI },
      { label: t('apiConnections.providers.moonshot'), value: api_providers.MOONSHOT },
      { label: t('apiConnections.providers.nanogpt'), value: api_providers.NANOGPT },
      { label: t('apiConnections.providers.ollama'), value: api_providers.OLLAMA },
      { label: t('apiConnections.providers.openai'), value: api_providers.OPENAI },
      { label: t('apiConnections.providers.openrouter'), value: api_providers.OPENROUTER },
      { label: t('apiConnections.providers.perplexity'), value: api_providers.PERPLEXITY },
      { label: t('apiConnections.providers.pollinations'), value: api_providers.POLLINATIONS },
      { label: t('apiConnections.providers.xai'), value: api_providers.XAI },
      { label: t('apiConnections.providers.zai'), value: api_providers.ZAI },
      { label: t('apiConnections.providers.koboldcpp'), value: api_providers.KOBOLDCPP },
    ],
  },
]);

const postProcessingOptions = computed(() => [
  { label: t('apiConnections.postProcessing.prompts.none'), value: CustomPromptPostProcessing.NONE },
  {
    label: t('apiConnections.postProcessing.withTools'),
    options: [
      { label: t('apiConnections.postProcessing.prompts.merge_tools'), value: CustomPromptPostProcessing.MERGE_TOOLS },
      { label: t('apiConnections.postProcessing.prompts.semi_tools'), value: CustomPromptPostProcessing.SEMI_TOOLS },
      {
        label: t('apiConnections.postProcessing.prompts.strict_tools'),
        value: CustomPromptPostProcessing.STRICT_TOOLS,
      },
    ],
  },
  {
    label: t('apiConnections.postProcessing.noTools'),
    options: [
      { label: t('apiConnections.postProcessing.prompts.merge'), value: CustomPromptPostProcessing.MERGE },
      { label: t('apiConnections.postProcessing.prompts.semi'), value: CustomPromptPostProcessing.SEMI },
      { label: t('apiConnections.postProcessing.prompts.strict'), value: CustomPromptPostProcessing.STRICT },
      { label: t('apiConnections.postProcessing.prompts.single'), value: CustomPromptPostProcessing.SINGLE },
    ],
  },
]);

const proxies = computed(() =>
  (settingsStore.settings.proxies ?? []).map((proxy) => ({ label: proxy.name, value: proxy.id })),
);

const hasPendingSecrets = computed(() => Object.keys(secretStore.pendingSecrets).length > 0);

const isTestingMessage = ref(false);

async function testMessage() {
  if (isTestingMessage.value) return;

  isTestingMessage.value = true;

  try {
    // Process any pending secrets before sending test message
    await apiStore.processPendingSecrets();

    const testMessages = [{ role: 'user' as const, content: 'Hello', name: 'user' }];

    const payload = buildChatCompletionPayload({
      messages: testMessages,
      model: apiStore.activeModel || '',
      provider: settingsStore.settings.api.provider,
      samplerSettings: {
        ...JSON.parse(JSON.stringify(settingsStore.settings.api.samplers)),
        max_tokens: 50,
        max_context: 200,
        stream: false,
      },
      providerSpecific: settingsStore.settings.api.providerSpecific,
      customPromptPostProcessing: CustomPromptPostProcessing.NONE,
      proxy: settingsStore.settings.api.proxy,
      formatter: settingsStore.settings.api.formatter,
      instructTemplate: apiStore.instructTemplates.find(
        (t) => t.name === settingsStore.settings.api.instructTemplateName,
      ),
      playerName: 'User',
      modelList: apiStore.modelList,
    });

    const response = await ChatCompletionService.generate(payload, settingsStore.settings.api.formatter);

    if (Symbol.asyncIterator in response) {
      toast.error(t('apiConnections.testMessage.unexpectedStream'));
      return;
    }

    toast.success(t('apiConnections.testMessage.success', { response: response.content }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    toast.error(t('apiConnections.testMessage.failed', { error: errorMessage }));
    console.error('Test message failed:', error);
  } finally {
    isTestingMessage.value = false;
  }
}
</script>

<template>
  <div class="api-connections-drawer">
    <div class="api-connections-drawer-wrapper">
      <div class="api-connections-drawer-section">
        <h3>{{ t('apiConnections.profile') }}</h3>
        <PresetControl
          allow-create
          allow-edit
          allow-delete
          allow-import
          allow-export
          :create-title="'apiConnections.profileManagement.create'"
          :edit-title="'apiConnections.profileManagement.rename'"
          :delete-title="'apiConnections.profileManagement.delete'"
          :import-title="'apiConnections.profileManagement.import'"
          :export-title="'apiConnections.profileManagement.export'"
          @create="isProfilePopupVisible = true"
          @edit="apiStore.renameConnectionProfile"
          @delete="apiStore.deleteConnectionProfile"
          @import="apiStore.importConnectionProfiles"
          @export="apiStore.exportConnectionProfile"
        >
          <template #selector>
            <ConnectionProfileSelector v-model="apiStore.selectedConnectionProfileName" />
          </template>
        </PresetControl>
      </div>

      <hr />

      <div class="api-connections-drawer-section">
        <FormItem :label="t('apiConnections.provider')">
          <Select v-model="settingsStore.settings.api.provider" :options="providerOptions" searchable />
        </FormItem>
      </div>

      <!-- Data-Driven Provider Forms -->
      <template v-for="section in visibleSections" :key="section.id">
        <div class="api-connections-drawer-section">
          <template v-for="item in section.items" :key="item.id || item.label">
            <AiConfigItemRenderer
              :item="item"
              :provider="provider"
              :formatter="formatter"
              :capabilities="capabilities"
            />
            <div
              v-if="['openai', 'claude', 'openrouter'].includes(section.id) && item.widget === 'key-manager'"
              class="neutral_warning"
            >
              {{ t('apiConnections.keyPrivacy') }}
            </div>
          </template>
        </div>
      </template>

      <div class="api-connections-drawer-section">
        <ApiFormattingPanel />
      </div>

      <!-- Tokenizer Selection -->
      <FormItem :label="t('apiConnections.tokenizer')">
        <Select v-model="settingsStore.settings.api.tokenizer" :options="tokenizerOptions" />
      </FormItem>

      <!-- Proxy form for custom provider -->
      <CollapsibleSection
        v-show="settingsStore.settings.api.provider === 'custom'"
        :title="t('apiConnections.customProxy.title')"
      >
        <PresetControl
          v-model="settingsStore.settings.api.proxy.id"
          :options="proxies || []"
          allow-create
          allow-delete
          allow-save
          allow-edit
          :create-title="'apiConnections.customProxy.createProfile'"
          :delete-title="'apiConnections.customProxy.deleteProfile'"
          :save-title="'apiConnections.customProxy.saveProfile'"
          :edit-title="'apiConnections.customProxy.renameProfile'"
          @create="
            () => {
              const newProxyId = uuidv4();
              settingsStore.settings.proxies.push({
                id: newProxyId,
                name: 'New Proxy',
                url: '',
                password: '',
              });
              settingsStore.settings.api.proxy.id = newProxyId;
              settingsStore.settings.api.proxy.url = '';
              settingsStore.settings.api.proxy.password = '';
            }
          "
          @delete="
            async () => {
              const index = settingsStore.settings.proxies.findIndex(
                (p) => p.id === settingsStore.settings.api.proxy.id,
              );
              if (index !== -1) {
                const { result } = await popupStore.show({
                  title: t('apiConnections.customProxy.deleteProfileTitle'),
                  content: t('apiConnections.customProxy.deleteProfileContent', {
                    name: settingsStore.settings.proxies[index].name,
                  }),
                  type: POPUP_TYPE.CONFIRM,
                });
                if (result === POPUP_RESULT.AFFIRMATIVE) {
                  settingsStore.settings.proxies.splice(index, 1);
                  if (settingsStore.settings.api.proxy.id === settingsStore.settings.proxies[index]?.id) {
                    settingsStore.settings.api.proxy.id = '';
                  }
                }
              }
            }
          "
          @save="
            () => {
              const proxy = settingsStore.settings.proxies.find((p) => p.id === settingsStore.settings.api.proxy.id);
              if (proxy) {
                proxy.url = settingsStore.settings.api.proxy.url;
                proxy.password = settingsStore.settings.api.proxy.password;
              }
            }
          "
          @edit="
            async () => {
              const proxy = settingsStore.settings.proxies.find((p) => p.id === settingsStore.settings.api.proxy.id);
              if (proxy) {
                const { result, value: newName } = await popupStore.show<string>({
                  title: t('apiConnections.customProxy.renameProfile'),
                  type: POPUP_TYPE.INPUT,
                  inputValue: proxy.name,
                });

                if (result === POPUP_RESULT.AFFIRMATIVE && newName && newName.trim() && newName !== proxy.name) {
                  try {
                    proxy.name = newName.trim();
                  } catch (error) {
                    toast.error('Failed to rename preset.');
                    console.error(error);
                  }
                }
              }
            }
          "
        />
        <FormItem :label="t('apiConnections.customProxy.url')">
          <Input
            v-model="settingsStore.settings.api.proxy.url"
            :placeholder="t('apiConnections.customProxy.urlPlaceholder')"
          />
        </FormItem>
        <FormItem :label="t('apiConnections.customProxy.password')">
          <Input
            v-model="settingsStore.settings.api.proxy.password"
            type="password"
            :placeholder="t('apiConnections.customProxy.passwordPlaceholder')"
          />
        </FormItem>
      </CollapsibleSection>

      <div class="api-connections-drawer-section">
        <FormItem
          :label="t('apiConnections.postProcessing.label')"
          :description="t('apiConnections.postProcessing.description')"
        >
          <div id="custom_prompt_post_processing">
            <Select
              v-model="settingsStore.settings.api.customPromptPostProcessing"
              :options="postProcessingOptions"
              :title="t('apiConnections.postProcessing.tooltip')"
            />
          </div>
        </FormItem>

        <div v-if="hasPendingSecrets" class="neutral_warning">
          {{ t('apiConnections.pendingSecretsNote') }}
        </div>

        <div class="api-connections-drawer-actions">
          <Button :loading="isTestingMessage" :disabled="isTestingMessage" @click.prevent="testMessage">
            {{ isTestingMessage ? t('apiConnections.testMessage.testing') : t('apiConnections.testMessage.label') }}
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
    <ConnectionProfilePopup
      :visible="isProfilePopupVisible"
      @close="isProfilePopupVisible = false"
      @save="handleProfileSave"
    />
  </div>
</template>
