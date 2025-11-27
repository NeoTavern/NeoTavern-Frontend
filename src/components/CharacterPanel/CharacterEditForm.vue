<script setup lang="ts">
import { cloneDeep, set } from 'lodash-es';
import { computed, markRaw, onUnmounted, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { default_avatar, DEFAULT_CHARACTER } from '../../constants';
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
import type { Character } from '../../types';
import { POPUP_RESULT, POPUP_TYPE, type PopupOptions } from '../../types';
import { getThumbnailUrl } from '../../utils/character';
import { humanizedDateTime } from '../../utils/commons';
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

const isPeeking = ref(false);
const isSpoilerModeActive = computed(() => settingsStore.settings.character.spoilerFreeMode);
const areDetailsHidden = computed(() => isSpoilerModeActive.value && !isPeeking.value && !isCreating.value);

const isCreatorNotesOpen = ref(false);
const isPromptOverridesOpen = ref(false);
const isMetadataOpen = ref(false);

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
});

function toggleFavorite() {
  if (characterUiStore.editFormCharacter) {
    const newVal = !characterUiStore.editFormCharacter.fav;
    if (localCharacter.value) localCharacter.value.fav = newVal;
  }
}

function peekSpoilerMode() {
  isPeeking.value = !isPeeking.value;
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

async function handleAvatarFileChange(event: Event) {
  if (!localCharacter.value) return;

  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    const file = input.files[0];

    if (isCreating.value) {
      revokePreviewUrl();
      avatarPreviewUrl.value = URL.createObjectURL(file);
      selectedAvatarFile.value = file;
      if (!localCharacter.value.name) {
        const name = file.name.replace(/\.[^/.]+$/, '');
        localCharacter.value.name = name;
      }
    } else {
      try {
        await characterStore.updateCharacterImage(localCharacter.value.avatar, file);
      } catch {
        toast.error(t('character.updateImage.error'));
      }
    }
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
    } catch {
      alert('Please select an avatar.'); // TODO: Add i18n, use toast, show error
      return;
    }
  }

  isSubmitting.value = true;
  try {
    const newAvatar = await characterStore.createNewCharacter(
      characterUiStore.editFormCharacter as Character,
      selectedAvatarFile.value,
    );
    if (newAvatar) {
      characterUiStore.cancelCreating();
      characterUiStore.draftCharacter = DEFAULT_CHARACTER;
      characterUiStore.selectCharacterByAvatar(newAvatar);
      characterUiStore.highlightCharacter(newAvatar);
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
}

async function createNewChat() {
  if (!localCharacter.value) return;
  const chatName = `${localCharacter.value.name.replace(/\s+/g, '_')}_${humanizedDateTime()}`;
  try {
    await chatStore.createNewChatForCharacter(localCharacter.value.avatar, chatName);
  } catch {
    toast.error(t('chat.createError'));
  }
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

  // We pass a callback to receive live updates from the component.
  // This allows us to update the character store (via localCharacter watcher)
  // immediately as the user edits, without waiting for the popup to close.
  const updateGreetings = (newGreetings: string[]) => {
    if (localCharacter.value && localCharacter.value.data) {
      localCharacter.value.data.alternate_greetings = newGreetings;
    }
  };

  await popupStore.show({
    title: t('characterEditor.alternateGreetings.title'),
    component: markRaw(AlternateGreetingsModal),
    componentProps: {
      greetings: localCharacter.value.data.alternate_greetings,
      'onUpdate:greetings': updateGreetings,
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

async function handleMoreAction(action: string) {
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
</script>

<template>
  <div v-if="localCharacter" class="character-edit-form">
    <div id="character-editor-form">
      <div id="character-editor-header" class="character-edit-form-header">
        <div id="character-editor-name-container" class="character-edit-form-header-main" style="flex-grow: 1">
          <h2 v-show="!isCreating" class="interactable" tabindex="0">{{ localCharacter.name }}</h2>
          <Input
            v-show="isCreating"
            v-model="localCharacter.name"
            :placeholder="t('characterEditor.namePlaceholder')"
            class="font-bold text-lg"
          />
        </div>
        <div class="character-edit-form-header-info">
          <div id="character-editor-token-info" class="result_info" :title="t('characterEditor.tokenCounts.title')">
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
            <Button variant="ghost" icon="fa-globe" :title="t('characterEditor.lore')" />
            <Button variant="ghost" icon="fa-passport" :title="t('characterEditor.chatLore')" />
            <Button variant="ghost" icon="fa-face-smile" :title="t('characterEditor.personas')" />
            <Button variant="ghost" icon="fa-file-export" :title="t('characterEditor.export')" />
            <Button variant="ghost" icon="fa-clone" :title="t('characterEditor.duplicate')" @click="handleDuplicate" />
            <Button icon="fa-skull" variant="danger" :title="t('characterEditor.delete')" @click="handleDelete" />
          </div>

          <div v-show="!isCreating">
            <!-- @vue-ignore -->
            <Select :model-value="'default'" :options="moreOptions" @update:model-value="handleMoreAction" />
          </div>
        </div>
      </div>

      <div class="character-edit-form-tags-block">
        <TagInput v-model="localCharacter.tags!" :placeholder="t('characterEditor.searchTags')" />
      </div>

      <!-- Creator's Notes Inline Drawer -->
      <CollapsibleSection v-model:is-open="isCreatorNotesOpen!" :title="t('characterEditor.creatorNotes')">
        <template #actions>
          <Button variant="ghost" icon="fa-palette" :title="t('characterEditor.toggleStyles')" @click.stop="() => {}" />
          <Button
            variant="ghost"
            icon="fa-eye"
            :title="t('characterEditor.toggleSpoiler')"
            @click.stop="peekSpoilerMode"
          />
        </template>

        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-show="localCharacter.data?.creator_notes" v-html="localCharacter?.data?.creator_notes"></div>
        <div v-show="!localCharacter.data?.creator_notes">
          {{ t('characterEditor.noCreatorNotes') }}
        </div>
      </CollapsibleSection>

      <small v-show="areDetailsHidden">{{ t('characterEditor.detailsHidden') }}</small>

      <div v-show="!areDetailsHidden" class="character-edit-form-main-content">
        <FormItem :label="t('characterEditor.description')" data-field-name="description">
          <Textarea
            v-model="localCharacter.description!"
            :rows="12"
            :placeholder="t('characterEditor.descriptionPlaceholder')"
            @maximize="openMaximizeEditor('description', t('characterEditor.description'))"
          >
            <template #footer>
              <div class="token-counter">
                {{ t('common.tokens') }}: <span>{{ tokenCounts['description'] || 0 }}</span>
              </div>
            </template>
          </Textarea>
        </FormItem>

        <FormItem :label="t('characterEditor.firstMessage')" data-field-name="first_mes">
          <div class="first-message-header">
            <Button variant="ghost" icon="fa-list-ul" @click="openAlternateGreetings">
              {{ t('characterEditor.alternateGreetings.label') }}
              <span v-if="localCharacter.data?.alternate_greetings?.length" class="count-badge">
                ({{ localCharacter.data.alternate_greetings.length }})
              </span>
            </Button>
          </div>
          <Textarea
            v-model="localCharacter.first_mes!"
            :rows="10"
            :placeholder="t('characterEditor.firstMessagePlaceholder')"
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

        <FormItem :label="t('characterEditor.advanced.personality')" data-field-name="personality">
          <Textarea
            v-model="localCharacter.personality!"
            :rows="4"
            :placeholder="t('characterEditor.advanced.personalityPlaceholder')"
            @maximize="openMaximizeEditor('personality', t('characterEditor.advanced.personality'))"
          >
            <template #footer>
              <div class="token-counter">
                {{ t('common.tokens') }}: <span>{{ tokenCounts['personality'] || 0 }}</span>
              </div>
            </template>
          </Textarea>
        </FormItem>

        <FormItem :label="t('characterEditor.advanced.scenario')" data-field-name="scenario">
          <Textarea
            v-model="localCharacter.scenario!"
            :rows="4"
            :placeholder="t('characterEditor.advanced.scenarioPlaceholder')"
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
            <FormItem :label="t('characterEditor.advanced.characterNote')">
              <Textarea
                v-model="localCharacter.data.depth_prompt.prompt"
                :rows="5"
                :placeholder="t('characterEditor.advanced.characterNotePlaceholder')"
                @maximize="openMaximizeEditor('data.depth_prompt.prompt', t('characterEditor.advanced.characterNote'))"
              />
            </FormItem>
          </div>
          <div v-if="localCharacter.data?.depth_prompt" style="flex: 1">
            <FormItem :label="t('characterEditor.advanced.depth')">
              <Input v-model="localCharacter.data.depth_prompt.depth" type="number" :min="0" :max="9999" />
            </FormItem>
            <FormItem :label="t('characterEditor.advanced.role')">
              <Select v-model="localCharacter.data.depth_prompt.role" :options="roleOptions" />
            </FormItem>
          </div>
        </div>

        <FormItem
          :label="t('characterEditor.advanced.talkativeness')"
          :description="t('characterEditor.advanced.talkativenessHint')"
        >
          <RangeControl v-model="localCharacter.talkativeness!" :min="0" :max="1" :step="0.05">
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
          :label="t('characterEditor.advanced.dialogueExamples')"
          :description="t('characterEditor.advanced.dialogueExamplesHint')"
          data-field-name="mes_example"
        >
          <Textarea
            v-model="localCharacter.mes_example!"
            :rows="6"
            :placeholder="t('characterEditor.advanced.dialogueExamplesPlaceholder')"
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
            <small>{{ t('characterEditor.advanced.promptHint') }}</small>
            <div v-if="localCharacter.data" data-field-name="data.system_prompt">
              <FormItem :label="t('characterEditor.advanced.mainPrompt')">
                <Textarea
                  v-model="localCharacter.data.system_prompt!"
                  :rows="3"
                  :placeholder="t('characterEditor.advanced.mainPromptPlaceholder')"
                  @maximize="openMaximizeEditor('data.system_prompt', t('characterEditor.advanced.mainPrompt'))"
                >
                  <template #footer>
                    <div class="token-counter">
                      {{ t('common.tokens') }}: <span>{{ tokenCounts['data.system_prompt'] || 0 }}</span>
                    </div>
                  </template>
                </Textarea>
              </FormItem>
            </div>

            <div v-if="localCharacter.data" data-field-name="data.post_history_instructions">
              <FormItem :label="t('characterEditor.advanced.postHistoryInstructions')">
                <Textarea
                  v-model="localCharacter.data.post_history_instructions!"
                  :rows="3"
                  :placeholder="t('characterEditor.advanced.postHistoryInstructionsPlaceholder')"
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
            <!-- TODO: Move to another place -->
            <FormItem :label="t('characterEditor.embeddedLorebook')">
              <Select v-model="embeddedLorebookName" :options="lorebookOptions" searchable />
            </FormItem>

            <small>{{ t('characterEditor.advanced.metadataOptional') }}</small>
            <div class="form-row">
              <div class="form-column">
                <FormItem :label="t('characterEditor.advanced.createdBy')">
                  <Textarea
                    v-if="localCharacter.data"
                    v-model="localCharacter.data.creator!"
                    :rows="2"
                    :placeholder="t('characterEditor.advanced.createdByPlaceholder')"
                  />
                </FormItem>
              </div>
              <div class="form-column">
                <FormItem :label="t('characterEditor.advanced.characterVersion')">
                  <Textarea
                    v-if="localCharacter.data"
                    v-model="localCharacter.data.character_version!"
                    :rows="2"
                    :placeholder="t('characterEditor.advanced.characterVersionPlaceholder')"
                  />
                </FormItem>
              </div>
            </div>
            <div class="form-row">
              <div class="form-column" data-field-name="data.creator_notes">
                <FormItem :label="t('characterEditor.advanced.creatorNotes')">
                  <Textarea
                    v-if="localCharacter.data"
                    v-model="localCharacter.data.creator_notes!"
                    :rows="4"
                    :placeholder="t('characterEditor.advanced.creatorNotesPlaceholder')"
                    @maximize="openMaximizeEditor('data.creator_notes', t('characterEditor.advanced.creatorNotes'))"
                  />
                </FormItem>
              </div>
              <div class="form-column">
                <FormItem :label="t('characterEditor.advanced.tagsToEmbed')">
                  <Textarea
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

<style scoped lang="scss">
.is-favorite {
  color: var(--color-golden);
  filter: drop-shadow(0 0 3px var(--color-golden));
}

.flex-1 {
  flex: 1;
}

.font-bold {
  font-weight: bold;
}
.text-lg {
  font-size: 1.2em;
}

.first-message-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 4px;
}

.count-badge {
  margin-left: 4px;
  opacity: 0.7;
}
</style>
