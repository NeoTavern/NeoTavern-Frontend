<script setup lang="ts">
import { computed, ref } from 'vue';
import { aiConfigDefinition } from '../../ai-config-definition';
import { Tabs } from '../../components/UI';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import type { AiConfigCondition } from '../../types';
import AiConfigItemRenderer from '../AiConfig/AiConfigItemRenderer.vue';
import PromptManager from '../AiConfig/PromptManager.vue';
import { SidebarHeader } from '../common';
import ApiConnectionsDrawer from './ApiConnectionsDrawer.vue';

const { t } = useStrictI18n();
const settingsStore = useSettingsStore();

const activeTab = ref<'connections' | 'sampler' | 'prompts'>('connections');

function checkConditions(conditions?: AiConfigCondition | AiConfigCondition[]): boolean {
  if (!conditions) return true;
  const conditionsList = Array.isArray(conditions) ? conditions : [conditions];

  // OR Logic: If ANY condition object in the list matches, return true.
  return conditionsList.some((cond) => {
    // AND Logic within object
    const { provider, formatter } = cond;

    if (provider) {
      const providers = Array.isArray(provider) ? provider : [provider];
      const current = settingsStore.settings.api.provider;
      if (!current || !providers.includes(current)) return false;
    }

    if (formatter) {
      const formatters = Array.isArray(formatter) ? formatter : [formatter];
      const current = settingsStore.settings.api.formatter;
      if (!current || !formatters.includes(current)) return false;
    }

    return true;
  });
}

const visibleSections = computed(() => {
  return aiConfigDefinition.filter((section) => checkConditions(section.conditions));
});

const sectionsBeforePostProcessing = computed(() => {
  const sections = visibleSections.value;
  const ppIndex = sections.findIndex((s) => s.id === 'post_processing');
  if (ppIndex === -1) return sections;
  return sections.slice(0, ppIndex);
});

const sectionsFromPostProcessing = computed(() => {
  const sections = visibleSections.value;
  const ppIndex = sections.findIndex((s) => s.id === 'post_processing');
  if (ppIndex === -1) return [];
  return sections.slice(ppIndex);
});
</script>

<template>
  <div class="ai-config-drawer">
    <SidebarHeader class="ai-config-drawer-header" :title="t('navbar.aiConfig')">
      <template #actions>
        <a
          class="ai-config-drawer-docs-link fa-solid fa-circle-question"
          href="https://docs.sillytavern.app/usage/common-settings/"
          target="_blank"
          :title="t('aiConfig.docsLinkTooltip')"
        ></a>
      </template>
    </SidebarHeader>

    <div class="sidebar-controls ai-config-drawer-controls">
      <div class="sidebar-controls-row ai-config-drawer-controls-row">
        <Tabs
          v-model="activeTab"
          style="margin-bottom: 0; border-bottom: none"
          :options="[
            { label: t('aiConfig.tabConnections'), value: 'connections' },
            { label: t('aiConfig.tabSampler'), value: 'sampler' },
            { label: t('aiConfig.tabPrompts'), value: 'prompts' },
          ]"
        />
      </div>
    </div>

    <div class="ai-config-drawer-content">
      <div v-show="activeTab === 'connections'" class="tab-content">
        <ApiConnectionsDrawer />
      </div>

      <div v-show="activeTab === 'sampler'" class="tab-content">
        <div class="ai-config-drawer-manual-input-note">{{ t('aiConfig.manualInputNote') }}</div>

        <template v-for="section in sectionsBeforePostProcessing" :key="section.id">
          <div v-for="item in section.items" :key="item.id || item.widget" class="ai-config-drawer-item">
            <AiConfigItemRenderer :item="item" />
          </div>
        </template>

        <template v-for="section in sectionsFromPostProcessing" :key="section.id">
          <div v-for="item in section.items" :key="item.id || item.widget" class="ai-config-drawer-item">
            <AiConfigItemRenderer :item="item" />
          </div>
        </template>
      </div>

      <div v-show="activeTab === 'prompts'" class="tab-content">
        <div class="completion-section">
          <h2 class="completion-title">{{ t('aiConfig.promptsTitle') }}</h2>
          <PromptManager />
        </div>
      </div>
    </div>
  </div>
</template>
