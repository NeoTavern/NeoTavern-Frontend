<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import PromptPresetField from '../PromptPresetField.vue';
import {
  AutoTranslateMode,
  BUILT_IN_PROMPT_PRESETS,
  type ChatTranslationSettings,
  DEFAULT_SETTINGS,
  migrateChatTranslationSettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI;
}>();

const t = props.api.i18n.t;

const settings = ref<ChatTranslationSettings>({ ...DEFAULT_SETTINGS });

const autoModeOptions = computed(() => [
  { label: t('extensionsBuiltin.chatTranslation.autoMode.none'), value: AutoTranslateMode.NONE },
  { label: t('extensionsBuiltin.chatTranslation.autoMode.responses'), value: AutoTranslateMode.RESPONSES },
  { label: t('extensionsBuiltin.chatTranslation.autoMode.inputs'), value: AutoTranslateMode.INPUTS },
  { label: t('extensionsBuiltin.chatTranslation.autoMode.both'), value: AutoTranslateMode.BOTH },
]);

onMounted(() => {
  settings.value = migrateChatTranslationSettings(props.api.settings.get());
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    props.api.settings.save();
  },
  { deep: true },
);

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
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

    <PromptPresetField
      :api="api"
      :active-preset-id="settings.activePromptPresetId"
      :prompt-presets="settings.promptPresets"
      :built-in-presets="builtInPromptPresets"
      prompt-key="prompt"
      :label="t('extensionsBuiltin.chatTranslation.promptTemplate')"
      :description="t('extensionsBuiltin.chatTranslation.promptHint')"
      identifier="extension.chat-translation.prompt"
      :rows="10"
      @update:active-preset-id="settings.activePromptPresetId = $event"
      @update:prompt-presets="settings.promptPresets = $event"
    />
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
</style>
