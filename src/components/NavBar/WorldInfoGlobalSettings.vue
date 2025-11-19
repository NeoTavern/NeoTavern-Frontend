<script setup lang="ts">
import { useWorldInfoStore, defaultWorldInfoSettings } from '../../stores/world-info.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { WorldInfoInsertionStrategy } from '../../types';

const { t } = useStrictI18n();
const worldInfoStore = useWorldInfoStore();

function resetToDefaults() {
  worldInfoStore.settings = { ...defaultWorldInfoSettings };
}
</script>

<template>
  <div class="world-info-global-settings">
    <div class="editor-header">
      <h3>{{ t('worldInfo.globalSettings') }}</h3>
      <button class="menu-button" @click="resetToDefaults">{{ t('common.resetToDefaults') }}</button>
    </div>

    <div class="settings-section">
      <h4>{{ t('worldInfo.activeWorlds') }}</h4>
      <small>{{ t('worldInfo.activeWorldsHint') }}</small>
      <select v-model="worldInfoStore.activeBookNames" class="text-pole" multiple>
        <option v-for="name in worldInfoStore.bookNames" :key="name" :value="name">{{ name }}</option>
      </select>
    </div>

    <hr />

    <div class="settings-section">
      <h4>{{ t('worldInfo.activationSettings') }}</h4>
      <div class="wi-settings-grid">
        <div class="wi-settings-grid-sliders">
          <div class="range-block">
            <div class="range-block-title">{{ t('worldInfo.scanDepth') }}</div>
            <div class="range-block-range-and-counter">
              <input
                v-model.number="worldInfoStore.settings.world_info_depth"
                type="range"
                class="neo-range-slider"
                min="0"
                max="1000"
                step="1"
              />
              <input
                v-model.number="worldInfoStore.settings.world_info_depth"
                type="number"
                class="neo-range-input"
                min="0"
                max="1000"
                step="1"
              />
            </div>
          </div>
          <div class="range-block">
            <div class="range-block-title">{{ t('worldInfo.contextPercent') }}</div>
            <div class="range-block-range-and-counter">
              <input
                v-model.number="worldInfoStore.settings.world_info_budget"
                type="range"
                class="neo-range-slider"
                min="1"
                max="100"
                step="1"
              />
              <input
                v-model.number="worldInfoStore.settings.world_info_budget"
                type="number"
                class="neo-range-input"
                min="1"
                max="100"
                step="1"
              />
            </div>
          </div>
          <div class="range-block" :title="t('worldInfo.budgetCapHint')">
            <div class="range-block-title">{{ t('worldInfo.budgetCap') }}</div>
            <div class="range-block-range-and-counter">
              <input
                v-model.number="worldInfoStore.settings.world_info_budget_cap"
                type="range"
                class="neo-range-slider"
                min="0"
                max="65536"
                step="1"
              />
              <input
                v-model.number="worldInfoStore.settings.world_info_budget_cap"
                type="number"
                class="neo-range-input"
                min="0"
                max="65536"
                step="1"
              />
            </div>
          </div>
        </div>
        <div class="wi-settings-grid-checkboxes">
          <label class="checkbox-label" :title="t('worldInfo.includeNamesHint')">
            <input v-model="worldInfoStore.settings.world_info_include_names" type="checkbox" />
            <span>{{ t('worldInfo.includeNames') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.recursiveScanHint')">
            <input v-model="worldInfoStore.settings.world_info_recursive" type="checkbox" />
            <span>{{ t('worldInfo.recursiveScan') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.caseSensitiveHint')">
            <input v-model="worldInfoStore.settings.world_info_case_sensitive" type="checkbox" />
            <span>{{ t('worldInfo.caseSensitive') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.matchWholeWordsHint')">
            <input v-model="worldInfoStore.settings.world_info_match_whole_words" type="checkbox" />
            <span>{{ t('worldInfo.matchWholeWords') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.useGroupScoringHint')">
            <input v-model="worldInfoStore.settings.world_info_use_group_scoring" type="checkbox" />
            <span>{{ t('worldInfo.useGroupScoring') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.alertOnOverflowHint')">
            <input v-model="worldInfoStore.settings.world_info_overflow_alert" type="checkbox" />
            <span>{{ t('worldInfo.alertOnOverflow') }}</span>
          </label>
        </div>
      </div>
    </div>

    <hr />

    <div class="settings-section">
      <h4>{{ t('worldInfo.advancedSettings') }}</h4>
      <div class="range-block" :title="t('worldInfo.insertionStrategyHint')">
        <div class="range-block-title">{{ t('worldInfo.insertionStrategy') }}</div>
        <select v-model="worldInfoStore.settings.world_info_character_strategy" class="text-pole">
          <option :value="WorldInfoInsertionStrategy.EVENLY">
            {{ t('worldInfo.insertionStrategies.sortedEvenly') }}
          </option>
          <option :value="WorldInfoInsertionStrategy.CHARACTER_FIRST">
            {{ t('worldInfo.insertionStrategies.characterLoreFirst') }}
          </option>
          <option :value="WorldInfoInsertionStrategy.GLOBAL_FIRST">
            {{ t('worldInfo.insertionStrategies.globalLoreFirst') }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>
