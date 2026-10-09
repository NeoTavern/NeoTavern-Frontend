<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Input } from '../../../../components/UI';
import type { ReadonlyNodeRegistry } from '../registry/node-definition';
import { useEditorI18n } from './editor-i18n';

const props = defineProps<{ registry: ReadonlyNodeRegistry; open: boolean }>();
const emit = defineEmits<{ add: [type: string]; toggle: [] }>();
const query = ref('');
const collapsedCategories = ref<ReadonlySet<string>>(new Set());
const { t, translateKey } = useEditorI18n();
const grouped = computed(() => {
  const search = query.value.trim().toLowerCase();
  const definitions = props.registry
    .list()
    .filter(
      (definition) =>
        !search || `${definition.type} ${translateKey(definition.labelKey)}`.toLowerCase().includes(search),
    );
  const groups = new Map<string, typeof definitions>();
  for (const definition of definitions)
    groups.set(definition.category, [...(groups.get(definition.category) ?? []), definition]);
  return [...groups.entries()];
});
function toggleCategory(category: string) {
  const next = new Set(collapsedCategories.value);
  if (next.has(category)) next.delete(category);
  else next.add(category);
  collapsedCategories.value = next;
}
function categoryId(category: string): string {
  return `custom-agent-node-category-${category.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '-')}`;
}
</script>

<template>
  <aside
    class="custom-agent-flow__palette"
    :class="{ 'is-collapsed': !open }"
    :aria-label="t('extensionsBuiltin.customAgents.editor.nodePalette')"
  >
    <header class="custom-agent-flow__palette-header">
      <h2 v-if="open">{{ t('extensionsBuiltin.customAgents.editor.nodes') }}</h2>
      <Button
        type="button"
        class="custom-agent-flow__palette-toggle"
        :icon="open ? 'fa-chevron-left' : 'fa-chevron-right'"
        :title="t(open ? 'common.collapseSidebar' : 'common.expandSidebar')"
        :aria-expanded="open"
        @click="emit('toggle')"
      />
    </header>
    <template v-if="open">
      <Input v-model="query" type="search" :placeholder="t('extensionsBuiltin.customAgents.editor.searchNodes')" />
      <section v-for="[category, definitions] in grouped" :key="category">
        <Button
          type="button"
          class="custom-agent-flow__category-toggle"
          :icon="collapsedCategories.has(category) && !query.trim() ? 'fa-chevron-right' : 'fa-chevron-down'"
          :title="
            t(
              collapsedCategories.has(category) && !query.trim()
                ? 'extensionsBuiltin.customAgents.editor.expandCategory'
                : 'extensionsBuiltin.customAgents.editor.collapseCategory',
              { category: t(`extensionsBuiltin.customAgents.editor.categories.${category.toLowerCase()}`) },
            )
          "
          :aria-expanded="Boolean(query.trim()) || !collapsedCategories.has(category)"
          :aria-controls="categoryId(category)"
          @click="toggleCategory(category)"
        >
          {{ t(`extensionsBuiltin.customAgents.editor.categories.${category.toLowerCase()}`) }}
        </Button>
        <div
          v-if="query.trim() || !collapsedCategories.has(category)"
          :id="categoryId(category)"
          class="custom-agent-flow__category"
        >
          <Button
            v-for="definition in definitions"
            type="button"
            :key="definition.type"
            :data-node-type="definition.type"
            :title="translateKey(definition.descriptionKey)"
            @click="emit('add', definition.type)"
          >
            {{ translateKey(definition.labelKey) }}
          </Button>
        </div>
      </section>
    </template>
  </aside>
</template>
