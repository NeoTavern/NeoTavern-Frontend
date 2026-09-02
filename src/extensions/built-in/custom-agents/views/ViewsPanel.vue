<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Select } from '../../../../components/UI';
import type { CustomAgentsHostAPI } from '../host/api';
import type { GraphCustomAgentsRuntime, GraphSelectedAgentContext } from '../host/runtime';
import ViewComponentRenderer from './ViewComponentRenderer.vue';

const props = defineProps<{ api: CustomAgentsHostAPI; runtime: GraphCustomAgentsRuntime }>();
const selected = ref('');
const agents = shallowRef(props.runtime.getAgents());
const context = shallowRef<GraphSelectedAgentContext>();
const entries = computed(() =>
  agents.value
    .filter((agent) => agent.definition.enabled)
    .flatMap((agent) => agent.definition.views.map((view) => ({ agent: agent.definition, view }))),
);
const current = computed(
  () => entries.value.find(({ agent, view }) => `${agent.id}/${view.id}` === selected.value) ?? entries.value[0],
);
const refresh = (): void => {
  agents.value = props.runtime.getAgents();
  context.value = current.value ? props.runtime.getSelectedAgentContext(current.value.agent.id) : undefined;
};
const unsubscribe = props.runtime.subscribe(refresh);
watch(current, refresh, { immediate: true });
onBeforeUnmount(unsubscribe);
</script>

<template>
  <div class="custom-agents-views">
    <Select
      v-if="entries.length"
      :model-value="selected || `${current!.agent.id}/${current!.view.id}`"
      :options="
        entries.map((entry) => ({
          label: `${entry.agent.name} — ${entry.view.title}`,
          value: `${entry.agent.id}/${entry.view.id}`,
        }))
      "
      @update:model-value="selected = $event as string"
    />
    <p v-else>{{ api.i18n.t('extensionsBuiltin.customAgents.noViews') }}</p>
    <ViewComponentRenderer
      v-if="current && context"
      :key="`${current.agent.id}/${current.view.id}/${context.selectionKey}`"
      :api="api"
      :runtime="runtime"
      :agent="current.agent"
      :node="current.view.root"
      :context="context"
    />
    <p v-else-if="current">{{ api.i18n.t('extensionsBuiltin.customAgents.noActiveChat') }}</p>
  </div>
</template>

<style scoped>
.custom-agents-views {
  padding: var(--spacing-md);
  overflow: auto;
  height: 100%;
}
</style>
