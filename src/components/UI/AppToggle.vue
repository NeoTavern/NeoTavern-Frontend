<script setup lang="ts">
// Replaces the toggle-switch pattern found in ExtensionsDrawer
defineProps<{
  modelValue: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits(['update:modelValue']);
</script>

<template>
  <label class="toggle-switch" :class="{ disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="slider"></span>
  </label>
</template>
