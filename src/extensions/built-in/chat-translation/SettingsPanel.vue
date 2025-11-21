<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import type { ExtensionAPI } from '@/types';
import { AutoTranslateMode, type ChatTranslationSettings, DEFAULT_PROMPT } from './types';
import ConnectionProfileSelector from '@/components/Common/ConnectionProfileSelector.vue';
import { AppInput, AppSelect, AppTextarea, AppButton } from '@/components/UI';
import { useStrictI18n } from '@/composables/useStrictI18n';

const props = defineProps<{
  api: ExtensionAPI;
}>();

const { t } = useStrictI18n();

const settings = ref<ChatTranslationSettings>({
  connectionProfile: undefined,
  sourceLang: 'Auto',
  targetLang: 'English',
  autoMode: AutoTranslateMode.NONE,
  prompt: DEFAULT_PROMPT,
});

const autoModeOptions = computed(() => [
  { label: t('extensionsBuiltin.chatTranslation.autoMode.none'), value: AutoTranslateMode.NONE },
  { label: t('extensionsBuiltin.chatTranslation.autoMode.responses'), value: AutoTranslateMode.RESPONSES },
  { label: t('extensionsBuiltin.chatTranslation.autoMode.inputs'), value: AutoTranslateMode.INPUTS },
  { label: t('extensionsBuiltin.chatTranslation.autoMode.both'), value: AutoTranslateMode.BOTH },
]);

onMounted(() => {
  const saved = props.api.settings.get();
  if (saved) {
    settings.value = { ...settings.value, ...saved };
  }
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    props.api.settings.save();
  },
  { deep: true },
);

function resetPrompt() {
  settings.value.prompt = DEFAULT_PROMPT;
}
</script>

<template>
  <div class="translation-settings">
    <div class="setting-item">
      <label>{{ t('extensionsBuiltin.chatTranslation.connectionProfile') }}</label>
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
      <small>{{ t('extensionsBuiltin.chatTranslation.connectionProfileHint') }}</small>
    </div>

    <div class="setting-row">
      <div class="setting-item">
        <AppInput v-model="settings.sourceLang" :label="t('extensionsBuiltin.chatTranslation.sourceLang')" />
      </div>
      <div class="setting-item">
        <AppInput v-model="settings.targetLang" :label="t('extensionsBuiltin.chatTranslation.targetLang')" />
      </div>
    </div>

    <div class="setting-item">
      <AppSelect
        v-model="settings.autoMode"
        :label="t('extensionsBuiltin.chatTranslation.autoMode.label')"
        :options="autoModeOptions"
      />
    </div>

    <div class="setting-item">
      <div class="header-row">
        <label>{{ t('extensionsBuiltin.chatTranslation.promptTemplate') }}</label>
        <AppButton icon="fa-rotate-left" @click="resetPrompt">
          {{ t('common.reset') }}
        </AppButton>
      </div>
      <AppTextarea v-model="settings.prompt" class="prompt-area" :rows="10" />
      <small>{{ t('extensionsBuiltin.chatTranslation.promptHint') }}</small>
    </div>
  </div>
</template>

<style scoped>
.translation-settings {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 10px;
}

.setting-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.setting-row {
  display: flex;
  gap: 10px;
}

.setting-row .setting-item {
  flex: 1;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.header-row label {
  font-weight: bold;
  font-size: 0.9em;
}

.prompt-area {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

label {
  font-weight: bold;
  opacity: 0.9;
}

small {
  opacity: 0.6;
  font-size: 0.85em;
}
</style>
