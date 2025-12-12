<script setup lang="ts">
import { debounce } from 'lodash-es';
import { computed, ref, watch } from 'vue';
import { ApiTokenizer } from '../../api/tokenizer';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { DebounceTimeout } from '../../constants';
import { useCharacterStore } from '../../stores/character.store';
import { useChatStore } from '../../stores/chat.store';
import { useLayoutStore } from '../../stores/layout.store';
import { usePersonaUiStore } from '../../stores/persona-ui.store';
import { usePersonaStore } from '../../stores/persona.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { POPUP_RESULT, POPUP_TYPE, type Character, type CropData } from '../../types';
import { getThumbnailUrl } from '../../utils/character';
import { downloadFile, getBase64Async, uuidv4 } from '../../utils/commons';
import { EmptyState, Pagination, PanelLayout, SidebarHeader } from '../common';
import { Button, Checkbox, FileInput, FormItem, ListItem, Search, Select, Textarea } from '../UI';

const { t } = useStrictI18n();
const props = defineProps<{
  mode?: 'full' | 'main-only' | 'side-only';
  title?: string;
}>();
const personaStore = usePersonaStore();
const personaUiStore = usePersonaUiStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const chatStore = useChatStore();
const characterStore = useCharacterStore();
const worldInfoStore = useWorldInfoStore();
const layoutStore = useLayoutStore();

// --- Local UI State ---
const currentPage = ref(1);
const itemsPerPage = ref(10);
const descriptionTokenCount = ref(0);

const sortOptions = [
  { label: 'A-Z', value: 'asc' },
  { label: 'Z-A', value: 'desc' },
];

const paginatedPersonas = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  const end = start + itemsPerPage.value;
  return personaUiStore.filteredPersonas.slice(start, end);
});

const connectedCharacters = computed(() => {
  if (!personaStore.activePersona?.connections) return [];
  return personaStore.activePersona.connections
    .map((conn) => characterStore.characters.find((c) => c.avatar === conn.id))
    .filter(Boolean) as Character[];
});

const isChatLocked = computed(() => {
  if (!chatStore.activeChat || !personaStore.activePersonaId) return false;
  return chatStore.activeChat.metadata.active_persona === personaStore.activePersonaId;
});

const isCharacterLocked = computed(() => {
  if (characterStore.activeCharacters.length !== 1 || !personaStore.activePersonaId) return false;
  return personaStore.isLinkedToCharacter(personaStore.activePersonaId, characterStore.activeCharacters[0].avatar);
});

const isDefaultPersona = computed(() => {
  if (!personaStore.activePersonaId) return false;
  return personaStore.isDefault(personaStore.activePersonaId);
});

const personaHeaderTitle = computed(() => {
  if (personaUiStore.viewMode === 'settings') {
    return t('personaManagement.globalSettings.title');
  }
  if (personaStore.activePersona) {
    return t('personaManagement.currentPersona');
  }
  return t('navbar.personaManagement');
});

const lorebookOptions = computed(() => {
  return worldInfoStore.bookInfos.map((info) => ({ label: info.name, value: info.file_id }));
});

const calculateDescriptionTokens = debounce(async (text: string) => {
  descriptionTokenCount.value = await ApiTokenizer.default.getTokenCount(text);
}, DebounceTimeout.RELAXED);

watch(
  () => personaStore.activePersona?.description,
  (newVal) => {
    calculateDescriptionTokens(newVal || '');
  },
  { immediate: true },
);

function selectPersona(id: string) {
  personaUiStore.viewMode = 'editor';
  personaStore.setActivePersona(id);
  layoutStore.autoCloseSidebarsOnMobile();
}

function selectGlobalSettings() {
  personaUiStore.viewMode = 'settings';
}

function handleExport() {
  // Export all personas as JSON
  const personasData = personaStore.personas;
  const dataStr = JSON.stringify(personasData, null, 2);
  const fileName = `personas_export_${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(dataStr, fileName, 'application/json');
}

async function handleFileImport(files: File[]) {
  if (!files || files.length === 0) return;

  const file = files[0];
  try {
    const content = await file.text();
    const importedPersonas = JSON.parse(content);

    // Validate the imported data
    if (!Array.isArray(importedPersonas)) {
      toast.error(t('personaManagement.errors.invalidFileFormat'));
      return;
    }

    // Import the personas
    for (const persona of importedPersonas) {
      // Check if persona with same avatarId already exists
      if (personaStore.personas.some((p) => p.avatarId === persona.avatarId)) {
        // Generate a new avatarId to avoid conflicts
        persona.avatarId = `${uuidv4()}.png`;
      }

      // Add the persona to the store
      personaStore.personas.push(persona);
    }
  } catch (error) {
    console.error('Failed to import personas:', error);
    toast.error(t('personaManagement.errors.importFailed'));
  }
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

async function handleRename() {
  if (!personaStore.activePersona || !personaStore.activePersonaId) return;

  const { result, value: newName } = await popupStore.show<string>({
    title: t('personaManagement.rename.title'),
    content: t('personaManagement.rename.prompt'),
    type: POPUP_TYPE.INPUT,
    inputValue: personaStore.activePersona.name,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && newName) {
    await personaStore.renamePersona(personaStore.activePersonaId, newName);
  }
}

async function handleAvatarChange(files: File[]) {
  if (!files[0] || !personaStore.activePersonaId) return;
  const file = files[0];

  let cropData: CropData | undefined = undefined;
  if (!settingsStore.settings.ui.avatars.neverResize) {
    const dataUrl = await getBase64Async(file);
    const { result, value } = await popupStore.show({
      title: t('popup.cropAvatar.title'),
      type: POPUP_TYPE.CROP,
      cropImage: dataUrl,
      wide: true,
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return;
    cropData = value as CropData;
  }

  await personaStore.uploadPersonaAvatar(personaStore.activePersonaId, file, cropData);
}

function toggleDefault() {
  if (personaStore.activePersonaId) {
    personaStore.toggleDefault(personaStore.activePersonaId);
  }
}

function toggleCharacterLock() {
  if (characterStore.activeCharacters.length === 1 && personaStore.activePersonaId) {
    personaStore.toggleCharacterConnection(personaStore.activePersonaId, characterStore.activeCharacters[0].avatar);
  }
}

function toggleChatLock() {
  if (chatStore.activeChat && personaStore.activePersonaId) {
    chatStore.toggleChatPersona(personaStore.activePersonaId);
  }
}

function removeConnection(charAvatar: string) {
  if (personaStore.activePersonaId) {
    personaStore.toggleCharacterConnection(personaStore.activePersonaId, charAvatar);
  }
}

async function handleDuplicate() {
  if (personaStore.activePersonaId) {
    await personaStore.duplicatePersona(personaStore.activePersonaId);
  }
}

function handleSyncName() {
  if (personaStore.activePersona && chatStore.activeChat) {
    chatStore.syncPersonaName(personaStore.activePersona.avatarId, personaStore.activePersona.name);
  }
}

function handleClose() {
  layoutStore.activateNavBarItem('chat');
  layoutStore.autoCloseSidebarsOnMobile();
}
</script>

<template>
  <div class="persona-drawer">
    <SidebarHeader
      v-if="props.mode !== 'main-only'"
      class="persona-drawer-header"
      :title="props.title ?? t('personaManagement.title')"
    >
      <template #actions>
        <a href="https://docs.sillytavern.app/usage/core-concepts/personas/" target="_blank" class="note-link-span">
          <span class="fa-solid fa-circle-question"></span>
        </a>
      </template>
    </SidebarHeader>

    <PanelLayout
      v-model:collapsed="personaUiStore.isBrowserExpanded"
      :mode="props.mode"
      :title="personaHeaderTitle"
      storage-key="personaBrowserWidth"
      :initial-width="350"
      class="persona-drawer-split"
    >
      <template #main-header-actions>
        <div class="sidebar-mobile-header">
          <Button icon="fa-xmark" variant="ghost" @click="handleClose" />
        </div>
      </template>
      <template #side>
        <div class="persona-drawer-sidebar">
          <div class="sidebar-controls persona-drawer-controls">
            <div class="sidebar-controls-row persona-drawer-actions-row">
              <Button icon="fa-file-export" @click="handleExport">{{ t('personaManagement.export') }}</Button>
              <FileInput
                accept=".json"
                icon="fa-file-import"
                type="button"
                :label="t('personaManagement.import')"
                @change="handleFileImport"
              />
            </div>
            <div class="sidebar-controls-row persona-drawer-search-row">
              <Search v-model="personaUiStore.searchTerm" :placeholder="t('common.search')">
                <template #actions>
                  <Button icon="fa-person-circle-question" @click="personaStore.createPersona">
                    {{ t('personaManagement.create') }}
                  </Button>
                  <Select v-model="personaUiStore.sortOrder" :options="sortOptions" />
                  <Button
                    variant="ghost"
                    icon="fa-table-cells-large"
                    @click="personaUiStore.isGridView = !personaUiStore.isGridView"
                  />
                </template>
              </Search>
            </div>
          </div>

          <ListItem :active="personaUiStore.viewMode === 'settings'" @click="selectGlobalSettings">
            <template #start><i class="fa-solid fa-cogs" style="opacity: 0.7"></i></template>
            <template #default>{{ t('personaManagement.globalSettings.title') }}</template>
          </ListItem>

          <hr class="panel-divider" />

          <Pagination
            v-if="personaUiStore.filteredPersonas.length > 0"
            v-model:current-page="currentPage"
            v-model:items-per-page="itemsPerPage"
            :total-items="personaUiStore.filteredPersonas.length"
            :items-per-page-options="[5, 10, 25, 50, 100]"
          />

          <div class="persona-list" :class="{ 'grid-view': personaUiStore.isGridView }">
            <div v-for="persona in paginatedPersonas" :key="`${persona.avatarId}-${personaStore.lastAvatarUpdate}`">
              <ListItem
                :active="personaUiStore.viewMode === 'editor' && persona.avatarId === personaStore.activePersonaId"
                @click="selectPersona(persona.avatarId)"
              >
                <template #start>
                  <img
                    :src="getThumbnailUrl('persona', persona.avatarId)"
                    alt="Persona Avatar"
                    class="persona-item-avatar"
                  />
                </template>
                <template #default>
                  <div class="font-bold persona-name-row">
                    <span class="persona-name">{{ persona.name }}</span>
                    <i
                      v-if="personaStore.isDefault(persona.avatarId)"
                      class="fa-solid fa-star default-icon"
                      :title="t('personaManagement.default.tooltip')"
                    ></i>
                  </div>
                  <div class="persona-desc">
                    {{ persona.description || t('personaManagement.noDescription') }}
                  </div>
                </template>
              </ListItem>
            </div>
          </div>
        </div>
      </template>

      <template #main>
        <div class="persona-drawer-main">
          <!-- Global Settings View -->
          <div v-if="personaUiStore.viewMode === 'settings'" class="persona-editor">
            <h4 class="persona-section-title">{{ t('personaManagement.globalSettings.title') }}</h4>
            <div class="persona-editor-global-settings">
              <Checkbox
                v-model="settingsStore.settings.persona.showNotifications"
                :label="t('personaManagement.globalSettings.showNotifications')"
              />
            </div>
          </div>

          <!-- Persona Editor View -->
          <div v-else-if="personaStore.activePersona" class="persona-editor">
            <h4 class="persona-section-title">{{ t('personaManagement.currentPersona') }}</h4>
            <div class="persona-editor-controls">
              <h5 class="persona-editor-name">{{ personaStore.activePersona?.name ?? '' }}</h5>
              <div class="buttons_block">
                <Button
                  variant="ghost"
                  icon="fa-pencil"
                  :title="t('personaManagement.actions.rename')"
                  @click="handleRename"
                />
                <Button
                  variant="ghost"
                  icon="fa-sync"
                  :title="t('personaManagement.actions.syncName')"
                  :disabled="!chatStore.activeChat"
                  @click="handleSyncName"
                />

                <FileInput
                  accept="image/*"
                  icon="fa-image"
                  :label="t('personaManagement.actions.changeImage')"
                  @change="handleAvatarChange"
                />

                <Button
                  variant="ghost"
                  icon="fa-clone"
                  :title="t('personaManagement.actions.duplicate')"
                  @click="handleDuplicate"
                />
                <Button
                  variant="danger"
                  icon="fa-skull"
                  :title="t('personaManagement.actions.delete')"
                  @click="handleDelete"
                />
              </div>
            </div>

            <FormItem :label="t('personaManagement.description.label')">
              <Textarea
                identifier="persona.description"
                allow-maximize
                :model-value="personaStore.activePersona?.description ?? ''"
                :rows="6"
                :placeholder="t('personaManagement.description.placeholder')"
                @update:model-value="personaStore.updateActivePersonaField('description', $event)"
              />
              <div class="token-counter" style="text-align: right; font-size: 0.8em; opacity: 0.7; margin-top: 2px">
                {{ t('common.tokens') }}: {{ descriptionTokenCount }}
              </div>
            </FormItem>

            <FormItem :label="t('personaManagement.lorebooks.label')">
              <!-- @vue-ignore -->
              <Select
                :model-value="personaStore.activePersona?.lorebooks ?? []"
                :options="lorebookOptions"
                multiple
                searchable
                @update:model-value="personaStore.updateActivePersonaField('lorebooks', $event)"
              />
            </FormItem>

            <h4 class="persona-section-title">{{ t('personaManagement.connections.title') }}</h4>
            <div class="persona-editor-connections">
              <Button icon="fa-star" :active="isDefaultPersona" @click="toggleDefault">
                {{ t('personaManagement.connections.default') }}
              </Button>
              <Button
                icon="fa-user-lock"
                :active="isCharacterLocked"
                :disabled="characterStore.activeCharacters.length !== 1"
                @click="toggleCharacterLock"
              >
                {{ t('personaManagement.connections.character') }}
              </Button>
              <Button icon="fa-lock" :active="isChatLocked" :disabled="!chatStore.activeChat" @click="toggleChatLock">
                {{ t('personaManagement.connections.chat') }}
              </Button>
            </div>

            <div v-if="connectedCharacters.length > 0" class="connected-characters-list">
              <h5>{{ t('personaManagement.connections.linkedCharacters') }}</h5>
              <div class="chips-container">
                <div v-for="char in connectedCharacters" :key="char.avatar" class="character-chip">
                  <img :src="getThumbnailUrl('avatar', char.avatar)" class="chip-avatar" />
                  <span class="chip-name">{{ char?.name ?? '' }}</span>
                  <i class="fa-solid fa-xmark chip-remove" @click="removeConnection(char.avatar)"></i>
                </div>
              </div>
            </div>
          </div>

          <EmptyState v-else title="No Persona Selected" icon="fa-user-slash" />
        </div>
      </template>
    </PanelLayout>
  </div>
</template>
