<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { FormItem, Input } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import { DEFAULT_SETTINGS, type StandardToolsSettings } from './types';

const props = defineProps<{
  api: ExtensionAPI<StandardToolsSettings>;
}>();

const t = props.api.i18n.t;

const settings = ref<StandardToolsSettings>({ ...DEFAULT_SETTINGS });

onMounted(() => {
  const saved = props.api.settings.get();
  if (saved) {
    settings.value = { ...DEFAULT_SETTINGS, ...saved };
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

const getResetTool = (field: keyof StandardToolsSettings) => ({
  id: 'reset',
  title: t('common.reset'),
  icon: 'fa-undo',
  onClick: ({ setValue }: { value: string; setValue: (val: string) => void }) => {
    setValue(String(DEFAULT_SETTINGS[field]));
  },
});
</script>

<template>
  <div class="standard-tools-settings">
    <div class="settings-group">
      <h3>{{ t('extensionsBuiltin.standardTools.network') }}</h3>
      <div class="settings-row"></div>
      <FormItem
        :label="t('extensionsBuiltin.standardTools.corsProxy')"
        :description="t('extensionsBuiltin.standardTools.corsProxyHint')"
      >
        <Input
          v-model="settings.corsProxy"
          placeholder="e.g. https://corsproxy.io/?"
          :tools="[getResetTool('corsProxy')]"
        />
      </FormItem>
    </div>

    <div class="settings-group">
      <h3>{{ t('extensionsBuiltin.standardTools.webSearch') }}</h3>
      <div class="settings-row"></div>
      <FormItem
        :label="t('extensionsBuiltin.standardTools.maxResults')"
        :description="t('extensionsBuiltin.standardTools.maxResultsHint')"
      >
        <Input
          v-model.number="settings.webSearchMaxResults"
          type="number"
          :min="1"
          :max="20"
          :tools="[getResetTool('webSearchMaxResults')]"
        />
      </FormItem>
    </div>

    <div class="settings-group">
      <h3>{{ t('extensionsBuiltin.standardTools.urlInspector') }}</h3>
      <div class="settings-row"></div>
      <FormItem
        :label="t('extensionsBuiltin.standardTools.maxContentLength')"
        :description="t('extensionsBuiltin.standardTools.maxContentLengthHint')"
      >
        <Input
          v-model.number="settings.urlInspectorMaxContentLength"
          type="number"
          :min="100"
          :step="500"
          :tools="[getResetTool('urlInspectorMaxContentLength')]"
        />
      </FormItem>
    </div>
  </div>
</template>

<style scoped>
.standard-tools-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 10px;
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--theme-border-color);
}

.settings-group:last-child {
  border-bottom: none;
}

.settings-group h3 {
  margin: 0 0 8px 0;
  font-size: 1.1em;
  font-weight: 600;
  color: var(--theme-text-color);
}

.settings-row {
  display: flex;
  align-items: center;
}
</style>
