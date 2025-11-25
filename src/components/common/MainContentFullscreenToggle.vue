<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../../stores/settings.store';
import { Button } from '../UI';

const settingsStore = useSettingsStore();
const isFullScreen = computed(() => settingsStore.settings.account.chatFullScreen);

function toggleFullScreen() {
  settingsStore.settings.account.chatFullScreen = !settingsStore.settings.account.chatFullScreen;
}
</script>

<template>
  <Button
    variant="ghost"
    :icon="isFullScreen ? 'fa-compress' : 'fa-expand'"
    :active="isFullScreen"
    title="Toggle Full Screen"
    @click="toggleFullScreen"
  />
</template>
