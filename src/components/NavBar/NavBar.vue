<script setup lang="ts">
import CharacterPanel from '../CharacterPanel/CharacterPanel.vue';
import ExtensionsDrawer from './ExtensionsDrawer.vue';
import UserSettingsDrawer from './UserSettingsDrawer.vue';
import ApiConnectionsDrawer from './ApiConnectionsDrawer.vue';
import AiConfigDrawer from './AiConfigDrawer.vue';
import BackgroundsDrawer from './BackgroundsDrawer.vue';
import WorldInfoDrawer from './WorldInfoDrawer.vue';
import PersonaManagementDrawer from './PersonaManagementDrawer.vue';
import FormattingDrawer from './FormattingDrawer.vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useUiStore } from '@/stores/ui.store';
import type { DrawerType } from '@/types';

const { t } = useStrictI18n();

const uiStore = useUiStore();

function toggleDrawer(drawerName: DrawerType) {
  if (uiStore.activeDrawer === drawerName) {
    uiStore.activeDrawer = null; // Close if already open
  } else {
    uiStore.activeDrawer = drawerName; // Open the new one
  }
}
</script>

<template>
  <div>
    <div id="nav-bar" class="nav-bar">
      <div class="nav-bar-nav">
        <div class="nav-item">
          <button type="button" class="nav-item-toggle" @click="toggleDrawer('ai-config')">
            <div
              class="nav-item-icon fa-solid fa-sliders fa-fw"
              :class="{ active: uiStore.activeDrawer === 'ai-config' }"
              :title="t('navbar.aiConfig')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item-toggle" @click="toggleDrawer('api-status')">
            <div
              class="nav-item-icon fa-solid fa-plug fa-fw"
              :class="{ active: uiStore.activeDrawer === 'api-status' }"
              :title="t('navbar.apiConnections')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item-toggle" @click="toggleDrawer('formatting')">
            <div
              class="nav-item-icon fa-solid fa-font fa-fw"
              :class="{ active: uiStore.activeDrawer === 'formatting' }"
              :title="t('navbar.formatting')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item-toggle" @click="toggleDrawer('world-info')">
            <div
              class="nav-item-icon fa-solid fa-book-atlas fa-fw"
              :class="{ active: uiStore.activeDrawer === 'world-info' }"
              :title="t('navbar.worldInfo')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item-toggle" @click="toggleDrawer('user-settings')">
            <div
              class="nav-item-icon fa-solid fa-user-cog fa-fw"
              :class="{ active: uiStore.activeDrawer === 'user-settings' }"
              :title="t('navbar.userSettings')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item-toggle" @click="toggleDrawer('backgrounds')">
            <div
              class="nav-item-icon fa-solid fa-panorama fa-fw"
              :class="{ active: uiStore.activeDrawer === 'backgrounds' }"
              :title="t('navbar.backgrounds')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item-toggle" @click="toggleDrawer('extensions')">
            <div
              class="nav-item-icon fa-solid fa-cubes fa-fw"
              :class="{ active: uiStore.activeDrawer === 'extensions' }"
              :title="t('navbar.extensions')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item-toggle" @click="toggleDrawer('persona')">
            <div
              class="nav-item-icon fa-solid fa-face-smile fa-fw"
              :class="{ active: uiStore.activeDrawer === 'persona' }"
              :title="t('navbar.personaManagement')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item-toggle" @click="toggleDrawer('character')">
            <div
              class="nav-item-icon fa-solid fa-address-card fa-fw"
              :class="{ active: uiStore.activeDrawer === 'character' }"
              :title="t('navbar.characterManagement')"
            ></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Drawers -->
    <div class="nav-item-content" :class="{ active: uiStore.activeDrawer === 'ai-config' }">
      <AiConfigDrawer />
    </div>
    <div class="nav-item-content" :class="{ active: uiStore.activeDrawer === 'api-status' }">
      <ApiConnectionsDrawer />
    </div>
    <div class="nav-item-content" :class="{ active: uiStore.activeDrawer === 'formatting' }">
      <FormattingDrawer />
    </div>
    <div
      class="nav-item-content"
      :class="{ active: uiStore.activeDrawer === 'world-info', wide: uiStore.activeDrawer === 'world-info' }"
    >
      <WorldInfoDrawer />
    </div>
    <div class="nav-item-content" :class="{ active: uiStore.activeDrawer === 'user-settings' }">
      <UserSettingsDrawer />
    </div>
    <div class="nav-item-content" :class="{ active: uiStore.activeDrawer === 'backgrounds' }">
      <BackgroundsDrawer />
    </div>
    <div
      class="nav-item-content"
      :class="{ active: uiStore.activeDrawer === 'extensions', wide: uiStore.activeDrawer === 'extensions' }"
    >
      <ExtensionsDrawer />
    </div>
    <div class="nav-item-content" :class="{ active: uiStore.activeDrawer === 'persona' }">
      <PersonaManagementDrawer />
    </div>
    <div
      class="nav-item-content"
      :class="{ active: uiStore.activeDrawer === 'character', wide: uiStore.activeDrawer === 'character' }"
    >
      <CharacterPanel />
    </div>
  </div>
</template>
