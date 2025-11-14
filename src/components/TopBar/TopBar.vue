<script setup lang="ts">
import { ref } from 'vue';
import RightMenu from '../RightMenu/RightMenu.vue';
import ExtensionsDrawer from './ExtensionsDrawer.vue';
import UserSettingsDrawer from './UserSettingsDrawer.vue';
import ApiConnectionsDrawer from './ApiConnectionsDrawer.vue';
import AiConfigDrawer from './AiConfigDrawer.vue';
import BackgroundsDrawer from './BackgroundsDrawer.vue';

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
            :title="$t('topbar.aiConfig')"
          ></div>
        </button>
        <div class="nav-item__content drawer-pane--fill-left" :class="{ active: activeDrawer === 'ai-config' }">
          <AiConfigDrawer />
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('api-status')">
          <div
            class="nav-item__icon fa-solid fa-plug fa-fw"
            :class="{ active: activeDrawer === 'api-status' }"
            :title="$t('topbar.apiConnections')"
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
            :title="$t('topbar.formatting')"
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
            :title="$t('topbar.worldInfo')"
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
            :title="$t('topbar.userSettings')"
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
            :title="$t('topbar.backgrounds')"
          ></div>
        </button>
        <div class="nav-item__content" :class="{ active: activeDrawer === 'backgrounds' }">
          <BackgroundsDrawer />
        </div>
      </div>
      <div class="nav-item">
        <button type="button" class="nav-item__toggle" @click="toggleDrawer('extensions')">
          <div
            class="nav-item__icon fa-solid fa-cubes fa-fw"
            :class="{ active: activeDrawer === 'extensions' }"
            :title="$t('topbar.extensions')"
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
            :title="$t('topbar.personaManagement')"
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
            :title="$t('topbar.characterManagement')"
          ></div>
        </button>
        <div class="nav-item__content drawer-pane--fill-right" :class="{ active: activeDrawer === 'character' }">
          <RightMenu />
        </div>
      </div>
    </div>
  </div>
</template>
