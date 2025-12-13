<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed } from 'vue';
import { uuidv4 } from '../../utils/commons';

const props = defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  title?: string;
  label?: string;
  id?: string;
}>();

const emit = defineEmits(['update:modelValue']);

const toggleId = computed(() => props.id || `toggle-${uuidv4()}`);

function toggle() {
  if (!props.disabled) {
    emit('update:modelValue', !props.modelValue);
  }
}
</script>

<template>
  <label
    class="toggle-label"
    :class="{ disabled }"
    :title="title"
    :for="toggleId"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <span class="toggle-switch">
      <input
        :id="toggleId"
        type="checkbox"
        role="switch"
        :aria-checked="modelValue"
        :aria-label="label || title"
        :checked="modelValue"
        :disabled="disabled"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span class="slider" aria-hidden="true"></span>
    </span>
    <span v-if="label" class="sr-only">{{ label }}</span>
  </label>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
</style>
