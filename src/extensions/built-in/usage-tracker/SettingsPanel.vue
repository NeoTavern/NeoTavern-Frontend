<script setup lang="ts">
import { ref, watch } from 'vue';
import { FormItem, Input, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import { useExtensionSettings } from '../_shared/composables/use-extension-settings';
import { DEFAULT_SETTINGS, type UsageTrackerSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<UsageTrackerSettings>;
}>();

const t = props.api.i18n.t;
const storageLimitMb = ref(Math.round(DEFAULT_SETTINGS.captureStorageLimitBytes / 1024 / 1024));
const settings = useExtensionSettings<UsageTrackerSettings>(
  props.api,
  { ...DEFAULT_SETTINGS },
  (saved) => ({ ...DEFAULT_SETTINGS, ...(saved ?? {}) }),
  {
    onLoaded: (loadedSettings) => {
      storageLimitMb.value = Math.max(1, Math.round(loadedSettings.captureStorageLimitBytes / 1024 / 1024));
    },
  },
);

watch(storageLimitMb, (value) => {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
  settings.value.captureStorageLimitBytes = normalized * 1024 * 1024;
});
</script>

<template>
  <div class="usage-tracker-settings">
    <FormItem
      :label="t('extensionsBuiltin.usageTracker.settings.keepFullPayloads')"
      :description="t('extensionsBuiltin.usageTracker.settings.keepFullPayloadsHint')"
    >
      <Toggle v-model="settings.captureFullPayloads" />
    </FormItem>

    <FormItem
      :label="t('extensionsBuiltin.usageTracker.settings.captureStorageLimit')"
      :description="t('extensionsBuiltin.usageTracker.settings.captureStorageLimitHint')"
    >
      <Input v-model="storageLimitMb" type="number" :min="1" :step="1" />
      <span class="setting-unit">{{ t('extensionsBuiltin.usageTracker.megabytes') }}</span>
    </FormItem>
  </div>
</template>

<style scoped lang="scss">
.usage-tracker-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.setting-unit {
  margin-left: 0.5rem;
  color: var(--theme-emphasis-color);
}
</style>
