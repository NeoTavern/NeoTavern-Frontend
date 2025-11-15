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
      <button @click="resetToDefaults" class="menu-button">{{ t('common.resetToDefaults') }}</button>
    </div>

    <div class="settings-section">
      <h4>{{ t('worldInfo.activeWorlds') }}</h4>
      <small>{{ t('worldInfo.activeWorldsHint') }}</small>
      <select class="text-pole" multiple v-model="worldInfoStore.activeBookNames">
        <option v-for="name in worldInfoStore.bookNames" :key="name" :value="name">{{ name }}</option>
      </select>
    </div>

    <hr />

    <div class="settings-section">
      <h4>{{ t('worldInfo.activationSettings') }}</h4>
      <div class="wi-settings-grid">
        <div class="wi-settings-grid__sliders">
          <div class="range-block">
            <div class="range-block-title">{{ t('worldInfo.scanDepth') }}</div>
            <div class="range-block-range-and-counter">
              <input
                type="range"
                class="neo-range-slider"
                min="0"
                max="1000"
                step="1"
                v-model.number="worldInfoStore.settings.world_info_depth"
              />
              <input
                type="number"
                class="neo-range-input"
                min="0"
                max="1000"
                step="1"
                v-model.number="worldInfoStore.settings.world_info_depth"
              />
            </div>
          </div>
          <div class="range-block">
            <div class="range-block-title">{{ t('worldInfo.contextPercent') }}</div>
            <div class="range-block-range-and-counter">
              <input
                type="range"
                class="neo-range-slider"
                min="1"
                max="100"
                step="1"
                v-model.number="worldInfoStore.settings.world_info_budget"
              />
              <input
                type="number"
                class="neo-range-input"
                min="1"
                max="100"
                step="1"
                v-model.number="worldInfoStore.settings.world_info_budget"
              />
            </div>
          </div>
          <div class="range-block" :title="t('worldInfo.budgetCapHint')">
            <div class="range-block-title">{{ t('worldInfo.budgetCap') }}</div>
            <div class="range-block-range-and-counter">
              <input
                type="range"
                class="neo-range-slider"
                min="0"
                max="65536"
                step="1"
                v-model.number="worldInfoStore.settings.world_info_budget_cap"
              />
              <input
                type="number"
                class="neo-range-input"
                min="0"
                max="65536"
                step="1"
                v-model.number="worldInfoStore.settings.world_info_budget_cap"
              />
            </div>
          </div>
        </div>
        <div class="wi-settings-grid__checkboxes">
          <label class="checkbox-label" :title="t('worldInfo.includeNamesHint')">
            <input type="checkbox" v-model="worldInfoStore.settings.world_info_include_names" />
            <span>{{ t('worldInfo.includeNames') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.recursiveScanHint')">
            <input type="checkbox" v-model="worldInfoStore.settings.world_info_recursive" />
            <span>{{ t('worldInfo.recursiveScan') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.caseSensitiveHint')">
            <input type="checkbox" v-model="worldInfoStore.settings.world_info_case_sensitive" />
            <span>{{ t('worldInfo.caseSensitive') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.matchWholeWordsHint')">
            <input type="checkbox" v-model="worldInfoStore.settings.world_info_match_whole_words" />
            <span>{{ t('worldInfo.matchWholeWords') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.useGroupScoringHint')">
            <input type="checkbox" v-model="worldInfoStore.settings.world_info_use_group_scoring" />
            <span>{{ t('worldInfo.useGroupScoring') }}</span>
          </label>
          <label class="checkbox-label" :title="t('worldInfo.alertOnOverflowHint')">
            <input type="checkbox" v-model="worldInfoStore.settings.world_info_overflow_alert" />
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
        <select class="text-pole" v-model="worldInfoStore.settings.world_info_character_strategy">
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
