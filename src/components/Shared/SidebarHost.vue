<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useComponentRegistryStore } from '../../stores/component-registry.store';
import { useLayoutStore } from '../../stores/layout.store';
import type { Settings } from '../../types';
import Sidebar from './Sidebar.vue';

const props = defineProps<{
  side: 'left' | 'right';
}>();

const layoutStore = useLayoutStore();
const registryStore = useComponentRegistryStore();

// Hydration Set: Tracks which sidebar IDs have been rendered at least once.
// This allows us to "Lazy Load" components (performance) but "Persist" them
// via v-show once loaded (to support vanilla JS extensions that modify DOM).
const hydratedViews = ref(new Set<string>());

const isOpen = computed(() => (props.side === 'left' ? layoutStore.isLeftSidebarOpen : layoutStore.isRightSidebarOpen));

const storageKey = computed(
  () => (props.side === 'left' ? 'leftSidebarWidth' : 'rightSidebarWidth') as keyof Settings['account'],
);

const activeViewId = computed(() =>
  props.side === 'left' ? layoutStore.leftSidebarView : layoutStore.rightSidebarView,
);

// Watch the active view. If we switch to a new view we haven't seen before, hydrate it.
watch(
  activeViewId,
  (newId) => {
    if (newId && !hydratedViews.value.has(newId)) {
      hydratedViews.value.add(newId);
    }
  },
  { immediate: true },
);

const activeRegistry = computed(() => {
  if (props.side === 'left') {
    return Array.from(registryStore.leftSidebarRegistry);
  }
  // Right sidebars are filtered by active main layout
  return Array.from(registryStore.rightSidebarRegistry).filter(
    ([, def]) => (def.layoutId ?? 'chat') === layoutStore.activeMainLayout,
  );
});
</script>

<template>
  <Sidebar :side="side" :is-open="isOpen" :storage-key="storageKey">
    <template v-for="[id, def] in activeRegistry" :key="id">
      <!-- 
        Logic: 
        1. v-if checks if it's active OR previously hydrated. If neither, it doesn't exist in DOM.
        2. v-show toggles visibility. 
        Result: Fast startup, persistent state after first open.
      -->
      <div
        v-if="activeViewId === id || hydratedViews.has(id)"
        v-show="activeViewId === id"
        :id="`sidebar-${side}-${id}`"
        class="sidebar-pane"
      >
        <component :is="def.component" v-bind="{ title: def.title, ...def.componentProps }" />
      </div>
    </template>
  </Sidebar>
</template>

<style scoped>
.sidebar-pane {
  height: 100%;
  width: 100%;
  overflow: hidden;
}
</style>
