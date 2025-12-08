<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { Button, CollapsibleSection, FormItem, Textarea, Toggle } from '../../../components/UI';
import { useStrictI18n } from '../../../composables/useStrictI18n';
import type { ExtensionAPI } from '../../../types';
import { DEFAULT_IMPERSONATE_PROMPT, type ExtensionSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<ExtensionSettings>;
}>();

const settings = ref<ExtensionSettings>({
  rerollContinueEnabled: true,
  impersonateEnabled: true,
  impersonateConnectionProfile: undefined,
  impersonatePrompt: DEFAULT_IMPERSONATE_PROMPT,
});

const { t } = useStrictI18n();

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
  settings.value.impersonatePrompt = DEFAULT_IMPERSONATE_PROMPT;
}
</script>

<template>
  <div class="impersonate-settings">
    <FormItem :label="t('extensionsBuiltin.rerollContinue.settings.rerollEnabled')">
      <Toggle v-model="settings.rerollContinueEnabled" />
    </FormItem>

    <FormItem :label="t('extensionsBuiltin.rerollContinue.settings.impersonateEnabled')">
      <Toggle v-model="settings.impersonateEnabled" />
    </FormItem>

    <CollapsibleSection :title="t('extensionsBuiltin.rerollContinue.settings.impersonateTitle')" :is-open="false">
      <FormItem
        :label="t('extensionsBuiltin.rerollContinue.settings.connectionProfileLabel')"
        :description="t('extensionsBuiltin.rerollContinue.settings.connectionProfileDesc')"
      >
        <ConnectionProfileSelector v-model="settings.impersonateConnectionProfile" />
      </FormItem>

      <FormItem :description="t('extensionsBuiltin.rerollContinue.settings.promptDesc')">
        <template #default>
          <div class="header-row">
            <div class="form-item-label">{{ t('extensionsBuiltin.rerollContinue.settings.promptLabel') }}</div>
            <Button icon="fa-rotate-left" @click="resetPrompt">
              {{ t('extensionsBuiltin.rerollContinue.settings.reset') }}
            </Button>
          </div>
          <Textarea v-model="settings.impersonatePrompt" class="prompt-area" :rows="8" />
        </template>
      </FormItem>
    </CollapsibleSection>
  </div>
</template>

<style scoped>
.impersonate-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.prompt-area {
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}
</style>
