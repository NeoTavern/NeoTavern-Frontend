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

defineProps<Props>();

const activeTab = ref('dashboard');

const tabs = [
  { label: 'Dashboard', value: 'dashboard' },
  { label: 'Scene', value: 'scene' },
  { label: 'NPCs', value: 'npcs' },
  { label: 'Threads', value: 'threads' },
  { label: 'Log', value: 'log' },
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
