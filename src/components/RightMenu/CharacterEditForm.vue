<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useCharacterStore } from '../../stores/character.store';
import { useUiStore } from '../../stores/ui.store';
import { useSettingsStore } from '../../stores/settings.store';
import { default_avatar } from '../../constants';
import type { Character } from '../../types';
import Popup from '../Popup/Popup.vue';
import { POPUP_TYPE, type PopupOptions } from '../../types';

const characterStore = useCharacterStore();
const uiStore = useUiStore();
const settingsStore = useSettingsStore();
const activeCharacter = computed(() => characterStore.activeCharacter);

const formData = ref<Partial<Character> & { data?: any }>({});

// --- State for new features ---
const areDetailsHidden = ref(settingsStore.powerUser.spoiler_free_mode);
const isCreatorNotesOpen = ref(true);

// Popup state for maximizing editors
type EditableField = 'description' | 'first_mes' | 'data.creator_notes';
const isEditorPopupVisible = ref(false);
const editorPopupValue = ref('');
const editingFieldName = ref<EditableField | null>(null);
const editorPopupOptions = ref<PopupOptions>({});
const editorPopupTitle = ref('');

watch(
  activeCharacter,
  (newChar) => {
    if (newChar) {
      const charCopy = JSON.parse(JSON.stringify(newChar));
      if (!charCopy.data) {
        charCopy.data = {};
      }
      if (!charCopy.data.creator_notes) {
        charCopy.data.creator_notes = charCopy.creatorcomment || '';
      }
      formData.value = charCopy;
      areDetailsHidden.value = settingsStore.powerUser.spoiler_free_mode;
    } else {
      formData.value = { data: {} };
    }
  },
  { immediate: true },
);

function getAvatarUrl(avatar: string | undefined) {
  return avatar && avatar !== 'none' ? `/thumbnail?type=avatar&file=${encodeURIComponent(avatar)}` : default_avatar;
}

function goBack() {
  uiStore.menuType = 'characters';
}

function toggleFavorite() {
  formData.value.fav = !formData.value.fav;
}

function peekSpoilerMode() {
  areDetailsHidden.value = !areDetailsHidden.value;
}

function openMaximizeEditor(fieldName: EditableField, title: string) {
  editingFieldName.value = fieldName;
  editorPopupTitle.value = `Editing: ${title}`;
  // A simple way to handle nested properties for v-model
  if (fieldName === 'data.creator_notes') {
    editorPopupValue.value = formData.value.data?.creator_notes ?? '';
  } else {
    editorPopupValue.value = formData.value[fieldName] ?? '';
  }
  editorPopupOptions.value = { wide: true, large: true, okButton: 'OK', cancelButton: false };
  isEditorPopupVisible.value = true;
}

function handleEditorSubmit({ value }: { value: string }) {
  if (editingFieldName.value) {
    if (editingFieldName.value === 'data.creator_notes') {
      if (formData.value.data) {
        formData.value.data.creator_notes = value;
      }
    } else {
      formData.value[editingFieldName.value] = value;
    }
  }
}
</script>

<template>
  <div v-if="activeCharacter && formData.data" class="character-edit-form">
    <form action="javascript:void(null);" method="post" enctype="multipart/form-data">
      <div class="character-edit-form__avatar-name-block">
        <div class="character-edit-form__avatar-area">
          <label
            for="add_avatar_button"
            class="character-edit-form__avatar-label"
            title="Click to select a new avatar for this character"
          >
            <img
              :src="getAvatarUrl(formData.avatar)"
              :alt="`${formData.name} Avatar`"
              class="character-edit-form__avatar-img"
            />
            <input hidden type="file" id="add_avatar_button" name="avatar" accept="image/*" />
          </label>
        </div>
        <div class="character-edit-form__controls">
          <div class="character-edit-form__buttons">
            <div @click="goBack" class="menu-button fa-solid fa-left-long" title="Back to Character List"></div>
            <div
              @click="toggleFavorite"
              class="menu-button fa-solid fa-star"
              :class="{ fav_on: formData.fav }"
              title="Add to Favorites"
            ></div>
            <div class="menu-button fa-solid fa-book" title="Advanced Definitions"></div>
            <div class="menu-button fa-solid fa-globe" title="Character Lore"></div>
            <div class="menu-button fa-solid fa-passport" title="Chat Lore"></div>
            <div class="menu-button fa-solid fa-face-smile" title="Connected Personas"></div>
            <div class="menu-button fa-solid fa-file-export" title="Export and Download"></div>
            <div class="menu-button fa-solid fa-clone" title="Duplicate Character"></div>
            <div class="menu-button fa-solid fa-skull red_button" title="Delete Character"></div>
          </div>
          <label class="u-w-full">
            <select class="text-pole u-w-full">
              <option value="default" disabled selected>More...</option>
              <option>Link to World Info</option>
              <option>Import Card Lore</option>
              <option>Character Settings Overrides</option>
              <option>Convert to Persona</option>
              <option>Rename</option>
              <option>Link to Source</option>
              <option>Replace / Update</option>
              <option>Import Tags</option>
              <option>Set / Unset as Welcome Page Assistant</option>
            </select>
          </label>
        </div>
      </div>

      <div class="character-edit-form__tags-block">
        <div class="tag-controls">
          <input class="text-pole u-w-full" placeholder="Search / Create tags" />
          <div class="menu-button fa-solid fa-tags" title="View all tags"></div>
        </div>
        <div class="tags">
          <span v-for="tag in formData.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>

      <!-- Creator's Notes Inline Drawer -->
      <div class="inline-drawer">
        <div class="inline-drawer-header" @click="isCreatorNotesOpen = !isCreatorNotesOpen">
          <span class="inline-drawer-header__title">Creator's Notes</span>
          <div
            class="menu-button fa-solid fa-palette fa-fw"
            title="Allow / Forbid global styles"
            @click.stop="() => {}"
          ></div>
          <div
            class="menu-button fa-solid fa-eye fa-fw"
            title="Show / Hide Description and First Message"
            @click.stop="peekSpoilerMode"
          ></div>
          <i
            class="fa-solid fa-circle-chevron-down inline-drawer-header__icon"
            :class="{ 'is-open': isCreatorNotesOpen }"
          ></i>
        </div>
        <Transition name="slide-fade">
          <div v-show="isCreatorNotesOpen" style="overflow: hidden">
            <div class="inline-drawer-content">
              <div v-if="formData.data.creator_notes" v-html="formData.data.creator_notes"></div>
              <div v-else>No Creator's Notes provided.</div>
            </div>
          </div>
        </Transition>
      </div>

      <small v-show="areDetailsHidden">Character details are hidden.</small>

      <div v-show="!areDetailsHidden" class="form-section">
        <label for="description_textarea">
          <span>Description</span>
          <i
            class="editor-maximize-icon fa-solid fa-maximize"
            title="Expand the editor"
            @click="openMaximizeEditor('description', 'Description')"
          ></i>
        </label>
        <textarea
          id="description_textarea"
          class="text-pole"
          v-model="formData.description"
          placeholder="Describe your character's physical and mental traits here."
        ></textarea>
      </div>

      <div v-show="!areDetailsHidden" class="form-section">
        <label for="firstmessage_textarea">
          <span>First message</span>
          <i
            class="editor-maximize-icon fa-solid fa-maximize"
            title="Expand the editor"
            @click="openMaximizeEditor('first_mes', 'First Message')"
          ></i>
        </label>
        <textarea
          id="firstmessage_textarea"
          class="text-pole"
          v-model="formData.first_mes"
          placeholder="This will be the first message from the character that starts every chat."
        ></textarea>
      </div>
    </form>

    <Popup
      :visible="isEditorPopupVisible"
      :title="editorPopupTitle"
      :type="POPUP_TYPE.INPUT"
      v-model:inputValue="editorPopupValue"
      :options="editorPopupOptions"
      @submit="handleEditorSubmit"
      @close="isEditorPopupVisible = false"
    />
  </div>
</template>
