<script setup lang="ts">
import { computed, ref } from 'vue';
import { FormItem, Textarea } from '../../../../components/UI';
import PresetControl from '../../../../components/common/PresetControl.vue';
import type { I18nKey } from '../../../../types/i18n';
import type { JsonObject } from '../generic/json';
import type { NamedMapSchema } from './configuration-controls';

const props = defineProps<{
  mapKey: string;
  schema: NamedMapSchema;
  value: JsonObject;
  selectedKey: string;
  texts: Record<string, string>;
  errors: Record<string, string>;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  (event: 'select', value: string): void;
  (event: 'create'): void;
  (event: 'duplicate'): void;
  (event: 'rename'): void;
  (event: 'delete'): void;
  (event: 'export-active'): void;
  (event: 'export-all'): void;
  (event: 'import-file', file: File, mode: 'single' | 'bundle'): void;
  (event: 'section', section: string, value: string): void;
}>();
const names = computed(() => Object.keys(props.value));
const selectedValue = computed(() => {
  const value = props.value[props.selectedKey];
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
});
const bufferKey = (section: string) => `config/${props.mapKey}/${props.selectedKey}/${section}`;
const sectionText = (section: string) =>
  props.texts[bufferKey(section)] ?? JSON.stringify(selectedValue.value?.[section] ?? null, null, 2);
const minimum = computed(() => props.schema.property.minProperties ?? 0);
const fileInput = ref<HTMLInputElement>();
const importMode = ref<'single' | 'bundle'>('bundle');
const requestImport = (mode: 'single' | 'bundle') => {
  if (props.disabled) return;
  importMode.value = mode;
  fileInput.value?.click();
};
const importFile = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file && !props.disabled) emit('import-file', file, importMode.value);
};
const customActions = computed(() => [
  ...(selectedValue.value
    ? [
        {
          key: 'duplicate',
          icon: 'fa-copy',
          title: 'extensionsBuiltin.customAgents.duplicateCollection' as I18nKey,
          event: 'duplicate',
        },
        {
          key: 'exportActive',
          icon: 'fa-file-export',
          title: 'extensionsBuiltin.customAgents.exportActiveCollection' as I18nKey,
          event: 'exportActive',
        },
      ]
    : []),
  ...(names.value.length
    ? [
        {
          key: 'exportAll',
          icon: 'fa-file-export',
          title: 'extensionsBuiltin.customAgents.exportAllCollections' as I18nKey,
          event: 'exportAll',
        },
      ]
    : []),
  {
    key: 'importSingle',
    icon: 'fa-file-import',
    title: 'extensionsBuiltin.customAgents.importSingleCollection' as I18nKey,
    event: 'importSingle',
  },
]);
</script>

<template>
  <section class="named-map-field">
    <PresetControl
      :model-value="selectedKey"
      :options="names.map((name) => ({ label: name, value: name }))"
      :actions-disabled="disabled"
      searchable
      allow-create
      :allow-edit="Boolean(selectedValue)"
      :allow-delete="Boolean(selectedValue) && names.length > minimum"
      allow-import
      :custom-actions="customActions"
      :action-order="['create', 'duplicate', 'edit', 'delete', 'exportActive', 'exportAll', 'importSingle', 'import']"
      :create-title="'extensionsBuiltin.customAgents.createCollection'"
      :edit-title="'extensionsBuiltin.customAgents.renameCollection'"
      :delete-title="'extensionsBuiltin.customAgents.deleteCollection'"
      :import-title="'extensionsBuiltin.customAgents.importAllCollections'"
      @update:model-value="emit('select', String($event))"
      @create="emit('create')"
      @duplicate="emit('duplicate')"
      @edit="emit('rename')"
      @delete="emit('delete')"
      @export-active="emit('export-active')"
      @export-all="emit('export-all')"
      @import-single="requestImport('single')"
      @import="requestImport('bundle')"
    />
    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json"
      hidden
      :disabled="disabled"
      @change="importFile"
    />
    <template v-if="selectedValue">
      <FormItem
        v-for="(sectionSchema, section) in schema.entry.properties"
        :key="section"
        :error="errors[bufferKey(section)]"
      >
        <Textarea
          :label="sectionSchema.title ?? section"
          :model-value="sectionText(section)"
          :rows="6"
          @update:model-value="emit('section', section, $event)"
        />
      </FormItem>
    </template>
  </section>
</template>
