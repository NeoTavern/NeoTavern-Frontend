<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import Icon from './Icon.vue';

interface Props {
  variant?: 'default' | 'danger' | 'confirm' | 'ghost';
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  title?: string;
  active?: boolean;
  role?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  disabled: false,
  loading: false,
  title: undefined,
  icon: undefined,
  active: false,
  role: undefined,
});

const { t } = useStrictI18n();

const emit = defineEmits(['click']);

const classes = computed(() => {
  return {
    'menu-button': true,
    'menu-button--danger': props.variant === 'danger',
    'menu-button--confirm': props.variant === 'confirm',
    'menu-button--ghost': props.variant === 'ghost',
    disabled: props.disabled || props.loading,
    active: props.active,
  };
});

const ariaLabel = computed(() => {
  if (props.loading) {
    return props.title ? `${props.title} (${t('common.loadingButton')})` : t('common.loadingButton');
  }
  if (props.title && props.icon) {
    return props.title;
  }
  return undefined;
});

// If the button is "active" (toggled on), denote it for screen readers
const ariaPressed = computed(() => {
  return props.active ? 'true' : undefined;
});

function onClick(event: MouseEvent) {
  if (!props.disabled && !props.loading) {
    emit('click', event);
  }
}
</script>

<template>
  <button
    :class="classes"
    :disabled="disabled || loading"
    :title="title"
    :aria-label="ariaLabel"
    :aria-busy="loading"
    :aria-pressed="ariaPressed"
    :role="role"
    @click="onClick"
  >
    <Icon v-if="loading" icon="fa-spinner" spin aria-hidden="true" />
    <Icon v-else-if="icon" :icon="icon" aria-hidden="true" />
    <span v-if="$slots.default" :class="{ 'ml-2': icon || loading }">
      <slot />
    </span>
  </button>
</template>
