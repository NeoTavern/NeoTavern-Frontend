<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue';
import { cloneDeep, set } from 'lodash-es';
import { computed, markRaw, onMounted, onUnmounted, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { default_avatar, DEFAULT_CHARACTER } from '../../constants';
import { characterService } from '../../services/character.service';
import { convertWorldInfoBookToCharacterBook } from '../../services/world-info';
import { useCharacterUiStore } from '../../stores/character-ui.store';
import { useCharacterStore } from '../../stores/character.store';
import { useChatStore } from '../../stores/chat.store';
import { useLayoutStore } from '../../stores/layout.store';
import { usePersonaStore } from '../../stores/persona.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useUiStore } from '../../stores/ui.store';
import { useWorldInfoStore } from '../../stores/world-info.store';
import type { Character, CropData } from '../../types';
import { POPUP_RESULT, POPUP_TYPE, type PopupOptions } from '../../types';
import { getThumbnailUrl } from '../../utils/character';
import { formatText } from '../../utils/chat';
import { getBase64Async, humanizedDateTime } from '../../utils/commons';
import Popup from '../Popup/Popup.vue';
import { Button, CollapsibleSection, FormItem, Input, RangeControl, Select, TagInput, Textarea } from '../UI';
import AlternateGreetingsModal from './AlternateGreetingsModal.vue';

const { t } = useStrictI18n();
const characterStore = useCharacterStore();
const characterUiStore = useCharacterUiStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const chatStore = useChatStore();
const personaStore = usePersonaStore();
const worldInfoStore = useWorldInfoStore();
const uiStore = useUiStore();
const layoutStore = useLayoutStore();

const tokenCounts = computed(() => characterStore.tokenCounts.fields);
const isCreating = computed(() => characterUiStore.isCreating);

const isPeeking = ref<boolean | null>(null);
const isSpoilerModeActive = computed(() => settingsStore.settings.character.spoilerFreeMode);
const areDetailsHidden = computed(() =>
  isCreating.value
    ? false
    : !isCreating.value && isPeeking.value === null
      ? isSpoilerModeActive.value
      : !isPeeking.value,
);

const isExportMenuVisible = ref(false);
const exportButtonRef = ref<HTMLElement | null>(null);
const exportMenuRef = ref<HTMLElement | null>(null);

const { floatingStyles: exportMenuStyles } = useFloating(exportButtonRef, exportMenuRef, {
  placement: 'bottom-start',
  open: isExportMenuVisible,
  whileElementsMounted: autoUpdate,
  middleware: [offset(8), flip(), shift({ padding: 10 })],
});

const isCreatorNotesOpen = ref(false);
const isPromptOverridesOpen = ref(false);
const isMetadataOpen = ref(false);

const formattedCreatorNotes = computed(() => {
  return formatText(
    localCharacter.value?.data?.creator_notes || '',
    settingsStore.settings.ui.chat.forbidExternalMedia,
  );
});

type EditableField =
  | 'description'
  | 'first_mes'
  | 'data.creator_notes'
  | 'personality'
  | 'scenario'
  | 'mes_example'
  | 'data.system_prompt'
  | 'data.post_history_instructions'
  | 'data.depth_prompt.prompt';
const isEditorPopupVisible = ref(false);
const editorPopupValue = ref('');
const editingFieldName = ref<EditableField | null>(null);
const editorPopupOptions = ref<PopupOptions>({});
const editorPopupTitle = ref('');

const avatarPreviewUrl = ref<string | null>(null);
const selectedAvatarFile = ref<File | null>(null);
const cropDataForCreate = ref<CropData | undefined>(undefined);
const isSubmitting = ref(false);

const localCharacter = ref<Character | null>(null);

watch(
  () => characterUiStore.editFormCharacter,
  (newVal) => {
    if (newVal && (!localCharacter.value || localCharacter.value.avatar !== newVal.avatar)) {
      localCharacter.value = cloneDeep(newVal);
      characterStore.calculateAllTokens(localCharacter.value);
    } else if (!newVal) {
      localCharacter.value = null;
    }
  },
  { immediate: true },
);

watch(
  localCharacter,
  async (newVal) => {
    if (!newVal) return;

    if (isCreating.value) {
      // Update draft state in UI store
      characterUiStore.draftCharacter = newVal;
      characterStore.calculateAllTokens(newVal);
    } else {
      const original = characterStore.characters.find((c) => c.avatar === newVal.avatar);
      if (original) {
        try {
          await characterStore.saveCharacter(newVal, original);
          characterStore.calculateAllTokens(newVal);
        } catch {
          toast.error(t('character.save.error'));
        }
      }
    }
  },
  { deep: true },
);

onUnmounted(() => {
  revokePreviewUrl();
  selectedAvatarFile.value = null;
  cropDataForCreate.value = undefined;
});

function toggleFavorite() {
  if (characterUiStore.editFormCharacter) {
    const newVal = !characterUiStore.editFormCharacter.fav;
    if (localCharacter.value) localCharacter.value.fav = newVal;
  }
}

function peekSpoilerMode() {
  isPeeking.value = isPeeking.value === null ? areDetailsHidden.value : !isPeeking.value;
}

function openMaximizeEditor(fieldName: EditableField, title: string) {
  editingFieldName.value = fieldName;
  editorPopupTitle.value = t('characterEditor.advanced.editingTitle', { title });
  editorPopupValue.value = characterUiStore.editFormCharacter
    ? // @ts-expect-error Element implicitly has an 'any'
      (characterUiStore.editFormCharacter[fieldName] ?? '')
    : '';
  editorPopupOptions.value = { wide: true, large: true, okButton: 'common.ok', cancelButton: false };
  isEditorPopupVisible.value = true;
}

function handleEditorSubmit({ value }: { value: string }) {
  if (editingFieldName.value && localCharacter.value) {
    set(localCharacter.value, editingFieldName.value, value);
  }
}

function revokePreviewUrl() {
  if (avatarPreviewUrl.value) {
    URL.revokeObjectURL(avatarPreviewUrl.value);
    avatarPreviewUrl.value = null;
  }
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node;

  const isOutsideMenu = exportMenuRef.value && !exportMenuRef.value.contains(target);
  const isOutsideButton = exportButtonRef.value && !exportButtonRef.value.contains(target);

  if (isOutsideMenu && isOutsideButton) {
    isExportMenuVisible.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

async function handleAvatarFileChange(event: Event) {
  if (!localCharacter.value) return;

  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    const file = input.files[0];

    let cropData: CropData | undefined = undefined;
    if (!settingsStore.settings.ui.avatars.neverResize) {
      const dataUrl = await getBase64Async(file);
      const { result, value } = await popupStore.show({
        title: t('popup.cropAvatar.title'),
        type: POPUP_TYPE.CROP,
        cropImage: dataUrl,
        wide: true,
      });
      if (result !== POPUP_RESULT.AFFIRMATIVE) {
        input.value = '';
        return;
      }
      cropData = value as CropData;
    }

    if (isCreating.value) {
      revokePreviewUrl();
      avatarPreviewUrl.value = URL.createObjectURL(file);
      selectedAvatarFile.value = file;
      cropDataForCreate.value = cropData;
      if (!localCharacter.value.name) {
        const name = file.name.replace(/\.[^/.]+$/, '');
        localCharacter.value.name = name;
      }
    } else {
      try {
        await characterStore.updateCharacterImage(localCharacter.value.avatar, file, cropData);
      } catch {
        toast.error(t('character.updateImage.error'));
      }
    }
    input.value = '';
  }
}

async function handleCreate() {
  if (!characterUiStore.editFormCharacter?.name) {
    toast.error(t('characterEditor.validation.nameRequired'));
    return;
  }
  if (uiStore.isSendPress) {
    toast.error(t('character.import.abortedMessage'));
    return;
  }

  if (!selectedAvatarFile.value) {
    try {
      const res = await fetch(default_avatar);
      const blob = await res.blob();
      selectedAvatarFile.value = new File([blob], 'avatar.png', { type: 'image/png' });
      cropDataForCreate.value = undefined;
    } catch {
      toast.error(t('characterEditor.validation.avatarRequired'));
      return;
    }
  }

  isSubmitting.value = true;
  try {
    const newAvatar = await characterStore.createNewCharacter(
      characterUiStore.editFormCharacter as Character,
      selectedAvatarFile.value,
      cropDataForCreate.value,
    );
    if (newAvatar) {
      characterUiStore.cancelCreating();
      characterUiStore.draftCharacter = DEFAULT_CHARACTER;
      characterUiStore.selectCharacterByAvatar(newAvatar);
      characterUiStore.highlightCharacter(newAvatar);
      selectedAvatarFile.value = null;
      cropDataForCreate.value = undefined;
      revokePreviewUrl();
    }
  } catch {
    toast.error(t('character.create.error'));
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete() {
  if (!characterUiStore.editFormCharacter) return;
  const charName = characterUiStore.editFormCharacter.name;
  const avatar = characterUiStore.editFormCharacter.avatar;

  const RESULT_CANCEL = -1;
  const RESULT_DELETE_ONLY = 1;
  const RESULT_DELETE_WITH_CHATS = 2;

  const result = await popupStore.show({
    title: t('character.delete.confirmTitle'),
    content: t('character.delete.confirmMessage', { name: charName }),
    type: POPUP_TYPE.TEXT,
    okButton: false,
    cancelButton: false,
    customButtons: [
      { text: t('common.cancel'), result: RESULT_CANCEL },
      { text: t('common.delete'), result: RESULT_DELETE_ONLY, classes: 'menu-button--danger' },
      { text: t('character.delete.deleteChats'), result: RESULT_DELETE_WITH_CHATS, classes: 'menu-button--danger' },
    ],
  });

  try {
    if (result.result === RESULT_DELETE_ONLY) {
      await characterStore.deleteCharacter(avatar, false);
      characterUiStore.selectedCharacterAvatarForEditing = null;
    } else if (result.result === RESULT_DELETE_WITH_CHATS) {
      await characterStore.deleteCharacter(avatar, true);
      characterUiStore.selectedCharacterAvatarForEditing = null;
    }
  } catch {
    toast.error(t('character.delete.error'));
  }
}

async function openLastChat() {
  if (!localCharacter.value) return;
  const chatExist = chatStore.chatInfos.find((chat) => chat.file_id === localCharacter.value?.chat);
  if (localCharacter.value.chat && chatExist) {
    try {
      chatStore.setActiveChatFile(localCharacter.value.chat);
    } catch {
      toast.error(t('chat.loadError'));
    }
  } else {
    createNewChat();
  }
  layoutStore.activateNavBarItem('chat');
  layoutStore.autoCloseSidebarsOnMobile();
}

async function createNewChat() {
  if (!localCharacter.value) return;
  const chatName = `${localCharacter.value.name} - ${humanizedDateTime()}`;
  try {
    chatStore.createNewChatForCharacter(localCharacter.value.avatar, chatName);
    layoutStore.activateNavBarItem('chat');
    layoutStore.autoCloseSidebarsOnMobile();
  } catch {
    toast.error(t('chat.createError'));
  }
}

async function handleExport(format: 'png' | 'json' = 'png') {
  if (!localCharacter.value) return;
  try {
    const blob = await characterService.export(localCharacter.value.avatar, format);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${localCharacter.value.name || 'character'}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch {
    toast.error(t('character.export.error'));
  }
}

function handleExportPng() {
  handleExport('png');
  isExportMenuVisible.value = false;
}

function handleExportJson() {
  handleExport('json');
  isExportMenuVisible.value = false;
}

async function handleDuplicate() {
  if (!localCharacter.value) return;
  try {
    await characterStore.duplicateCharacter(localCharacter.value.avatar);
  } catch {
    toast.error(t('character.duplicate.error'));
  }
}

async function handleRename() {
  if (!localCharacter.value) return;

  const { result, value: newName } = await popupStore.show<string>({
    title: t('characterEditor.moreOptions.rename'),
    type: POPUP_TYPE.INPUT,
    inputValue: localCharacter.value.name,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && newName) {
    await characterStore.renameCharacter(localCharacter.value.avatar, newName);
  }
}

async function openAlternateGreetings() {
  if (!localCharacter.value) return;

  if (!localCharacter.value.data) {
    localCharacter.value.data = {};
  }
  if (!localCharacter.value.data.alternate_greetings) {
    localCharacter.value.data.alternate_greetings = [];
  }

  const updateGreetings = (newGreetings: string[]) => {
    if (localCharacter.value && localCharacter.value.data) {
      localCharacter.value.data.alternate_greetings = newGreetings;
    }
  };
  const updateFirstMes = (newFirstMes: string) => {
    if (localCharacter.value) {
      localCharacter.value.first_mes = newFirstMes;
    }
  };

  await popupStore.show({
    title: t('characterEditor.alternateGreetings.title'),
    component: markRaw(AlternateGreetingsModal),
    componentProps: {
      greetings: localCharacter.value.data.alternate_greetings,
      firstMes: localCharacter.value.first_mes || '',
      'onUpdate:greetings': updateGreetings,
      'onUpdate:firstMes': updateFirstMes,
    },
    type: POPUP_TYPE.CONFIRM,
    large: true,
    wide: true,
    okButton: 'common.close',
    cancelButton: false,
  });
}

const displayAvatarUrl = computed(() => {
  if (!characterUiStore.editFormCharacter) return '';

  if (isCreating.value && avatarPreviewUrl.value) {
    return avatarPreviewUrl.value;
  }
  return getThumbnailUrl('avatar', characterUiStore.editFormCharacter.avatar);
});

const roleOptions = computed(() => [
  { value: 'system', label: t('characterEditor.advanced.roles.system') },
  { value: 'user', label: t('characterEditor.advanced.roles.user') },
  { value: 'assistant', label: t('characterEditor.advanced.roles.assistant') },
]);

const moreOptions = computed(() => [
  { value: 'default', label: t('characterEditor.more'), disabled: true },
  { value: 'importCardLore', label: t('characterEditor.moreOptions.importCardLore') },
  { value: 'convertToPersona', label: t('characterEditor.moreOptions.convertToPersona') },
  { value: 'rename', label: t('characterEditor.moreOptions.rename') },
]);

async function handleMoreAction(action: string | string[]) {
  if (!localCharacter.value) return;

  switch (action) {
    case 'convertToPersona':
      await personaStore.createPersonaFromCharacter(localCharacter.value);
      break;
    case 'rename':
      await handleRename();
      break;
    default:
      console.log('Selected action:', action);
  }
}

const lorebookOptions = computed(() => {
  return [
    { label: t('common.none'), value: '' },
    ...worldInfoStore.bookInfos.map((info) => ({ label: info.name, value: info.file_id })),
  ];
});

const embeddedLorebookName = computed({
  get: () => localCharacter.value?.data?.character_book?.name || '',
  set: async (newValue) => {
    if (!localCharacter.value || !localCharacter.value.data) return;
    if (!newValue) {
      delete localCharacter.value.data.character_book;
    } else {
      const book = await worldInfoStore.getBookFromCache(newValue, true);
      if (book) {
        const charBook = convertWorldInfoBookToCharacterBook(book);
        localCharacter.value.data.character_book = charBook;
      }
    }
  },
});

const allCharacterTags = computed<string[]>({
  get() {
    if (!localCharacter.value) return [];
    const customTags = characterUiStore.tagStore.getCustomTagsForCharacter(localCharacter.value.avatar);
    if (settingsStore.settings.character.hideEmbeddedTagsInPanel) {
      return customTags;
    }
    const embeddedTags = localCharacter.value.tags ?? [];
    return [...new Set([...embeddedTags, ...customTags])];
  },
  set(newTags: string[]) {
    if (!localCharacter.value) return;

    const customTags: string[] = [];
    const embeddedTags: string[] = [];

    // Separate tags from the input into custom and embedded types
    newTags.forEach((tag) => {
      if (characterUiStore.tagStore.getTagProperties(tag)) {
        customTags.push(tag);
      } else {
        embeddedTags.push(tag);
      }
    });

    // Always update custom tags, as they are managed separately
    characterUiStore.tagStore.setCustomTagsForCharacter(localCharacter.value.avatar, customTags);

    // Only update embedded tags if they were visible in the form.
    // This prevents wiping them out when they are hidden.
    if (!settingsStore.settings.character.hideEmbeddedTagsInPanel) {
      localCharacter.value.tags = embeddedTags;
    }
  },
});
</script>

<template>
  <div v-if="localCharacter" class="character-edit-form">
    <div id="character-editor-form">
      <div id="character-editor-header" class="character-edit-form-header">
        <div id="character-editor-name-container" class="character-edit-form-header-main" style="flex-grow: 1">
          <h2 v-show="!isCreating" class="interactable" tabindex="0">{{ localCharacter.name }}</h2>
          <Input
            v-show="isCreating"
            id="character-name-input"
            v-model="localCharacter.name"
            :placeholder="t('characterEditor.namePlaceholder')"
            class="font-bold text-lg"
            :label="t('characterEditor.name')"
          />
        </div>
        <div class="character-edit-form-header-info">
          <div
            id="character-editor-token-info"
            class="result_info"
            :title="t('characterEditor.tokenCounts.title')"
            :aria-label="t('characterEditor.tokenCounts.title')"
          >
            <div>
              <strong id="character-editor-total-tokens" :title="t('characterEditor.tokenCounts.total')">{{
                characterStore.totalTokens
              }}</strong
              >&nbsp;<span>{{ t('common.tokens') }}</span>
            </div>
            <div>
              <small :title="t('characterEditor.tokenCounts.permanent')">
                (<span id="character-editor-permanent-tokens">{{ characterStore.permanentTokens }}</span
                >&nbsp;<span>{{ t('characterEditor.tokenCounts.permanent') }}</span
                >)
              </small>
            </div>
          </div>
          <Button
            v-show="!isCreating"
            variant="ghost"
            icon="fa-ranking-star"
            :title="t('characterEditor.stats.title')"
          />
        </div>
      </div>

      <div class="character-edit-form-avatar-name-block">
        <div class="character-edit-form-avatar-area">
          <label for="add_avatar_button" class="character-edit-form-avatar-label" :title="t('characterEditor.avatar')">
            <img
              id="character-editor-avatar"
              :src="displayAvatarUrl"
              :alt="`${localCharacter.name} Avatar`"
              class="character-edit-form-avatar-img"
            />
            <input
              id="add_avatar_button"
              hidden
              type="file"
              name="avatar"
              accept="image/*"
              @change="handleAvatarFileChange"
            />
          </label>
        </div>
        <div class="character-edit-form-controls">
          <!-- Creation Controls -->
          <div v-show="isCreating" class="character-edit-form-buttons">
            <Button variant="confirm" :loading="isSubmitting" @click="handleCreate">
              {{ t('common.save') }}
            </Button>
            <Button :disabled="isSubmitting" @click="characterUiStore.cancelCreating">
              {{ t('common.cancel') }}
            </Button>
          </div>

          <div
            v-show="!isCreating"
            class="character-primary-actions"
            style="display: flex; gap: 4px; margin-bottom: 5px"
          >
            <Button
              variant="confirm"
              icon="fa-comments"
              class="flex-1"
              :title="t('characterEditor.openLastChat')"
              @click="openLastChat"
            >
              {{ t('common.chat') }}
            </Button>
            <Button icon="fa-plus" class="flex-1" :title="t('characterEditor.startNewChat')" @click="createNewChat">
              {{ t('common.new') }}
            </Button>
          </div>

          <div v-show="!isCreating" class="character-edit-form-buttons">
            <Button
              variant="ghost"
              icon="fa-star"
              :active="!!localCharacter.fav"
              :class="{ 'is-favorite': localCharacter.fav }"
              :title="t('characterEditor.favorite')"
              @click="toggleFavorite"
            />
            <div ref="exportButtonRef">
              <Button
                variant="ghost"
                icon="fa-file-export"
                :title="t('characterEditor.export')"
                @click.stop="isExportMenuVisible = !isExportMenuVisible"
              />
            </div>

            <div v-show="isExportMenuVisible" ref="exportMenuRef" class="export-menu" :style="exportMenuStyles">
              <a
                class="export-menu-item"
                role="button"
                tabindex="0"
                @click="handleExportPng"
                @keydown.enter="handleExportPng"
              >
                <i class="fa-solid fa-file-image" aria-hidden="true"></i>
                <span>{{ t('characterEditor.exportAsPng') }}</span>
              </a>
              <a
                class="export-menu-item"
                role="button"
                tabindex="0"
                @click="handleExportJson"
                @keydown.enter="handleExportJson"
              >
                <i class="fa-solid fa-file-code" aria-hidden="true"></i>
                <span>{{ t('characterEditor.exportAsJson') }}</span>
              </a>
            </div>
            <Button variant="ghost" icon="fa-clone" :title="t('characterEditor.duplicate')" @click="handleDuplicate" />
            <Button icon="fa-skull" variant="danger" :title="t('characterEditor.delete')" @click="handleDelete" />
          </div>

          <div v-show="!isCreating">
            <Select
              :model-value="'default'"
              :options="moreOptions"
              :label="t('characterEditor.more')"
              @update:model-value="handleMoreAction"
            />
          </div>
        </div>
      </div>

      <div class="character-edit-form-tags-block">
        <TagInput
          v-model="allCharacterTags!"
          :placeholder="t('characterEditor.searchTags')"
          :label="t('characterEditor.tags')"
          :suggestions="characterUiStore.availableTags"
        />
      </div>

      <!-- Creator's Notes Inline Drawer -->
      <CollapsibleSection v-model:is-open="isCreatorNotesOpen!" :title="t('characterEditor.creatorNotes')">
        <template #actions>
          <Button
            v-show="!isCreating"
            variant="ghost"
            icon="fa-eye"
            :title="t('characterEditor.toggleSpoiler')"
            @click.stop="peekSpoilerMode"
          />
        </template>

        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-show="localCharacter.data?.creator_notes" v-html="formattedCreatorNotes"></div>
        <div v-show="!localCharacter.data?.creator_notes">
          {{ t('characterEditor.noCreatorNotes') }}
        </div>
      </CollapsibleSection>

      <small v-show="areDetailsHidden">{{ t('characterEditor.detailsHidden') }}</small>

      <div v-show="!areDetailsHidden" class="character-edit-form-main-content">
        <FormItem for="char-description" :label="t('characterEditor.description')" data-field-name="description">
          <Textarea
            id="char-description"
            v-model="localCharacter.description!"
            allow-maximize
            :rows="12"
            :placeholder="t('characterEditor.descriptionPlaceholder')"
            identifier="character.description"
            @maximize="openMaximizeEditor('description', t('characterEditor.description'))"
          >
            <template #footer>
              <div class="token-counter">
                {{ t('common.tokens') }}: <span>{{ tokenCounts['description'] || 0 }}</span>
              </div>
            </template>
          </Textarea>
        </FormItem>

        <FormItem for="char-first-mes" :label="t('characterEditor.firstMessage')" data-field-name="first_mes">
          <div class="first-message-header">
            <Button variant="ghost" icon="fa-list-ul" @click="openAlternateGreetings">
              {{ t('characterEditor.alternateGreetings.label') }}
              <span v-if="localCharacter.data?.alternate_greetings?.length" class="count-badge">
                ({{ localCharacter.data.alternate_greetings.length }})
              </span>
            </Button>
          </div>
          <Textarea
            id="char-first-mes"
            v-model="localCharacter.first_mes!"
            allow-maximize
            :rows="10"
            :placeholder="t('characterEditor.firstMessagePlaceholder')"
            identifier="character.first_mes"
            @maximize="openMaximizeEditor('first_mes', t('characterEditor.firstMessage'))"
          >
            <template #footer>
              <div class="token-counter">
                {{ t('common.tokens') }}: <span>{{ tokenCounts['first_mes'] || 0 }}</span>
              </div>
            </template>
          </Textarea>
        </FormItem>

        <hr />

        <FormItem
          for="char-personality"
          :label="t('characterEditor.advanced.personality')"
          data-field-name="personality"
        >
          <Textarea
            id="char-personality"
            v-model="localCharacter.personality!"
            allow-maximize
            :rows="4"
            :placeholder="t('characterEditor.advanced.personalityPlaceholder')"
            identifier="character.personality"
            @maximize="openMaximizeEditor('personality', t('characterEditor.advanced.personality'))"
          >
            <template #footer>
              <div class="token-counter">
                {{ t('common.tokens') }}: <span>{{ tokenCounts['personality'] || 0 }}</span>
              </div>
            </template>
          </Textarea>
        </FormItem>

        <FormItem for="char-scenario" :label="t('characterEditor.advanced.scenario')" data-field-name="scenario">
          <Textarea
            id="char-scenario"
            v-model="localCharacter.scenario!"
            allow-maximize
            :rows="4"
            :placeholder="t('characterEditor.advanced.scenarioPlaceholder')"
            identifier="character.scenario"
            @maximize="openMaximizeEditor('scenario', t('characterEditor.advanced.scenario'))"
          >
            <template #footer>
              <div class="token-counter">
                {{ t('common.tokens') }}: <span>{{ tokenCounts['scenario'] || 0 }}</span>
              </div>
            </template>
          </Textarea>
        </FormItem>

        <!-- Character Note with Depth -->
        <div class="character-note-container" data-field-name="data.depth_prompt.prompt">
          <div v-if="localCharacter.data?.depth_prompt" style="flex: 3">
            <FormItem for="char-note" :label="t('characterEditor.advanced.characterNote')">
              <Textarea
                id="char-note"
                v-model="localCharacter.data.depth_prompt.prompt"
                allow-maximize
                :rows="5"
                :placeholder="t('characterEditor.advanced.characterNotePlaceholder')"
                identifier="character.note"
                @maximize="openMaximizeEditor('data.depth_prompt.prompt', t('characterEditor.advanced.characterNote'))"
              />
            </FormItem>
          </div>
          <div v-if="localCharacter.data?.depth_prompt" style="flex: 1">
            <FormItem for="char-depth" :label="t('characterEditor.advanced.depth')">
              <Input
                id="char-depth"
                v-model="localCharacter.data.depth_prompt.depth"
                type="number"
                :min="0"
                :max="9999"
              />
            </FormItem>
            <FormItem for="char-role" :label="t('characterEditor.advanced.role')">
              <Select id="char-role" v-model="localCharacter.data.depth_prompt.role" :options="roleOptions" />
            </FormItem>
          </div>
        </div>

        <FormItem
          :label="t('characterEditor.advanced.talkativeness')"
          :description="t('characterEditor.advanced.talkativenessHint')"
        >
          <RangeControl
            v-model="localCharacter.talkativeness!"
            :min="0"
            :max="1"
            :step="0.05"
            :label="t('characterEditor.advanced.talkativeness')"
          >
            <template #addon>
              <div class="slider-hint">
                <span>{{ t('characterEditor.advanced.talkativenessShy') }}</span>
                <span>{{ t('characterEditor.advanced.talkativenessNormal') }}</span>
                <span>{{ t('characterEditor.advanced.talkativenessChatty') }}</span>
              </div>
            </template>
          </RangeControl>
        </FormItem>

        <hr />

        <FormItem
          for="char-examples"
          :label="t('characterEditor.advanced.dialogueExamples')"
          data-field-name="mes_example"
        >
          <Textarea
            id="char-examples"
            v-model="localCharacter.mes_example!"
            allow-maximize
            :rows="6"
            :placeholder="t('characterEditor.advanced.dialogueExamplesPlaceholder')"
            identifier="character.mes_example"
            @maximize="openMaximizeEditor('mes_example', t('characterEditor.advanced.dialogueExamples'))"
          >
            <template #footer>
              <div class="token-counter">
                {{ t('common.tokens') }}: <span>{{ tokenCounts['mes_example'] || 0 }}</span>
              </div>
            </template>
          </Textarea>
        </FormItem>

        <hr />

        <CollapsibleSection
          v-model:is-open="isPromptOverridesOpen"
          :title="t('characterEditor.advanced.promptOverrides')"
        >
          <div class="inline-drawer-content--column">
            <div v-if="localCharacter.data" data-field-name="data.post_history_instructions">
              <FormItem for="char-post-history" :label="t('characterEditor.advanced.postHistoryInstructions')">
                <Textarea
                  id="char-post-history"
                  v-model="localCharacter.data.post_history_instructions!"
                  allow-maximize
                  :rows="3"
                  :placeholder="t('characterEditor.advanced.postHistoryInstructionsPlaceholder')"
                  identifier="character.post_history_instructions"
                  @maximize="
                    openMaximizeEditor(
                      'data.post_history_instructions',
                      t('characterEditor.advanced.postHistoryInstructions'),
                    )
                  "
                >
                  <template #footer>
                    <div class="token-counter">
                      {{ t('common.tokens') }}: <span>{{ tokenCounts['data.post_history_instructions'] || 0 }}</span>
                    </div>
                  </template>
                </Textarea>
              </FormItem>
            </div>
          </div>
        </CollapsibleSection>

        <hr />

        <CollapsibleSection
          v-model:is-open="isMetadataOpen"
          :title="t('characterEditor.advanced.metadata')"
          :subtitle="t('characterEditor.advanced.metadataHint')"
        >
          <div class="inline-drawer-content--column">
            <FormItem for="char-lorebook" :label="t('characterEditor.embeddedLorebook')">
              <Select id="char-lorebook" v-model="embeddedLorebookName" :options="lorebookOptions" searchable />
            </FormItem>

            <small>{{ t('characterEditor.advanced.metadataOptional') }}</small>
            <div class="form-row">
              <div class="form-column">
                <FormItem for="char-creator" :label="t('characterEditor.advanced.createdBy')">
                  <Textarea
                    v-if="localCharacter.data"
                    id="char-creator"
                    v-model="localCharacter.data.creator!"
                    :rows="2"
                    :placeholder="t('characterEditor.advanced.createdByPlaceholder')"
                  />
                </FormItem>
              </div>
              <div class="form-column">
                <FormItem for="char-version" :label="t('characterEditor.advanced.characterVersion')">
                  <Textarea
                    v-if="localCharacter.data"
                    id="char-version"
                    v-model="localCharacter.data.character_version!"
                    :rows="2"
                    :placeholder="t('characterEditor.advanced.characterVersionPlaceholder')"
                  />
                </FormItem>
              </div>
            </div>
            <div class="form-row">
              <div class="form-column" data-field-name="data.creator_notes">
                <FormItem for="char-creator-notes" :label="t('characterEditor.advanced.creatorNotes')">
                  <Textarea
                    v-if="localCharacter.data"
                    id="char-creator-notes"
                    v-model="localCharacter.data.creator_notes!"
                    allow-maximize
                    :rows="4"
                    :placeholder="t('characterEditor.advanced.creatorNotesPlaceholder')"
                    identifier="character.creator_notes"
                    @maximize="openMaximizeEditor('data.creator_notes', t('characterEditor.advanced.creatorNotes'))"
                  />
                </FormItem>
              </div>
              <div class="form-column">
                <FormItem for="char-embed-tags" :label="t('characterEditor.advanced.tagsToEmbed')">
                  <Textarea
                    id="char-embed-tags"
                    :model-value="localCharacter.tags?.join(', ') || ''"
                    :rows="4"
                    :placeholder="t('characterEditor.advanced.tagsToEmbedPlaceholder')"
                    @update:model-value="
                      (v) => (localCharacter ? (localCharacter.tags = v.split(',').map((s: string) => s.trim())) : null)
                    "
                  />
                </FormItem>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>

    <Popup
      id="character-edit-form-editor-popup"
      :visible="isEditorPopupVisible"
      :title="editorPopupTitle"
      :type="POPUP_TYPE.INPUT"
      :input-value="editorPopupValue"
      :options="editorPopupOptions"
      @submit="handleEditorSubmit"
      @close="isEditorPopupVisible = false"
    />
  </div>
</template>
