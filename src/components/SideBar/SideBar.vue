<script setup lang="ts">
import { ref } from 'vue';
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

const { t } = useStrictI18n();

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
    <div id="side-bar" class="side-bar">
      <div class="side-bar__nav">
        <div class="nav-item">
          <button type="button" class="nav-item__toggle" @click="toggleDrawer('ai-config')">
            <div
              class="nav-item__icon fa-solid fa-sliders fa-fw"
              :class="{ active: activeDrawer === 'ai-config' }"
              :title="t('sidebar.aiConfig')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item__toggle" @click="toggleDrawer('api-status')">
            <div
              class="nav-item__icon fa-solid fa-plug fa-fw"
              :class="{ active: activeDrawer === 'api-status' }"
              :title="t('sidebar.apiConnections')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item__toggle" @click="toggleDrawer('formatting')">
            <div
              class="nav-item__icon fa-solid fa-font fa-fw"
              :class="{ active: activeDrawer === 'formatting' }"
              :title="t('sidebar.formatting')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item__toggle" @click="toggleDrawer('world-info')">
            <div
              class="nav-item__icon fa-solid fa-book-atlas fa-fw"
              :class="{ active: activeDrawer === 'world-info' }"
              :title="t('sidebar.worldInfo')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item__toggle" @click="toggleDrawer('user-settings')">
            <div
              class="nav-item__icon fa-solid fa-user-cog fa-fw"
              :class="{ active: activeDrawer === 'user-settings' }"
              :title="t('sidebar.userSettings')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item__toggle" @click="toggleDrawer('backgrounds')">
            <div
              class="nav-item__icon fa-solid fa-panorama fa-fw"
              :class="{ active: activeDrawer === 'backgrounds' }"
              :title="t('sidebar.backgrounds')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item__toggle" @click="toggleDrawer('extensions')">
            <div
              class="nav-item__icon fa-solid fa-cubes fa-fw"
              :class="{ active: activeDrawer === 'extensions' }"
              :title="t('sidebar.extensions')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item__toggle" @click="toggleDrawer('persona')">
            <div
              class="nav-item__icon fa-solid fa-face-smile fa-fw"
              :class="{ active: activeDrawer === 'persona' }"
              :title="t('sidebar.personaManagement')"
            ></div>
          </button>
        </div>
        <div class="nav-item">
          <button type="button" class="nav-item__toggle" @click="toggleDrawer('character')">
            <div
              class="nav-item__icon fa-solid fa-address-card fa-fw"
              :class="{ active: activeDrawer === 'character' }"
              :title="t('sidebar.characterManagement')"
            ></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Drawers -->
    <div class="nav-item__content" :class="{ active: activeDrawer === 'ai-config' }">
      <AiConfigDrawer />
    </div>
    <div class="nav-item__content" :class="{ active: activeDrawer === 'api-status' }">
      <ApiConnectionsDrawer />
    </div>
    <div class="nav-item__content" :class="{ active: activeDrawer === 'formatting' }">
      <FormattingDrawer />
    </div>
    <div
      class="nav-item__content"
      :class="{ active: activeDrawer === 'world-info', wide: activeDrawer === 'world-info' }"
    >
      <WorldInfoDrawer />
    </div>
    <div class="nav-item__content" :class="{ active: activeDrawer === 'user-settings' }">
      <UserSettingsDrawer />
    </div>
    <div class="nav-item__content" :class="{ active: activeDrawer === 'backgrounds' }">
      <BackgroundsDrawer />
    </div>
    <div class="nav-item__content" :class="{ active: activeDrawer === 'extensions' }">
      <ExtensionsDrawer />
    </div>
    <div class="nav-item__content" :class="{ active: activeDrawer === 'persona' }">
      <PersonaManagementDrawer />
    </div>
    <div
      class="nav-item__content"
      :class="{ active: activeDrawer === 'character', wide: activeDrawer === 'character' }"
    >
      <CharacterPanel />
    </div>
  </div>
</template>
