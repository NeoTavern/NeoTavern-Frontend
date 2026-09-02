<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ReadonlyNodeRegistry } from '../registry/node-definition';
import AllScopesSmartLayout from './AllScopesSmartLayout.vue';
import FlowCanvas from './FlowCanvas.vue';
import FlowTabs from './FlowTabs.vue';
import FlowSignatureEditor from './FlowSignatureEditor.vue';
import FlowToolbar from './FlowToolbar.vue';
import GraphDiagnostics from './GraphDiagnostics.vue';
import NodePalette from './NodePalette.vue';
import type { GraphEditorStore } from './editor-store';
import { smartLayoutAvailability } from './smart-layout';
import { resolveEditorScope, type EditorPortResolutionCache } from './vue-flow-adapter';
import { useEditorI18n } from './editor-i18n';

const props = defineProps<{ store: GraphEditorStore; registry: ReadonlyNodeRegistry }>();
const { t } = useEditorI18n();
const canvas = ref<InstanceType<typeof FlowCanvas>>();
const allScopesLayout = ref<InstanceType<typeof AllScopesSmartLayout>>();
const portCache: EditorPortResolutionCache = new Map();
const flow = computed(() => props.store.selectedFlow);
const rootScope = computed(() =>
  flow.value ? resolveEditorScope(props.store.draft.value.agent, flow.value, [], props.registry, portCache) : undefined,
);
const activeScope = computed(() =>
  props.store.scopePath.value.length === 0
    ? rootScope.value
    : flow.value
      ? resolveEditorScope(
          props.store.draft.value.agent,
          flow.value,
          props.store.scopePath.value,
          props.registry,
          portCache,
        )
      : undefined,
);
const resolved = computed(() => activeScope.value?.resolved ?? new Map());
const smartLayoutState = computed(() =>
  activeScope.value ? smartLayoutAvailability(activeScope.value.graph) : undefined,
);
const smartLayoutBusy = ref(false);
const smartLayoutAllBusy = ref(false);
const smartLayoutAllProgress = ref<{ completed: number; total: number }>();
const smartLayoutFailure = ref<string>();
const layoutBusy = computed(() => smartLayoutBusy.value || smartLayoutAllBusy.value);
const smartLayoutAvailable = computed(() => smartLayoutState.value?.available === true && !layoutBusy.value);
const smartLayoutTitle = computed(() =>
  smartLayoutState.value?.available === false
    ? t('extensionsBuiltin.customAgents.editor.smartLayoutCyclicUnavailable')
    : smartLayoutBusy.value
      ? t('extensionsBuiltin.customAgents.editor.smartLayoutBusy')
      : (smartLayoutFailure.value ?? t('extensionsBuiltin.customAgents.editor.smartLayout')),
);
function setSmartLayoutBusy(busy: boolean) {
  smartLayoutBusy.value = busy;
  if (busy) smartLayoutFailure.value = undefined;
}
function setSmartLayoutFailure(reason: 'UNMEASURED' | 'UNAVAILABLE') {
  smartLayoutFailure.value = t(
    reason === 'UNMEASURED'
      ? 'extensionsBuiltin.customAgents.editor.smartLayoutMeasurementUnavailable'
      : 'extensionsBuiltin.customAgents.editor.smartLayoutUnavailable',
  );
}
function setSmartLayoutAllBusy(busy: boolean) {
  smartLayoutAllBusy.value = busy;
  if (busy) {
    smartLayoutFailure.value = undefined;
    smartLayoutAllProgress.value = { completed: 0, total: 0 };
  }
}
function setSmartLayoutAllFailure(reason: 'CYCLIC' | 'UNMEASURED' | 'UNAVAILABLE') {
  smartLayoutFailure.value = t(
    reason === 'CYCLIC'
      ? 'extensionsBuiltin.customAgents.editor.smartLayoutAllCyclicUnavailable'
      : reason === 'UNMEASURED'
        ? 'extensionsBuiltin.customAgents.editor.smartLayoutAllMeasurementUnavailable'
        : 'extensionsBuiltin.customAgents.editor.smartLayoutAllUnavailable',
  );
}
const smartLayoutAllTitle = computed(() => {
  const progress = smartLayoutAllProgress.value;
  return smartLayoutAllBusy.value && progress?.total
    ? t('extensionsBuiltin.customAgents.editor.smartLayoutAllProgress', progress)
    : t('extensionsBuiltin.customAgents.editor.smartLayoutAll');
});
const rootResolved = computed(() => rootScope.value?.resolved ?? new Map());
</script>

<template>
  <section class="custom-agent-flow" :aria-label="t('extensionsBuiltin.customAgents.editor.flowEditor')">
    <FlowTabs
      :flows="store.draft.value.agent.flows"
      :selected-id="store.selectedFlowId.value"
      @select="store.selectFlow($event)"
      @create="store.createFlow($event)"
      @duplicate="store.duplicateFlow($event)"
      @rename="(id, name) => store.renameFlow(id, name)"
      @remove="store.deleteFlow($event)"
    />
    <FlowToolbar
      :can-undo="store.canUndo"
      :can-redo="store.canRedo"
      :can-apply="store.canApply.value"
      :can-smart-layout="smartLayoutAvailable"
      :smart-layout-title="smartLayoutTitle"
      :smart-layout-busy="smartLayoutBusy"
      :can-smart-layout-all="store.draft.value.agent.flows.length > 0 && !layoutBusy"
      :smart-layout-all-title="smartLayoutAllTitle"
      :smart-layout-all-busy="smartLayoutAllBusy"
      :smart-layout-status="smartLayoutFailure"
      :dirty="store.isDirty.value"
      :nested="store.scopePath.value.length > 0"
      @undo="store.undo()"
      @redo="store.redo()"
      @copy="store.copy()"
      @paste="store.paste()"
      @fit="canvas?.fitView()"
      @smart-layout="canvas?.applySmartLayout()"
      @smart-layout-all="allScopesLayout?.applySmartLayoutAll()"
      @apply="store.apply()"
      @reset="store.reset()"
      @back="store.closeBody()"
    />
    <div class="custom-agent-flow__workspace" :class="{ 'is-palette-collapsed': !store.paletteOpen.value }">
      <NodePalette
        :open="store.paletteOpen.value"
        :registry="registry"
        @toggle="store.paletteOpen.value = !store.paletteOpen.value"
        @add="store.addNode($event)"
      />
      <main class="custom-agent-flow__main">
        <FlowSignatureEditor :store="store" />
        <FlowCanvas
          :key="store.currentScopeKey"
          ref="canvas"
          :store="store"
          :registry="registry"
          :resolved-ports="resolved"
          :root-resolved="rootResolved"
          @smart-layout-busy="setSmartLayoutBusy"
          @smart-layout-failed="setSmartLayoutFailure"
          @smart-layout-succeeded="smartLayoutFailure = undefined"
        />
      </main>
    </div>
    <GraphDiagnostics :diagnostics="store.diagnostics.value" @focus="store.focusDiagnostic($event)" />
    <AllScopesSmartLayout
      ref="allScopesLayout"
      :store="store"
      :registry="registry"
      @busy="setSmartLayoutAllBusy"
      @failed="setSmartLayoutAllFailure"
      @progress="(completed, total) => (smartLayoutAllProgress = { completed, total })"
      @succeeded="smartLayoutFailure = undefined"
    />
  </section>
</template>
