<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { useCharacterStore } from '../../stores/character.store';
import { useUiStore } from '../../stores/ui.store';
import { useSettingsStore } from '../../stores/settings.store';
import type { Character } from '../../types';
import Popup from '../Popup/Popup.vue';
import { POPUP_TYPE, type PopupOptions } from '../../types';
import AdvancedDefinitions from './AdvancedDefinitions.vue';
import { getThumbnailUrl } from '../../utils/image';
import { useI18n } from 'vue-i18n';
import { slideTransitionHooks } from '../../utils/dom';

const { t } = useI18n();
const characterStore = useCharacterStore();
const uiStore = useUiStore();
const settingsStore = useSettingsStore();
const activeCharacter = computed(() => characterStore.activeCharacter);

const formData = ref<Partial<Character> & { data?: any }>({});
const isUpdatingFromStore = ref(false);

// --- State for new features ---
const isPeeking = ref(false);
const isSpoilerModeActive = computed(() => settingsStore.powerUser.spoiler_free_mode);
const areDetailsHidden = computed(() => isSpoilerModeActive.value && !isPeeking.value);

const isCreatorNotesOpen = ref(false);
const isAdvancedDefinitionsVisible = ref(false);

// Popup state for maximizing editors
type EditableField = 'description' | 'first_mes' | 'data.creator_notes';
const isEditorPopupVisible = ref(false);
const editorPopupValue = ref('');
const editingFieldName = ref<EditableField | null>(null);
const editorPopupOptions = ref<PopupOptions>({});
const editorPopupTitle = ref('');

// --- Transition Hooks ---
const { beforeEnter, enter, afterEnter, beforeLeave, leave, afterLeave } = slideTransitionHooks;

watch(
  activeCharacter,
  (newChar) => {
    if (newChar) {
      if (JSON.stringify(newChar) !== JSON.stringify(formData.value)) {
        isUpdatingFromStore.value = true;

        const charCopy = JSON.parse(JSON.stringify(newChar));
        if (!charCopy.data) {
          charCopy.data = {};
        }
        if (!charCopy.data.creator_notes) {
          charCopy.data.creator_notes = charCopy.creatorcomment || '';
        }
        formData.value = charCopy;
        characterStore.calculateAllTokens(charCopy);
        isPeeking.value = false;

        nextTick(() => {
          isUpdatingFromStore.value = false;
        });
      }
    } else {
      formData.value = { data: {} };
    }
  },
  { immediate: true, deep: true },
);

watch(
  formData,
  (newData, oldData) => {
    if (isUpdatingFromStore.value) {
      return;
    }

    if (oldData && newData.data) {
      // Dynamically sync any changed root field with its counterpart in `data` if it exists.
      for (const key in newData) {
        if (key !== 'data' && Object.prototype.hasOwnProperty.call(newData, key)) {
          // If the corresponding key exists in the 'data' object, sync it.
          if (typeof newData.data[key] !== 'undefined') {
            newData.data[key] = newData[key as keyof typeof newData];
          }
          if (newData.data.extensions && typeof newData.data.extensions[key] !== 'undefined') {
            newData.data.extensions[key] = newData[key as keyof typeof newData];
          }
        }
      }
    }

    // Don't save on initial load when populating from activeCharacter
    if (oldData && Object.keys(oldData).length > 1 && newData.avatar === oldData.avatar) {
      characterStore.saveCharacterDebounced(newData);
      characterStore.calculateAllTokens(newData);
    }
  },
  { deep: true },
);

function goBack() {
  uiStore.menuType = 'characters';
}

function toggleFavorite() {
  formData.value.fav = !formData.value.fav;
}

function peekSpoilerMode() {
  isPeeking.value = !isPeeking.value;
}

function openMaximizeEditor(fieldName: EditableField, title: string) {
  editingFieldName.value = fieldName;
  editorPopupTitle.value = t('advancedDefinitions.editingTitle', { title });
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
            :title="$t('characterEditor.avatar')"
          >
            <img
              :src="getThumbnailUrl('avatar', formData.avatar)"
              :alt="`${formData.name} Avatar`"
              class="character-edit-form__avatar-img"
            />
            <input hidden type="file" id="add_avatar_button" name="avatar" accept="image/*" />
          </label>
        </div>
        <div class="character-edit-form__controls">
          <div class="character-edit-form__buttons">
            <div @click="goBack" class="menu-button fa-solid fa-left-long" :title="$t('characterEditor.back')"></div>
            <div
              @click="toggleFavorite"
              class="menu-button fa-solid fa-star"
              :class="{ fav_on: formData.fav }"
              :title="$t('characterEditor.favorite')"
            ></div>
            <div
              @click="isAdvancedDefinitionsVisible = true"
              class="menu-button fa-solid fa-book"
              :title="$t('characterEditor.advancedDefinitions')"
            ></div>
            <div class="menu-button fa-solid fa-globe" :title="$t('characterEditor.lore')"></div>
            <div class="menu-button fa-solid fa-passport" :title="$t('characterEditor.chatLore')"></div>
            <div class="menu-button fa-solid fa-face-smile" :title="$t('characterEditor.personas')"></div>
            <div class="menu-button fa-solid fa-file-export" :title="$t('characterEditor.export')"></div>
            <div class="menu-button fa-solid fa-clone" :title="$t('characterEditor.duplicate')"></div>
            <div class="menu-button fa-solid fa-skull red_button" :title="$t('characterEditor.delete')"></div>
          </div>
          <label class="u-w-full">
            <select class="text-pole u-w-full">
              <option value="default" disabled selected>{{ $t('characterEditor.more') }}</option>
              <option>{{ $t('characterEditor.moreOptions.linkWorldInfo') }}</option>
              <option>{{ $t('characterEditor.moreOptions.importCardLore') }}</option>
              <option>{{ $t('characterEditor.moreOptions.characterSettingsOverrides') }}</option>
              <option>{{ $t('characterEditor.moreOptions.convertToPersona') }}</option>
              <option>{{ $t('characterEditor.moreOptions.rename') }}</option>
              <option>{{ $t('characterEditor.moreOptions.linkToSource') }}</option>
              <option>{{ $t('characterEditor.moreOptions.replaceUpdate') }}</option>
              <option>{{ $t('characterEditor.moreOptions.importTags') }}</option>
              <option>{{ $t('characterEditor.moreOptions.setAsWelcomeAssistant') }}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="character-edit-form__tags-block">
        <div class="tag-controls">
          <input class="text-pole u-w-full" :placeholder="$t('characterEditor.searchTags')" />
          <div class="menu-button fa-solid fa-tags" :title="$t('characterEditor.viewAllTags')"></div>
        </div>
        <div class="tags">
          <span v-for="tag in formData.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>

      <!-- Creator's Notes Inline Drawer -->
      <div class="inline-drawer">
        <div class="inline-drawer-header" @click="isCreatorNotesOpen = !isCreatorNotesOpen">
          <span class="inline-drawer-header__title">{{ $t('characterEditor.creatorNotes') }}</span>
          <div
            class="menu-button fa-solid fa-palette fa-fw"
            :title="$t('characterEditor.toggleStyles')"
            @click.stop="() => {}"
          ></div>
          <div
            class="menu-button fa-solid fa-eye fa-fw"
            :title="$t('characterEditor.toggleSpoiler')"
            @click.stop="peekSpoilerMode"
          ></div>
          <i
            class="fa-solid fa-circle-chevron-down inline-drawer-header__icon"
            :class="{ 'is-open': isCreatorNotesOpen }"
          ></i>
        </div>
        <Transition
          name="slide-js"
          @before-enter="beforeEnter"
          @enter="enter"
          @after-enter="afterEnter"
          @before-leave="beforeLeave"
          @leave="leave"
          @after-leave="afterLeave"
        >
          <div v-show="isCreatorNotesOpen">
            <div class="inline-drawer-content">
              <div v-if="formData.data.creator_notes" v-html="formData.data.creator_notes"></div>
              <div v-else>{{ $t('characterEditor.noCreatorNotes') }}</div>
            </div>
          </div>
        </Transition>
      </div>

      <small v-show="areDetailsHidden">{{ $t('characterEditor.detailsHidden') }}</small>

      <div v-show="!areDetailsHidden" class="form-section">
        <label for="description_textarea">
          <span>{{ $t('characterEditor.description') }}</span>
          <i
            class="editor-maximize-icon fa-solid fa-maximize"
            :title="$t('characterEditor.expandEditor')"
            @click="openMaximizeEditor('description', $t('characterEditor.description'))"
          ></i>
        </label>
        <textarea
          id="description_textarea"
          class="text-pole"
          v-model="formData.description"
          :placeholder="$t('characterEditor.descriptionPlaceholder')"
        ></textarea>
      </div>

      <div v-show="!areDetailsHidden" class="form-section">
        <label for="firstmessage_textarea">
          <span>{{ $t('characterEditor.firstMessage') }}</span>
          <i
            class="editor-maximize-icon fa-solid fa-maximize"
            :title="$t('characterEditor.expandEditor')"
            @click="openMaximizeEditor('first_mes', $t('characterEditor.firstMessage'))"
          ></i>
        </label>
        <textarea
          id="firstmessage_textarea"
          class="text-pole"
          v-model="formData.first_mes"
          :placeholder="$t('characterEditor.firstMessagePlaceholder')"
        ></textarea>
      </div>
    </form>

    <Popup
      id="character-edit-form-editor-popup"
      :visible="isEditorPopupVisible"
      :title="editorPopupTitle"
      :type="POPUP_TYPE.INPUT"
      :inputValue="editorPopupValue"
      :options="editorPopupOptions"
      @submit="handleEditorSubmit"
      @close="isEditorPopupVisible = false"
    />

    <AdvancedDefinitions
      v-if="isAdvancedDefinitionsVisible"
      v-model="formData"
      @close="isAdvancedDefinitionsVisible = false"
    />
  </div>
</template>
