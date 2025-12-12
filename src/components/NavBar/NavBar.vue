<script setup lang="ts">
import { computed } from 'vue';
import { useComponentRegistryStore } from '../../stores/component-registry.store';
import { useLayoutStore } from '../../stores/layout.store';
import type { NavBarItemDefinition } from '../../types';
import { Button } from '../UI';

const layoutStore = useLayoutStore();
const componentRegistryStore = useComponentRegistryStore();
const navItems = computed(() => Array.from(componentRegistryStore.navBarRegistry));

const mainNavItems = computed(() => navItems.value.filter(([, item]) => !!item.layoutComponent));
const floatingNavItems = computed(() =>
  navItems.value.filter(([, item]) => !!item.targetSidebarId && !item.layoutComponent),
);
const drawerNavItems = computed(() =>
  navItems.value.filter(([, item]) => !item.layoutComponent && !item.targetSidebarId),
);

const isActive = (id: string, item: NavBarItemDefinition) => {
  if (item.targetSidebarId) {
    return layoutStore.isLeftSidebarOpen && layoutStore.leftSidebarView === item.targetSidebarId;
  }

  if (!item.layoutComponent) {
    return layoutStore.activeDrawer === id;
  }

  if (layoutStore.activeMainLayout === id) {
    if (layoutStore.isLeftSidebarOpen && item.defaultSidebarId) {
      return layoutStore.leftSidebarView === item.defaultSidebarId;
    }
    return true;
  }

  return false;
};
</script>

<template>
  <div id="nav-bar" class="nav-bar">
    <div class="nav-bar-nav">
      <!-- Main Sections (Top) -->
      <div class="nav-bar-section nav-bar-section--main">
        <div v-for="[id, item] in mainNavItems" :key="id" class="nav-item">
          <Button
            variant="ghost"
            :icon="item.icon"
            :active="isActive(id, item)"
            :title="item.title"
            @click="layoutStore.activateNavBarItem(id)"
          />
        </div>
      </div>

      <!-- Floating/Sidebar Toggles (Middle) -->
      <div v-if="floatingNavItems.length" class="nav-bar-section nav-bar-section--floating">
        <div v-for="[id, item] in floatingNavItems" :key="id" class="nav-item">
          <Button
            variant="ghost"
            :icon="item.icon"
            :active="isActive(id, item)"
            :title="item.title"
            @click="layoutStore.activateNavBarItem(id)"
          />
        </div>
      </div>

      <!-- Drawers (Bottom) -->
      <div v-if="drawerNavItems.length" class="nav-bar-section nav-bar-section--drawer">
        <div v-for="[id, item] in drawerNavItems" :key="id" class="nav-item">
          <Button
            variant="ghost"
            :icon="item.icon"
            :active="isActive(id, item)"
            :title="item.title"
            @click="layoutStore.activateNavBarItem(id)"
          />
        </div>
      </div>
    </div>
  </div>

  <!-- Drawer Content Areas -->
  <template v-for="[id, item] in drawerNavItems" :key="id">
    <div
      v-show="item.component"
      class="nav-item-content"
      :class="{
        active: layoutStore.activeDrawer === id,
        wide: item.layout === 'wide',
      }"
    >
      <component :is="item.component" />
    </div>
  </template>
</template>
