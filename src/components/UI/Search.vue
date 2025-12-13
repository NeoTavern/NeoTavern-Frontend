<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { useStrictI18n } from '../../composables/useStrictI18n';
import Input from './Input.vue';

defineProps<{
  modelValue: string;
  placeholder?: string;
  label?: string;
}>();

const emit = defineEmits(['update:modelValue']);
const { t } = useStrictI18n();
</script>

<template>
  <div class="search-bar" role="search" :aria-label="label || t('common.search')">
    <div class="search-input-wrapper">
      <Input
        type="search"
        :model-value="modelValue"
        :placeholder="placeholder"
        :label="!label ? placeholder || t('common.search') : undefined"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>

    <!-- Slot for Sort Select or Filter buttons -->
    <div v-if="$slots.actions" class="search-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
