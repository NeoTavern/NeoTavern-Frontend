<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue';
import { useCharacterStore } from '../../stores/character.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useChatStore } from '../../stores/chat.store';
import type { Character, MessageRole } from '../../types';
import Popup from '../Popup/Popup.vue';
import { POPUP_TYPE, type PopupOptions } from '../../types';
import { getThumbnailUrl } from '../../utils/image';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { slideTransitionHooks } from '../../utils/dom';
import { default_avatar } from '../../constants';
import { toast } from '../../composables/useToast';
import { usePopupStore } from '../../stores/popup.store';
import { cloneDeep, set } from 'lodash-es';
import { humanizedDateTime } from '../../utils/date';

const { t } = useStrictI18n();
const characterStore = useCharacterStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const chatStore = useChatStore();
const tokenCounts = computed(() => characterStore.tokenCounts.fields);

const isCreating = computed(() => characterStore.isCreating);

// --- State for new features ---
const isPeeking = ref(false);
const isSpoilerModeActive = computed(() => settingsStore.settings.character.spoilerFreeMode);
const areDetailsHidden = computed(() => isSpoilerModeActive.value && !isPeeking.value && !isCreating.value);

// --- Drawer States ---
const isCreatorNotesOpen = ref(false);
const isPromptOverridesOpen = ref(false);
const isMetadataOpen = ref(false);

// --- Popup state for maximizing editors ---
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

// --- Creation State ---
const avatarPreviewUrl = ref<string | null>(null);
const selectedAvatarFile = ref<File | null>(null);
const isSubmitting = ref(false);

// --- Transition Hooks ---
const { beforeEnter, enter, afterEnter, beforeLeave, leave, afterLeave } = slideTransitionHooks;

const localCharacter = ref<Character | null>(null);

watch(
  () => characterStore.editFormCharacter,
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
  (newVal) => {
    if (newVal) {
      characterStore.saveCharacterDebounced(newVal);
      characterStore.calculateAllTokens(newVal);
    }
  },
  { deep: true },
);

const joinedTags = computed({
  get: () => characterStore.editFormCharacter?.tags?.join(', ') || '',
  set: (value) => {
    if (characterStore.editFormCharacter) {
      characterStore.editFormCharacter.tags = value.split(',').map((t) => t.trim());
    }
  },
});

onUnmounted(() => {
  revokePreviewUrl();
});

function toggleFavorite() {
  if (characterStore.editFormCharacter) {
    characterStore.editFormCharacter.fav = !characterStore.editFormCharacter.fav;
  }
}

function peekSpoilerMode() {
  isPeeking.value = !isPeeking.value;
}

function openMaximizeEditor(fieldName: EditableField, title: string) {
  editingFieldName.value = fieldName;
  editorPopupTitle.value = t('characterEditor.advanced.editingTitle', { title });
  // @ts-expect-error Element implicitly has an 'any'
  editorPopupValue.value = characterStore.editFormCharacter ? (characterStore.editFormCharacter[fieldName] ?? '') : '';
  editorPopupOptions.value = { wide: true, large: true, okButton: 'common.ok', cancelButton: false };
  isEditorPopupVisible.value = true;
}

function handleEditorSubmit({ value }: { value: string }) {
  if (editingFieldName.value && characterStore.editFormCharacter) {
    set(characterStore.editFormCharacter, editingFieldName.value, value);
  }
}

function revokePreviewUrl() {
  if (avatarPreviewUrl.value) {
    URL.revokeObjectURL(avatarPreviewUrl.value);
    avatarPreviewUrl.value = null;
  }
}

async function handleAvatarFileChange(event: Event) {
  if (!characterStore.editFormCharacter) return;

  const input = event.target as HTMLInputElement;
  if (input.files && input.files[0]) {
    const file = input.files[0];

    // If in creation mode, show preview
    if (isCreating.value) {
      revokePreviewUrl();
      avatarPreviewUrl.value = URL.createObjectURL(file);
      selectedAvatarFile.value = file;
      // Also update name if empty
      if (!characterStore.editFormCharacter?.name) {
        const name = file.name.replace(/\.[^/.]+$/, '');
        characterStore.editFormCharacter.name = name;
      }
    } else {
      await characterStore.updateCharacterImage(characterStore.editFormCharacter.avatar, file);
    }
  }
}

async function handleCreate() {
  if (!characterStore.editFormCharacter?.name) {
    toast.error(t('characterEditor.validation.nameRequired'));
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
    await characterStore.createNewCharacter(characterStore.editFormCharacter as Character, selectedAvatarFile.value);
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete() {
  if (!characterStore.editFormCharacter) return;
  const charName = characterStore.editFormCharacter.name;
  const avatar = characterStore.editFormCharacter.avatar;

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
      {
        text: t('common.cancel'),
        result: RESULT_CANCEL,
      },
      {
        text: t('common.delete'),
        result: RESULT_DELETE_ONLY,
        classes: 'menu-button--danger',
      },
      {
        text: t('character.delete.deleteChats'),
        result: RESULT_DELETE_WITH_CHATS,
        classes: 'menu-button--danger',
      },
    ],
  });

  if (result.result === RESULT_DELETE_ONLY) {
    await characterStore.deleteCharacter(avatar, false);
  } else if (result.result === RESULT_DELETE_WITH_CHATS) {
    await characterStore.deleteCharacter(avatar, true);
  }
}

async function openLastChat() {
  if (!localCharacter.value) return;
  if (localCharacter.value.chat) {
    await chatStore.setActiveChatFile(localCharacter.value.chat);
  } else {
    await createNewChat();
  }
}

async function createNewChat() {
  if (!localCharacter.value) return;
  const filename = `${localCharacter.value.name.replace(/\s+/g, '_')}_${humanizedDateTime()}`;
  await chatStore.createNewChatForCharacter(localCharacter.value.avatar, filename);
}

const displayAvatarUrl = computed(() => {
  if (!characterStore.editFormCharacter) return '';

  if (isCreating.value && avatarPreviewUrl.value) {
    return avatarPreviewUrl.value;
  }
  return getThumbnailUrl('avatar', characterStore.editFormCharacter.avatar);
});
</script>

<template>
  <div v-if="localCharacter" class="character-edit-form">
    <form id="character-editor-form" action="javascript:void(null);" method="post" enctype="multipart/form-data">
      <div id="character-editor-header" class="character-edit-form-header">
        <div id="character-editor-name-container" class="character-edit-form-header-main">
          <h2 v-show="!isCreating" class="interactable" tabindex="0">{{ localCharacter.name }}</h2>
          <input
            v-show="isCreating"
            v-model="localCharacter.name"
            class="text-pole"
            :placeholder="t('characterEditor.namePlaceholder')"
            style="font-size: 1.2em; font-weight: bold"
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
          <!-- TODO: Implement token warning visibility logic -->
          <a
            v-show="!isCreating"
            id="character-editor-token-warning"
            class="menu-button-icon fa-solid fa-triangle-exclamation"
            style="display: none"
            href="https://docs.sillytavern.app/usage/core-concepts/characterdesign/#character-tokens"
            target="_blank"
            :title="t('characterEditor.tokenCounts.warningTooltip')"
          ></a>
          <i
            v-show="!isCreating"
            id="character-editor-stats-button"
            class="menu-button-icon fa-solid fa-ranking-star"
            :title="t('characterEditor.stats.title')"
          ></i>
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
            <button class="menu-button menu-button--confirm" :disabled="isSubmitting" @click="handleCreate">
              <i v-show="isSubmitting" class="fa-solid fa-spinner fa-spin"></i>
              {{ t('common.save') }}
            </button>
            <button class="menu-button" :disabled="isSubmitting" @click="characterStore.cancelCreating">
              {{ t('common.cancel') }}
            </button>
          </div>

          <div
            v-show="!isCreating"
            class="character-primary-actions"
            style="display: flex; gap: 5px; margin-bottom: 5px"
          >
            <button
              class="menu-button menu-button--confirm"
              style="flex: 1"
              @click="openLastChat"
              :title="t('characterEditor.openLastChat')"
            >
              <i class="fa-solid fa-comments"></i> {{ t('common.chat') }}
            </button>
            <button
              class="menu-button"
              style="flex: 1"
              @click="createNewChat"
              :title="t('characterEditor.startNewChat')"
            >
              <i class="fa-solid fa-plus"></i> {{ t('common.new') }}
            </button>
          </div>

          <div v-show="!isCreating" class="character-edit-form-buttons">
            <div
              class="menu-button fa-solid fa-star"
              :class="{ 'is-favorite': localCharacter.fav }"
              :title="t('characterEditor.favorite')"
              @click="toggleFavorite"
            ></div>
            <div class="menu-button fa-solid fa-globe" :title="t('characterEditor.lore')"></div>
            <div class="menu-button fa-solid fa-passport" :title="t('characterEditor.chatLore')"></div>
            <div class="menu-button fa-solid fa-face-smile" :title="t('characterEditor.personas')"></div>
            <div class="menu-button fa-solid fa-file-export" :title="t('characterEditor.export')"></div>
            <div class="menu-button fa-solid fa-clone" :title="t('characterEditor.duplicate')"></div>
            <div
              class="menu-button fa-solid fa-skull menu-button--danger"
              :title="t('characterEditor.delete')"
              @click="handleDelete"
            ></div>
          </div>

          <label v-show="!isCreating">
            <select class="text-pole">
              <option value="default" disabled selected>{{ t('characterEditor.more') }}</option>
              <option>{{ t('characterEditor.moreOptions.linkWorldInfo') }}</option>
              <option>{{ t('characterEditor.moreOptions.importCardLore') }}</option>
              <option>{{ t('characterEditor.moreOptions.characterSettingsOverrides') }}</option>
              <option>{{ t('characterEditor.moreOptions.convertToPersona') }}</option>
              <option>{{ t('characterEditor.moreOptions.rename') }}</option>
              <option>{{ t('characterEditor.moreOptions.linkToSource') }}</option>
              <option>{{ t('characterEditor.moreOptions.replaceUpdate') }}</option>
              <option>{{ t('characterEditor.moreOptions.importTags') }}</option>
              <option>{{ t('characterEditor.moreOptions.setAsWelcomeAssistant') }}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="character-edit-form-tags-block">
        <div class="tag-controls">
          <input class="text-pole" :placeholder="t('characterEditor.searchTags')" />
          <div class="menu-button fa-solid fa-tags" :title="t('characterEditor.viewAllTags')"></div>
        </div>
        <div class="tags">
          <span v-for="tag in localCharacter.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>

      <!-- Creator's Notes Inline Drawer -->
      <div class="inline-drawer">
        <div class="inline-drawer-header" @click="isCreatorNotesOpen = !isCreatorNotesOpen">
          <span class="inline-drawer-header-title">{{ t('characterEditor.creatorNotes') }}</span>
          <div
            class="menu-button fa-solid fa-palette fa-fw"
            :title="t('characterEditor.toggleStyles')"
            @click.stop="() => {}"
          ></div>
          <div
            class="menu-button fa-solid fa-eye fa-fw"
            :title="t('characterEditor.toggleSpoiler')"
            @click.stop="peekSpoilerMode"
          ></div>
          <i
            class="fa-solid fa-circle-chevron-down inline-drawer-header-icon"
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
              <!-- TODO: We should make sure this is sanitized when we loading the character eslint-disable-next-line vue/no-v-html -->
              <div v-show="localCharacter.data?.creator_notes" v-html="localCharacter?.data?.creator_notes"></div>
              <div v-show="!localCharacter.data?.creator_notes">
                {{ t('characterEditor.noCreatorNotes') }}
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <small v-show="areDetailsHidden">{{ t('characterEditor.detailsHidden') }}</small>

      <div v-show="!areDetailsHidden" class="character-edit-form-main-content">
        <div class="form-section form-section--text-area" data-field-name="description">
          <label for="description_textarea">
            <span>{{ t('characterEditor.description') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('description', t('characterEditor.description'))"
            ></i>
          </label>
          <textarea
            id="description_textarea"
            class="text-pole"
            rows="12"
            :value="localCharacter.description"
            :placeholder="t('characterEditor.descriptionPlaceholder')"
            @input="localCharacter.description = ($event.target as HTMLTextAreaElement).value"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['description'] || 0 }}</span>
          </div>
        </div>

        <div class="form-section form-section--text-area" data-field-name="first_mes">
          <label for="firstmessage_textarea">
            <span>{{ t('characterEditor.firstMessage') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('first_mes', t('characterEditor.firstMessage'))"
            ></i>
          </label>
          <textarea
            id="firstmessage_textarea"
            class="text-pole"
            rows="10"
            :value="localCharacter.first_mes"
            :placeholder="t('characterEditor.firstMessagePlaceholder')"
            @input="localCharacter.first_mes = ($event.target as HTMLTextAreaElement).value"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['first_mes'] || 0 }}</span>
          </div>
        </div>
        <hr />
        <div class="form-section" data-field-name="personality">
          <label>
            <span>{{ t('characterEditor.advanced.personality') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('personality', t('characterEditor.advanced.personality'))"
            ></i>
          </label>
          <textarea
            :value="localCharacter.personality"
            class="text-pole"
            rows="4"
            :placeholder="t('characterEditor.advanced.personalityPlaceholder')"
            @input="localCharacter.personality = ($event.target as HTMLTextAreaElement).value"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['personality'] || 0 }}</span>
          </div>
        </div>
        <div class="form-section" data-field-name="scenario">
          <label>
            <span>{{ t('characterEditor.advanced.scenario') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('scenario', t('characterEditor.advanced.scenario'))"
            ></i>
          </label>
          <textarea
            :value="localCharacter.scenario"
            class="text-pole"
            rows="4"
            :placeholder="t('characterEditor.advanced.scenarioPlaceholder')"
            @input="localCharacter.scenario = ($event.target as HTMLTextAreaElement).value"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['scenario'] || 0 }}</span>
          </div>
        </div>
        <div class="form-section character-note" data-field-name="data.depth_prompt.prompt">
          <div class="character-note-main">
            <label>
              <span>{{ t('characterEditor.advanced.characterNote') }}</span>
              <i
                class="editor-maximize-icon fa-solid fa-maximize"
                :title="t('characterEditor.expandEditor')"
                @click="openMaximizeEditor('data.depth_prompt.prompt', t('characterEditor.advanced.characterNote'))"
              ></i>
            </label>
            <!-- @vue-ignore -->
            <textarea
              :value="localCharacter.data.depth_prompt?.prompt"
              class="text-pole"
              rows="5"
              :placeholder="t('characterEditor.advanced.characterNotePlaceholder')"
              @input="localCharacter.data.depth_prompt.prompt = ($event.target as HTMLTextAreaElement).value"
            ></textarea>
          </div>
          <div class="character-note-controls">
            <label>{{ t('characterEditor.advanced.depth') }}</label>
            <!-- @vue-ignore -->
            <input
              :value="localCharacter.data.depth_prompt?.depth"
              type="number"
              min="0"
              max="9999"
              class="text-pole"
              @input="localCharacter.data.depth_prompt.depth = ($event.target as HTMLInputElement).valueAsNumber"
            />
            <label>{{ t('characterEditor.advanced.role') }}</label>
            <!-- @vue-ignore -->
            <select
              :value="localCharacter.data.depth_prompt?.role"
              class="text-pole"
              @change="updateValue('data.depth_prompt.role', ($event.target as HTMLSelectElement).value as MessageRole)"
            >
              <option value="system">{{ t('characterEditor.advanced.roles.system') }}</option>
              <option value="user">{{ t('characterEditor.advanced.roles.user') }}</option>
              <option value="assistant">{{ t('characterEditor.advanced.roles.assistant') }}</option>
            </select>
          </div>
        </div>
        <div class="form-section">
          <label>{{ t('characterEditor.advanced.talkativeness') }}</label>
          <small>{{ t('characterEditor.advanced.talkativenessHint') }}</small>
          <input
            :value="localCharacter.talkativeness"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="localCharacter.talkativeness = ($event.target as HTMLInputElement).valueAsNumber"
          />
          <div class="slider-hint">
            <span>{{ t('characterEditor.advanced.talkativenessShy') }}</span>
            <span>{{ t('characterEditor.advanced.talkativenessNormal') }}</span>
            <span>{{ t('characterEditor.advanced.talkativenessChatty') }}</span>
          </div>
        </div>
        <hr />
        <div class="form-section" data-field-name="mes_example">
          <label>
            <span>{{ t('characterEditor.advanced.dialogueExamples') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('mes_example', t('characterEditor.advanced.dialogueExamples'))"
            ></i>
          </label>
          <small>{{ t('characterEditor.advanced.dialogueExamplesHint') }}</small>
          <textarea
            :value="localCharacter.mes_example"
            class="text-pole"
            rows="6"
            :placeholder="t('characterEditor.advanced.dialogueExamplesPlaceholder')"
            @input="localCharacter.mes_example = ($event.target as HTMLTextAreaElement).value"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['mes_example'] || 0 }}</span>
          </div>
        </div>
        <hr />
        <div class="inline-drawer">
          <div class="inline-drawer-header" @click="isPromptOverridesOpen = !isPromptOverridesOpen">
            <h4 class="inline-drawer-header-title">
              {{ t('characterEditor.advanced.promptOverrides') }}
              <small>{{ t('characterEditor.advanced.promptOverridesHint') }}</small>
            </h4>
            <i
              class="fa-solid fa-circle-chevron-down inline-drawer-header-icon"
              :class="{ 'is-open': isPromptOverridesOpen }"
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
            <div v-show="isPromptOverridesOpen">
              <div class="inline-drawer-content inline-drawer-content--column">
                <small>{{ t('characterEditor.advanced.promptHint') }}</small>
                <div data-field-name="data.system_prompt">
                  <label>
                    <span>{{ t('characterEditor.advanced.mainPrompt') }}</span>
                    <i
                      class="editor-maximize-icon fa-solid fa-maximize"
                      :title="t('characterEditor.expandEditor')"
                      @click="openMaximizeEditor('data.system_prompt', t('characterEditor.advanced.mainPrompt'))"
                    ></i>
                  </label>
                  <textarea
                    :value="localCharacter.data?.system_prompt"
                    class="text-pole"
                    rows="3"
                    :placeholder="t('characterEditor.advanced.mainPromptPlaceholder')"
                    @input="localCharacter.data!.system_prompt = ($event.target as HTMLTextAreaElement).value"
                  ></textarea>
                  <div class="token-counter">
                    {{ t('common.tokens') }}: <span>{{ tokenCounts['data.system_prompt'] || 0 }}</span>
                  </div>
                </div>
                <div data-field-name="data.post_history_instructions">
                  <label>
                    <span>{{ t('characterEditor.advanced.postHistoryInstructions') }}</span>
                    <i
                      class="editor-maximize-icon fa-solid fa-maximize"
                      :title="t('characterEditor.expandEditor')"
                      @click="
                        openMaximizeEditor(
                          'data.post_history_instructions',
                          t('characterEditor.advanced.postHistoryInstructions'),
                        )
                      "
                    ></i>
                  </label>
                  <textarea
                    :value="localCharacter.data?.post_history_instructions"
                    class="text-pole"
                    rows="3"
                    :placeholder="t('characterEditor.advanced.postHistoryInstructionsPlaceholder')"
                    @input="
                      localCharacter.data!.post_history_instructions = ($event.target as HTMLTextAreaElement).value
                    "
                  ></textarea>
                  <div class="token-counter">
                    {{ t('common.tokens') }}: <span>{{ tokenCounts['data.post_history_instructions'] || 0 }}</span>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>
        <hr />
        <div class="inline-drawer">
          <div class="inline-drawer-header" @click="isMetadataOpen = !isMetadataOpen">
            <h4 class="inline-drawer-header-title">
              {{ t('characterEditor.advanced.metadata') }}
              <small>{{ t('characterEditor.advanced.metadataHint') }}</small>
            </h4>
            <i
              class="fa-solid fa-circle-chevron-down inline-drawer-header-icon"
              :class="{ 'is-open': isMetadataOpen }"
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
            <div v-show="isMetadataOpen">
              <div class="inline-drawer-content inline-drawer-content--column">
                <small>{{ t('characterEditor.advanced.metadataOptional') }}</small>
                <div class="form-row">
                  <div class="form-column">
                    <label>{{ t('characterEditor.advanced.createdBy') }}</label>
                    <textarea
                      :value="localCharacter.data?.creator"
                      class="text-pole"
                      rows="2"
                      :placeholder="t('characterEditor.advanced.createdByPlaceholder')"
                      @input="localCharacter.data!.creator = ($event.target as HTMLTextAreaElement).value"
                    ></textarea>
                  </div>
                  <div class="form-column">
                    <label>{{ t('characterEditor.advanced.characterVersion') }}</label>
                    <textarea
                      :value="localCharacter.data?.character_version"
                      class="text-pole"
                      rows="2"
                      :placeholder="t('characterEditor.advanced.characterVersionPlaceholder')"
                      @input="localCharacter.data!.character_version = ($event.target as HTMLTextAreaElement).value"
                    ></textarea>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-column" data-field-name="data.creator_notes">
                    <label>
                      <span>{{ t('characterEditor.advanced.creatorNotes') }}</span>
                      <i
                        class="editor-maximize-icon fa-solid fa-maximize"
                        :title="t('characterEditor.expandEditor')"
                        @click="openMaximizeEditor('data.creator_notes', t('characterEditor.advanced.creatorNotes'))"
                      ></i>
                    </label>
                    <textarea
                      :value="localCharacter.data?.creator_notes"
                      class="text-pole"
                      rows="4"
                      :placeholder="t('characterEditor.advanced.creatorNotesPlaceholder')"
                      @input="localCharacter.data!.creator_notes = ($event.target as HTMLTextAreaElement).value"
                    ></textarea>
                  </div>
                  <div class="form-column">
                    <label>{{ t('characterEditor.advanced.tagsToEmbed') }}</label>
                    <textarea
                      v-model="joinedTags"
                      class="text-pole"
                      rows="4"
                      :placeholder="t('characterEditor.advanced.tagsToEmbedPlaceholder')"
                    ></textarea>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </form>

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
