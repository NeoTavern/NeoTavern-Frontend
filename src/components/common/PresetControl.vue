<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import type { I18nKey } from '../../types/i18n';
import { Button, Select } from '../UI';

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    options?: { label: string; value: string | number }[];
    searchable?: boolean;
    disabled?: boolean;
    loading?: boolean;

    // Tooltips
    createTitle?: I18nKey;
    editTitle?: I18nKey;
    deleteTitle?: I18nKey;
    importTitle?: I18nKey;
    exportTitle?: I18nKey;
    saveTitle?: I18nKey;

    // Visibility
    allowCreate?: boolean;
    allowEdit?: boolean;
    allowDelete?: boolean;
    allowImport?: boolean;
    allowExport?: boolean;
    allowSave?: boolean;

    deleteVariant?: 'ghost' | 'danger';
  }>(),
  {
    deleteVariant: 'ghost',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number): void;
  (e: 'create'): void;
  (e: 'edit'): void;
  (e: 'delete'): void;
  (e: 'import'): void;
  (e: 'export'): void;
  (e: 'save'): void;
}>();

const internalValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val!),
});

const { t } = useStrictI18n();
</script>

<template>
  <div class="preset-control">
    <div class="preset-control-selector">
      <slot name="selector">
        <Select
          v-if="options"
          v-model="internalValue!"
          :options="options"
          :searchable="searchable"
          :disabled="disabled"
        />
      </slot>
    </div>

    <div class="preset-control-actions">
      <Button
        v-if="allowSave"
        variant="ghost"
        icon="fa-save"
        :title="saveTitle ? t(saveTitle) : t('common.save')"
        :disabled="disabled || loading"
        @click="emit('save')"
      />
      <Button
        v-if="allowCreate"
        variant="ghost"
        icon="fa-file-circle-plus"
        :title="createTitle ? t(createTitle) : t('common.create')"
        :disabled="disabled || loading"
        @click="emit('create')"
      />
      <Button
        v-if="allowEdit"
        variant="ghost"
        icon="fa-pencil"
        :title="editTitle ? t(editTitle) : t('common.edit')"
        :disabled="disabled || loading"
        @click="emit('edit')"
      />
      <Button
        v-if="allowDelete"
        :variant="deleteVariant"
        icon="fa-trash-can"
        :title="deleteTitle ? t(deleteTitle) : t('common.delete')"
        :disabled="disabled || loading"
        @click="emit('delete')"
      />
      <Button
        v-if="allowImport"
        variant="ghost"
        icon="fa-file-import"
        :title="importTitle ? t(importTitle) : t('common.import')"
        :disabled="disabled || loading"
        @click="emit('import')"
      />
      <Button
        v-if="allowExport"
        variant="ghost"
        icon="fa-file-export"
        :title="exportTitle ? t(exportTitle) : t('common.export')"
        :disabled="disabled || loading"
        @click="emit('export')"
      />
      <slot name="actions" />
    </div>
  </div>
</template>
