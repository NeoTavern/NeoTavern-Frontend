<script setup lang="ts">
interface Props {
  modelValue: string | number;
  label?: string;
  type?: 'text' | 'number' | 'search' | 'password';
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

withDefaults(defineProps<Props>(), {
  type: 'text',
  disabled: false,
  label: undefined,
  placeholder: '',
  min: undefined,
  max: undefined,
  step: undefined,
});

const emit = defineEmits(['update:modelValue', 'input', 'change']);

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  let val: string | number = target.value;

  if (target.type === 'number') {
    val = target.valueAsNumber;
  }

  emit('update:modelValue', val);
  emit('input', event);
}
</script>

<template>
  <div class="app-input-wrapper">
    <label v-if="label" class="app-input-label">{{ label }}</label>
    <input
      class="text-pole"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :min="min"
      :max="max"
      :step="step"
      @input="handleInput"
      @change="$emit('change', $event)"
    />
  </div>
</template>
