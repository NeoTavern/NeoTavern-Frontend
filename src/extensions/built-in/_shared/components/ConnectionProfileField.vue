<script setup lang="ts">
import { computed } from 'vue';
import { ConnectionProfileSelector } from '../../../../components/common';
import { FormItem } from '../../../../components/UI';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    label: string;
    description?: string;
    showGlobalOption?: boolean;
  }>(),
  {
    description: undefined,
    showGlobalOption: true,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const selectedProfile = computed({
  get: () => props.modelValue ?? '',
  set: (value) => emit('update:modelValue', value),
});
</script>

<template>
  <FormItem :label="label" :description="description">
    <ConnectionProfileSelector v-model="selectedProfile" :show-global-option="showGlobalOption" />
  </FormItem>
</template>
