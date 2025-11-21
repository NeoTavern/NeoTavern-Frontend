<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSettingsStore } from '../../stores/settings.store';
import type { SettingDefinition, Settings, SettingsPath } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import type { ValueForPath } from '../../types/utils';
import { AppInput, AppSelect, AppCheckbox, RangeControl, CollapsibleSection } from '../../components/UI';
import type { I18nKey } from '@/types/i18n';

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
  // Ensure consistent order
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
    <div class="user-settings-drawer-header">
      <h3>{{ t('userSettings.title') }}</h3>
    </div>

    <div style="margin-bottom: 10px">
      <AppInput v-model="searchTerm" type="search" :placeholder="t('userSettings.searchPlaceholder')" />
    </div>

    <div class="user-settings-drawer-content">
      <div v-show="Object.keys(groupedSettings).length === 0" class="user-settings-drawer-no-results">
        {{ t('userSettings.noResults') }}
      </div>

      <div v-for="(settings, category) in groupedSettings" :key="category" class="user-settings-drawer-category">
        <CollapsibleSection :title="category" :initially-open="!searchTerm">
          <div class="user-settings-list">
            <div v-for="setting in settings" :key="setting.id" class="user-settings-drawer-setting">
              <!-- Checkbox Layout (Label on right) -->
              <div v-if="setting.widget === 'checkbox'" class="setting-full-width">
                <AppCheckbox
                  :model-value="getSettingValue(setting.id) as boolean"
                  :label="t(setting.label)"
                  :description="setting.description ? t(setting.description) : undefined"
                  @update:model-value="(val) => updateSetting(setting.id, val)"
                />
              </div>

              <!-- Standard Layout (Label on left, Control on right) -->
              <template v-else>
                <div class="setting-details">
                  <label :for="setting.id">{{ t(setting.label) }}</label>
                  <small v-show="setting.description">{{ setting.description ? t(setting.description) : '' }}</small>
                </div>
                <div class="setting-control">
                  <!-- Select -->
                  <AppSelect
                    v-if="setting.widget === 'select'"
                    :model-value="getSettingValue(setting.id)"
                    :options="formatOptions(setting.options || [])"
                    @update:model-value="(val) => updateSetting(setting.id, val)"
                  />

                  <!-- Slider -->
                  <RangeControl
                    v-if="setting.widget === 'slider'"
                    :model-value="getSettingValue(setting.id) as number"
                    :min="setting.min"
                    :max="setting.max"
                    :step="setting.step"
                    @update:model-value="(val) => updateSetting(setting.id, val)"
                  />
                </div>
              </template>
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  </div>
</template>
