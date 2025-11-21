<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';

const props = defineProps<{
  icon: string;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'danger';
}>();

const emit = defineEmits(['click']);

const classes = computed(() => {
  return {
    'menu-button-icon': true,
    active: props.active,
    disabled: props.disabled,
    'menu-button--danger': props.variant === 'danger',
  };
});
</script>

<template>
  <div :class="classes" :title="title" @click="!disabled && emit('click', $event)">
    <AppIcon :icon="icon" fixed-width />
  </div>
</template>
