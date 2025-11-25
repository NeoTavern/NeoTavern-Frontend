<script setup lang="ts">
import ChatHeader from '../Chat/ChatHeader.vue';
import ChatInterface from '../Chat/ChatInterface.vue';
import ZoomedAvatar from '../ZoomedAvatar.vue';
import { useUiStore } from '../../stores/ui.store';

const uiStore = useUiStore();
</script>

<template>
  <ChatHeader />
  <div class="content-wrapper">
    <ChatInterface />
  </div>
  <template v-for="avatar in uiStore.zoomedAvatars" :key="avatar.id">
    <ZoomedAvatar :avatar="avatar" />
  </template>
</template>

<style scoped lang="scss">
.content-wrapper {
  height: calc(100% - var(--header-height));
  position: relative;
}
</style>
