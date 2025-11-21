<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';

interface Props {
  variant?: 'default' | 'danger' | 'confirm';
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  disabled: false,
  loading: false,
  title: undefined,
  icon: undefined,
});

const emit = defineEmits(['click']);

const classes = computed(() => {
  return {
    'menu-button': true,
    'menu-button--danger': props.variant === 'danger',
    'menu-button--confirm': props.variant === 'confirm',
    disabled: props.disabled || props.loading,
  };
});

function onClick(event: MouseEvent) {
  if (!props.disabled && !props.loading) {
    emit('click', event);
  }
}
</script>

<template>
  <button :class="classes" :disabled="disabled || loading" :title="title" @click="onClick">
    <AppIcon v-if="loading" icon="fa-spinner" spin />
    <AppIcon v-else-if="icon" :icon="icon" />
    <span v-if="$slots.default" :class="{ 'ml-2': icon || loading }">
      <slot />
    </span>
  </button>
</template>

