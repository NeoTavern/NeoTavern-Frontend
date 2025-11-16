<script setup lang="ts">
import SideBar from './components/SideBar/SideBar.vue';
import ChatInterface from './components/Chat/ChatInterface.vue';
import Popup from './components/Popup/Popup.vue';
import ZoomedAvatar from './components/ZoomedAvatar.vue';
import { onMounted, computed } from 'vue';
import { useSettingsStore } from './stores/settings.store';
import { usePopupStore } from './stores/popup.store';
import { useUiStore } from './stores/ui.store';
import { useBackgroundStore } from './stores/background.store';

const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const uiStore = useUiStore();
const backgroundStore = useBackgroundStore();

const backgroundStyle = computed(() => ({
  backgroundImage: backgroundStore.currentBackgroundUrl,
}));

onMounted(() => {
  settingsStore.initializeSettings();
});
</script>

<template>
  <div id="background" :style="backgroundStyle"></div>
  <SideBar />
  <main id="main-content">
    <ChatInterface />
    <template v-for="avatar in uiStore.zoomedAvatars" :key="avatar.id">
      <ZoomedAvatar :avatar="avatar" />
    </template>
  </main>
  <template v-for="popup in popupStore.popups" :key="popup.id">
    <Popup
      v-bind="popup"
      @submit="(payload: any) => popupStore.confirm(popup.id, payload)"
      @close="popupStore.cancel(popup.id)"
    />
  </template>
</template>
