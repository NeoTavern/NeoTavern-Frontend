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
const activeSection = ref<'workflow' | 'settings' | 'transfer'>('workflow');
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
      validatedExecutable: true,
      apply: (definition) => {
        persist(replaceInstalledPreset(settings.value, preset.agent.id, definition));
      },
    });
    editors.set(preset.agent.id, store);
  }
  return store;
});
const hasRunOverlay = computed(() => Object.keys(editor.value?.runOverlay.value ?? {}).length > 0);

function persist(prepared: PreparedInstalledGraphAgents): void {
  persistPreparedInstalledGraphAgents(props.api, prepared);
  settings.value = prepared.settings;
  props.runtime.replacePrepared(prepared);
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
  store.synchronizeMetadata(preset.agent);
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

function templateInstalled(template: GraphPreset): boolean {
  return settings.value.presets.some((preset) => preset.agent.id === template.agent.id);
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
    <header class="custom-agent-settings__header">
      <div class="custom-agent-settings__identity">
        <span class="custom-agent-settings__eyebrow">{{ t('extensionsBuiltin.customAgents.workspace') }}</span>
        <h2>{{ selected?.agent.name ?? t('extensionsBuiltin.customAgents.title') }}</h2>
        <code v-if="selected">{{ selected.agent.id }}</code>
      </div>
      <div class="custom-agent-settings__actions">
        <Button type="button" icon="fa-plus" @click="create">{{ t('extensionsBuiltin.customAgents.create') }}</Button>
        <Button type="button" icon="fa-copy" :disabled="!selected" @click="duplicate">{{
          t('extensionsBuiltin.customAgents.duplicate')
        }}</Button>
        <Button type="button" icon="fa-trash" variant="danger" :disabled="!selected" @click="remove">{{
          t('common.delete')
        }}</Button>
      </div>
    </header>

    <div v-if="settings.presets.length" class="custom-agent-settings__picker">
      <Select
        :label="t('extensionsBuiltin.customAgents.chooseAgent')"
        :model-value="selectedId"
        :options="settings.presets.map((preset) => ({ label: preset.agent.name, value: preset.agent.id }))"
        @update:model-value="choose($event as string)"
      />
      <FormItem v-if="selected" :label="t('extensionsBuiltin.customAgents.enabled')" horizontal>
        <Toggle
          :model-value="selected.agent.enabled"
          :label="t('extensionsBuiltin.customAgents.enabled')"
          @update:model-value="
            updateInstalled((preset) => setInstalledPresetEnabled(settings, preset.agent.id, $event))
          "
        />
      </FormItem>
    </div>

    <details v-if="templates.length" class="custom-agent-settings__catalog">
      <summary>
        <i class="fa-solid fa-box-open" aria-hidden="true" />
        {{ t('extensionsBuiltin.customAgents.templates') }}
        <span>{{ templates.length }}</span>
      </summary>
      <div>
        <article v-for="template in templates" :key="template.agent.id">
          <i class="fa-solid fa-diagram-project" aria-hidden="true" />
          <div>
            <strong>{{ template.agent.name }}</strong>
            <small>
              {{
                t('extensionsBuiltin.customAgents.templateContents', {
                  flows: template.agent.flows.length,
                  views: template.agent.views.length,
                })
              }}
            </small>
          </div>
          <Button
            type="button"
            :icon="templateInstalled(template) ? 'fa-check' : 'fa-plus'"
            :disabled="templateInstalled(template)"
            @click="install(template)"
          >
            {{
              t(
                templateInstalled(template)
                  ? 'extensionsBuiltin.customAgents.templateInstalledShort'
                  : 'extensionsBuiltin.customAgents.installTemplateAction',
              )
            }}
          </Button>
        </article>
      </div>
    </details>

    <p v-if="message" class="custom-agent-settings__notice" role="status">{{ message }}</p>
    <section v-if="!settings.presets.length" class="custom-agent-settings__empty">
      <i class="fa-solid fa-robot" aria-hidden="true" />
      <h3>{{ t('extensionsBuiltin.customAgents.noAgents') }}</h3>
      <p>{{ t('extensionsBuiltin.customAgents.noAgentsDescription') }}</p>
      <Button type="button" icon="fa-plus" @click="create">{{ t('extensionsBuiltin.customAgents.create') }}</Button>
    </section>

    <template v-if="selected">
      <nav class="custom-agent-settings__sections" :aria-label="t('extensionsBuiltin.customAgents.sections')">
        <button
          type="button"
          :class="{ 'is-active': activeSection === 'workflow' }"
          @click="activeSection = 'workflow'"
        >
          <i class="fa-solid fa-diagram-project" aria-hidden="true" />
          {{ t('extensionsBuiltin.customAgents.workflow') }}
        </button>
        <button
          type="button"
          :class="{ 'is-active': activeSection === 'settings' }"
          @click="activeSection = 'settings'"
        >
          <i class="fa-solid fa-sliders" aria-hidden="true" />
          {{ t('extensionsBuiltin.customAgents.settings') }}
        </button>
        <button
          type="button"
          :class="{ 'is-active': activeSection === 'transfer' }"
          @click="activeSection = 'transfer'"
        >
          <i class="fa-solid fa-file-code" aria-hidden="true" />
          {{ t('extensionsBuiltin.customAgents.importExport') }}
        </button>
      </nav>

      <section v-show="activeSection === 'workflow'" class="custom-agent-settings__workflow">
        <FlowEditor v-if="editor" :key="selected.agent.id" :store="editor" :registry="builtinNodeRegistry" />
        <Button
          v-if="hasRunOverlay"
          class="custom-agent-settings__clear"
          type="button"
          variant="ghost"
          @click="clearOverlay"
          >{{ t('extensionsBuiltin.customAgents.clearRunOverlay') }}</Button
        >
      </section>

      <section v-show="activeSection === 'settings'" class="custom-agent-settings__configuration">
        <AgentMetadataPanel
          :preset="selected"
          :t="t"
          @rename="updateInstalled((preset) => renameInstalledPreset(settings, preset.agent.id, $event))"
          @priority="updatePriority"
        />
        <ConfigurationPanel :preset="selected" :t="t" @update="updateConfiguration" />
        <StatePanel :context="selectedContext" :t="t" :busy="resetBusy" @reset="resetState" />
        <p v-if="runtimeError" class="error">{{ runtimeError }}</p>
      </section>

      <section v-show="activeSection === 'transfer'" class="custom-agent-settings__transfer">
        <header>
          <div>
            <h3>{{ t('extensionsBuiltin.customAgents.importExport') }}</h3>
            <p>{{ t('extensionsBuiltin.customAgents.importExportDescription') }}</p>
          </div>
          <div>
            <Button type="button" icon="fa-download" variant="ghost" @click="doExport">{{ t('common.export') }}</Button>
            <Button type="button" icon="fa-upload" variant="confirm" @click="doImport">{{ t('common.import') }}</Button>
          </div>
        </header>
        <Textarea
          :label="t('extensionsBuiltin.customAgents.presetJson')"
          :model-value="transfer"
          :placeholder="t('extensionsBuiltin.customAgents.presetJsonPlaceholder')"
          :rows="14"
          allow-maximize
          @update:model-value="transfer = $event"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.custom-agent-settings {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 100%;
  padding: 1rem;
  color: var(--theme-text-color);
}
.custom-agent-settings__header,
.custom-agent-settings__picker,
.custom-agent-settings__actions,
.custom-agent-settings__transfer header,
.custom-agent-settings__transfer header > div:last-child {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}
.custom-agent-settings__header {
  justify-content: space-between;
}
.custom-agent-settings__identity {
  min-width: 0;
}
.custom-agent-settings__identity h2 {
  margin: 0.1rem 0;
  overflow-wrap: anywhere;
  font-size: 1.35rem;
  line-height: 1.2;
}
.custom-agent-settings__identity code {
  color: var(--theme-text-color-secondary, var(--theme-text-color));
  font-size: 0.75rem;
  opacity: 0.65;
}
.custom-agent-settings__eyebrow {
  color: var(--theme-accent-color);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.custom-agent-settings__actions {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.custom-agent-settings__picker {
  display: grid;
  grid-template-columns: minmax(15rem, 1fr) auto;
  padding: 0.75rem 1rem;
  border: 1px solid var(--theme-border-color);
  border-radius: calc(var(--border-radius) + 2px);
  background: color-mix(in srgb, var(--theme-background-tint), transparent 20%);
}
.custom-agent-settings__picker > :first-child {
  min-width: 0;
}
.custom-agent-settings__catalog {
  border: 1px solid var(--theme-border-color);
  border-radius: var(--border-radius);
  background: color-mix(in srgb, var(--theme-background-tint), transparent 35%);
}
.custom-agent-settings__catalog summary {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.75rem 1rem;
  font-weight: 700;
  cursor: pointer;
}
.custom-agent-settings__catalog summary span {
  display: inline-grid;
  min-width: 1.4rem;
  height: 1.4rem;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--theme-accent-color), transparent 75%);
  font-size: 0.7rem;
}
.custom-agent-settings__catalog > div {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.6rem;
  padding: 0 0.75rem 0.75rem;
}
.custom-agent-settings__catalog article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  min-height: 4.5rem;
  padding: 0.75rem;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--border-radius);
  background: color-mix(in srgb, var(--theme-background-tint), black 2%);
}
.custom-agent-settings__catalog article > i {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: var(--border-radius);
  color: var(--theme-accent-color);
  background: color-mix(in srgb, var(--theme-accent-color), transparent 86%);
}
.custom-agent-settings__catalog article > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.2rem;
}
.custom-agent-settings__catalog article strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.custom-agent-settings__catalog small {
  opacity: 0.6;
}
.custom-agent-settings__sections {
  position: sticky;
  top: 0;
  z-index: 8;
  display: flex;
  gap: 0.25rem;
  padding: 0.3rem;
  border: 1px solid var(--theme-border-color);
  border-radius: calc(var(--border-radius) + 2px);
  background: var(--theme-background-color, #171717);
}
.custom-agent-settings__sections button {
  display: flex;
  flex: 0 1 auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.6rem 0.9rem;
  border: 0;
  border-radius: var(--border-radius);
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.custom-agent-settings__sections button:hover {
  background: color-mix(in srgb, var(--theme-text-color), transparent 92%);
}
.custom-agent-settings__sections button.is-active {
  color: var(--theme-accent-color);
  background: color-mix(in srgb, var(--theme-accent-color), transparent 86%);
  box-shadow: inset 0 -2px var(--theme-accent-color);
}
.custom-agent-settings__workflow {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--theme-border-color);
  border-radius: calc(var(--border-radius) + 2px);
}
.custom-agent-settings__clear {
  margin: 0.5rem;
}
.custom-agent-settings__configuration {
  display: grid;
  grid-template-columns: minmax(16rem, 0.75fr) minmax(22rem, 1.5fr);
  gap: 1rem;
  align-items: start;
}
.custom-agent-settings__configuration :deep(.custom-agent-panel) {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
  margin: 0;
  padding: 1rem;
  border: 1px solid var(--theme-border-color);
  border-radius: calc(var(--border-radius) + 2px);
  background: color-mix(in srgb, var(--theme-background-tint), transparent 20%);
}
.custom-agent-settings__configuration :deep(.custom-agent-panel:nth-child(2)) {
  grid-row: span 2;
}
.custom-agent-settings__configuration :deep(legend) {
  padding: 0 0.4rem;
  color: var(--theme-accent-color);
  font-weight: 750;
}
.custom-agent-settings__transfer {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--theme-border-color);
  border-radius: calc(var(--border-radius) + 2px);
  background: color-mix(in srgb, var(--theme-background-tint), transparent 20%);
}
.custom-agent-settings__transfer header {
  justify-content: space-between;
}
.custom-agent-settings__transfer h3,
.custom-agent-settings__transfer p {
  margin: 0;
}
.custom-agent-settings__transfer p {
  margin-top: 0.25rem;
  opacity: 0.65;
}
.custom-agent-settings__notice {
  margin: 0;
  padding: 0.75rem 1rem;
  border-radius: var(--border-radius);
  background: color-mix(in srgb, var(--theme-accent-color), transparent 88%);
}
.custom-agent-settings__empty {
  display: flex;
  min-height: 15rem;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  border: 1px dashed var(--theme-border-color);
  border-radius: calc(var(--border-radius) + 2px);
  text-align: center;
}
.custom-agent-settings__empty > i {
  color: var(--theme-accent-color);
  font-size: 2rem;
}
.custom-agent-settings__empty h3,
.custom-agent-settings__empty p {
  margin: 0;
}
.custom-agent-settings__empty p {
  max-width: 28rem;
  opacity: 0.65;
}
.error {
  color: var(--theme-error-color);
  white-space: pre-wrap;
}
pre {
  max-height: 24rem;
  overflow: auto;
}
@media (max-width: 760px) {
  .custom-agent-settings__header,
  .custom-agent-settings__transfer header {
    align-items: flex-start;
    flex-direction: column;
  }
  .custom-agent-settings__actions {
    justify-content: flex-start;
  }
  .custom-agent-settings__picker,
  .custom-agent-settings__configuration {
    grid-template-columns: 1fr;
  }
  .custom-agent-settings__configuration :deep(.custom-agent-panel:nth-child(2)) {
    grid-row: auto;
  }
  .custom-agent-settings__sections button {
    flex: 1;
    justify-content: center;
  }
}
</style>
