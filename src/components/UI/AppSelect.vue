<script setup lang="ts" generic="T extends string | number">
interface Option<T> {
  label: string;
  value: T;
  disabled?: boolean;
}

interface Props {
  modelValue: T;
  options: Option<T>[];
  label?: string;
  disabled?: boolean;
  title?: string;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: T): void;
  (e: 'change', event: Event): void;
}>();

function onChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  // We assume value is string, but for numbers we might need parsing
  // depending on usage. For strict typing, this simple cast often suffices
  // if standard HTML behavior is expected.
  const val = target.value as T;
  emit('update:modelValue', val);
  emit('change', event);
}
</script>

<template>
  <div class="app-select-wrapper">
    <label v-if="label" class="app-select-label">{{ label }}</label>
    <select class="text-pole" :value="modelValue" :disabled="disabled" :title="title" @change="onChange">
      <option v-for="opt in options" :key="String(opt.value)" :value="opt.value" :disabled="opt.disabled">
        {{ opt.label }}
      </option>
    </select>
  </div>
</template>
