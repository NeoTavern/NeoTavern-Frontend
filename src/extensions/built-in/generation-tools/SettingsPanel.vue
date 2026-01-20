<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { CollapsibleSection, FormItem, Textarea, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import type { TextareaToolDefinition } from '../../../types/ExtensionAPI';
import { DEFAULT_GENERATE_PROMPT, DEFAULT_IMPERSONATE_PROMPT, type ExtensionSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<ExtensionSettings>;
}>();

const settings = ref<ExtensionSettings>({
  rerollContinueEnabled: true,
  swipeEnabled: true,
  impersonateEnabled: true,
  impersonateConnectionProfile: undefined,
  impersonatePrompt: DEFAULT_IMPERSONATE_PROMPT,
  generateEnabled: true,
  generatePrompt: DEFAULT_GENERATE_PROMPT,
});

const t = props.api.i18n.t;

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
    // @ts-expect-error - Custom event for settings change
    props.api.events.emit('generation-tools:settings-changed');
    props.api.settings.save();
  },
  { deep: true },
);

const impersonatePromptTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('extensionsBuiltin.generationTools.settings.reset'),
    onClick: ({ setValue }) => {
      setValue(DEFAULT_IMPERSONATE_PROMPT);
    },
  },
]);

const generatePromptTools = computed<TextareaToolDefinition[]>(() => [
  {
    id: 'reset',
    icon: 'fa-rotate-left',
    title: t('extensionsBuiltin.generationTools.settings.reset'),
    onClick: ({ setValue }) => {
      setValue(DEFAULT_GENERATE_PROMPT);
    },
  },
]);
</script>

<template>
  <div class="extension-settings">
    <FormItem :label="t('extensionsBuiltin.generationTools.settings.rerollEnabled')">
      <Toggle v-model="settings.rerollContinueEnabled" />
    </FormItem>

    <FormItem :label="t('extensionsBuiltin.generationTools.settings.swipeEnabled')">
      <Toggle v-model="settings.swipeEnabled" />
    </FormItem>

    <FormItem :label="t('extensionsBuiltin.generationTools.settings.impersonateEnabled')">
      <Toggle v-model="settings.impersonateEnabled" />
    </FormItem>

    <FormItem :label="t('extensionsBuiltin.generationTools.settings.generateEnabled')">
      <Toggle v-model="settings.generateEnabled" />
    </FormItem>

    <CollapsibleSection :title="t('extensionsBuiltin.generationTools.settings.impersonateTitle')" :is-open="false">
      <FormItem
        :label="t('extensionsBuiltin.generationTools.settings.connectionProfileLabel')"
        :description="t('extensionsBuiltin.generationTools.settings.connectionProfileDesc')"
      >
        <ConnectionProfileSelector v-model="settings.impersonateConnectionProfile" />
      </FormItem>

      <FormItem
        :label="t('extensionsBuiltin.generationTools.settings.promptLabel')"
        :description="t('extensionsBuiltin.generationTools.settings.promptDesc')"
      >
        <Textarea
          v-model="settings.impersonatePrompt"
          allow-maximize
          class="prompt-area"
          :rows="8"
          identifier="extension.generation-tools.impersonate-prompt"
          :tools="impersonatePromptTools"
        />
      </FormItem>
    </CollapsibleSection>

    <CollapsibleSection :title="t('extensionsBuiltin.generationTools.settings.generateTitle')" :is-open="false">
      <FormItem
        :label="t('extensionsBuiltin.generationTools.settings.promptLabel')"
        :description="t('extensionsBuiltin.generationTools.settings.generatePromptDesc')"
      >
        <Textarea
          v-model="settings.generatePrompt"
          allow-maximize
          class="prompt-area"
          :rows="8"
          identifier="extension.generation-tools.generate-prompt"
          :tools="generatePromptTools"
        />
      </FormItem>
    </CollapsibleSection>
  </div>
</template>

<style scoped>
.extension-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.prompt-area {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}
</style>
