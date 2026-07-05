<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { FormItem, Input, Toggle } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import { DEFAULT_SETTINGS, type UsageTrackerSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<UsageTrackerSettings>;
}>();

const t = props.api.i18n.t;
const settings = ref<UsageTrackerSettings>({ ...DEFAULT_SETTINGS });
const storageLimitMb = ref(Math.round(DEFAULT_SETTINGS.captureStorageLimitBytes / 1024 / 1024));

onMounted(() => {
  const saved = props.api.settings.get();
  settings.value = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  storageLimitMb.value = Math.max(1, Math.round(settings.value.captureStorageLimitBytes / 1024 / 1024));
});

watch(storageLimitMb, (value) => {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
  settings.value.captureStorageLimitBytes = normalized * 1024 * 1024;
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    props.api.settings.save();
  },
  { deep: true },
);
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
