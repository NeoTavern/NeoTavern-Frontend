<script setup lang="ts">
import { computed } from 'vue';
import { FormItem, Input } from '../../../../components/UI';

const props = defineProps<{
  modelValue: number;
  label: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number];
}>();

const value = computed({
  get: () => props.modelValue,
  set: (nextValue) => emit('update:modelValue', Number(nextValue)),
});
</script>

<template>
  <FormItem :label="label" :description="description">
    <Input v-model.number="value" type="number" :min="min" :max="max" :step="step" />
  </FormItem>
</template>
