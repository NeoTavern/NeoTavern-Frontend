<script setup lang="ts">
import { ref } from 'vue';
import { Tabs } from '../../../components/UI';
import DashboardTab from './components/DashboardTab.vue';
import LogTab from './components/LogTab.vue';
import NpcTab from './components/NpcTab.vue';
import SceneTab from './components/SceneTab.vue';
import ThreadsTab from './components/ThreadsTab.vue';
import type { MythicExtensionAPI } from './types';

interface Props {
  api: MythicExtensionAPI;
}

const props = defineProps<Props>();

const t = props.api.i18n.t;
const activeTab = ref('dashboard');

const tabs = [
  { label: t('extensionsBuiltin.mythicAgents.panel.tabs.dashboard'), value: 'dashboard' },
  { label: t('extensionsBuiltin.mythicAgents.panel.tabs.scene'), value: 'scene' },
  { label: t('extensionsBuiltin.mythicAgents.panel.tabs.npcs'), value: 'npcs' },
  { label: t('extensionsBuiltin.mythicAgents.panel.tabs.threads'), value: 'threads' },
  { label: t('extensionsBuiltin.mythicAgents.panel.tabs.log'), value: 'log' },
];
</script>

<template>
  <div class="mythic-panel">
    <div class="tabs-container">
      <Tabs v-model="activeTab" :options="tabs" />
    </div>
    <div class="tab-content">
      <DashboardTab v-if="activeTab === 'dashboard'" :api="api" />
      <SceneTab v-if="activeTab === 'scene'" :api="api" />
      <NpcTab v-if="activeTab === 'npcs'" :api="api" />
      <ThreadsTab v-if="activeTab === 'threads'" :api="api" />
      <LogTab v-if="activeTab === 'log'" :api="api" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.mythic-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.tabs-container {
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--theme-border-color);
  background-color: var(--theme-background-tint);
  flex-shrink: 0;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: var(--theme-background-tint);
}
</style>
