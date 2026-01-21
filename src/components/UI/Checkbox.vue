<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { uuidv4 } from '../../utils/commons';

const props = defineProps<{
  modelValue: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
  indeterminate?: boolean;
}>();

const emit = defineEmits(['update:modelValue']);

const inputRef = ref<HTMLInputElement | null>(null);

const checkboxId = computed(() => props.id || `checkbox-${uuidv4()}`);
const descriptionId = computed(() => (props.description ? `${checkboxId.value}-desc` : undefined));

function onChange(event: Event) {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.checked);
}

watchEffect(() => {
  if (inputRef.value) {
    inputRef.value.indeterminate = props.indeterminate ?? false;
  }
});
</script>

<template>
  <div class="checkbox-container">
    <label class="checkbox-label" :class="{ disabled }" :for="checkboxId">
      <input
        :id="checkboxId"
        ref="inputRef"
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        :aria-describedby="descriptionId"
        @change="onChange"
      />
      <span>{{ label }}</span>
    </label>
    <div v-if="description" :id="descriptionId" class="checkbox-description">
      {{ description }}
    </div>
  </div>
</template>
