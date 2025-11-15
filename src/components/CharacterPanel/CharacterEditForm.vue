<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { useCharacterStore } from '../../stores/character.store';
import { useSettingsStore } from '../../stores/settings.store';
import type { Character, MessageRole } from '../../types';
import Popup from '../Popup/Popup.vue';
import { POPUP_TYPE, type PopupOptions } from '../../types';
import { getThumbnailUrl } from '../../utils/image';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { slideTransitionHooks } from '../../utils/dom';
import { get, set } from 'lodash-es';
import { depth_prompt_depth_default, depth_prompt_role_default, talkativeness_default } from '../../constants';
import type { Path, ValueForPath } from '../../types/utils';

type CharacterFormData = Omit<Character, 'data'> & {
  data: Omit<NonNullable<Character['data']>, 'depth_prompt'> & {
    depth_prompt: {
      prompt: string;
      depth: number;
      role: MessageRole;
    };
  };
};

type CharacterFormDataPath = Path<CharacterFormData>;

const { t } = useStrictI18n();
const characterStore = useCharacterStore();
const settingsStore = useSettingsStore();
const tokenCounts = computed(() => characterStore.tokenCounts.fields);
const activeCharacter = computed(() => characterStore.activeCharacter);

const formData = ref<CharacterFormData>({} as CharacterFormData);
const isUpdatingFromStore = ref(false);

// --- State for new features ---
const isPeeking = ref(false);
const isSpoilerModeActive = computed(() => settingsStore.powerUser.spoiler_free_mode);
const areDetailsHidden = computed(() => isSpoilerModeActive.value && !isPeeking.value);

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

// --- Transition Hooks ---
const { beforeEnter, enter, afterEnter, beforeLeave, leave, afterLeave } = slideTransitionHooks;

// --- Computed properties for form fields ---
const joinedTags = computed({
  get: () => formData.value.tags?.join(', ') || '',
  set: (value) => {
    updateValue(
      'tags',
      value.split(',').map((t) => t.trim()),
    );
  },
});

// --- Watchers to sync form data with store ---
watch(
  activeCharacter,
  (newChar) => {
    if (newChar) {
      if (JSON.stringify(newChar) !== JSON.stringify(formData.value)) {
        isUpdatingFromStore.value = true;

        const charCopy = JSON.parse(JSON.stringify(newChar));

        // Ensure data structures exist for the template
        if (!charCopy.data) charCopy.data = {};
        if (!charCopy.data.creator_notes) charCopy.data.creator_notes = charCopy.creatorcomment || '';
        if (!charCopy.data.depth_prompt) {
          charCopy.data.depth_prompt = {
            prompt: '',
            depth: depth_prompt_depth_default,
            role: depth_prompt_role_default,
          };
        }
        if (charCopy.talkativeness === undefined) charCopy.talkativeness = talkativeness_default;

        formData.value = charCopy;
        characterStore.calculateAllTokens(charCopy);
        isPeeking.value = false;

        nextTick(() => {
          isUpdatingFromStore.value = false;
        });
      }
    } else {
      formData.value = { data: {} } as CharacterFormData;
    }
  },
  { immediate: true, deep: true },
);

watch(
  formData,
  (newData, oldData) => {
    if (isUpdatingFromStore.value) return;
    if (oldData && Object.keys(oldData).length === 0) return; // Prevent saving on initial hydration

    // Legacy sync: sync root fields with their counterparts in `data` if they exist.
    if (newData.data) {
      for (const key in newData) {
        if (key !== 'data' && Object.prototype.hasOwnProperty.call(newData, key)) {
          if (typeof newData.data[key] !== 'undefined') newData.data[key] = newData[key as keyof typeof newData];
          if (newData.data.extensions && typeof newData.data.extensions[key] !== 'undefined') {
            newData.data.extensions[key] = newData[key as keyof typeof newData];
          }
        }
      }
    }

    if (newData.avatar === oldData?.avatar) {
      characterStore.saveCharacterDebounced(newData);
      characterStore.calculateAllTokens(newData);
    }
  },
  { deep: true },
);

// --- Methods ---
function updateValue<P extends CharacterFormDataPath>(path: P, value: ValueForPath<CharacterFormData, P>) {
  set(formData.value, path, value);
}

function toggleFavorite() {
  formData.value.fav = !formData.value.fav;
}

function peekSpoilerMode() {
  isPeeking.value = !isPeeking.value;
}

function openMaximizeEditor(fieldName: EditableField, title: string) {
  editingFieldName.value = fieldName;
  editorPopupTitle.value = t('characterEditor.advanced.editingTitle', { title });
  editorPopupValue.value = get(formData.value, fieldName) ?? '';
  editorPopupOptions.value = { wide: true, large: true, okButton: 'common.ok', cancelButton: false };
  isEditorPopupVisible.value = true;
}

function handleEditorSubmit({ value }: { value: string }) {
  if (editingFieldName.value) {
    set(formData.value, editingFieldName.value, value);
  }
}
</script>

<template>
  <div v-if="activeCharacter && formData.data" class="character-edit-form">
    <form action="javascript:void(null);" method="post" enctype="multipart/form-data">
      <div class="character-edit-form__avatar-name-block">
        <div class="character-edit-form__avatar-area">
          <label for="add_avatar_button" class="character-edit-form__avatar-label" :title="t('characterEditor.avatar')">
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
            <div
              @click="toggleFavorite"
              class="menu-button fa-solid fa-star"
              :class="{ 'is-favorite': formData.fav }"
              :title="t('characterEditor.favorite')"
            ></div>
            <div class="menu-button fa-solid fa-globe" :title="t('characterEditor.lore')"></div>
            <div class="menu-button fa-solid fa-passport" :title="t('characterEditor.chatLore')"></div>
            <div class="menu-button fa-solid fa-face-smile" :title="t('characterEditor.personas')"></div>
            <div class="menu-button fa-solid fa-file-export" :title="t('characterEditor.export')"></div>
            <div class="menu-button fa-solid fa-clone" :title="t('characterEditor.duplicate')"></div>
            <div class="menu-button fa-solid fa-skull menu-button--danger" :title="t('characterEditor.delete')"></div>
          </div>
          <label class="u-w-full">
            <select class="text-pole u-w-full">
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

      <div class="character-edit-form__tags-block">
        <div class="tag-controls">
          <input class="text-pole u-w-full" :placeholder="t('characterEditor.searchTags')" />
          <div class="menu-button fa-solid fa-tags" :title="t('characterEditor.viewAllTags')"></div>
        </div>
        <div class="tags">
          <span v-for="tag in formData.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>

      <!-- Creator's Notes Inline Drawer -->
      <div class="inline-drawer">
        <div class="inline-drawer-header" @click="isCreatorNotesOpen = !isCreatorNotesOpen">
          <span class="inline-drawer-header__title">{{ t('characterEditor.creatorNotes') }}</span>
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
              <div v-else>{{ t('characterEditor.noCreatorNotes') }}</div>
            </div>
          </div>
        </Transition>
      </div>

      <small v-show="areDetailsHidden">{{ t('characterEditor.detailsHidden') }}</small>

      <div v-show="!areDetailsHidden" class="u-flex-col" style="gap: 15px; flex-grow: 1; min-height: 0">
        <div class="form-section form-section--text-area">
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
            :value="formData.description"
            @input="updateValue('description', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="t('characterEditor.descriptionPlaceholder')"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['description'] || 0 }}</span>
          </div>
        </div>

        <div class="form-section form-section--text-area">
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
            :value="formData.first_mes"
            @input="updateValue('first_mes', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="t('characterEditor.firstMessagePlaceholder')"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['first_mes'] || 0 }}</span>
          </div>
        </div>
        <hr />
        <div class="form-section">
          <label>
            <span>{{ t('characterEditor.advanced.personality') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('personality', t('characterEditor.advanced.personality'))"
            ></i>
          </label>
          <textarea
            :value="formData.personality"
            @input="updateValue('personality', ($event.target as HTMLTextAreaElement).value)"
            class="text-pole"
            rows="4"
            :placeholder="t('characterEditor.advanced.personalityPlaceholder')"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['personality'] || 0 }}</span>
          </div>
        </div>
        <div class="form-section">
          <label>
            <span>{{ t('characterEditor.advanced.scenario') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('scenario', t('characterEditor.advanced.scenario'))"
            ></i>
          </label>
          <textarea
            :value="formData.scenario"
            @input="updateValue('scenario', ($event.target as HTMLTextAreaElement).value)"
            class="text-pole"
            rows="4"
            :placeholder="t('characterEditor.advanced.scenarioPlaceholder')"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['scenario'] || 0 }}</span>
          </div>
        </div>
        <div class="form-section character-note">
          <div class="u-w-full">
            <label>
              <span>{{ t('characterEditor.advanced.characterNote') }}</span>
              <i
                class="editor-maximize-icon fa-solid fa-maximize"
                :title="t('characterEditor.expandEditor')"
                @click="openMaximizeEditor('data.depth_prompt.prompt', t('characterEditor.advanced.characterNote'))"
              ></i>
            </label>
            <textarea
              :value="formData.data.depth_prompt.prompt"
              @input="updateValue('data.depth_prompt.prompt', ($event.target as HTMLTextAreaElement).value)"
              class="text-pole"
              rows="5"
              :placeholder="t('characterEditor.advanced.characterNotePlaceholder')"
            ></textarea>
          </div>
          <div>
            <label>{{ t('characterEditor.advanced.depth') }}</label>
            <input
              :value="formData.data.depth_prompt.depth"
              @input="updateValue('data.depth_prompt.depth', ($event.target as HTMLInputElement).valueAsNumber)"
              type="number"
              min="0"
              max="9999"
              class="text-pole"
            />
            <label>{{ t('characterEditor.advanced.role') }}</label>
            <select
              :value="formData.data.depth_prompt.role"
              @change="updateValue('data.depth_prompt.role', ($event.target as HTMLSelectElement).value as MessageRole)"
              class="text-pole"
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
            :value="formData.talkativeness"
            @input="updateValue('talkativeness', ($event.target as HTMLInputElement).valueAsNumber)"
            type="range"
            min="0"
            max="1"
            step="0.05"
          />
          <div class="slider-hint">
            <span>{{ t('characterEditor.advanced.talkativenessShy') }}</span>
            <span>{{ t('characterEditor.advanced.talkativenessNormal') }}</span>
            <span>{{ t('characterEditor.advanced.talkativenessChatty') }}</span>
          </div>
        </div>
        <hr />
        <div class="form-section">
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
            :value="formData.mes_example"
            @input="updateValue('mes_example', ($event.target as HTMLTextAreaElement).value)"
            class="text-pole"
            rows="6"
            :placeholder="t('characterEditor.advanced.dialogueExamplesPlaceholder')"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['mes_example'] || 0 }}</span>
          </div>
        </div>
        <hr />
        <div class="inline-drawer">
          <div class="inline-drawer-header" @click="isPromptOverridesOpen = !isPromptOverridesOpen">
            <h4 class="inline-drawer-header__title">
              {{ t('characterEditor.advanced.promptOverrides') }}
              <small>{{ t('characterEditor.advanced.promptOverridesHint') }}</small>
            </h4>
            <i
              class="fa-solid fa-circle-chevron-down inline-drawer-header__icon"
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
              <div class="inline-drawer-content u-flex-col">
                <small>{{ t('characterEditor.advanced.promptHint') }}</small>
                <div>
                  <label>
                    <span>{{ t('characterEditor.advanced.mainPrompt') }}</span>
                    <i
                      class="editor-maximize-icon fa-solid fa-maximize"
                      :title="t('characterEditor.expandEditor')"
                      @click="openMaximizeEditor('data.system_prompt', t('characterEditor.advanced.mainPrompt'))"
                    ></i>
                  </label>
                  <textarea
                    :value="formData.data.system_prompt"
                    @input="updateValue('data.system_prompt', ($event.target as HTMLTextAreaElement).value)"
                    class="text-pole"
                    rows="3"
                    :placeholder="t('characterEditor.advanced.mainPromptPlaceholder')"
                  ></textarea>
                  <div class="token-counter">
                    {{ t('common.tokens') }}: <span>{{ tokenCounts['data.system_prompt'] || 0 }}</span>
                  </div>
                </div>
                <div>
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
                    :value="formData.data.post_history_instructions"
                    @input="updateValue('data.post_history_instructions', ($event.target as HTMLTextAreaElement).value)"
                    class="text-pole"
                    rows="3"
                    :placeholder="t('characterEditor.advanced.postHistoryInstructionsPlaceholder')"
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
            <h4 class="inline-drawer-header__title">
              {{ t('characterEditor.advanced.metadata') }}
              <small>{{ t('characterEditor.advanced.metadataHint') }}</small>
            </h4>
            <i
              class="fa-solid fa-circle-chevron-down inline-drawer-header__icon"
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
              <div class="inline-drawer-content u-flex-col">
                <small>{{ t('characterEditor.advanced.metadataOptional') }}</small>
                <div class="u-flex u-flex-nowrap">
                  <div class="u-w-full">
                    <label>{{ t('characterEditor.advanced.createdBy') }}</label>
                    <textarea
                      :value="formData.data.creator"
                      @input="updateValue('data.creator', ($event.target as HTMLTextAreaElement).value)"
                      class="text-pole"
                      rows="2"
                      :placeholder="t('characterEditor.advanced.createdByPlaceholder')"
                    ></textarea>
                  </div>
                  <div class="u-w-full">
                    <label>{{ t('characterEditor.advanced.characterVersion') }}</label>
                    <textarea
                      :value="formData.data.character_version"
                      @input="updateValue('data.character_version', ($event.target as HTMLTextAreaElement).value)"
                      class="text-pole"
                      rows="2"
                      :placeholder="t('characterEditor.advanced.characterVersionPlaceholder')"
                    ></textarea>
                  </div>
                </div>
                <div class="u-flex u-flex-nowrap">
                  <div class="u-w-full">
                    <label>
                      <span>{{ t('characterEditor.advanced.creatorNotes') }}</span>
                      <i
                        class="editor-maximize-icon fa-solid fa-maximize"
                        :title="t('characterEditor.expandEditor')"
                        @click="openMaximizeEditor('data.creator_notes', t('characterEditor.advanced.creatorNotes'))"
                      ></i>
                    </label>
                    <textarea
                      :value="formData.data.creator_notes"
                      @input="updateValue('data.creator_notes', ($event.target as HTMLTextAreaElement).value)"
                      class="text-pole"
                      rows="4"
                      :placeholder="t('characterEditor.advanced.creatorNotesPlaceholder')"
                    ></textarea>
                  </div>
                  <div class="u-w-full">
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
      :inputValue="editorPopupValue"
      :options="editorPopupOptions"
      @submit="handleEditorSubmit"
      @close="isEditorPopupVisible = false"
    />
  </div>
</template>
