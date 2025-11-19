<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSettingsStore } from '../../stores/settings.store';
import type { SettingDefinition, Settings, SettingsPath } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { slideTransitionHooks } from '../../utils/dom';
import type { ValueForPath } from '../../types/utils';

const { t } = useStrictI18n();
const settingsStore = useSettingsStore();
const searchTerm = ref('');
const collapsedCategories = ref<string[]>([]);

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

function updateSetting<P extends SettingsPath>(id: P, event: Event) {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  let value: ValueForPath<Settings, P> = target.value as ValueForPath<Settings, P>;
  const definition = settingsStore.definitions.find((d) => d.id === id);

  if (definition?.type === 'boolean') {
    value = (target as HTMLInputElement).checked as ValueForPath<Settings, P>;
  } else if (definition?.type === 'number') {
    value = parseFloat(value as unknown as string) as ValueForPath<Settings, P>;
  }

  settingsStore.setSetting(id, value);
}

function toggleCategoryCollapse(category: string) {
  const index = collapsedCategories.value.indexOf(category);
  if (index > -1) {
    collapsedCategories.value.splice(index, 1);
  } else {
    collapsedCategories.value.push(category);
  }
}

// --- Transition Hooks for Drawers ---
const { beforeEnter, enter, afterEnter, beforeLeave, leave, afterLeave } = slideTransitionHooks;
</script>

<template>
  <div class="user-settings-drawer">
    <div class="user-settings-drawer-header">
      <h3>{{ t('userSettings.title') }}</h3>
      <input
        v-model="searchTerm"
        type="search"
        class="text-pole user-settings-drawer-search"
        :placeholder="t('userSettings.searchPlaceholder')"
      />
    </div>

    <div class="user-settings-drawer-content">
      <div v-show="Object.keys(groupedSettings).length === 0" class="user-settings-drawer-no-results">
        {{ t('userSettings.noResults') }}
      </div>
      <div v-for="(settings, category) in groupedSettings" :key="category" class="user-settings-drawer-category">
        <div class="user-settings-drawer-category-header" @click="toggleCategoryCollapse(category)">
          <h4>{{ category }}</h4>
          <i
            class="fa-solid fa-chevron-down user-settings-drawer-chevron"
            :class="{ 'is-collapsed': collapsedCategories.includes(category) }"
          ></i>
        </div>

        <Transition
          name="slide-js"
          @before-enter="beforeEnter"
          @enter="enter"
          @after-enter="afterEnter"
          @before-leave="beforeLeave"
          @leave="leave"
          @after-leave="afterLeave"
        >
          <div v-show="!collapsedCategories.includes(category)">
            <div class="user-settings-drawer-category-content">
              <div v-for="setting in settings" :key="setting.id" class="user-settings-drawer-setting">
                <div class="setting-details">
                  <label :for="setting.id">{{ t(setting.label) }}</label>
                  <small v-show="setting.description">{{ setting.description ? t(setting.description) : '' }}</small>
                </div>
                <div class="setting-control">
                  <!-- Checkbox -->
                  <label v-if="setting.widget === 'checkbox'" class="checkbox-label-wrapper">
                    <!-- @vue-ignore -->
                    <input
                      :id="setting.id"
                      type="checkbox"
                      :checked="getSettingValue(setting.id)"
                      @change="updateSetting(setting.id, $event)"
                    />
                  </label>

                  <!-- Select -->
                  <select
                    v-if="setting.widget === 'select'"
                    :id="setting.id"
                    class="text-pole"
                    :value="getSettingValue(setting.id)"
                    @change="updateSetting(setting.id, $event)"
                  >
                    <option v-for="option in setting.options" :key="option.value" :value="option.value">
                      {{ t(option.label) }}
                    </option>
                  </select>

                  <!-- Slider -->
                  <div v-if="setting.widget === 'slider'" class="slider-control">
                    <input
                      :id="setting.id"
                      type="range"
                      :min="setting.min"
                      :max="setting.max"
                      :step="setting.step"
                      :value="getSettingValue(setting.id)"
                      @input="updateSetting(setting.id, $event)"
                    />
                    <span class="slider-value">{{ getSettingValue(setting.id) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>
