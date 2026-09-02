<script setup lang="ts">
import { computed, ref, shallowReactive } from 'vue';
import { Button, Checkbox, FormItem, Input, Select, Tabs, Textarea } from '../../../../components/UI';
import type { CustomAgentsHostAPI } from '../host/api';
import type { GraphCustomAgentsRuntime } from '../host/runtime';
import type { GraphAgent } from '../graph/contracts';
import type { JsonObject, JsonValue } from '../generic/json';
import type { FormField, RowFormField, RuntimeAction, ViewAction, ViewComponent, ViewRowForm } from './contracts';
import {
  coerceFormInput,
  evaluateViewCondition,
  initialFormValues,
  projectViewRows,
  jsonValuesEqual,
  readPath,
  resolveActionInput,
  resolveViewBinding,
  type ViewContext,
} from './bindings';
import { resetSelectedGraphAgent } from '../host/generation';
import { runGraphViewAction } from './actions';

const props = defineProps<{
  api: CustomAgentsHostAPI;
  runtime: GraphCustomAgentsRuntime;
  agent: GraphAgent;
  node: ViewComponent;
  context: ViewContext;
}>();
const activeTab = ref(props.node.component === 'TABS' ? props.node.tabs[0]?.id : undefined);
const page = ref(0);
type UiFormValue = JsonValue;
const forms = shallowReactive<Record<string, Record<string, UiFormValue>>>({});
const error = ref('');

const bound = computed(() => {
  if (!('binding' in props.node)) return null;
  return resolveViewBinding(props.node.binding, props.context);
});
const rows = computed(() => {
  if (props.node.component !== 'LIST' && props.node.component !== 'TABLE') return { rows: [], pageCount: 1 };
  return projectViewRows(bound.value as JsonValue, {
    order: props.node.order,
    ...(props.node.limit === undefined ? {} : { limit: props.node.limit }),
    ...(props.node.component === 'TABLE' && props.node.pageSize !== undefined
      ? { pageSize: props.node.pageSize, page: page.value }
      : {}),
  });
});
const status = computed(() => {
  if (props.node.component !== 'STATUS') return undefined;
  return props.node.cases.find((item) =>
    evaluateViewCondition(item.condition, props.context, bound.value as JsonValue),
  );
});

function display(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function fieldValue(row: JsonObject, path: string): string {
  return display(readPath(row, path));
}

function formKey(label: string, row?: JsonObject): string {
  return `${props.context.selectionKey ?? ''}/${props.node.id}/${label}/${row ? JSON.stringify(row) : ''}`;
}

function ensureForm(fields: Array<FormField | RowFormField>, label: string, row?: JsonObject) {
  const key = formKey(label, row);
  if (!forms[key]) {
    const initial = initialFormValues(fields, props.context, row);
    forms[key] = shallowReactive(
      Object.fromEntries(
        fields.map((field) => {
          const value = initial[field.name];
          return [field.name, field.control === 'JSON' ? JSON.stringify(value) : structuredClone(value)];
        }),
      ),
    );
  }
  return forms[key]!;
}

async function manual(workflowId: string, input: JsonValue): Promise<void> {
  error.value = '';
  try {
    await runGraphViewAction(props.api, props.runtime, props.agent.id, workflowId, input);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

function isRowForm(value: ViewAction | ViewRowForm): value is ViewRowForm {
  return 'fields' in value;
}

function rowForm(value: ViewAction | ViewRowForm): ViewRowForm {
  if (!isRowForm(value)) throw new Error('Expected row form');
  return value;
}

async function action(value: ViewAction | RuntimeAction, row?: JsonObject): Promise<void> {
  if (value.confirm && !window.confirm(value.label)) return;
  if ('command' in value) {
    if (value.command === 'ABORT_ACTIVE_MANUAL') props.runtime.abortManual(props.agent.id);
    else {
      error.value = '';
      try {
        await resetSelectedGraphAgent(props.api, props.agent);
        props.runtime.invalidate();
      } catch (reason) {
        error.value = reason instanceof Error ? reason.message : String(reason);
      }
    }
    return;
  }
  await manual(value.workflowId, resolveActionInput(value, props.context, row));
}

async function submit(fields: Array<FormField | RowFormField>, label: string, workflowId: string, row?: JsonObject) {
  const values = ensureForm(fields, label, row);
  await manual(workflowId, coerceFormInput(fields, values));
}

function options(field: FormField | RowFormField): JsonObject[] {
  if (field.control !== 'SELECT') return [];
  return projectViewRows(resolveViewBinding(field.options, props.context), { order: 'ASC' }).rows;
}

function optionValue(field: FormField | RowFormField, option: JsonObject): JsonValue {
  if (field.control !== 'SELECT') throw new Error('Expected SELECT field');
  return readPath(option, field.optionValuePath);
}

function optionLabel(field: FormField | RowFormField, option: JsonObject): string {
  if (field.control !== 'SELECT') throw new Error('Expected SELECT field');
  return display(readPath(option, field.optionLabelPath));
}

function selectOptions(field: FormField | RowFormField) {
  return options(field).map((option, index) => ({
    label: optionLabel(field, option),
    value: String(index),
  }));
}

function selectKey(field: FormField | RowFormField, value: JsonValue): string {
  const index = options(field).findIndex((option) => jsonValuesEqual(optionValue(field, option), value));
  return index < 0 ? '' : String(index);
}

function setSelectFormValue(
  field: FormField | RowFormField,
  values: Record<string, UiFormValue>,
  key: string | number | Array<string | number>,
): void {
  if (Array.isArray(key)) throw new Error('Expected a single SELECT option');
  const option = options(field)[Number(key)];
  if (option) values[field.name] = optionValue(field, option);
}

function setFormValue(values: Record<string, UiFormValue>, name: string, value: string | number): void {
  values[name] = value;
}
</script>

<template>
  <div class="custom-agent-view-node">
    <p v-if="error" class="error">{{ error }}</p>
    <template v-if="node.component === 'TABS'">
      <Tabs v-model="activeTab!" :options="node.tabs.map((tab) => ({ label: tab.label, value: tab.id }))" />
      <template v-for="tab in node.tabs" :key="tab.id">
        <ViewComponentRenderer
          v-for="child in tab.components"
          v-if="activeTab === tab.id"
          :key="child.id"
          v-bind="{ api, runtime, agent, context, node: child }"
        />
      </template>
    </template>
    <section v-else-if="node.component === 'SECTION'">
      <h3>{{ node.title }}</h3>
      <ViewComponentRenderer
        v-for="child in node.components"
        :key="child.id"
        v-bind="{ api, runtime, agent, context, node: child }"
      />
    </section>
    <dl v-else-if="node.component === 'SCALAR'">
      <dt>{{ node.label }}</dt>
      <dd>{{ node.aggregate === 'COUNT' && Array.isArray(bound) ? bound.length : display(bound as JsonValue) }}</dd>
    </dl>
    <p v-else-if="node.component === 'STATUS'">
      <strong>{{ node.label }}:</strong> <span :data-tone="status?.tone">{{ status?.label ?? '' }}</span>
    </p>
    <section v-else-if="node.component === 'LIST'">
      <h3>{{ node.label }}</h3>
      <ul>
        <li v-for="(row, index) in rows.rows" :key="index">
          <span v-for="field in node.fields" :key="field.path"
            ><strong>{{ field.label }}:</strong> {{ fieldValue(row, field.path) }}
          </span>
        </li>
      </ul>
    </section>
    <section v-else-if="node.component === 'TABLE'">
      <h3>{{ node.label }}</h3>
      <table>
        <thead>
          <tr>
            <th v-for="column in node.columns" :key="column.path">{{ column.label }}</th>
            <th v-if="node.rowActions">{{ api.i18n.t('extensionsBuiltin.customAgents.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows.rows" :key="index">
            <td v-for="column in node.columns" :key="column.path">{{ fieldValue(row, column.path) }}</td>
            <td v-if="node.rowActions">
              <template v-for="rowAction in node.rowActions" :key="rowAction.label">
                <Button
                  v-if="!isRowForm(rowAction)"
                  type="button"
                  :variant="rowAction.confirm ? 'confirm' : 'default'"
                  @click="action(rowAction, row)"
                >
                  {{ rowAction.label }}
                </Button>
                <form
                  v-else
                  @submit.prevent="submit(rowForm(rowAction).fields, rowAction.label, rowAction.workflowId, row)"
                >
                  <FormItem v-for="field in rowForm(rowAction).fields" :key="field.name">
                    <Input
                      v-if="field.control !== 'TEXTAREA' && field.control !== 'CHECKBOX' && field.control !== 'SELECT'"
                      :label="field.label"
                      :model-value="
                        String(ensureForm(rowForm(rowAction).fields, rowAction.label, row)[field.name] ?? '')
                      "
                      :type="field.control === 'NUMBER' ? 'number' : 'text'"
                      @update:model-value="
                        setFormValue(ensureForm(rowForm(rowAction).fields, rowAction.label, row), field.name, $event)
                      "
                    />
                    <Textarea
                      v-else-if="field.control === 'TEXTAREA'"
                      :label="field.label"
                      :model-value="
                        String(ensureForm(rowForm(rowAction).fields, rowAction.label, row)[field.name] ?? '')
                      "
                      @update:model-value="
                        setFormValue(ensureForm(rowForm(rowAction).fields, rowAction.label, row), field.name, $event)
                      "
                    />
                    <Checkbox
                      v-else-if="field.control === 'CHECKBOX'"
                      :model-value="Boolean(ensureForm(rowForm(rowAction).fields, rowAction.label, row)[field.name])"
                      :label="field.label"
                      @update:model-value="
                        ensureForm(rowForm(rowAction).fields, rowAction.label, row)[field.name] = $event
                      "
                    />
                    <Select
                      v-else
                      :label="field.label"
                      :model-value="
                        selectKey(field, ensureForm(rowForm(rowAction).fields, rowAction.label, row)[field.name]!)
                      "
                      :options="selectOptions(field)"
                      @update:model-value="
                        setSelectFormValue(field, ensureForm(rowForm(rowAction).fields, rowAction.label, row), $event)
                      "
                    />
                  </FormItem>
                  <Button type="submit" variant="confirm">{{ rowAction.label }}</Button>
                </form>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <nav v-if="rows.pageCount > 1">
        <Button type="button" variant="ghost" :disabled="page === 0" @click="page--">{{
          api.i18n.t('pagination.previous')
        }}</Button>
        <span>{{ Math.min(page + 1, rows.pageCount) }} / {{ rows.pageCount }}</span>
        <Button type="button" variant="ghost" :disabled="page + 1 >= rows.pageCount" @click="page++">{{
          api.i18n.t('pagination.next')
        }}</Button>
      </nav>
    </section>
    <details v-else-if="node.component === 'JSON_DETAILS'">
      <summary>{{ node.label }}</summary>
      <pre>{{ JSON.stringify(bound, null, 2) }}</pre>
    </details>
    <Button
      v-else-if="node.component === 'BUTTON'"
      type="button"
      :variant="node.action.confirm ? 'confirm' : 'default'"
      @click="action(node.action)"
    >
      {{ node.label }}
    </Button>
    <form v-else-if="node.component === 'FORM'" @submit.prevent="submit(node.fields, node.label, node.workflowId)">
      <h3>{{ node.label }}</h3>
      <FormItem v-for="field in node.fields" :key="field.name">
        <Input
          v-if="field.control !== 'TEXTAREA' && field.control !== 'CHECKBOX' && field.control !== 'SELECT'"
          :label="field.label"
          :model-value="String(ensureForm(node.fields, node.label)[field.name] ?? '')"
          :type="field.control === 'NUMBER' ? 'number' : 'text'"
          @update:model-value="setFormValue(ensureForm(node.fields, node.label), field.name, $event)"
        />
        <Textarea
          v-else-if="field.control === 'TEXTAREA'"
          :label="field.label"
          :model-value="String(ensureForm(node.fields, node.label)[field.name] ?? '')"
          @update:model-value="setFormValue(ensureForm(node.fields, node.label), field.name, $event)"
        />
        <Checkbox
          v-else-if="field.control === 'CHECKBOX'"
          :model-value="Boolean(ensureForm(node.fields, node.label)[field.name])"
          :label="field.label"
          @update:model-value="ensureForm(node.fields, node.label)[field.name] = $event"
        />
        <Select
          v-else
          :label="field.label"
          :model-value="selectKey(field, ensureForm(node.fields, node.label)[field.name]!)"
          :options="selectOptions(field)"
          @update:model-value="setSelectFormValue(field, ensureForm(node.fields, node.label), $event)"
        />
      </FormItem>
      <Button type="submit" variant="confirm">{{ node.label }}</Button>
    </form>
  </div>
</template>

<style scoped>
.custom-agent-view-node {
  margin: 0.5rem 0;
}
form,
nav {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 0.35rem;
  border: 1px solid var(--theme-border-color);
  vertical-align: top;
}
pre {
  overflow: auto;
  max-height: 24rem;
}
.error,
[data-tone='DANGER'] {
  color: var(--theme-error-color);
}
</style>
