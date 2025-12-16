<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useComponentRegistryStore } from '../../stores/component-registry.store';
import { useLayoutStore } from '../../stores/layout.store';
import type { NavBarItemDefinition } from '../../types';
import { Button } from '../UI';

const layoutStore = useLayoutStore();
const componentRegistryStore = useComponentRegistryStore();
const { t } = useStrictI18n();
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
  <nav id="nav-bar" class="nav-bar" :aria-label="t('a11y.navbar.navigation')">
    <ul class="nav-bar-nav">
      <!-- Main Sections (Top) -->
      <li class="nav-bar-section nav-bar-section--main">
        <ul class="nav-section-list">
          <li v-for="[id, item] in mainNavItems" :key="id" class="nav-item">
            <Button
              variant="ghost"
              :icon="item.icon"
              :active="isActive(id, item)"
              :title="item.title"
              :aria-label="item.title"
              :aria-current="isActive(id, item) ? 'page' : undefined"
              @click="layoutStore.activateNavBarItem(id)"
            />
          </li>
        </ul>
      </li>

      <!-- Floating/Sidebar Toggles (Middle) -->
      <li v-if="floatingNavItems.length" class="nav-bar-section nav-bar-section--floating">
        <ul class="nav-section-list">
          <li v-for="[id, item] in floatingNavItems" :key="id" class="nav-item">
            <Button
              variant="ghost"
              :icon="item.icon"
              :active="isActive(id, item)"
              :title="item.title"
              :aria-label="item.title"
              :aria-expanded="isActive(id, item)"
              aria-haspopup="true"
              @click="layoutStore.activateNavBarItem(id)"
            />
          </li>
        </ul>
      </li>

      <!-- Drawers (Bottom) -->
      <li v-if="drawerNavItems.length" class="nav-bar-section nav-bar-section--drawer">
        <ul class="nav-section-list">
          <li v-for="[id, item] in drawerNavItems" :key="id" class="nav-item">
            <Button
              variant="ghost"
              :icon="item.icon"
              :active="isActive(id, item)"
              :title="item.title"
              :aria-expanded="isActive(id, item)"
              aria-haspopup="dialog"
              @click="layoutStore.activateNavBarItem(id)"
            />
          </li>
        </ul>
      </li>
    </ul>
  </nav>

  <!-- Drawer Content Areas -->
  <template v-for="[id, item] in drawerNavItems" :key="id">
    <div
      v-show="item.component"
      class="nav-item-content"
      :class="{
        active: layoutStore.activeDrawer === id,
        wide: item.layout === 'wide',
      }"
      role="dialog"
      :aria-label="item.title"
      :aria-hidden="layoutStore.activeDrawer !== id"
    >
      <component :is="item.component" />
    </div>
  </template>
</template>
