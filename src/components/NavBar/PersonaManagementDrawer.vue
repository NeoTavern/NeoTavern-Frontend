<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { usePersonaStore } from '../../stores/persona.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { getThumbnailUrl } from '../../utils/image';
import Pagination from '../Common/Pagination.vue';
import { usePopupStore } from '../../stores/popup.store';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';

const { t } = useStrictI18n();
const personaStore = usePersonaStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();

const searchTerm = ref('');
const sortOrder = ref('asc');
const currentPage = ref(1);
const itemsPerPage = ref(10);
const isGridView = ref(false);
const avatarInput = ref<HTMLInputElement | null>(null);

const filteredPersonas = computed(() => {
  let personas = [...personaStore.personas];
  if (searchTerm.value) {
    const lowerSearch = searchTerm.value.toLowerCase();
    personas = personas.filter(
      (p) => p.name.toLowerCase().includes(lowerSearch) || p.description.toLowerCase().includes(lowerSearch),
    );
  }
  personas.sort((a, b) => {
    if (sortOrder.value === 'asc') return a.name.localeCompare(b.name);
    return b.name.localeCompare(a.name);
  });
  return personas;
});

const paginatedPersonas = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  const end = start + itemsPerPage.value;
  return filteredPersonas.value.slice(start, end);
});

function handleFileImport(event: Event) {
  // TODO
  console.log('Restore from backup clicked', event);
}

async function handleDelete() {
  if (personaStore.activePersonaId) {
    const { result } = await popupStore.show({
      title: t('personaManagement.delete.confirmTitle'),
      content: t('personaManagement.delete.confirmMessage', { name: personaStore.activePersona?.name ?? '' }),
      type: POPUP_TYPE.CONFIRM,
    });
    if (result === POPUP_RESULT.AFFIRMATIVE) {
      personaStore.deletePersona(personaStore.activePersonaId);
    }
  }
}

function triggerAvatarUpload() {
  avatarInput.value?.click();
}

async function handleAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    await personaStore.uploadPersonaAvatar(personaStore.activePersonaId, file);
  }
  // Reset input to allow selecting the same file again
  if (input) input.value = '';
}

onMounted(() => {
  if (personaStore.personas.length === 0) {
    personaStore.initialize();
  }
});
</script>

<template>
  <div class="persona-drawer">
    <div class="persona-drawer-header">
      <h3>
        <span>{{ t('personaManagement.title') }}</span>
        <a href="https://docs.sillytavern.app/usage/core-concepts/personas/" target="_blank">
          <span class="fa-solid fa-circle-question note-link-span"></span>
        </a>
      </h3>
      <div class="persona-drawer-header-actions">
        <div class="menu-button">
          <i class="fa-solid fa-ranking-star"></i>
          <span>{{ t('personaManagement.usageStats') }}</span>
        </div>
        <div class="menu-button">
          <i class="fa-solid fa-file-export"></i>
          <span>{{ t('personaManagement.backup') }}</span>
        </div>
        <label class="menu-button">
          <i class="fa-solid fa-file-import"></i>
          <span>{{ t('personaManagement.restore') }}</span>
          <input type="file" accept=".json" hidden @change="handleFileImport" />
        </label>
      </div>
    </div>
    <div class="persona-drawer-content">
      <!-- Left Column -->
      <div class="persona-drawer-column--left">
        <div class="persona-drawer-list-controls">
          <div class="menu-button" @click="personaStore.createPersona">
            <i class="fa-solid fa-person-circle-question fa-fw"></i>
            <span>{{ t('personaManagement.create') }}</span>
          </div>
          <input v-model="searchTerm" class="text-pole" type="search" :placeholder="t('common.search')" />
          <select v-model="sortOrder" class="text-pole">
            <option value="asc">A-Z</option>
            <option value="desc">Z-A</option>
          </select>
          <div class="menu-button fa-solid fa-table-cells-large" @click="isGridView = !isGridView"></div>
        </div>
        <Pagination
          v-if="filteredPersonas.length > 0"
          v-model:current-page="currentPage"
          v-model:items-per-page="itemsPerPage"
          :total-items="filteredPersonas.length"
          :items-per-page-options="[5, 10, 25, 50, 100]"
        />
        <div class="persona-list" :class="{ 'grid-view': isGridView }">
          <div
            v-for="persona in paginatedPersonas"
            :key="`${persona.avatarId}-${personaStore.lastAvatarUpdate}`"
            class="persona-item"
            :class="{ selected: persona.avatarId === personaStore.activePersonaId }"
            @click="personaStore.setActivePersona(persona.avatarId)"
          >
            <img :src="getThumbnailUrl('persona', persona.avatarId)" alt="Persona Avatar" class="persona-item-avatar" />
            <div class="persona-item-details">
              <div class="persona-item-name">{{ persona.name }}</div>
              <div class="persona-item-description">
                {{ persona.description || t('personaManagement.noDescription') }}
              </div>
              <!-- TODO: Add lock icons -->
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column -->
      <div class="persona-drawer-column--right">
        <div v-show="personaStore.activePersona" class="persona-editor">
          <h4 class="standoutHeader">{{ t('personaManagement.currentPersona') }}</h4>
          <div class="persona-editor-controls">
            <h5 class="persona-editor-name">{{ personaStore.activePersona?.name ?? '' }}</h5>
            <div class="buttons_block">
              <div
                class="menu-button fa-solid fa-pencil"
                :title="t('personaManagement.actions.rename')"
                @click="personaStore.updateActivePersonaName"
              ></div>
              <div class="menu-button fa-solid fa-sync" :title="t('personaManagement.actions.syncName')"></div>
              <div class="menu-button fa-solid fa-globe" :title="t('personaManagement.actions.lore')"></div>
              <div
                class="menu-button fa-solid fa-image"
                :title="t('personaManagement.actions.changeImage')"
                @click="triggerAvatarUpload"
              ></div>
              <input ref="avatarInput" type="file" accept="image/*" hidden @change="handleAvatarChange" />
              <div class="menu-button fa-solid fa-clone" :title="t('personaManagement.actions.duplicate')"></div>
              <div
                class="menu-button fa-solid fa-skull red_button"
                :title="t('personaManagement.actions.delete')"
                @click="handleDelete"
              ></div>
            </div>
          </div>

          <label>{{ t('personaManagement.description.label') }}</label>
          <textarea
            class="text-pole"
            rows="6"
            :placeholder="t('personaManagement.description.placeholder')"
            :value="personaStore.activePersona?.description ?? ''"
            @input="personaStore.updateActivePersonaField('description', ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
          <!-- TODO: Add token counter -->

          <h4 class="standoutHeader">{{ t('personaManagement.connections.title') }}</h4>
          <div class="persona-editor-connections">
            <div class="menu-button">
              <i class="icon fa-solid fa-crown fa-fw"></i>
              <span>{{ t('personaManagement.connections.default') }}</span>
            </div>
            <div class="menu-button">
              <i class="icon fa-solid fa-unlock fa-fw"></i>
              <span>{{ t('personaManagement.connections.character') }}</span>
            </div>
            <div class="menu-button">
              <i class="icon fa-solid fa-unlock fa-fw"></i>
              <span>{{ t('personaManagement.connections.chat') }}</span>
            </div>
          </div>
          <!-- TODO: Connections List -->

          <h4 class="standoutHeader">{{ t('personaManagement.globalSettings.title') }}</h4>
          <div class="persona-editor-global-settings">
            <label class="checkbox-label">
              <input v-model="settingsStore.settings.persona.showNotifications" type="checkbox" />
              <span>{{ t('personaManagement.globalSettings.showNotifications') }}</span>
            </label>
            <label class="checkbox-label">
              <input v-model="settingsStore.settings.persona.allowMultiConnections" type="checkbox" />
              <span>{{ t('personaManagement.globalSettings.allowMultiConnections') }}</span>
            </label>
            <label class="checkbox-label">
              <input v-model="settingsStore.settings.persona.autoLock" type="checkbox" />
              <span>{{ t('personaManagement.globalSettings.autoLock') }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
