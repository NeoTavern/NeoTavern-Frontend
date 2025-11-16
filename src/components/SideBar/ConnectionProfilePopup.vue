<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useApiStore } from '../../stores/api.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import type { ConnectionProfile } from '../../types';
import { toast } from '../../composables/useToast';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'save']);

const { t } = useStrictI18n();
const apiStore = useApiStore();
const settingsStore = useSettingsStore();

const dialog = ref<HTMLDialogElement | null>(null);
const profileName = ref('New Profile');

const includeApi = ref(true);
const includeSource = ref(true);
const includeModel = ref(true);
const includeSampler = ref(true);

const currentApi = computed(() => settingsStore.settings.api.main);
const currentSource = computed(() => settingsStore.settings.api.chat_completion_source);
const currentModel = computed(() => apiStore.activeModel);
const currentSampler = computed(() => settingsStore.settings.api.selected_sampler);

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      profileName.value = 'New Profile';
      includeApi.value = true;
      includeSource.value = true;
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

  if (includeApi.value) profile.api = currentApi.value;
  if (includeSource.value) profile.chat_completion_source = currentSource.value;
  if (includeModel.value) profile.model = currentModel.value;
  if (includeSampler.value) profile.sampler = currentSampler.value;

  emit('save', profile);
  close();
}
</script>

<template>
  <dialog ref="dialog" class="popup" @cancel="close">
    <div class="popup-body">
      <h3>{{ t('apiConnections.profileManagement.createPopupTitle') }}</h3>

      <div class="connection-profile-form">
        <div class="form-group">
          <label for="profileName">{{ t('apiConnections.profileManagement.profileName') }}</label>
          <input id="profileName" type="text" class="text-pole" v-model="profileName" />
        </div>

        <h4>{{ t('apiConnections.profileManagement.fieldsToInclude') }}</h4>

        <div class="fields-grid">
          <label class="checkbox-label field-item">
            <input type="checkbox" v-model="includeApi" />
            <span>{{ t('apiConnections.api') }}</span>
          </label>
          <div class="field-value">{{ currentApi }}</div>

          <label class="checkbox-label field-item">
            <input type="checkbox" v-model="includeSource" />
            <span>{{ t('apiConnections.source') }}</span>
          </label>
          <div class="field-value">{{ currentSource }}</div>

          <label class="checkbox-label field-item">
            <input type="checkbox" v-model="includeModel" />
            <span>{{
              currentSource === 'openrouter'
                ? t('apiConnections.openrouterModel')
                : currentSource === 'claude'
                  ? t('apiConnections.claudeModel')
                  : t('apiConnections.openaiModel')
            }}</span>
          </label>
          <div class="field-value">{{ currentModel }}</div>

          <label class="checkbox-label field-item">
            <input type="checkbox" v-model="includeSampler" />
            <span>{{ t('aiConfig.presets.chatCompletion.label') }}</span>
          </label>
          <div class="field-value">{{ currentSampler }}</div>
        </div>
      </div>

      <div class="popup-controls">
        <button class="menu-button" @click="save">{{ t('common.save') }}</button>
        <button class="menu-button" @click="close">{{ t('common.cancel') }}</button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.connection-profile-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.fields-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px 15px;
}
.field-item {
  font-weight: bold;
}
.field-value {
  background: var(--black-30a);
  padding: 5px;
  border-radius: 5px;
  font-family: var(--font-family-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
