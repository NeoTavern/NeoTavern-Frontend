<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useApiStore } from '../../stores/api.store';
import { useSettingsStore } from '../../stores/settings.store';
import type { AiConfigValueItem } from '../../types';
import { api_providers } from '../../types';
import { Input, Select } from '../UI';
import type { SelectItem } from '../UI/Select.vue';

const props = defineProps<{
  item: AiConfigValueItem;
}>();

const settingsStore = useSettingsStore();
const apiStore = useApiStore();
const { t } = useStrictI18n();

const modelValue = computed({
  get: () => settingsStore.getSetting(props.item.id!) as string,
  set: (val) => settingsStore.setSetting(props.item.id!, String(val)),
});

const modelOptions = computed(() => {
  return apiStore.modelList.map((modelGroup) => {
    return {
      label: modelGroup.name || modelGroup.id,
      value: modelGroup.id,
    };
  });
});

// OpenRouter Options
const hasOpenRouterGroupedModels = computed(() => {
  return apiStore.groupedOpenRouterModels && Object.keys(apiStore.groupedOpenRouterModels).length > 0;
});

const openRouterModelOptions = computed(() => {
  const opts: SelectItem<string>[] = [{ label: t('apiConnections.openrouterWebsite'), value: 'OR_Website' }];

  if (hasOpenRouterGroupedModels.value && apiStore.groupedOpenRouterModels) {
    for (const [vendor, models] of Object.entries(apiStore.groupedOpenRouterModels)) {
      opts.push({
        label: vendor,
        options: models.map((m) => ({ label: m.name || m.id, value: m.id })),
      });
    }
  }

  return opts;
});

const provider = computed(() => settingsStore.settings.api.provider);
</script>

<template>
  <template v-if="provider === api_providers.OPENROUTER">
    <Select v-show="hasOpenRouterGroupedModels" v-model="modelValue" :options="openRouterModelOptions" searchable />
    <Input v-show="!hasOpenRouterGroupedModels" v-model="modelValue" :placeholder="item.placeholder" />
  </template>
  <template v-else-if="modelOptions.length > 0">
    <Select v-model="modelValue" :options="modelOptions" searchable />
  </template>
  <template v-else>
    <Input v-model="modelValue" :placeholder="item.placeholder" />
  </template>
</template>
