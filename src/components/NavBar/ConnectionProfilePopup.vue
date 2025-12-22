<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { PROVIDER_SECRET_KEYS } from '../../constants';
import { useApiStore } from '../../stores/api.store';
import { useSecretStore } from '../../stores/secret.store';
import { useSettingsStore } from '../../stores/settings.store';
import type { ConnectionProfile } from '../../types';
import { Button, Checkbox, Input } from '../UI';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'save']);

const { t } = useStrictI18n();
const apiStore = useApiStore();
const settingsStore = useSettingsStore();
const secretStore = useSecretStore();

const dialog = ref<HTMLDialogElement | null>(null);
const defaultProfileName = () => {
  const provider = settingsStore.settings.api.provider;
  const model = apiStore.activeModel;
  return `${provider} - ${model}`;
};

const includeProvider = ref(true);
const includeModel = ref(true);
const includeSampler = ref(true);
const includePostProcessing = ref(true);
const includeApiUrl = ref(false);
const includeSecretId = ref(false);

const currentProvider = computed(() => settingsStore.settings.api.provider);
const currentModel = computed(() => apiStore.activeModel);
const currentSampler = computed(() => settingsStore.settings.api.selectedSampler);
const currentPostProcessing = computed(() => settingsStore.settings.api.customPromptPostProcessing);
const currentApiUrl = computed(() => {
  const provider = currentProvider.value;
  if (provider === 'custom') {
    return settingsStore.settings.api.providerSpecific.custom.url;
  } else if (provider === 'koboldcpp') {
    return settingsStore.settings.api.providerSpecific.koboldcpp.url;
  } else if (provider === 'ollama') {
    return settingsStore.settings.api.providerSpecific.ollama.url;
  }
  return '';
});

const currentSecretKey = computed(() => {
  return PROVIDER_SECRET_KEYS[currentProvider.value] || null;
});

const currentSecret = computed(() => {
  if (!currentSecretKey.value) return null;
  const secrets = secretStore.secrets[currentSecretKey.value];
  if (!secrets) return null;
  return secrets.find((s) => s.active) || null;
});

const currentSecretId = computed(() => currentSecret.value?.id || '');
const currentSecretLabel = computed(() => currentSecret.value?.label || '');
const profileName = ref(defaultProfileName());

const modelLabel = computed(() => {
  const provider = currentProvider.value;
  switch (provider) {
    case 'openai':
      return t('apiConnections.openaiModel');
    case 'claude':
      return t('apiConnections.claudeModel');
    case 'openrouter':
      return t('apiConnections.openrouterModel');
    case 'mistralai':
      return t('apiConnections.mistralaiModel');
    case 'groq':
      return t('apiConnections.groqModel');
    case 'azure_openai':
      return t('apiConnections.azureModel');
    case 'custom':
    // Fallback for all other providers without a specific label to a generic "Model Name"
    case 'ai21':
    case 'makersuite':
    case 'vertexai':
    case 'cohere':
    case 'perplexity':
    case 'electronhub':
    case 'nanogpt':
    case 'deepseek':
    case 'aimlapi':
    case 'xai':
    case 'pollinations':
    case 'moonshot':
    case 'fireworks':
    case 'cometapi':
    case 'zai':
    default:
      return t('apiConnections.customModel');
  }
});

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      profileName.value = defaultProfileName();
      includeProvider.value = true;
      includeModel.value = true;
      includeSampler.value = true;
      includePostProcessing.value = true;
      includeApiUrl.value = false;
      includeSecretId.value = false;
      dialog.value?.showModal();
    } else {
      dialog.value?.close();
    }
  },
);

function close() {
  emit('close');
}

function save() {
  const trimmedName = profileName.value.trim();
  if (!trimmedName) {
    toast.error('Profile name cannot be empty.');
    return;
  }

  const profile: Partial<Omit<ConnectionProfile, 'id'>> & { name: string } = {
    name: trimmedName,
  };

  if (includeProvider.value) profile.provider = currentProvider.value;
  if (includeModel.value) profile.model = currentModel.value;
  if (includeSampler.value) profile.sampler = currentSampler.value;
  if (includePostProcessing.value) profile.customPromptPostProcessing = currentPostProcessing.value;
  if (includeApiUrl.value) profile.apiUrl = currentApiUrl.value;
  if (includeSecretId.value && currentSecretId.value) profile.secretId = currentSecretId.value;

  emit('save', profile);
  close();
}
</script>

<template>
  <dialog id="connection-profile-popup" ref="dialog" class="popup" @cancel="close">
    <div class="popup-body">
      <h3>{{ t('apiConnections.profileManagement.createPopupTitle') }}</h3>

      <div class="connection-profile-form">
        <div class="form-group">
          <Input v-model="profileName" :label="t('apiConnections.profileManagement.profileName')" class="text-pole" />
        </div>

        <h4>{{ t('apiConnections.profileManagement.fieldsToInclude') }}</h4>

        <div class="fields-grid">
          <Checkbox v-model="includeProvider" :label="t('apiConnections.provider')" />
          <div class="field-value">{{ currentProvider }}</div>

          <Checkbox v-model="includeModel" :label="modelLabel" />
          <div class="field-value">{{ currentModel }}</div>

          <Checkbox v-model="includeSampler" :label="t('aiConfig.presets.sampler.label')" />
          <div class="field-value">{{ currentSampler }}</div>

          <Checkbox v-model="includePostProcessing" :label="t('apiConnections.postProcessing.label')" />
          <div class="field-value">{{ currentPostProcessing || t('apiConnections.postProcessing.prompts.none') }}</div>

          <template v-if="currentApiUrl">
            <Checkbox v-model="includeApiUrl" :label="t('apiConnections.apiUrl')" />
            <div class="field-value">{{ currentApiUrl }}</div>
          </template>

          <template v-if="currentSecret">
            <Checkbox v-model="includeSecretId" :label="t('apiConnections.secretId')" />
            <div class="field-value">{{ currentSecretLabel }}</div>
          </template>
        </div>
      </div>

      <div class="popup-controls">
        <Button variant="confirm" @click="save">{{ t('common.save') }}</Button>
        <Button @click="close">{{ t('common.cancel') }}</Button>
      </div>
    </div>
  </dialog>
</template>
