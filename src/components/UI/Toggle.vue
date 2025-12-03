<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
// Replaces the toggle-switch pattern found in ExtensionsDrawer
defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  label?: string;
  title?: string;
}>();

const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <label class="toggle-label" :class="{ disabled }" :title="title">
    <span class="toggle-switch">
      <input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span class="slider"></span>
    </span>
    <span v-if="label">{{ label }}</span>
  </label>
</template>
