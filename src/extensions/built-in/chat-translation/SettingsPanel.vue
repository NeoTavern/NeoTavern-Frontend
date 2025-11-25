<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { Button, FormItem, Input, Select, Textarea } from '../../../components/UI';
import { useStrictI18n } from '../../../composables/useStrictI18n';
import type { ExtensionAPI } from '../../../types';
import { AutoTranslateMode, type ChatTranslationSettings, DEFAULT_PROMPT } from './types';

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
    <FormItem
      :label="t('extensionsBuiltin.chatTranslation.connectionProfile')"
      :description="t('extensionsBuiltin.chatTranslation.connectionProfileHint')"
    >
      <ConnectionProfileSelector v-model="settings.connectionProfile" />
    </FormItem>

    <div class="setting-row">
      <div style="flex: 1">
        <FormItem :label="t('extensionsBuiltin.chatTranslation.sourceLang')">
          <Input v-model="settings.sourceLang" />
        </FormItem>
      </div>
      <div style="flex: 1">
        <FormItem :label="t('extensionsBuiltin.chatTranslation.targetLang')">
          <Input v-model="settings.targetLang" />
        </FormItem>
      </div>
    </div>

    <FormItem :label="t('extensionsBuiltin.chatTranslation.autoMode.label')">
      <Select v-model="settings.autoMode" :options="autoModeOptions" />
    </FormItem>

    <FormItem :description="t('extensionsBuiltin.chatTranslation.promptHint')">
      <template #default>
        <div class="header-row">
          <div class="form-item-label">{{ t('extensionsBuiltin.chatTranslation.promptTemplate') }}</div>
          <Button icon="fa-rotate-left" @click="resetPrompt">
            {{ t('common.reset') }}
          </Button>
        </div>
        <Textarea v-model="settings.prompt" class="prompt-area" :rows="10" />
      </template>
    </FormItem>
  </div>
</template>

<style scoped>
.translation-settings {
  display: flex;
  flex-direction: column;
  padding: 10px;
}

.setting-row {
  display: flex;
  gap: 8px;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.prompt-area {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}
</style>
