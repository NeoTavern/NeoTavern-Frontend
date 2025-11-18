<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useStrictI18n } from '@/composables/useStrictI18n';

const { t } = useStrictI18n();
const time = ref(new Date().toLocaleTimeString());
const intervalId = ref<number | null>(null);

onMounted(() => {
  intervalId.value = window.setInterval(() => {
    time.value = new Date().toLocaleTimeString();
  }, 1000);
});

onUnmounted(() => {
  if (intervalId.value) {
    clearInterval(intervalId.value);
  }
});
</script>

<template>
  <div class="clock-widget">
    <div class="clock-widget__icon">
      <i class="fa-regular fa-clock"></i>
    </div>
    <div class="clock-widget__content">
      <div class="clock-widget__label">{{ t('common.of') }} Time</div>
      <div class="clock-widget__time">{{ time }}</div>
    </div>
  </div>
</template>

<style scoped>
.clock-widget {
  display: flex;
  align-items: center;
  padding: 10px;
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: 5px;
  margin-bottom: 10px;
  color: var(--theme-text-color);
}

.clock-widget__icon {
  font-size: 1.5rem;
  margin-right: 10px;
  color: var(--theme-emphasis-color);
}

.clock-widget__content {
  display: flex;
  flex-direction: column;
}

.clock-widget__label {
  font-size: 0.7rem;
  text-transform: uppercase;
  opacity: 0.7;
}

.clock-widget__time {
  font-size: 1.1rem;
  font-weight: bold;
  font-family: var(--font-family-mono);
}
</style>
