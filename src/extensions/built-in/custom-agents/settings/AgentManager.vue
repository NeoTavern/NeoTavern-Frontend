<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue';
import { Button, FormItem, Select, Textarea, Toggle } from '../../../../components/UI';
import { downloadFile } from '../../../../utils/commons';
import FlowEditor from '../editor/FlowEditor.vue';
import { GraphEditorStore, type RunOverlayRecord } from '../editor/editor-store';
import { builtinNodeRegistry } from '../registry/builtin-nodes';
import type { GraphPreset, JsonObject } from '../graph/contracts';
import type { CustomAgentsHostAPI } from '../host/api';
import type { GraphCustomAgentsRuntime, GraphSelectedAgentContext } from '../host/runtime';
import { resetSelectedGraphAgent } from '../host/generation';
import AgentMetadataPanel from './AgentMetadataPanel.vue';
import ConfigurationPanel from './ConfigurationPanel.vue';
import StatePanel from './StatePanel.vue';
import { graphAgentTemplateDefinitions } from './catalog';
import {
  addInstalledPreset,
  createGraphPreset,
  deleteInstalledPreset,
  duplicateInstalledPreset,
  installGraphTemplate,
  renameInstalledPreset,
  replaceInstalledPreset,
  setInstalledPresetEnabled,
} from './management';
import {
  persistPreparedInstalledGraphAgents,
  type InstalledGraphAgentsSettings,
  type PreparedInstalledGraphAgents,
} from './store';
import { exportGraphPreset, importGraphPreset } from './transfer';

const props = defineProps<{
  api: CustomAgentsHostAPI;
  runtime: GraphCustomAgentsRuntime;
  prepared: PreparedInstalledGraphAgents;
}>();
const t = props.api.i18n.t;
const settings = shallowRef<InstalledGraphAgentsSettings>(props.prepared.settings);
const selectedId = ref(settings.value.presets[0]?.agent.id ?? '');
const transfer = ref('');
const message = ref('');
const runtimeError = ref('');
const resetBusy = ref(false);
const selectedContext = shallowRef<GraphSelectedAgentContext>();
const editors = new Map<string, GraphEditorStore>();
const templates = graphAgentTemplateDefinitions;
let localSequence = 0;
const ids = {
  generate: () => `id-${props.api.uuid().replaceAll(/[^A-Za-z0-9_-]/g, '-')}-${++localSequence}`,
};

const selected = computed(() => settings.value.presets.find((preset) => preset.agent.id === selectedId.value));
const editor = computed(() => {
  const preset = selected.value;
  if (!preset) return undefined;
  let store = editors.get(preset.agent.id);
  if (!store) {
    store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids,
      apply: (definition) => {
        persist(replaceInstalledPreset(settings.value, preset.agent.id, definition));
      },
    });
    editors.set(preset.agent.id, store);
  }
  return store;
});

function persist(prepared: PreparedInstalledGraphAgents): void {
  persistPreparedInstalledGraphAgents(props.api, prepared);
  settings.value = prepared.settings;
  props.runtime.replacePrepared(prepared);
  refreshRuntime();
}

function overlay(): Record<string, RunOverlayRecord> {
  const invocations = new Map<string, RunOverlayRecord['invocations'][number] & { nodeId: string }>();
  for (const diagnostic of props.runtime.getDiagnostics(selectedId.value).flatMap((record) => record.diagnostics)) {
    const key = `${diagnostic.scopeInvocationId}\u0000${diagnostic.nodeId}`;
    invocations.delete(key);
    invocations.set(key, {
      nodeId: diagnostic.nodeId,
      scopeInvocationId: diagnostic.scopeInvocationId,
      status: diagnostic.status,
      ...(diagnostic.output === undefined ? {} : { output: diagnostic.output }),
      ...(diagnostic.error === undefined ? {} : { error: diagnostic.error }),
    });
  }
  const grouped: Record<string, Array<RunOverlayRecord['invocations'][number]>> = {};
  for (const { nodeId, ...invocation } of [...invocations.values()].slice(-200))
    (grouped[nodeId] ??= []).push(invocation);
  return Object.fromEntries(
    Object.entries(grouped).map(([nodeId, nodeInvocations]) => {
      const latest = nodeInvocations.at(-1)!;
      return [
        nodeId,
        {
          status: latest.status,
          ...(latest.output === undefined ? {} : { output: latest.output }),
          ...(latest.error === undefined ? {} : { error: latest.error }),
          invocations: nodeInvocations,
        },
      ];
    }),
  );
}

function refreshRuntime(): void {
  const preset = selected.value;
  selectedContext.value = preset ? props.runtime.getSelectedAgentContext(preset.agent.id) : undefined;
  editor.value?.setRunOverlay(overlay());
}
const unsubscribe = props.runtime.subscribe(refreshRuntime);
onBeforeUnmount(unsubscribe);
refreshRuntime();

function choose(id: string): void {
  selectedId.value = id;
  message.value = '';
  runtimeError.value = '';
  refreshRuntime();
}

function requested(label: string, initial = ''): string | undefined {
  return window.prompt(label, initial)?.trim() || undefined;
}

function create(): void {
  const id = requested(t('extensionsBuiltin.customAgents.agentId'));
  if (!id) return;
  const name = requested(t('extensionsBuiltin.customAgents.name'), id);
  if (!name) return;
  attempt(() => {
    persist(addInstalledPreset(settings.value, createGraphPreset(id, name)));
    choose(id);
  });
}

function duplicate(): void {
  const preset = selected.value;
  if (!preset) return;
  const id = requested(t('extensionsBuiltin.customAgents.agentId'));
  if (!id) return;
  const name = requested(t('extensionsBuiltin.customAgents.name'), `${preset.agent.name} Copy`);
  if (!name) return;
  attempt(() => {
    persist(duplicateInstalledPreset(settings.value, preset.agent.id, id, name));
    choose(id);
  });
}

function remove(): void {
  const preset = selected.value;
  if (!preset || !window.confirm(t('extensionsBuiltin.customAgents.confirmDelete'))) return;
  attempt(() => {
    editors.delete(preset.agent.id);
    persist(deleteInstalledPreset(settings.value, preset.agent.id));
    choose(settings.value.presets[0]?.agent.id ?? '');
  });
}

function synchronizeMetadata(preset: GraphPreset): void {
  const store = editor.value;
  if (!store) return;
  const executable = structuredClone(store.executable.value);
  executable.agent.name = preset.agent.name;
  executable.agent.priority = preset.agent.priority;
  executable.agent.enabled = preset.agent.enabled;
  store.executable.value = executable;
  const draft = structuredClone(store.draft.value);
  draft.agent.name = preset.agent.name;
  draft.agent.priority = preset.agent.priority;
  draft.agent.enabled = preset.agent.enabled;
  store.draft.value = draft;
  store.revalidate();
}

function updateInstalled(mutator: (preset: GraphPreset) => PreparedInstalledGraphAgents): void {
  const preset = selected.value;
  if (!preset) return;
  attempt(() => {
    const next = mutator(preset);
    persist(next);
    const current = settings.value.presets.find((candidate) => candidate.agent.id === preset.agent.id);
    if (current) synchronizeMetadata(current);
  });
}

function updatePriority(priority: number): void {
  updateInstalled((preset) => {
    const next = structuredClone(preset);
    next.agent.priority = priority;
    return replaceInstalledPreset(settings.value, preset.agent.id, next);
  });
}

function updateConfiguration(configuration: JsonObject): void {
  const preset = selected.value;
  if (!preset) return;
  const next = structuredClone(preset);
  next.agent.configurationDefaults = configuration;
  attempt(() => {
    persist(replaceInstalledPreset(settings.value, preset.agent.id, next));
    const store = editor.value;
    if (store) {
      const executable = structuredClone(store.executable.value);
      executable.agent.configurationDefaults = structuredClone(configuration);
      store.executable.value = executable;
      const draft = structuredClone(store.draft.value);
      draft.agent.configurationDefaults = structuredClone(configuration);
      store.draft.value = draft;
      store.revalidate();
    }
  });
}

function install(template: GraphPreset): void {
  attempt(() => {
    persist(installGraphTemplate(settings.value, template));
    choose(template.agent.id);
    message.value = t('extensionsBuiltin.customAgents.templateInstalled');
  });
}

function doExport(): void {
  const preset = selected.value;
  if (!preset) return;
  attempt(() => {
    transfer.value = exportGraphPreset(settings.value, preset.agent.id);
    downloadFile(transfer.value, `${preset.agent.id}.flow.json`, 'application/json');
  });
}

function doImport(): void {
  attempt(() => {
    const prepared = importGraphPreset(settings.value, transfer.value);
    const imported = prepared.settings.presets.at(-1)!;
    persist(prepared);
    choose(imported.agent.id);
    message.value = t('extensionsBuiltin.customAgents.imported');
  });
}

async function resetState(): Promise<void> {
  const preset = selected.value;
  if (!preset || !window.confirm(t('extensionsBuiltin.customAgents.confirmReset'))) return;
  resetBusy.value = true;
  runtimeError.value = '';
  try {
    await resetSelectedGraphAgent(props.api, preset.agent);
    props.runtime.invalidate();
  } catch (error) {
    runtimeError.value = error instanceof Error ? error.message : String(error);
  } finally {
    resetBusy.value = false;
  }
}

function clearOverlay(): void {
  props.runtime.clearDiagnostics(selectedId.value);
  editor.value?.clearRunOverlay();
}

function attempt(action: () => void): void {
  message.value = '';
  try {
    action();
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  }
}
</script>

<template>
  <div class="custom-agent-settings">
    <header class="custom-agent-settings__actions">
      <Button type="button" @click="create">{{ t('extensionsBuiltin.customAgents.create') }}</Button>
      <Button type="button" :disabled="!selected" @click="duplicate">{{
        t('extensionsBuiltin.customAgents.duplicate')
      }}</Button>
      <Button type="button" variant="danger" :disabled="!selected" @click="remove">{{ t('common.delete') }}</Button>
    </header>
    <section v-if="templates.length" class="custom-agent-settings__catalog">
      <h3>{{ t('extensionsBuiltin.customAgents.templates') }}</h3>
      <Button v-for="template in templates" :key="template.agent.id" type="button" @click="install(template)">
        {{ t('extensionsBuiltin.customAgents.installTemplate', { name: template.agent.name }) }}
      </Button>
    </section>
    <p v-if="message" role="status">{{ message }}</p>
    <Select
      v-if="settings.presets.length"
      :model-value="selectedId"
      :options="settings.presets.map((preset) => ({ label: preset.agent.name, value: preset.agent.id }))"
      @update:model-value="choose($event as string)"
    />
    <p v-else>{{ t('extensionsBuiltin.customAgents.noAgents') }}</p>
    <template v-if="selected">
      <FormItem :label="t('extensionsBuiltin.customAgents.enabled')" horizontal>
        <Toggle
          :model-value="selected.agent.enabled"
          :label="t('extensionsBuiltin.customAgents.enabled')"
          @update:model-value="
            updateInstalled((preset) => setInstalledPresetEnabled(settings, preset.agent.id, $event))
          "
        />
      </FormItem>
      <AgentMetadataPanel
        :preset="selected"
        :t="t"
        @rename="updateInstalled((preset) => renameInstalledPreset(settings, preset.agent.id, $event))"
        @priority="updatePriority"
      />
      <ConfigurationPanel :preset="selected" :t="t" @update="updateConfiguration" />
      <StatePanel :context="selectedContext" :t="t" :busy="resetBusy" @reset="resetState" />
      <p v-if="runtimeError" class="error">{{ runtimeError }}</p>
      <FlowEditor v-if="editor" :key="selected.agent.id" :store="editor" :registry="builtinNodeRegistry" />
      <Button type="button" variant="ghost" @click="clearOverlay">{{
        t('extensionsBuiltin.customAgents.clearRunOverlay')
      }}</Button>
      <section class="custom-agent-settings__transfer">
        <h3>{{ t('extensionsBuiltin.customAgents.importExport') }}</h3>
        <Button type="button" variant="ghost" @click="doExport">{{ t('common.export') }}</Button>
        <Button type="button" variant="confirm" @click="doImport">{{ t('common.import') }}</Button>
        <Textarea
          :label="t('extensionsBuiltin.customAgents.presetJson')"
          :model-value="transfer"
          :rows="12"
          @update:model-value="transfer = $event"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.custom-agent-settings,
.custom-agent-panel,
.custom-agent-settings__transfer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.custom-agent-settings {
  padding: 0.75rem;
}
.custom-agent-settings__actions,
.custom-agent-settings__catalog {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.error {
  color: var(--theme-error-color);
  white-space: pre-wrap;
}
pre {
  max-height: 24rem;
  overflow: auto;
}
</style>
