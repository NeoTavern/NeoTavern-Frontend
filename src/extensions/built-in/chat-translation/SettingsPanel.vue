<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Input, Select, Textarea } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import type { TextareaToolDefinition } from '../../../types/ExtensionAPI';
import { AutoTranslateMode, type ChatTranslationSettings, DEFAULT_PROMPT } from './types';

const props = defineProps<{
  api: ExtensionAPI;
}>();

const t = props.api.i18n.t;

const settings = ref<ChatTranslationSettings>({
  connectionProfile: '',
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

const promptTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('common.reset'),
    onClick: ({ setValue }) => {
      setValue(DEFAULT_PROMPT);
    },
  },
]);
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

    <FormItem
      :label="t('extensionsBuiltin.chatTranslation.promptTemplate')"
      :description="t('extensionsBuiltin.chatTranslation.promptHint')"
    >
      <Textarea
        v-model="settings.prompt"
        allow-maximize
        class="prompt-area"
        :rows="10"
        identifier="extension.chat-translation.prompt"
        :tools="promptTools"
      />
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

.prompt-area {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}
</style>
