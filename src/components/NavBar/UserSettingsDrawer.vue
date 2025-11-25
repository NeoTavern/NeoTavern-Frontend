<script setup lang="ts">
import { computed, ref } from 'vue';
import { SidebarHeader } from '../common';
import { Checkbox, CollapsibleSection, FormItem, RangeControl, Search, Select } from '../../components/UI';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import type { SettingDefinition, Settings, SettingsPath } from '../../types';
import type { I18nKey } from '../../types/i18n';
import type { ValueForPath } from '../../types/utils';

const { t } = useStrictI18n();
const settingsStore = useSettingsStore();
const searchTerm = ref('');

const filteredDefinitions = computed(() => {
  if (!searchTerm.value.trim()) {
    return settingsStore.definitions;
  }
  const lowerCaseSearch = searchTerm.value.toLowerCase();
  return settingsStore.definitions.filter(
    (def) =>
      t(def.label).toLowerCase().includes(lowerCaseSearch) ||
      (def.description && t(def.description).toLowerCase().includes(lowerCaseSearch)) ||
      def.category.toLowerCase().includes(lowerCaseSearch),
  );
});

const groupedSettings = computed(() => {
  const groups: Record<string, SettingDefinition[]> = {};
  for (const setting of filteredDefinitions.value) {
    if (!groups[setting.category]) {
      groups[setting.category] = [];
    }
    groups[setting.category].push(setting);
  }
  const orderedGroups: Record<string, SettingDefinition[]> = {};
  const categoryOrder = [...new Set(settingsStore.definitions.map((def) => def.category))];
  for (const category of categoryOrder) {
    if (groups[category]) {
      orderedGroups[category] = groups[category];
    }
  }
  return orderedGroups;
});

function getSettingValue(id: string) {
  return settingsStore.getSetting(id as SettingsPath);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function updateSetting<P extends SettingsPath>(id: P, value: any) {
  const definition = settingsStore.definitions.find((d) => d.id === id);

  let typedValue = value;

  if (definition?.type === 'number') {
    typedValue = parseFloat(value);
  } else if (definition?.type === 'boolean') {
    typedValue = !!value;
  }

  settingsStore.setSetting(id, typedValue as ValueForPath<Settings, P>);
}

function formatOptions(options: { label: I18nKey; value: string | number }[]) {
  return options.map((o) => ({ label: t(o.label), value: o.value }));
}
</script>

<template>
  <div class="user-settings-drawer">
    <SidebarHeader class="user-settings-drawer-header" :title="t('navbar.userSettings')" />

    <div style="margin-bottom: 10px">
      <Search v-model="searchTerm" :placeholder="t('userSettings.searchPlaceholder')" />
    </div>

    <div class="user-settings-drawer-content">
      <div v-show="Object.keys(groupedSettings).length === 0" class="user-settings-drawer-no-results">
        {{ t('userSettings.noResults') }}
      </div>

      <div v-for="(settings, category) in groupedSettings" :key="category" class="user-settings-drawer-category">
        <CollapsibleSection :title="category" :is-open="!searchTerm">
          <div class="user-settings-list">
            <div v-for="setting in settings" :key="setting.id">
              <!-- Checkbox -->
              <div v-if="setting.widget === 'checkbox'">
                <Checkbox
                  :model-value="getSettingValue(setting.id) as boolean"
                  :label="t(setting.label)"
                  :description="setting.description ? t(setting.description) : undefined"
                  @update:model-value="(val) => updateSetting(setting.id, val)"
                />
              </div>

              <!-- Standard Inputs (Horizontal Layout) -->
              <template v-else>
                <FormItem
                  :label="t(setting.label)"
                  :description="setting.description ? t(setting.description) : undefined"
                  horizontal
                >
                  <!-- Select -->
                  <div v-if="setting.widget === 'select'" style="width: 220px">
                    <!-- @vue-ignore -->
                    <Select
                      :model-value="getSettingValue(setting.id)"
                      :options="formatOptions(setting.options || [])"
                      @update:model-value="(val) => updateSetting(setting.id, val)"
                    />
                  </div>

                  <!-- Slider -->
                  <div v-if="setting.widget === 'slider'" style="width: 220px">
                    <RangeControl
                      :model-value="getSettingValue(setting.id) as number"
                      :min="setting.min"
                      :max="setting.max"
                      :step="setting.step"
                      @update:model-value="(val) => updateSetting(setting.id, val)"
                    />
                  </div>
                </FormItem>
              </template>
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  </div>
</template>
