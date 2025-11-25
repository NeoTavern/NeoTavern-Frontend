<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { aiConfigDefinition } from '../../ai-config-definition';
import { SidebarHeader } from '../common';
import { Button, Tabs } from '../../components/UI';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useApiStore } from '../../stores/api.store';
import { useSettingsStore } from '../../stores/settings.store';
import type { AiConfigCondition } from '../../types';
import ApiFormattingPanel from '../AiConfig/ApiFormattingPanel.vue';
import AiConfigItemRenderer from '../AiConfig/AiConfigItemRenderer.vue';
import PromptManager from '../AiConfig/PromptManager.vue';
import ApiConnectionsDrawer from './ApiConnectionsDrawer.vue';

const { t } = useStrictI18n();
const apiStore = useApiStore();
const settingsStore = useSettingsStore();

const activeTab = ref<'connections' | 'sampler' | 'completions'>('connections');
const completionMode = ref<'chat' | 'text'>('chat');
const isPanelPinned = ref(false);
const completionModeTabValue = computed<'chat' | 'text' | ''>({
  get: () => (activeTab.value === 'completions' ? completionMode.value : ''),
  set: (mode) => {
    if (mode === 'chat' || mode === 'text') {
      completionMode.value = mode;
      activeTab.value = 'completions';
    }
  },
});

function checkConditions(conditions?: AiConfigCondition): boolean {
  if (!conditions) return true;
  if (conditions.provider) {
    const providers = Array.isArray(conditions.provider) ? conditions.provider : [conditions.provider];
    const current = settingsStore.settings.api.provider;
    if (!current || !providers.includes(current)) return false;
  }
  return true;
}

const visibleSections = computed(() => {
  return aiConfigDefinition.filter((section) => checkConditions(section.conditions));
});

watch(completionMode, () => {
  activeTab.value = 'completions';
});

onMounted(() => {
  apiStore.loadPresetsForApi();
  apiStore.loadInstructTemplates();
});
</script>

<template>
  <div class="ai-config-drawer">
    <SidebarHeader class="ai-config-drawer-header" :title="t('navbar.aiConfig')">
      <template #actions>
        <Button
          variant="ghost"
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
      </template>
    </SidebarHeader>

    <div class="sidebar-controls ai-config-drawer-controls">
      <div class="sidebar-controls__row ai-config-drawer-controls-row">
        <Tabs
          v-model="activeTab"
          style="margin-bottom: 0; border-bottom: none"
          :options="[
            { label: t('aiConfig.tabConnections'), value: 'connections' },
            { label: t('aiConfig.tabSampler'), value: 'sampler' },
          ]"
        />

        <div class="completion-mode">
          <span class="completion-mode-label">{{ t('aiConfig.modeLabel') }}</span>
          <Tabs
            v-model="completionModeTabValue"
            :options="[
              { label: t('aiConfig.modeChat'), value: 'chat' },
              { label: t('aiConfig.modeText'), value: 'text' },
            ]"
          />
        </div>
      </div>
    </div>

    <div class="ai-config-drawer-content">
      <div v-show="activeTab === 'connections'" class="tab-content">
        <ApiConnectionsDrawer />
      </div>

      <div v-show="activeTab === 'sampler'" class="tab-content">
        <div class="ai-config-drawer-manual-input-note">{{ t('aiConfig.manualInputNote') }}</div>

        <template v-for="section in visibleSections" :key="section.id">
          <div v-for="item in section.items" :key="item.id || item.widget" class="ai-config-drawer-item">
            <AiConfigItemRenderer :item="item" />
          </div>
        </template>
      </div>

      <div v-show="activeTab === 'completions'" class="tab-content">
        <div v-if="completionMode === 'chat'" class="completion-section">
          <h2 class="completion-title">{{ t('aiConfig.chatCompletionTitle') }}</h2>
          <p class="completion-subtitle">{{ t('aiConfig.chatCompletionSubtitle') }}</p>
          <PromptManager />
        </div>

        <div v-else class="completion-section">
          <h2 class="completion-title">{{ t('aiConfig.textCompletionTitle') }}</h2>
          <p class="completion-subtitle">{{ t('aiConfig.textCompletionSubtitle') }}</p>
          <ApiFormattingPanel />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ai-config-drawer-item {
  margin-bottom: 16px;
  &:empty {
    display: none;
  }
}

.ai-config-drawer-controls-row :deep(.tabs) {
  margin-bottom: 0;
  padding-bottom: 0;
}

.completion-mode {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 4px 12px;
  border-radius: var(--base-border-radius);
  background: var(--grey-30a);
}

.completion-mode :deep(.tabs) {
  gap: 8px;
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
  font-size: smaller;
}

.completion-mode-label {
  font-weight: 600;
  font-size: smaller;
}

.completion-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.completion-title {
  margin: 0;
}

.completion-subtitle {
  margin: 0;
  color: var(--text-secondary);
}
</style>
