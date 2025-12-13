<script setup lang="ts">
import { useStrictI18n } from '../../composables/useStrictI18n';
import { uuidv4 } from '../../utils/commons';

const { t } = useStrictI18n();

interface Props {
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  disabled?: boolean;
  title?: string;
  id?: string;
}

const props = withDefaults(defineProps<Props>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  label: undefined,
  title: undefined,
  id: undefined,
});

const emit = defineEmits(['update:modelValue']);

const baseId = props.id || `range-${uuidv4()}`;
const inputId = `${baseId}-input`;
const numberId = `${baseId}-number`;
const labelId = props.label ? `${baseId}-label` : undefined;

function update(val: number | string) {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (!isNaN(num)) {
    emit('update:modelValue', num);
  }
}
</script>

<template>
  <div class="range-block" :title="title" role="group" :aria-labelledby="labelId">
    <div v-if="label" :id="labelId" class="range-block-title">
      <label :for="inputId">{{ label }}</label>
    </div>
    <div class="range-block-range-and-counter">
      <input
        :id="inputId"
        type="range"
        class="neo-range-slider"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :disabled="disabled"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuenow="modelValue"
        :aria-label="!label ? t('a11y.rangeControl.value') : undefined"
        @input="update(($event.target as HTMLInputElement).value)"
      />
      <input
        :id="numberId"
        type="number"
        class="neo-range-input"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :disabled="disabled"
        :aria-label="label ? `${label} ${t('a11y.rangeControl.valueLower')}` : t('a11y.rangeControl.value')"
        @input="update(($event.target as HTMLInputElement).value)"
      />
    </div>
    <div v-if="$slots.addon" class="range-block-addon">
      <slot name="addon" />
    </div>
  </div>
</template>
