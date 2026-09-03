<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { FormItem, Input, Select, Textarea, Toggle } from '../../../../components/UI';
import { ConnectionProfileSelector } from '../../../../components/common';
import { downloadFile } from '../../../../utils/commons';
import ConfigurationNamedMapField from './ConfigurationNamedMapField.vue';
import type { GraphPreset, JsonObject, JsonValue } from '../graph/contracts';
import type { CustomAgentsHostAPI } from '../host/api';
import { validateSchemaValue } from '../generic/schema';
import {
  namedMapActiveProperty,
  namedMapSchema,
  normalizedNamedMapName,
  type ConfigurationProperty,
  type NamedMapSchema,
} from './configuration-controls';
import { jsonValuesEqual } from '../views/bindings';
import {
  bundleNamedMapTransfer,
  namedMapFilename,
  parseNamedMapTransfer,
  singleNamedMapTransfer,
} from './named-map-transfer';

const props = defineProps<{ preset: GraphPreset; t: CustomAgentsHostAPI['i18n']['t'] }>();
const emit = defineEmits<{ update: [configuration: JsonObject] }>();
type PropertySchema = JsonObject & { title?: string; type?: string; enum?: JsonValue[] };
const properties = computed(() => {
  const value = props.preset.agent.configurationSchema.properties;
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, PropertySchema>)
    : {};
});
const buffers = ref<Record<string, string>>({});
const errors = ref<Record<string, string>>({});
const mapSelections = ref<Record<string, string>>({});
watch(
  () => props.preset.agent.id,
  () => {
    buffers.value = {};
    errors.value = {};
    mapSelections.value = {};
  },
);

function commit(key: string, value: JsonValue): void {
  const next = structuredClone(props.preset.agent.configurationDefaults);
  next[key] = structuredClone(value);
  const checked = validateSchemaValue(props.preset.agent.configurationSchema, next, 'agent.configurationDefaults');
  if (!checked.valid) {
    errors.value = { ...errors.value, [key]: checked.errors.join('\n') };
    return;
  }
  const updated = { ...errors.value };
  delete updated[key];
  errors.value = updated;
  emit('update', checked.value as JsonObject);
}

function structured(key: string, text: string): void {
  buffers.value = { ...buffers.value, [key]: text };
  try {
    commit(key, JSON.parse(text) as JsonValue);
  } catch (error) {
    errors.value = { ...errors.value, [key]: error instanceof Error ? error.message : String(error) };
  }
}

function numericValue(key: string): string {
  return buffers.value[key] ?? String(props.preset.agent.configurationDefaults[key] ?? '');
}

function numeric(key: string, type: 'number' | 'integer', text: string): void {
  buffers.value = { ...buffers.value, [key]: text };
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) return;
  commit(key, value);
}

function mapSchema(schema: PropertySchema): NamedMapSchema | undefined {
  return namedMapSchema(schema as ConfigurationProperty);
}

function mapValue(key: string): JsonObject {
  const value = props.preset.agent.configurationDefaults[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mapReference(key: string): string | undefined {
  return namedMapActiveProperty(properties.value as Record<string, ConfigurationProperty>, key);
}

function selectedMapKey(key: string): string {
  const map = mapValue(key);
  const reference = mapReference(key);
  if (reference) {
    const active = props.preset.agent.configurationDefaults[reference];
    return typeof active === 'string' && Object.hasOwn(map, active) ? active : '';
  }
  const local = mapSelections.value[key];
  return local && Object.hasOwn(map, local) ? local : (Object.keys(map)[0] ?? '');
}

function commitConfiguration(mutator: (configuration: JsonObject) => void): boolean {
  const next = structuredClone(props.preset.agent.configurationDefaults);
  mutator(next);
  const checked = validateSchemaValue(props.preset.agent.configurationSchema, next, 'agent.configurationDefaults');
  if (!checked.valid) {
    errors.value = { ...errors.value, _map: checked.errors.join('\n') };
    return false;
  }
  const nextErrors = { ...errors.value };
  delete nextErrors._map;
  errors.value = nextErrors;
  emit('update', checked.value as JsonObject);
  return true;
}

function requestMapName(): string | undefined {
  const requested = window.prompt(props.t('extensionsBuiltin.customAgents.collectionName'));
  return requested === null ? undefined : normalizedNamedMapName(requested);
}

function selectMap(key: string, name: string): void {
  if (!Object.hasOwn(mapValue(key), name)) return;
  const reference = mapReference(key);
  if (reference) commitConfiguration((configuration) => (configuration[reference] = name));
  else mapSelections.value = { ...mapSelections.value, [key]: name };
}

function copyMap(key: string, duplicate: boolean): void {
  const source = selectedMapKey(key);
  const current = mapValue(key);
  const name = requestMapName();
  if (!source || !name || Object.hasOwn(current, name)) return;
  if (
    commitConfiguration((configuration) => {
      (configuration[key] as JsonObject)[name] = structuredClone(current[source]!);
      const reference = mapReference(key);
      if (reference) configuration[reference] = name;
    }) &&
    !mapReference(key)
  )
    mapSelections.value = { ...mapSelections.value, [key]: name };
  if (!duplicate) delete errors.value._map;
}

function renameMap(key: string): void {
  const source = selectedMapKey(key);
  const current = mapValue(key);
  const name = requestMapName();
  if (!source || !name || name === source || Object.hasOwn(current, name)) return;
  const reference = mapReference(key);
  if (
    commitConfiguration((configuration) => {
      configuration[key] = Object.fromEntries(
        Object.entries(configuration[key] as JsonObject).map(([entry, value]) => [
          entry === source ? name : entry,
          value,
        ]),
      );
      if (reference && configuration[reference] === source) configuration[reference] = name;
    }) &&
    !reference
  )
    mapSelections.value = { ...mapSelections.value, [key]: name };
}

function deleteMap(key: string, schema: NamedMapSchema): void {
  const source = selectedMapKey(key);
  const names = Object.keys(mapValue(key));
  if (!source || names.length <= (schema.property.minProperties ?? 0)) return;
  if (!window.confirm(props.t('extensionsBuiltin.customAgents.confirmDeleteCollection'))) return;
  const next = names[names.indexOf(source) + 1] ?? names[names.indexOf(source) - 1] ?? '';
  const reference = mapReference(key);
  if (
    commitConfiguration((configuration) => {
      delete (configuration[key] as JsonObject)[source];
      if (reference && configuration[reference] === source) configuration[reference] = next;
    }) &&
    !reference
  )
    mapSelections.value = { ...mapSelections.value, [key]: next };
}

function exportMap(key: string, all: boolean): void {
  const map = mapValue(key);
  const selected = selectedMapKey(key);
  if (!all && (!selected || map[selected] === undefined)) return;
  const transfer = all ? bundleNamedMapTransfer(map) : singleNamedMapTransfer(selected, map[selected]!);
  downloadFile(
    JSON.stringify(transfer, null, 2),
    namedMapFilename(props.preset.agent.id, key, all ? 'all' : selected),
    'application/json',
  );
}

async function importMap(key: string, schema: NamedMapSchema, file: File, mode: 'single' | 'bundle'): Promise<void> {
  try {
    const entries = parseNamedMapTransfer(await file.text(), mode);
    const current = mapValue(key);
    for (const entry of entries) {
      if (Object.hasOwn(current, entry.name)) throw new Error(`Collection already exists: ${entry.name}`);
      const checked = validateSchemaValue(
        schema.entry as unknown as JsonObject,
        entry.value,
        `configuration.${key}.${entry.name}`,
      );
      if (!checked.valid) throw new Error(checked.errors.join('\n'));
    }
    const first = entries[0]!.name;
    const reference = mapReference(key);
    if (
      commitConfiguration((configuration) => {
        for (const entry of entries) (configuration[key] as JsonObject)[entry.name] = structuredClone(entry.value);
        if (reference) configuration[reference] = first;
      }) &&
      !reference
    )
      mapSelections.value = { ...mapSelections.value, [key]: first };
  } catch (error) {
    errors.value = { ...errors.value, _map: error instanceof Error ? error.message : String(error) };
  }
}

function updateMapSection(key: string, schema: NamedMapSchema, section: string, text: string): void {
  const selected = selectedMapKey(key);
  const bufferKey = `config/${key}/${selected}/${section}`;
  buffers.value = { ...buffers.value, [bufferKey]: text };
  try {
    const parsed = JSON.parse(text) as JsonValue;
    const sectionResult = validateSchemaValue(
      schema.entry.properties[section] as unknown as JsonObject,
      parsed,
      `configuration.${key}.${selected}.${section}`,
    );
    if (!sectionResult.valid) throw new Error(sectionResult.errors.join('\n'));
    if (
      !commitConfiguration((configuration) => {
        ((configuration[key] as JsonObject)[selected] as JsonObject)[section] = sectionResult.value;
      })
    )
      return;
    const nextErrors = { ...errors.value };
    delete nextErrors[bufferKey];
    errors.value = nextErrors;
  } catch (error) {
    errors.value = { ...errors.value, [bufferKey]: error instanceof Error ? error.message : String(error) };
  }
}

function enumOptions(schema: PropertySchema) {
  return (schema.enum ?? []).map((value, index) => ({
    label: typeof value === 'string' ? value : JSON.stringify(value),
    value: String(index),
  }));
}
</script>

<template>
  <fieldset class="custom-agent-panel">
    <legend>{{ t('extensionsBuiltin.customAgents.configuration') }}</legend>
    <p v-if="Object.keys(properties).length === 0">{{ t('extensionsBuiltin.customAgents.noConfiguration') }}</p>
    <p v-if="errors._map" class="error">{{ errors._map }}</p>
    <FormItem v-for="(schema, key) in properties" :key="key" :label="schema.title ?? key" :error="errors[key]">
      <Toggle
        v-if="schema.type === 'boolean'"
        :model-value="Boolean(preset.agent.configurationDefaults[key])"
        :label="schema.title ?? key"
        @update:model-value="commit(key, $event)"
      />
      <ConfigurationNamedMapField
        v-else-if="mapSchema(schema)"
        :map-key="key"
        :schema="mapSchema(schema)!"
        :value="mapValue(key)"
        :selected-key="selectedMapKey(key)"
        :texts="buffers"
        :errors="errors"
        @select="selectMap(key, $event)"
        @create="copyMap(key, false)"
        @duplicate="copyMap(key, true)"
        @rename="renameMap(key)"
        @delete="deleteMap(key, mapSchema(schema)!)"
        @export-active="exportMap(key, false)"
        @export-all="exportMap(key, true)"
        @import-file="(file, mode) => importMap(key, mapSchema(schema)!, file, mode)"
        @section="(section, text) => updateMapSection(key, mapSchema(schema)!, section, text)"
      />
      <ConnectionProfileSelector
        v-else-if="key === 'connectionProfileId'"
        :model-value="String(preset.agent.configurationDefaults[key] ?? '')"
        @update:model-value="commit(key, $event ?? '')"
      />
      <Select
        v-else-if="schema.enum"
        :model-value="
          String(schema.enum.findIndex((value) => jsonValuesEqual(value, preset.agent.configurationDefaults[key]!)))
        "
        :options="enumOptions(schema)"
        @update:model-value="commit(key, schema.enum![Number($event)]!)"
      />
      <Input
        v-else-if="schema.type === 'string'"
        type="text"
        :model-value="(preset.agent.configurationDefaults[key] as string) ?? ''"
        @update:model-value="commit(key, String($event))"
      />
      <Input
        v-else-if="schema.type === 'number' || schema.type === 'integer'"
        type="text"
        :model-value="numericValue(key)"
        @update:model-value="numeric(key, schema.type, String($event))"
      />
      <Textarea
        v-else
        :model-value="buffers[key] ?? JSON.stringify(preset.agent.configurationDefaults[key] ?? null, null, 2)"
        :rows="6"
        @update:model-value="structured(key, $event)"
      />
    </FormItem>
  </fieldset>
</template>

<style scoped>
.error {
  color: var(--theme-error-color);
  white-space: pre-wrap;
}
</style>
