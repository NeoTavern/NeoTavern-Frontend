<!-- TODO: Convert to ConnectionProfile and use with popup.show({component: ConnectionProfile}) -->

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { useApiStore } from '../../stores/api.store';
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

const dialog = ref<HTMLDialogElement | null>(null);
const profileName = ref('New Profile');

const includeProvider = ref(true);
const includeModel = ref(true);
const includeSampler = ref(true);

const currentProvider = computed(() => settingsStore.settings.api.provider);
const currentModel = computed(() => apiStore.activeModel);
const currentSampler = computed(() => settingsStore.settings.api.selectedSampler);

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
      profileName.value = 'New Profile';
      includeProvider.value = true;
      includeModel.value = true;
      includeSampler.value = true;
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
        </div>
      </div>

      <div class="popup-controls">
        <Button variant="confirm" @click="save">{{ t('common.save') }}</Button>
        <Button @click="close">{{ t('common.cancel') }}</Button>
      </div>
    </div>
  </dialog>
</template>
