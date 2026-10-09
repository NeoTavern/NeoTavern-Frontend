<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core';
import { computed, toRaw } from 'vue';
import { Button, Checkbox, Input, Select, Textarea, Toggle } from '../../../../components/UI';
import ConnectionProfileSelector from '../../../../components/common/ConnectionProfileSelector.vue';
import type { GraphFlow, JsonObject, JsonValue, ScopeGraph } from '../graph/contracts';
import { schemaValueType } from '../graph/schema-ports';
import { validateSchemaValue } from '../generic/schema';
import type { DataPortDefinition, InspectorFieldDefinition, ReadonlyNodeRegistry } from '../registry/node-definition';
import type { GraphEditorStore } from './editor-store';
import type { ResolvedEditorNode } from './vue-flow-adapter';
import { useEditorI18n } from './editor-i18n';

const props = defineProps<{
  store: GraphEditorStore;
  registry: ReadonlyNodeRegistry;
  flow: GraphFlow;
  graph: ScopeGraph;
  resolved?: ResolvedEditorNode;
  allResolved: ReadonlyMap<string, ResolvedEditorNode>;
  rootResolved: ReadonlyMap<string, ResolvedEditorNode>;
  showPortHandles?: boolean;
}>();
const emit = defineEmits<{ openBody: [nodeId: string] }>();
const { t, translateKey } = useEditorI18n();
const node = computed(() => props.resolved?.node);
const definition = computed(() => (node.value ? props.registry.get(node.value.type) : undefined));
const fields = computed(() => {
  if (!node.value || !definition.value) return [];
  const parsed = definition.value.dataSchema.safeParse(node.value.data);
  return parsed.success ? definition.value.fields(parsed.data) : [];
});
const dataInputs = computed(
  () => props.resolved?.inputs.filter((port): port is DataPortDefinition => port.kind === 'DATA') ?? [],
);

function get(root: JsonValue, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = root;
  for (const part of path.split('.')) {
    if (Array.isArray(value)) value = value[Number(part)];
    else if (value !== null && typeof value === 'object') value = value[part];
    else return undefined;
  }
  return value;
}
function set(root: JsonObject, path: string, value: JsonValue): void {
  const parts = path.split('.');
  let current: JsonObject | JsonValue[] = root;
  for (let index = 0; index < parts.length - 1; index++) {
    const key = Array.isArray(current) ? Number(parts[index]) : parts[index]!;
    const next = current[key as never] as JsonValue;
    current = next as JsonObject | JsonValue[];
  }
  const key = Array.isArray(current) ? Number(parts.at(-1)) : parts.at(-1)!;
  current[key as never] = value as never;
}
function update(path: string, value: JsonValue) {
  if (node.value) props.store.updateNodeData(node.value.id, path, value);
}
function jsonKey(prefix: 'field' | 'input', path: string) {
  return props.store.inspectorJsonKey(node.value?.id ?? '', prefix, path);
}
function jsonText(prefix: 'field' | 'input', path: string, value: JsonValue | undefined) {
  return props.store.inspectorJsonText(jsonKey(prefix, path), value);
}
function hasJsonDraft(prefix: 'field' | 'input', path: string): boolean {
  return Object.hasOwn(props.store.inspectorJsonBuffers.value, jsonKey(prefix, path));
}
function updateJson(
  prefix: 'field' | 'input',
  path: string,
  text: string,
  field?: InspectorFieldDefinition,
  port?: DataPortDefinition,
) {
  const key = jsonKey(prefix, path);
  try {
    const parsed = JSON.parse(text) as JsonValue;
    if (port && !validateSchemaValue(port.schema, parsed).valid)
      throw new Error(t('extensionsBuiltin.customAgents.editor.errors.inputSchema'));
    if (field && node.value && definition.value) {
      const candidate = structuredClone(toRaw(node.value.data));
      set(candidate, path, parsed);
      const checked = definition.value.dataSchema.safeParse(candidate);
      if (!checked.success) throw new Error(checked.error.issues.map((issue) => issue.message).join('; '));
    }
    props.store.updateInspectorJsonDraft(key, text);
    if (prefix === 'field') update(path, parsed);
    else if (node.value) props.store.updateInputValue(node.value.id, path, parsed);
  } catch (error) {
    props.store.updateInspectorJsonDraft(key, text, error instanceof Error ? error.message : String(error));
  }
}
function omitJson(path: string): void {
  if (!node.value) return;
  const key = jsonKey('field', path);
  props.store.clearInspectorJsonDraft(key);
  props.store.removeNodeData(node.value.id, path);
}
function inputPortTitle(port: DataPortDefinition): string {
  const label = port.literalLabel ? port.labelKey : translateKey(port.labelKey);
  const type = t(`extensionsBuiltin.customAgents.editor.portKinds.${schemaValueType(port.schema).toLowerCase()}`);
  return `${label} (${type})`;
}
function inputConnected(portId: string): boolean {
  return props.graph.edges.some(
    (edge) => edge.kind === 'DATA' && edge.target.nodeId === node.value?.id && edge.target.portId === portId,
  );
}
function inputValue(port: DataPortDefinition): JsonValue | undefined {
  return node.value?.inputValues[port.id];
}
function updateInline(port: DataPortDefinition, value: JsonValue) {
  if (node.value) props.store.updateInputValue(node.value.id, port.id, value);
}
function clearInline(port: DataPortDefinition): void {
  if (!node.value) return;
  props.store.clearInspectorJsonDraft(jsonKey('input', port.id));
  props.store.updateInputValue(node.value.id, port.id, undefined);
}
function inputSourceSchema(inputPortId: string): JsonObject {
  const incoming = props.graph.edges.find(
    (edge) => edge.kind === 'DATA' && edge.target.nodeId === node.value?.id && edge.target.portId === inputPortId,
  );
  return (incoming && outputSchema(incoming.source.nodeId, incoming.source.portId)) ?? {};
}
function inlineSchemaRoot(port: DataPortDefinition): JsonObject {
  const source = port.schemaPathSource;
  if (!source) return {};
  const schema = inputSourceSchema(source.inputPortId);
  if (source.mode === 'ARRAY_ITEMS') {
    const items = schema.type === 'array' ? schema.items : undefined;
    return items !== null && typeof items === 'object' && !Array.isArray(items) ? items : {};
  }
  return schema;
}
function selectOptions(field: { id: string; options: Array<{ labelKey: string; value: JsonValue }> }) {
  if (field.id === 'flowId' && field.options.length === 0)
    return props.store.draft.value.agent.flows
      .filter((candidate) => candidate.kind === 'SUBFLOW')
      .map((candidate) => ({ label: candidate.name, value: candidate.id }));
  return field.options.map((option) => ({ label: translateKey(option.labelKey), value: String(option.value) }));
}
function enumOptions(port: DataPortDefinition) {
  const values = Array.isArray(port.schema.enum) ? port.schema.enum : [];
  return values.map((value, index) => ({
    label: typeof value === 'string' ? (port.literalLabel ? value : translateKey(value)) : JSON.stringify(value),
    value: String(index),
  }));
}
function enumSelection(values: readonly JsonValue[], value: JsonValue | undefined) {
  const serialized = JSON.stringify(value);
  const index = values.findIndex((candidate) => JSON.stringify(candidate) === serialized);
  return index < 0 ? '' : String(index);
}
function outputSchema(nodeId: string, portId: string): JsonObject | undefined {
  const port = props.allResolved.get(nodeId)?.outputs.find((candidate) => candidate.id === portId);
  return port?.kind === 'DATA' ? port.schema : undefined;
}
function schemaRoot(field: Extract<InspectorFieldDefinition, { control: 'SCHEMA_PATH' }>): JsonObject {
  if (field.schemaSource === 'CONFIGURATION') return props.store.draft.value.agent.configurationSchema;
  if (field.schemaSource === 'STATE') return props.store.draft.value.agent.stateSchema;
  if (field.schemaSource === 'EVENT') {
    const trigger = props.flow.nodes.find((candidate) => candidate.type.startsWith('trigger.'));
    const port = trigger && props.rootResolved.get(trigger.id)?.outputs.find((candidate) => candidate.id === 'event');
    return port?.kind === 'DATA' ? port.schema : {};
  }
  return inputSourceSchema('value');
}
function schemaPaths(schema: JsonObject, allowRoot: boolean): Array<{ label: string; value: string }> {
  const output = allowRoot ? [{ label: t('extensionsBuiltin.customAgents.editor.root'), value: '' }] : [];
  const queue: Array<{ schema: JsonObject; path: string }> = [{ schema, path: '' }];
  while (queue.length && output.length < 500) {
    const current = queue.shift()!;
    if (
      current.schema.type !== 'object' ||
      !current.schema.properties ||
      typeof current.schema.properties !== 'object' ||
      Array.isArray(current.schema.properties)
    )
      continue;
    for (const [key, child] of Object.entries(current.schema.properties)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
      if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
      const path = current.path ? `${current.path}.${key}` : key;
      output.push({ label: path, value: path });
      queue.push({ schema: child as JsonObject, path });
      if (output.length >= 500) break;
    }
  }
  return output;
}
function knownSchemaPaths(schema: JsonObject, allowRoot: boolean) {
  const properties = schema.properties;
  const knownObject =
    schemaValueType(schema) === 'OBJECT' &&
    properties !== null &&
    typeof properties === 'object' &&
    !Array.isArray(properties);
  const options = knownObject ? schemaPaths(schema, allowRoot) : [];
  return { known: knownObject && options.length > 0, options };
}
function checkboxValues(
  field: { path: string; options: Array<{ labelKey: string; value: JsonValue }> },
  option: JsonValue,
  checked: boolean,
): JsonValue[] {
  const selected = new Set(Array.isArray(fieldValue(field.path)) ? (fieldValue(field.path) as JsonValue[]) : []);
  if (checked) selected.add(option);
  else selected.delete(option);
  return field.options.flatMap((candidate) => (selected.has(candidate.value) ? [candidate.value] : []));
}
function repeaterItems(field: Extract<InspectorFieldDefinition, { control: 'REPEATER' }>): JsonObject[] {
  const value = node.value && get(node.value.data, field.path);
  return Array.isArray(value) ? (value as JsonObject[]) : [];
}
function fieldValue(path: string): JsonValue | undefined {
  return node.value && get(node.value.data, path);
}
function combinedPath(field: InspectorFieldDefinition, index: number, itemField: InspectorFieldDefinition) {
  return `${field.path}.${index}.${itemField.path}`;
}
</script>

<template>
  <div v-if="node && definition" class="custom-agent-flow__node-details nodrag nowheel">
    <section v-for="field in fields" :key="field.id" class="custom-agent-flow__field">
      <template v-if="field.control === 'REPEATER'">
        <strong>{{ translateKey(field.labelKey) }}</strong>
        <div
          v-for="(item, index) in repeaterItems(field)"
          :key="String(item.id ?? index)"
          class="custom-agent-flow__repeater-item"
        >
          <header>
            <span>{{ t('extensionsBuiltin.customAgents.editor.itemNumber', { number: index + 1 }) }}</span>
            <div class="custom-agent-flow__repeater-actions">
              <Button
                :title="t('extensionsBuiltin.customAgents.editor.moveUp')"
                icon="fa-arrow-up"
                :disabled="index === 0"
                @click="store.moveRepeaterItem(node.id, field.path, index, -1)"
              />
              <Button
                :title="t('extensionsBuiltin.customAgents.editor.moveDown')"
                icon="fa-arrow-down"
                :disabled="index === repeaterItems(field).length - 1"
                @click="store.moveRepeaterItem(node.id, field.path, index, 1)"
              />
              <Button
                variant="danger"
                :title="t('common.remove')"
                icon="fa-trash"
                :disabled="repeaterItems(field).length <= field.minimum"
                @click="store.removeRepeaterItem(node.id, field.path, index, field.minimum)"
              />
            </div>
          </header>
          <div v-for="itemField in field.itemFields" :key="itemField.id" class="custom-agent-flow__repeater-field">
            <Input
              v-if="itemField.control === 'INPUT'"
              :model-value="String(fieldValue(combinedPath(field, index, itemField)) ?? '')"
              :label="translateKey(itemField.labelKey)"
              @update:model-value="update(combinedPath(field, index, itemField), String($event))"
            />
            <Input
              v-else-if="itemField.control === 'NUMBER'"
              type="number"
              :model-value="Number(fieldValue(combinedPath(field, index, itemField)) ?? 0)"
              :label="translateKey(itemField.labelKey)"
              @update:model-value="update(combinedPath(field, index, itemField), Number($event))"
            />
            <Toggle
              v-else-if="itemField.control === 'TOGGLE'"
              :model-value="fieldValue(combinedPath(field, index, itemField)) === true"
              :label="translateKey(itemField.labelKey)"
              @update:model-value="update(combinedPath(field, index, itemField), $event)"
            />
            <Textarea
              v-else-if="itemField.control === 'JSON'"
              :model-value="
                jsonText(
                  'field',
                  combinedPath(field, index, itemField),
                  fieldValue(combinedPath(field, index, itemField)),
                )
              "
              :label="translateKey(itemField.labelKey)"
              @update:model-value="updateJson('field', combinedPath(field, index, itemField), $event, itemField)"
            />
          </div>
        </div>
        <Button
          icon="fa-plus"
          :title="t('extensionsBuiltin.customAgents.editor.addItem')"
          @click="store.addRepeaterItem(node.id, field.path)"
          >{{ t('common.add') }}</Button
        >
      </template>
      <Button v-else-if="field.control === 'SCOPE_EDITOR'" @click="emit('openBody', node.id)">{{
        t('extensionsBuiltin.customAgents.editor.openBody')
      }}</Button>
      <Input
        v-else-if="field.control === 'INPUT'"
        :model-value="String(fieldValue(field.path) ?? '')"
        :label="translateKey(field.labelKey)"
        @update:model-value="update(field.path, String($event))"
      />
      <Input
        v-else-if="field.control === 'NUMBER'"
        type="number"
        :model-value="Number(fieldValue(field.path) ?? 0)"
        :label="translateKey(field.labelKey)"
        @update:model-value="update(field.path, Number($event))"
      />
      <Textarea
        v-else-if="field.control === 'TEXTAREA'"
        :model-value="String(fieldValue(field.path) ?? '')"
        :label="translateKey(field.labelKey)"
        :rows="field.rows"
        :allow-maximize="field.allowMaximize"
        @update:model-value="update(field.path, $event)"
      />
      <Toggle
        v-else-if="field.control === 'TOGGLE'"
        :model-value="fieldValue(field.path) === true"
        :label="translateKey(field.labelKey)"
        @update:model-value="update(field.path, $event)"
      />
      <Select
        v-else-if="field.control === 'SELECT'"
        :model-value="String(fieldValue(field.path) ?? '')"
        :options="selectOptions(field)"
        :label="translateKey(field.labelKey)"
        @update:model-value="update(field.path, $event)"
      />
      <div v-else-if="field.control === 'CHECKBOX_GROUP'">
        <strong>{{ translateKey(field.labelKey) }}</strong>
        <Checkbox
          v-for="option in field.options"
          :key="String(option.value)"
          :model-value="
            Array.isArray(fieldValue(field.path)) && (fieldValue(field.path) as JsonValue[]).includes(option.value)
          "
          :label="translateKey(option.labelKey)"
          @update:model-value="update(field.path, checkboxValues(field, option.value, $event))"
        />
      </div>
      <template v-else-if="field.control === 'JSON'">
        <Textarea
          :model-value="jsonText('field', field.path, fieldValue(field.path))"
          :label="translateKey(field.labelKey)"
          @update:model-value="updateJson('field', field.path, $event, field)"
        />
        <span v-if="store.inspectorJsonErrors.value[jsonKey('field', field.path)]" class="custom-agent-flow__error">{{
          store.inspectorJsonErrors.value[jsonKey('field', field.path)]
        }}</span>
        <Button
          v-if="field.optional && (fieldValue(field.path) !== undefined || hasJsonDraft('field', field.path))"
          :title="t('extensionsBuiltin.customAgents.editor.omitOptional')"
          @click="omitJson(field.path)"
          >{{ t('extensionsBuiltin.customAgents.editor.omit') }}</Button
        >
      </template>
      <template v-else-if="field.control === 'SCHEMA_PATH'">
        <Select
          v-if="knownSchemaPaths(schemaRoot(field), field.allowRoot).known"
          data-path-editor="select"
          :model-value="fieldValue(field.path) === null ? '' : String(fieldValue(field.path) ?? '')"
          :options="knownSchemaPaths(schemaRoot(field), field.allowRoot).options"
          searchable
          :label="translateKey(field.labelKey)"
          @update:model-value="update(field.path, $event === '' && field.allowRoot ? null : $event)"
        />
        <Input
          v-else
          data-path-editor="advanced"
          :model-value="String(fieldValue(field.path) ?? '')"
          :label="`${translateKey(field.labelKey)} (${t('common.advanced')})`"
          @update:model-value="update(field.path, String($event))"
        />
      </template>
    </section>

    <h3 v-if="dataInputs.length">{{ t('extensionsBuiltin.customAgents.editor.inputs') }}</h3>
    <section
      v-for="port in dataInputs"
      :key="port.id"
      class="custom-agent-flow__field custom-agent-flow__input-port"
      :class="{ 'is-connected': inputConnected(port.id) }"
      :data-input-port-id="port.id"
    >
      <Handle
        v-if="showPortHandles"
        :id="port.id"
        type="target"
        :position="Position.Left"
        :class="`is-${schemaValueType(port.schema).toLowerCase()}`"
        :title="inputPortTitle(port)"
      />
      <header>
        <strong>{{ port.literalLabel ? port.labelKey : translateKey(port.labelKey) }}</strong>
        <span class="custom-agent-flow__type-badge">
          {{ t(`extensionsBuiltin.customAgents.editor.portKinds.${schemaValueType(port.schema).toLowerCase()}`) }}
        </span>
        <span v-if="inputConnected(port.id)" class="custom-agent-flow__connected-badge">
          <i class="fa-solid fa-link" aria-hidden="true" />
          {{ t('extensionsBuiltin.customAgents.editor.connected') }}
        </span>
      </header>
      <template v-if="!inputConnected(port.id) && port.inlineEditor === 'CONNECTION_PROFILE'">
        <ConnectionProfileSelector
          :model-value="String(inputValue(port) ?? '')"
          @update:model-value="updateInline(port, $event ?? '')"
        />
      </template>
      <Textarea
        v-else-if="!inputConnected(port.id) && port.inlineEditor === 'TEXTAREA'"
        :model-value="String(inputValue(port) ?? '')"
        @update:model-value="updateInline(port, $event)"
      />
      <template v-else-if="!inputConnected(port.id) && port.inlineEditor === 'SCHEMA_PATH'">
        <Select
          v-if="knownSchemaPaths(inlineSchemaRoot(port), false).known"
          data-path-editor="select"
          :model-value="String(inputValue(port) ?? '')"
          :options="knownSchemaPaths(inlineSchemaRoot(port), false).options"
          searchable
          @update:model-value="updateInline(port, $event)"
        />
        <Input
          v-else
          data-path-editor="advanced"
          :model-value="String(inputValue(port) ?? '')"
          :label="t('extensionsBuiltin.customAgents.editor.advancedPath')"
          @update:model-value="updateInline(port, String($event))"
        />
      </template>
      <Select
        v-else-if="!inputConnected(port.id) && Array.isArray(port.schema.enum)"
        :model-value="enumSelection(port.schema.enum, inputValue(port))"
        :options="enumOptions(port)"
        @update:model-value="updateInline(port, port.schema.enum![Number($event)]!)"
      />
      <Toggle
        v-else-if="!inputConnected(port.id) && schemaValueType(port.schema) === 'BOOLEAN'"
        :model-value="inputValue(port) === true"
        @update:model-value="updateInline(port, $event)"
      />
      <Input
        v-else-if="!inputConnected(port.id) && schemaValueType(port.schema) === 'STRING'"
        :model-value="String(inputValue(port) ?? '')"
        @update:model-value="updateInline(port, String($event))"
      />
      <Input
        v-else-if="!inputConnected(port.id) && schemaValueType(port.schema) === 'NUMBER'"
        type="number"
        :min="typeof port.schema.minimum === 'number' ? port.schema.minimum : undefined"
        :max="typeof port.schema.maximum === 'number' ? port.schema.maximum : undefined"
        :model-value="typeof inputValue(port) === 'number' ? (inputValue(port) as number) : ''"
        @update:model-value="updateInline(port, Number($event))"
      />
      <template v-else-if="!inputConnected(port.id)">
        <Textarea
          :model-value="jsonText('input', port.id, inputValue(port))"
          @update:model-value="updateJson('input', port.id, $event, undefined, port)"
        />
        <span v-if="store.inspectorJsonErrors.value[jsonKey('input', port.id)]" class="custom-agent-flow__error">{{
          store.inspectorJsonErrors.value[jsonKey('input', port.id)]
        }}</span>
      </template>
      <span
        v-if="port.required && inputValue(port) === undefined && !inputConnected(port.id)"
        class="custom-agent-flow__error"
        >{{ t('extensionsBuiltin.customAgents.editor.requiredUnbound') }}</span
      >
      <Button
        v-if="inputValue(port) !== undefined || hasJsonDraft('input', port.id)"
        :title="t('extensionsBuiltin.customAgents.editor.clearInline')"
        @click="clearInline(port)"
        >{{ t('common.clear') }}</Button
      >
    </section>
  </div>
</template>
