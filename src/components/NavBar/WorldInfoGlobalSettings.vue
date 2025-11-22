<script setup lang="ts">
import { computed } from 'vue';
import { useWorldInfoStore, defaultWorldInfoSettings } from '../../stores/world-info.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { WorldInfoInsertionStrategy } from '../../types';
import { AppButton, AppCheckbox, AppSelect, RangeControl } from '../UI';
import AppFormItem from '../UI/AppFormItem.vue';

const { t } = useStrictI18n();
const worldInfoStore = useWorldInfoStore();

function resetToDefaults() {
  worldInfoStore.settings = { ...defaultWorldInfoSettings };
}

const strategyOptions = computed(() => [
  { value: WorldInfoInsertionStrategy.EVENLY, label: t('worldInfo.insertionStrategies.sortedEvenly') },
  { value: WorldInfoInsertionStrategy.CHARACTER_FIRST, label: t('worldInfo.insertionStrategies.characterLoreFirst') },
  { value: WorldInfoInsertionStrategy.GLOBAL_FIRST, label: t('worldInfo.insertionStrategies.globalLoreFirst') },
]);

const bookOptions = computed(() => {
  return worldInfoStore.bookNames.map((name) => ({
    label: name,
    value: name,
  }));
});
</script>

<template>
  <div class="world-info-global-settings">
    <div class="editor-header">
      <h3>{{ t('worldInfo.globalSettings') }}</h3>
      <AppButton @click="resetToDefaults">{{ t('common.resetToDefaults') }}</AppButton>
    </div>

    <div class="settings-section">
      <AppFormItem :description="t('worldInfo.activeWorldsHint')">
        <AppSelect
          v-model="worldInfoStore.activeBookNames"
          :options="bookOptions"
          multiple
          :label="t('worldInfo.activeWorlds')"
          :placeholder="t('common.none')"
        />
      </AppFormItem>
    </div>

    <hr />

    <div class="settings-section">
      <h4>{{ t('worldInfo.activationSettings') }}</h4>
      <div class="wi-settings-grid">
        <div class="wi-settings-grid-sliders">
          <RangeControl
            v-model="worldInfoStore.settings.world_info_depth"
            :label="t('worldInfo.scanDepth')"
            :min="0"
            :max="1000"
          />
          <RangeControl
            v-model="worldInfoStore.settings.world_info_budget"
            :label="t('worldInfo.contextPercent')"
            :min="1"
            :max="100"
          />
          <RangeControl
            v-model="worldInfoStore.settings.world_info_budget_cap"
            :label="t('worldInfo.budgetCap')"
            :min="0"
            :max="65536"
            :title="t('worldInfo.budgetCapHint')"
          />
        </div>
        <div class="wi-settings-grid-checkboxes">
          <AppCheckbox
            v-model="worldInfoStore.settings.world_info_include_names"
            :label="t('worldInfo.includeNames')"
            :title="t('worldInfo.includeNamesHint')"
          />
          <AppCheckbox
            v-model="worldInfoStore.settings.world_info_recursive"
            :label="t('worldInfo.recursiveScan')"
            :title="t('worldInfo.recursiveScanHint')"
          />
          <AppCheckbox
            v-model="worldInfoStore.settings.world_info_case_sensitive"
            :label="t('worldInfo.caseSensitive')"
            :title="t('worldInfo.caseSensitiveHint')"
          />
          <AppCheckbox
            v-model="worldInfoStore.settings.world_info_match_whole_words"
            :label="t('worldInfo.matchWholeWords')"
            :title="t('worldInfo.matchWholeWordsHint')"
          />
          <AppCheckbox
            v-model="worldInfoStore.settings.world_info_use_group_scoring"
            :label="t('worldInfo.useGroupScoring')"
            :title="t('worldInfo.useGroupScoringHint')"
          />
          <AppCheckbox
            v-model="worldInfoStore.settings.world_info_overflow_alert"
            :label="t('worldInfo.alertOnOverflow')"
            :title="t('worldInfo.alertOnOverflowHint')"
          />
        </div>
      </div>
    </div>

    <hr />

    <div class="settings-section">
      <h4>{{ t('worldInfo.advancedSettings') }}</h4>
      <AppFormItem>
        <AppSelect
          v-model="worldInfoStore.settings.world_info_character_strategy"
          :label="t('worldInfo.insertionStrategy')"
          :title="t('worldInfo.insertionStrategyHint')"
          :options="strategyOptions"
        />
      </AppFormItem>
    </div>
  </div>
</template>
