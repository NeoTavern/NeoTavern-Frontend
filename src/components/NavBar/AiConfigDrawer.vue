<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useApiStore } from '../../stores/api.store';
import { usePopupStore } from '../../stores/popup.store';
import { aiConfigDefinition } from '../../ai-config-definition';
import type { AiConfigCondition, AiConfigSection } from '../../types';
import { POPUP_TYPE } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import PromptManager from '../AiConfig/PromptManager.vue';
import { AppIconButton, AppSelect, AppInput, AppTextarea, AppCheckbox, RangeControl } from '../../components/UI';

const { t } = useStrictI18n();
const apiStore = useApiStore();
const popupStore = usePopupStore();
const settingsStore = useSettingsStore();

const activeTab = ref<'sampler' | 'prompts'>('sampler');
const isPanelPinned = ref(false); // TODO: connect to settings

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
      <div class="ai-config-tabs">
        <button class="tab-button" :class="{ active: activeTab === 'sampler' }" @click="activeTab = 'sampler'">
          {{ t('aiConfig.tabSampler') }}
        </button>
        <button class="tab-button" :class="{ active: activeTab === 'prompts' }" @click="activeTab = 'prompts'">
          {{ t('aiConfig.tabPrompts') }}
        </button>
      </div>

      <div class="header-actions">
        <AppIconButton
          :icon="isPanelPinned ? 'fa-lock' : 'fa-unlock'"
          :title="t('characterPanel.pinToggle')"
          @click="isPanelPinned = !isPanelPinned"
        />
        <a
          class="ai-config-drawer-docs-link fa-solid fa-circle-question"
          href="https://docs.sillytavern.app/usage/common-settings/"
          target="_blank"
          :title="t('aiConfig.docsLinkTooltip')"
        ></a>
      </div>
    </div>

    <div class="ai-config-drawer-content">
      <div v-show="activeTab === 'sampler'" class="tab-content">
        <div class="ai-config-drawer-manual-input-note">{{ t('aiConfig.manualInputNote') }}</div>

        <template v-for="section in visibleSections" :key="section.id">
          <div v-for="item in getVisibleItems(section)" :key="item.id || item.widget" class="ai-config-drawer-item">
            <!-- Preset Manager -->
            <div v-if="item.widget === 'preset-manager' && item.id" class="preset-manager">
              <div class="standout-header">
                <strong>{{ item.label ? t(item.label) : '' }}</strong>
                <div class="preset-manager-actions">
                  <AppIconButton
                    icon="fa-file-import"
                    :title="t('aiConfig.presets.import')"
                    @click="apiStore.importPreset()"
                  />
                  <AppIconButton
                    icon="fa-file-export"
                    :title="t('aiConfig.presets.export')"
                    @click="apiStore.exportPreset(settingsStore.getSetting(item.id))"
                  />
                  <AppIconButton
                    icon="fa-trash-can"
                    variant="danger"
                    :title="t('aiConfig.presets.delete')"
                    @click="apiStore.deletePreset(settingsStore.getSetting(item.id))"
                  />
                </div>
              </div>
              <div class="preset-manager-controls">
                <div style="flex-grow: 1">
                  <AppSelect
                    :model-value="settingsStore.getSetting(item.id)"
                    :options="apiStore.presets.map((p) => ({ label: p.name, value: p.name }))"
                    @update:model-value="(val) => settingsStore.setSetting(item.id!, val)"
                  />
                </div>
                <AppIconButton
                  icon="fa-save"
                  :title="t('aiConfig.presets.update')"
                  @click="apiStore.updateCurrentPreset(settingsStore.getSetting(item.id))"
                />
                <AppIconButton
                  icon="fa-pencil"
                  :title="t('aiConfig.presets.rename')"
                  @click="apiStore.renamePreset(settingsStore.getSetting(item.id))"
                />
                <AppIconButton
                  icon="fa-file-circle-plus"
                  :title="t('aiConfig.presets.saveAs')"
                  @click="handleNewPreset()"
                />
              </div>
            </div>

            <!-- Slider -->
            <div v-if="item.widget === 'slider' && item.id">
              <RangeControl
                :model-value="settingsStore.getSetting(item.id)"
                :label="item.label ? t(item.label) : ''"
                :min="item.min"
                :max="item.maxUnlockedId && settingsStore.getSetting(item.maxUnlockedId) ? 131072 : item.max"
                :step="item.step"
                @update:model-value="(val) => settingsStore.setSetting(item.id!, Number(val))"
              >
                <template v-if="item.maxUnlockedId && item.unlockLabel" #addon>
                  <div class="mt-1">
                    <AppCheckbox
                      :model-value="!!settingsStore.getSetting(item.maxUnlockedId)"
                      :label="t(item.unlockLabel)"
                      :title="item.unlockTooltip ? t(item.unlockTooltip) : ''"
                      @update:model-value="(val) => settingsStore.setSetting(item.maxUnlockedId!, val)"
                    />
                  </div>
                </template>
              </RangeControl>
            </div>

            <!-- Number Input -->
            <div v-if="item.widget === 'number-input' && item.id">
              <AppInput
                type="number"
                :label="item.label ? t(item.label) : ''"
                :model-value="settingsStore.getSetting(item.id)"
                :min="item.min"
                :max="item.max"
                :step="item.step"
                @update:model-value="(val) => settingsStore.setSetting(item.id!, Number(val))"
              />
            </div>

            <!-- Textarea -->
            <div v-if="item.widget === 'textarea' && item.id">
              <AppTextarea
                :label="item.label ? t(item.label) : ''"
                :model-value="settingsStore.getSetting(item.id)"
                @update:model-value="(val) => settingsStore.setSetting(item.id!, val)"
              />
              <small v-if="item.description" class="toggle-description">{{ t(item.description) }}</small>
            </div>

            <!-- Checkbox -->
            <div v-if="item.widget === 'checkbox' && item.id">
              <AppCheckbox
                :label="item.label ? t(item.label) : ''"
                :model-value="!!settingsStore.getSetting(item.id)"
                :description="item.description ? t(item.description) : undefined"
                @update:model-value="(val) => settingsStore.setSetting(item.id!, val)"
              />
            </div>

            <!-- Select Input -->
            <div v-if="item.widget === 'select' && item.id && item.options">
              <AppSelect
                :label="item.label ? t(item.label) : ''"
                :model-value="settingsStore.getSetting(item.id)"
                :options="item.options.map((o) => ({ label: t(o.label), value: o.value }))"
                :title="item.infoTooltip ? t(item.infoTooltip) : undefined"
                @update:model-value="(val) => settingsStore.setSetting(item.id!, val)"
              />
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

      <div v-show="activeTab === 'prompts'" class="tab-content">
        <PromptManager />
      </div>
    </div>
  </div>
</template>
