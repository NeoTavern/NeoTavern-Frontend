<script setup lang="ts">
import { computed } from 'vue';
import { useUiStore } from '../../stores/ui.store';
import { Button } from '../UI';

const uiStore = useUiStore();

const navItems = computed(() => Array.from(uiStore.navBarRegistry));
const mainNavItems = computed(() => navItems.value.filter(([, item]) => item.section === 'main'));
const floatingNavItems = computed(() => navItems.value.filter(([, item]) => item.section === 'floating'));
const drawerNavItems = computed(() => navItems.value.filter(([, item]) => !item.section || item.section === 'drawer'));

function onNavItemClick(id: string, onClick?: () => void) {
  if (onClick) {
    onClick();
    return;
  }
  if (uiStore.activeDrawer === id) {
    uiStore.activeDrawer = null;
  } else {
    uiStore.activeDrawer = id;
  }
}

function handleMainClick(id: string, onClick?: () => void, defaultSidebarId?: string) {
  if (onClick) {
    onClick();
  }
  const isActive = uiStore.activeMainLayout === id;
  if (!isActive) {
    uiStore.setActiveMainLayout(id, defaultSidebarId);
    return;
  }
  const isDefaultSidebarActive =
    defaultSidebarId && uiStore.leftSidebarView === defaultSidebarId && uiStore.isLeftSidebarOpen;
  if (isDefaultSidebarActive) {
    uiStore.closeLeftSidebar();
  } else if (defaultSidebarId) {
    uiStore.openFloatingLeftSidebar(defaultSidebarId);
  }
}

function handleFloatingClick(targetSidebarId?: string, onClick?: () => void) {
  if (onClick) {
    onClick();
  }
  if (targetSidebarId) {
    const isActive =
      uiStore.leftSidebarView === targetSidebarId && uiStore.isLeftSidebarOpen && uiStore.floatingLeftSidebarView;
    if (isActive) {
      uiStore.closeLeftSidebar();
    } else {
      uiStore.openFloatingLeftSidebar(targetSidebarId);
    }
  }
}
</script>

<template>
  <div>
    <div id="nav-bar" class="nav-bar">
      <div class="nav-bar-nav">
        <div class="nav-bar-section nav-bar-section--main">
          <div v-for="[id, item] in mainNavItems" :key="id" class="nav-item">
            <Button
              variant="ghost"
              :icon="item.icon"
              :active="uiStore.activeMainLayout === id"
              :title="item.title"
              @click="handleMainClick(id, item.onClick, item.defaultSidebarId)"
            />
          </div>
        </div>

        <div v-if="floatingNavItems.length" class="nav-bar-section nav-bar-section--floating">
          <div v-for="[id, item] in floatingNavItems" :key="id" class="nav-item">
            <Button
              variant="ghost"
              :icon="item.icon"
              :active="uiStore.leftSidebarView === (item.targetSidebarId || item.defaultSidebarId)"
              :title="item.title"
              @click="handleFloatingClick(item.targetSidebarId || item.defaultSidebarId, item.onClick)"
            />
          </div>
        </div>

        <div v-if="drawerNavItems.length" class="nav-bar-section nav-bar-section--drawer">
          <div v-for="[id, item] in drawerNavItems" :key="id" class="nav-item">
            <Button
              variant="ghost"
              :icon="item.icon"
              :active="uiStore.activeDrawer === id"
              :title="item.title"
              @click="onNavItemClick(id, item.onClick)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Drawers -->
    <template v-for="[id, item] in drawerNavItems" :key="id">
      <div
        v-show="item.component"
        class="nav-item-content"
        :class="{ active: uiStore.activeDrawer === id, wide: item.layout === 'wide' }"
      >
        <component :is="item.component" />
      </div>
    </template>
  </div>
</template>
