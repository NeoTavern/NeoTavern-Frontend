<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useApiStore } from '../../stores/api.store';
import type { ReasoningTemplate } from '../../types';
import { FormItem, Input, Textarea } from '../UI';

const props = defineProps<{
  modelValue: ReasoningTemplate;
  isEdit?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: ReasoningTemplate): void;
}>();

const { t } = useStrictI18n();
const apiStore = useApiStore();

const template = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const nameError = computed(() => {
  if (props.isEdit) return undefined;
  if (!template.value.name) return undefined;
  const exists = apiStore.reasoningTemplates.some((t) => t.name.toLowerCase() === template.value.name.toLowerCase());
  return exists ? t('apiConnections.profileManagement.errors.nameExists') : undefined;
});
</script>

<template>
  <div class="reasoning-template-popup-content">
    <FormItem :label="t('common.name')" :error="nameError">
      <Input v-model="template.name" :disabled="isEdit" />
    </FormItem>

    <FormItem :label="t('apiConnections.reasoning.prefix')">
      <Textarea v-model="template.prefix" :rows="2" />
    </FormItem>

    <FormItem :label="t('apiConnections.reasoning.suffix')">
      <Textarea v-model="template.suffix" :rows="2" />
    </FormItem>

    <FormItem :label="t('apiConnections.reasoning.separator')">
      <Textarea v-model="template.separator" :rows="2" />
    </FormItem>
  </div>
</template>

<style scoped lang="scss">
.reasoning-template-popup-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  min-width: 300px;
}
</style>
