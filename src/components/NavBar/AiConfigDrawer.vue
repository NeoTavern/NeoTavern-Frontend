<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useApiStore } from '../../stores/api.store';
import { usePopupStore } from '../../stores/popup.store';
import { aiConfigDefinition } from '../../ai-config-definition';
import type { AiConfigCondition, AiConfigSection } from '../../types';
import { POPUP_TYPE } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import PromptManagerPopup from './PromptManagerPopup.vue';
import { useSettingsStore } from '../../stores/settings.store';

const { t } = useStrictI18n();
const apiStore = useApiStore();
const popupStore = usePopupStore();
const settingsStore = useSettingsStore();

const isPanelPinned = ref(false); // TODO: connect to settings
const isPromptManagerVisible = ref(false);

function checkConditions(conditions?: AiConfigCondition): boolean {
  if (!conditions) return true;

  if (conditions.api) {
    const apis = Array.isArray(conditions.api) ? conditions.api : [conditions.api];
    if (!apis.includes(settingsStore.settings.api.main)) return false;
  }
  if (conditions.source) {
    const sources = Array.isArray(conditions.source) ? conditions.source : [conditions.source];
    if (
      !settingsStore.settings.api.chatCompletionSource ||
      !sources.includes(settingsStore.settings.api.chatCompletionSource)
    )
      return false;
  }
  // TODO: Add source_not and other conditions
  return true;
}

const visibleSections = computed(() => {
  return aiConfigDefinition.filter((section) => checkConditions(section.conditions));
});

function getVisibleItems(section: AiConfigSection) {
  return section.items.filter((item) => checkConditions(item.conditions));
}

async function handleNewPreset() {
  const { result, value } = await popupStore.show({
    title: t('aiConfig.presets.newName'),
    type: POPUP_TYPE.INPUT,
    inputValue: settingsStore.settings.api.selectedSampler || 'New Preset',
  });

  if (result === 1 && value) {
    apiStore.saveCurrentPresetAs(value);
  }
}

onMounted(() => {
  apiStore.loadPresetsForApi();
});
</script>

<template>
  <div class="ai-config-drawer">
    <div class="ai-config-drawer-header">
      <div
        :title="t('characterPanel.pinToggle')"
        class="menu-button-icon"
        :class="isPanelPinned ? 'fa-lock' : 'fa-unlock'"
        @click="isPanelPinned = !isPanelPinned"
      ></div>
      <div class="ai-config-drawer-manual-input-note">{{ t('aiConfig.manualInputNote') }}</div>
      <a
        class="ai-config-drawer-docs-link fa-solid fa-circle-question"
        href="https://docs.sillytavern.app/usage/common-settings/"
        target="_blank"
        :title="t('aiConfig.docsLinkTooltip')"
      ></a>
    </div>

    <div class="ai-config-drawer-content">
      <template v-for="section in visibleSections" :key="section.id">
        <div v-for="item in getVisibleItems(section)" :key="item.id || item.widget" class="ai-config-drawer-item">
          <!-- Preset Manager -->
          <div v-if="item.widget === 'preset-manager' && item.id" class="preset-manager">
            <div class="standout-header">
              <strong>{{ item.label ? t(item.label) : '' }}</strong>
              <div class="preset-manager-actions">
                <div
                  class="menu-button-icon fa-solid fa-file-import"
                  :title="t('aiConfig.presets.import')"
                  @click="apiStore.importPreset()"
                ></div>
                <div
                  class="menu-button-icon fa-solid fa-file-export"
                  :title="t('aiConfig.presets.export')"
                  @click="apiStore.exportPreset(settingsStore.getSetting(item.id))"
                ></div>
                <div
                  class="menu-button-icon fa-solid fa-trash-can"
                  :title="t('aiConfig.presets.delete')"
                  @click="apiStore.deletePreset(settingsStore.getSetting(item.id))"
                ></div>
              </div>
            </div>
            <div class="preset-manager-controls">
              <select
                class="text-pole"
                :value="settingsStore.getSetting(item.id)"
                @change="settingsStore.setSetting(item.id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="preset in apiStore.presets" :key="preset.name" :value="preset.name">
                  {{ preset.name }}
                </option>
              </select>
              <div
                class="menu-button-icon fa-solid fa-save"
                :title="t('aiConfig.presets.update')"
                @click="apiStore.updateCurrentPreset(settingsStore.getSetting(item.id))"
              ></div>
              <div
                class="menu-button-icon fa-solid fa-pencil"
                :title="t('aiConfig.presets.rename')"
                @click="apiStore.renamePreset(settingsStore.getSetting(item.id))"
              ></div>
              <div
                class="menu-button-icon fa-solid fa-file-circle-plus"
                :title="t('aiConfig.presets.saveAs')"
                @click="handleNewPreset()"
              ></div>
            </div>
          </div>

          <!-- Prompt Manager Button -->
          <div v-if="item.widget === 'prompt-manager-button'">
            <div class="standout-header">
              <strong>{{ item.label ? t(item.label) : '' }}</strong>
            </div>
            <small v-if="item.description" class="toggle-description">{{ t(item.description) }}</small>
            <button class="menu-button" @click="isPromptManagerVisible = true">
              {{ t('aiConfig.promptManager.openButton') }}
            </button>
          </div>

          <!-- Slider -->
          <div v-if="item.widget === 'slider' && item.id" class="range-block">
            <div class="range-block-title">{{ item.label ? t(item.label) : '' }}</div>
            <div class="range-block-range-and-counter">
              <input
                type="range"
                class="neo-range-slider"
                :min="item.min"
                :max="item.maxUnlockedId && settingsStore.getSetting(item.maxUnlockedId) ? 131072 : item.max"
                :step="item.step"
                :value="settingsStore.getSetting(item.id)"
                @input="settingsStore.setSetting(item.id, Number(($event.target as HTMLInputElement).value))"
              />
              <input
                type="number"
                class="neo-range-input"
                :min="item.min"
                :max="item.maxUnlockedId && settingsStore.getSetting(item.maxUnlockedId) ? 131072 : item.max"
                :step="item.step"
                :value="settingsStore.getSetting(item.id)"
                @input="settingsStore.setSetting(item.id, Number(($event.target as HTMLInputElement).value))"
              />
            </div>
            <div v-show="item.maxUnlockedId && item.unlockLabel" class="range-block-addon">
              <label class="checkbox-label" :title="item.unlockTooltip ? t(item.unlockTooltip) : ''">
                <input
                  type="checkbox"
                  :checked="item.maxUnlockedId ? settingsStore.getSetting(item.maxUnlockedId) : false"
                  @change="
                    item.maxUnlockedId
                      ? settingsStore.setSetting(item.maxUnlockedId, ($event.target as HTMLInputElement).checked)
                      : undefined
                  "
                />
                <span>{{ item.unlockLabel ? t(item.unlockLabel) : '' }}</span>
              </label>
            </div>
          </div>

          <!-- Number Input -->
          <div v-if="item.widget === 'number-input' && item.id" class="range-block">
            <div class="range-block-title">{{ item.label ? t(item.label) : '' }}</div>
            <input
              type="number"
              class="text-pole"
              :min="item.min"
              :max="item.max"
              :step="item.step"
              :value="settingsStore.getSetting(item.id)"
              @input="settingsStore.setSetting(item.id, Number(($event.target as HTMLInputElement).value))"
            />
          </div>

          <!-- Textarea -->
          <div v-if="item.widget === 'textarea' && item.id" class="range-block">
            <div class="range-block-title">{{ item.label ? t(item.label) : '' }}</div>
            <textarea
              class="text-pole"
              rows="3"
              :value="settingsStore.getSetting(item.id)"
              @input="settingsStore.setSetting(item.id, ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
            <small v-if="item.description" class="toggle-description">{{ t(item.description) }}</small>
          </div>

          <!-- Checkbox -->
          <div v-if="item.widget === 'checkbox' && item.id" class="range-block">
            <label class="checkbox-label">
              <input
                type="checkbox"
                :checked="settingsStore.getSetting(item.id)"
                @change="settingsStore.setSetting(item.id, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ item.label ? t(item.label) : '' }}</span>
            </label>
            <div v-if="item.description" class="toggle-description">{{ t(item.description) }}</div>
          </div>

          <!-- Select Input -->
          <div v-if="item.widget === 'select' && item.id && item.options" class="range-block">
            <div class="range-block-title">
              <label :for="item.id.toString()">{{ item.label ? t(item.label) : '' }}</label>
              <a
                v-if="item.infoLink"
                :href="item.infoLink"
                target="_blank"
                class="fa-solid fa-circle-question info-link"
                :title="item.infoTooltip ? t(item.infoTooltip) : undefined"
              ></a>
            </div>
            <select
              :id="item.id.toString()"
              class="text-pole"
              :value="settingsStore.getSetting(item.id)"
              @change="settingsStore.setSetting(item.id, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="option in item.options" :key="String(option.value)" :value="option.value">
                {{ t(option.label) }}
              </option>
            </select>
          </div>

          <!-- Info Display -->
          <div v-if="item.widget === 'info-display' && item.description" class="toggle-description">
            {{ t(item.description) }}
          </div>

          <!-- Horizontal Rule -->
          <hr v-if="item.widget === 'hr'" />
        </div>
      </template>
    </div>

    <PromptManagerPopup :visible="isPromptManagerVisible" @close="isPromptManagerVisible = false" />
  </div>
</template>
