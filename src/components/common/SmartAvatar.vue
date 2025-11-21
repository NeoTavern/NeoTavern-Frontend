<script setup lang="ts">
defineProps<{
  urls: string[];
  alt?: string;
}>();

function onImgError(event: Event) {
  const img = event.target as HTMLImageElement;
  // Fallback to default AI avatar if load fails
  img.src = 'img/ai4.png';
}
</script>

<template>
  <div class="smart-avatar">
    <template v-if="urls.length > 1">
      <div class="smart-avatar-grid">
        <img
          v-for="(url, index) in urls.slice(0, 4)"
          :key="index"
          :src="url"
          :alt="alt"
          class="smart-avatar-grid-img"
          @error="onImgError"
        />
      </div>
    </template>
    <template v-else>
      <img :src="urls[0] || 'img/ai4.png'" :alt="alt" class="smart-avatar-img" @error="onImgError" />
    </template>
  </div>
</template>
