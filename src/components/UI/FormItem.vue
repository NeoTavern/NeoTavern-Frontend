<script setup lang="ts">
defineProps<{
  label?: string;
  description?: string;
  error?: string;
  horizontal?: boolean;
  for?: string;
}>();
</script>

<template>
  <div class="form-item" :class="{ 'is-horizontal': horizontal, 'has-error': !!error }">
    <div v-if="label" class="form-item-label">
      <label v-if="$props.for" :for="$props.for" :title="horizontal ? description : undefined">{{ label }}</label>
      <span v-else :title="horizontal ? description : undefined">{{ label }}</span>
    </div>

    <div class="form-item-control">
      <slot />
    </div>

    <small v-if="description" class="form-item-description">{{ description }}</small>
    <small v-if="error" class="form-item-error" role="alert">{{ error }}</small>
  </div>
</template>
