<script setup lang="ts">
import { CollapsibleSection, FormItem, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import ConnectionProfileField from '../_shared/components/ConnectionProfileField.vue';
import PromptPresetField from '../_shared/components/PromptPresetField.vue';
import { useExtensionSettings } from '../_shared/composables/use-extension-settings';
import {
  BUILT_IN_PROMPT_PRESETS,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  migrateGenerationToolsSettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<ExtensionSettings>;
}>();

const t = props.api.i18n.t;
const settings = useExtensionSettings<ExtensionSettings>(
  props.api,
  { ...DEFAULT_SETTINGS },
  migrateGenerationToolsSettings,
  {
    onBeforeSave: () => {
      // @ts-expect-error - Custom event for settings change
      props.api.events.emit('generation-tools:settings-changed');
    },
  },
);

const builtInPromptPresets = BUILT_IN_PROMPT_PRESETS;
</script>

<template>
  <div class="extension-settings">
    <FormItem :label="t('extensionsBuiltin.generationTools.settings.rerollEnabled')">
      <Toggle v-model="settings.rerollContinueEnabled" />
    </FormItem>

    <FormItem :label="t('extensionsBuiltin.generationTools.settings.deleteContinueEnabled')">
      <Toggle v-model="settings.deleteContinueEnabled" />
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
      <ConnectionProfileField
        v-model="settings.impersonateConnectionProfile"
        :label="t('extensionsBuiltin.generationTools.settings.connectionProfileLabel')"
        :description="t('extensionsBuiltin.generationTools.settings.connectionProfileDesc')"
      />

      <PromptPresetField
        :api="api"
        :active-preset-id="settings.activePromptPresetId"
        :prompt-presets="settings.promptPresets"
        :built-in-presets="builtInPromptPresets"
        prompt-key="impersonatePrompt"
        :label="t('extensionsBuiltin.generationTools.settings.promptLabel')"
        :description="t('extensionsBuiltin.generationTools.settings.promptDesc')"
        identifier="extension.generation-tools.impersonate-prompt"
        :rows="8"
        @update:active-preset-id="settings.activePromptPresetId = $event"
        @update:prompt-presets="settings.promptPresets = $event"
      />
    </CollapsibleSection>

    <CollapsibleSection :title="t('extensionsBuiltin.generationTools.settings.generateTitle')" :is-open="false">
      <PromptPresetField
        :api="api"
        :active-preset-id="settings.activePromptPresetId"
        :prompt-presets="settings.promptPresets"
        :built-in-presets="builtInPromptPresets"
        prompt-key="generatePrompt"
        :label="t('extensionsBuiltin.generationTools.settings.promptLabel')"
        :description="t('extensionsBuiltin.generationTools.settings.generatePromptDesc')"
        identifier="extension.generation-tools.generate-prompt"
        :rows="8"
        @update:active-preset-id="settings.activePromptPresetId = $event"
        @update:prompt-presets="settings.promptPresets = $event"
      />
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
</style>
