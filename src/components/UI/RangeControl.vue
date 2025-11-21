<script setup lang="ts">
interface Props {
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  disabled?: boolean;
}

withDefaults(defineProps<Props>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  label: undefined,
});

const emit = defineEmits(['update:modelValue']);

function update(val: number | string) {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (!isNaN(num)) {
    emit('update:modelValue', num);
  }
}
</script>

<template>
  <div class="range-block">
    <div v-if="label" class="range-block-title">{{ label }}</div>
    <div class="range-block-range-and-counter">
      <input
        type="range"
        class="neo-range-slider"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :disabled="disabled"
        @input="update(($event.target as HTMLInputElement).value)"
      />
      <input
        type="number"
        class="neo-range-input"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :disabled="disabled"
        @input="update(($event.target as HTMLInputElement).value)"
      />
    </div>
    <div v-if="$slots.addon" class="range-block-addon">
      <slot name="addon" />
    </div>
  </div>
</template>

