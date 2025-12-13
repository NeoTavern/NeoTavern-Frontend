<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { uuidv4 } from '../../utils/commons';

interface Props {
  modelValue: string | number;
  label?: string;
  type?: 'text' | 'number' | 'search' | 'password';
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  disabled: false,
  label: undefined,
  placeholder: '',
  min: undefined,
  max: undefined,
  step: undefined,
  id: undefined,
});

const emit = defineEmits(['update:modelValue', 'input', 'change']);

// Use provided ID or generate one
const inputId = props.id || `input-${uuidv4()}`;

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
  <div class="input-wrapper">
    <label v-if="label" :for="inputId" class="input-label">{{ label }}</label>
    <input
      :id="inputId"
      class="text-pole"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :min="min"
      :max="max"
      :step="step"
      :aria-label="!label ? placeholder : undefined"
      @input="handleInput"
      @change="$emit('change', $event)"
    />
  </div>
</template>
