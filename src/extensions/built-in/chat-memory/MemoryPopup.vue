<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { FormItem, Tabs } from '../../../components/UI';
import type { ExtensionAPI } from '../../../types';
import LorebookTab from './components/LorebookTab.vue';
import MessageSummariesTab from './components/MessageSummariesTab.vue';
import { type ChatMemoryMetadata, type ExtensionSettings, type MemoryMessageExtra } from './types';

const props = defineProps<{
  api: ExtensionAPI<ExtensionSettings, ChatMemoryMetadata, MemoryMessageExtra>;
}>();

const t = props.api.i18n.t;

// --- Tabs ---
const activeTab = ref('lorebook');
const tabs = computed(() => [
  { label: t('extensionsBuiltin.chatMemory.tabs.lorebook'), value: 'lorebook', icon: 'fa-book-atlas' },
  { label: t('extensionsBuiltin.chatMemory.tabs.messages'), value: 'messages', icon: 'fa-message' },
]);

// --- Shared State ---
const connectionProfile = ref<string | undefined>(undefined);

// --- Lifecycle ---
onMounted(async () => {
  loadState();
});

// Auto-save settings
watch([connectionProfile], () => {
  saveGlobalSettings();
});

watch(activeTab, () => {
  saveTabState();
});

// --- Common Methods ---
function loadState() {
  // Global
  const settings = props.api.settings.get();
  if (settings) {
    if (settings.connectionProfile) connectionProfile.value = settings.connectionProfile;
  }

  // Metadata
  const currentMetadata = props.api.chat.metadata.get();
  const memoryExtra = currentMetadata?.extra?.['core.chat-memory'];
  if (memoryExtra?.activeTab) {
    activeTab.value = memoryExtra.activeTab;
  }
}

function saveGlobalSettings() {
  props.api.settings.set('connectionProfile', connectionProfile.value);
  props.api.settings.save();
}

function saveTabState() {
  const currentMetadata = props.api.chat.metadata.get();
  if (!currentMetadata) return;

  props.api.chat.metadata.update({
    extra: {
      'core.chat-memory': {
        memories: currentMetadata.extra?.['core.chat-memory']?.memories || [],
        activeTab: activeTab.value,
      },
    },
  });
}
</script>

<template>
  <div class="memory-popup">
    <!-- Header -->
    <div class="header-controls">
      <Tabs v-model="activeTab" :options="tabs" class="main-tabs" />
    </div>

    <!-- Connection Profile Global Setting for the Popup -->
    <div class="profile-section">
      <FormItem
        :label="t('extensionsBuiltin.chatMemory.labels.connectionProfile')"
        :description="t('extensionsBuiltin.chatMemory.labels.connectionProfileDesc')"
      >
        <ConnectionProfileSelector v-model="connectionProfile" />
      </FormItem>
    </div>

    <!-- Content Area -->
    <div class="tab-content-area">
      <LorebookTab v-if="activeTab === 'lorebook'" :api="api" :connection-profile="connectionProfile" />
      <MessageSummariesTab v-if="activeTab === 'messages'" :api="api" :connection-profile="connectionProfile" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.memory-popup {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 10px;
  max-height: 80vh;
  overflow-y: auto;
  height: 100%;
}

.header-controls {
  display: flex;
  justify-content: center;
  margin-bottom: 5px;
}

.profile-section {
  border-bottom: 1px solid var(--theme-border-color);
  padding-bottom: 15px;
  margin-bottom: 15px;
}

.tab-content-area {
  flex: 1;
  min-height: 0;
}
</style>
