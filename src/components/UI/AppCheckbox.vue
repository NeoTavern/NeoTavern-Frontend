<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
}>();

const emit = defineEmits(['update:modelValue']);

function onChange(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.checked);
}
</script>

<template>
  <div class="app-checkbox-container">
    <label class="checkbox-label" :class="{ disabled }">
      <input type="checkbox" :checked="modelValue" :disabled="disabled" @change="onChange" />
      <span>{{ label }}</span>
    </label>
    <div v-if="description" class="checkbox-description">{{ description }}</div>
  </div>
</template>
