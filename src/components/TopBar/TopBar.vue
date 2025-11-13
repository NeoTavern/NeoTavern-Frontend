<script setup lang="ts">
import { ref } from 'vue';
import RightMenu from '../RightMenu/RightMenu.vue';
import ExtensionsDrawer from './ExtensionsDrawer.vue';
import UserSettingsDrawer from './UserSettingsDrawer.vue';
import ApiConnectionsDrawer from './ApiConnectionsDrawer.vue';

// Reactive state to control which drawer is open
const activeDrawer = ref<string | null>(null);

function toggleDrawer(drawerName: string) {
  if (activeDrawer.value === drawerName) {
    activeDrawer.value = null; // Close if already open
  } else {
    activeDrawer.value = drawerName; // Open the new one
  }
}
</script>

<template>
  <div>
    <div class="top-bar"></div>
    <div class="top-bar__nav">
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('ai-config')">
          <div
            class="nav-item__icon fa-solid fa-sliders fa-fw"
            :class="{ active: activeDrawer === 'ai-config' }"
            title="AI Response Configuration"
          ></div>
        </button>
        <div class="nav-item__content drawer-pane--fill-left" :class="{ active: activeDrawer === 'ai-config' }">
          <!-- AI Config Content -->
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('api-status')">
          <div
            class="nav-item__icon fa-solid fa-plug fa-fw"
            :class="{ active: activeDrawer === 'api-status' }"
            title="API Connections"
          ></div>
        </button>
        <div class="nav-item__content" :class="{ active: activeDrawer === 'api-status' }">
          <ApiConnectionsDrawer />
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('formatting')">
          <div
            class="nav-item__icon fa-solid fa-font fa-fw"
            :class="{ active: activeDrawer === 'formatting' }"
            title="AI Response Formatting"
          ></div>
        </button>
        <div class="nav-item__content" :class="{ active: activeDrawer === 'formatting' }">
          <!-- Formatting Content -->
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('world-info')">
          <div
            class="nav-item__icon fa-solid fa-book-atlas fa-fw"
            :class="{ active: activeDrawer === 'world-info' }"
            title="World Info"
          ></div>
        </button>
        <div class="nav-item__content" :class="{ active: activeDrawer === 'world-info' }">
          <!-- World Info Content -->
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('user-settings')">
          <div
            class="nav-item__icon fa-solid fa-user-cog fa-fw"
            :class="{ active: activeDrawer === 'user-settings' }"
            title="User Settings"
          ></div>
        </button>
        <div class="nav-item__content" :class="{ active: activeDrawer === 'user-settings' }">
          <UserSettingsDrawer />
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('backgrounds')">
          <div
            class="nav-item__icon fa-solid fa-panorama fa-fw"
            :class="{ active: activeDrawer === 'backgrounds' }"
            title="Change Background Image"
          ></div>
        </button>
        <div class="nav-item__content" :class="{ active: activeDrawer === 'backgrounds' }">
          <!-- Backgrounds Content -->
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('extensions')">
          <div
            class="nav-item__icon fa-solid fa-cubes fa-fw"
            :class="{ active: activeDrawer === 'extensions' }"
            title="Extensions"
          ></div>
        </button>
        <div class="nav-item__content" :class="{ active: activeDrawer === 'extensions' }">
          <ExtensionsDrawer />
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('persona')">
          <div
            class="nav-item__icon fa-solid fa-face-smile fa-fw"
            :class="{ active: activeDrawer === 'persona' }"
            title="Persona Management"
          ></div>
        </button>
        <div class="nav-item__content" :class="{ active: activeDrawer === 'persona' }">
          <!-- Persona Management Content -->
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('character')">
          <div
            class="nav-item__icon fa-solid fa-address-card fa-fw"
            :class="{ active: activeDrawer === 'character' }"
            title="Character Management"
          ></div>
        </button>
        <div class="nav-item__content drawer-pane--fill-right" :class="{ active: activeDrawer === 'character' }">
          <RightMenu />
        </div>
      </div>
    </div>
  </div>
</template>
