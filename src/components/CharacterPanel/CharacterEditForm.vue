<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue';
import { useCharacterStore } from '../../stores/character.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useChatStore } from '../../stores/chat.store';
import { usePersonaStore } from '../../stores/persona.store';
import type { Character } from '../../types';
import Popup from '../Popup/Popup.vue';
import { POPUP_TYPE, type PopupOptions } from '../../types';
import { getThumbnailUrl } from '../../utils/image';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { default_avatar } from '../../constants';
import { toast } from '../../composables/useToast';
import { usePopupStore } from '../../stores/popup.store';
import { cloneDeep, set } from 'lodash-es';
import { humanizedDateTime } from '../../utils/date';
import {
  AppInput,
  AppTextarea,
  AppButton,
  AppIconButton,
  AppSelect,
  TagInput,
  CollapsibleSection,
  RangeControl,
} from '../UI';
import AppFormItem from '../UI/AppFormItem.vue';

const { t } = useStrictI18n();
const characterStore = useCharacterStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const chatStore = useChatStore();
const personaStore = usePersonaStore();
const tokenCounts = computed(() => characterStore.tokenCounts.fields);

const isCreating = computed(() => characterStore.isCreating);

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

    if (isCreating.value) {
      revokePreviewUrl();
      avatarPreviewUrl.value = URL.createObjectURL(file);
      selectedAvatarFile.value = file;
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

async function handleDuplicate() {
  if (!localCharacter.value) return;
  await characterStore.duplicateCharacter(localCharacter.value.avatar);
}

const displayAvatarUrl = computed(() => {
  if (!characterStore.editFormCharacter) return '';

  if (isCreating.value && avatarPreviewUrl.value) {
    return avatarPreviewUrl.value;
  }
  return getThumbnailUrl('avatar', characterStore.editFormCharacter.avatar);
});

const roleOptions = computed(() => [
  { value: 'system', label: t('characterEditor.advanced.roles.system') },
  { value: 'user', label: t('characterEditor.advanced.roles.user') },
  { value: 'assistant', label: t('characterEditor.advanced.roles.assistant') },
]);

const moreOptions = computed(() => [
  { value: 'default', label: t('characterEditor.more'), disabled: true },
  { value: 'linkWorldInfo', label: t('characterEditor.moreOptions.linkWorldInfo') },
  { value: 'importCardLore', label: t('characterEditor.moreOptions.importCardLore') },
  { value: 'characterSettingsOverrides', label: t('characterEditor.moreOptions.characterSettingsOverrides') },
  { value: 'convertToPersona', label: t('characterEditor.moreOptions.convertToPersona') },
  { value: 'rename', label: t('characterEditor.moreOptions.rename') },
  { value: 'linkToSource', label: t('characterEditor.moreOptions.linkToSource') },
  { value: 'replaceUpdate', label: t('characterEditor.moreOptions.replaceUpdate') },
  { value: 'importTags', label: t('characterEditor.moreOptions.importTags') },
  { value: 'setAsWelcomeAssistant', label: t('characterEditor.moreOptions.setAsWelcomeAssistant') },
]);

async function handleMoreAction(action: string) {
  if (!localCharacter.value) return;

  switch (action) {
    case 'convertToPersona':
      await personaStore.createPersonaFromCharacter(localCharacter.value);
      break;
    default:
      console.log('Selected action:', action);
  }
}
</script>

<template>
  <div v-if="localCharacter" class="character-edit-form">
    <div id="character-editor-form">
      <div id="character-editor-header" class="character-edit-form-header">
        <div id="character-editor-name-container" class="character-edit-form-header-main" style="flex-grow: 1">
          <h2 v-show="!isCreating" class="interactable" tabindex="0">{{ localCharacter.name }}</h2>
          <AppInput
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
          <AppIconButton v-show="!isCreating" icon="fa-ranking-star" :title="t('characterEditor.stats.title')" />
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
            <AppButton variant="confirm" :loading="isSubmitting" @click="handleCreate">
              {{ t('common.save') }}
            </AppButton>
            <AppButton :disabled="isSubmitting" @click="characterStore.cancelCreating">
              {{ t('common.cancel') }}
            </AppButton>
          </div>

          <div
            v-show="!isCreating"
            class="character-primary-actions"
            style="display: flex; gap: 5px; margin-bottom: 5px"
          >
            <AppButton
              variant="confirm"
              icon="fa-comments"
              class="flex-1"
              :title="t('characterEditor.openLastChat')"
              @click="openLastChat"
            >
              {{ t('common.chat') }}
            </AppButton>
            <AppButton icon="fa-plus" class="flex-1" :title="t('characterEditor.startNewChat')" @click="createNewChat">
              {{ t('common.new') }}
            </AppButton>
          </div>

          <div v-show="!isCreating" class="character-edit-form-buttons">
            <AppIconButton
              icon="fa-star"
              :active="!!localCharacter.fav"
              :class="{ 'is-favorite': localCharacter.fav }"
              :title="t('characterEditor.favorite')"
              @click="toggleFavorite"
            />
            <AppIconButton icon="fa-globe" :title="t('characterEditor.lore')" />
            <AppIconButton icon="fa-passport" :title="t('characterEditor.chatLore')" />
            <AppIconButton icon="fa-face-smile" :title="t('characterEditor.personas')" />
            <AppIconButton icon="fa-file-export" :title="t('characterEditor.export')" />
            <AppIconButton icon="fa-clone" :title="t('characterEditor.duplicate')" @click="handleDuplicate" />
            <AppIconButton
              icon="fa-skull"
              variant="danger"
              :title="t('characterEditor.delete')"
              @click="handleDelete"
            />
          </div>

          <div v-show="!isCreating">
            <!-- @vue-ignore -->
            <AppSelect :model-value="'default'" :options="moreOptions" @update:model-value="handleMoreAction" />
          </div>
        </div>
      </div>

      <div class="character-edit-form-tags-block">
        <TagInput v-model="localCharacter.tags!" :placeholder="t('characterEditor.searchTags')" />
      </div>

      <!-- Creator's Notes Inline Drawer -->
      <CollapsibleSection v-model:is-open="isCreatorNotesOpen!" :title="t('characterEditor.creatorNotes')">
        <template #actions>
          <AppIconButton icon="fa-palette" :title="t('characterEditor.toggleStyles')" @click.stop="() => {}" />
          <AppIconButton icon="fa-eye" :title="t('characterEditor.toggleSpoiler')" @click.stop="peekSpoilerMode" />
        </template>

        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-show="localCharacter.data?.creator_notes" v-html="localCharacter?.data?.creator_notes"></div>
        <div v-show="!localCharacter.data?.creator_notes">
          {{ t('characterEditor.noCreatorNotes') }}
        </div>
      </CollapsibleSection>

      <small v-show="areDetailsHidden">{{ t('characterEditor.detailsHidden') }}</small>

      <div v-show="!areDetailsHidden" class="character-edit-form-main-content">
        <AppFormItem :label="t('characterEditor.description')" data-field-name="description">
          <AppTextarea
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
          </AppTextarea>
        </AppFormItem>

        <AppFormItem :label="t('characterEditor.firstMessage')" data-field-name="first_mes">
          <AppTextarea
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
          </AppTextarea>
        </AppFormItem>

        <hr />

        <AppFormItem :label="t('characterEditor.advanced.personality')" data-field-name="personality">
          <AppTextarea
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
          </AppTextarea>
        </AppFormItem>

        <AppFormItem :label="t('characterEditor.advanced.scenario')" data-field-name="scenario">
          <AppTextarea
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
          </AppTextarea>
        </AppFormItem>

        <!-- Character Note with Depth -->
        <div class="character-note-container" data-field-name="data.depth_prompt.prompt">
          <div v-if="localCharacter.data?.depth_prompt" style="flex: 3">
            <AppFormItem :label="t('characterEditor.advanced.characterNote')">
              <AppTextarea
                v-model="localCharacter.data.depth_prompt.prompt"
                :rows="5"
                :placeholder="t('characterEditor.advanced.characterNotePlaceholder')"
                @maximize="openMaximizeEditor('data.depth_prompt.prompt', t('characterEditor.advanced.characterNote'))"
              />
            </AppFormItem>
          </div>
          <div v-if="localCharacter.data?.depth_prompt" style="flex: 1">
            <AppFormItem :label="t('characterEditor.advanced.depth')">
              <AppInput v-model="localCharacter.data.depth_prompt.depth" type="number" :min="0" :max="9999" />
            </AppFormItem>
            <AppFormItem :label="t('characterEditor.advanced.role')">
              <AppSelect v-model="localCharacter.data.depth_prompt.role" :options="roleOptions" />
            </AppFormItem>
          </div>
        </div>

        <AppFormItem
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
        </AppFormItem>

        <hr />

        <AppFormItem
          :label="t('characterEditor.advanced.dialogueExamples')"
          :description="t('characterEditor.advanced.dialogueExamplesHint')"
          data-field-name="mes_example"
        >
          <AppTextarea
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
          </AppTextarea>
        </AppFormItem>

        <hr />

        <CollapsibleSection
          v-model:is-open="isPromptOverridesOpen"
          :title="t('characterEditor.advanced.promptOverrides')"
          :subtitle="t('characterEditor.advanced.promptOverridesHint')"
        >
          <div class="inline-drawer-content--column">
            <small>{{ t('characterEditor.advanced.promptHint') }}</small>
            <div v-if="localCharacter.data" data-field-name="data.system_prompt">
              <AppFormItem :label="t('characterEditor.advanced.mainPrompt')">
                <AppTextarea
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
                </AppTextarea>
              </AppFormItem>
            </div>

            <div v-if="localCharacter.data" data-field-name="data.post_history_instructions">
              <AppFormItem :label="t('characterEditor.advanced.postHistoryInstructions')">
                <AppTextarea
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
                </AppTextarea>
              </AppFormItem>
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
            <small>{{ t('characterEditor.advanced.metadataOptional') }}</small>
            <div class="form-row">
              <div class="form-column">
                <AppFormItem :label="t('characterEditor.advanced.createdBy')">
                  <AppTextarea
                    v-if="localCharacter.data"
                    v-model="localCharacter.data.creator!"
                    :rows="2"
                    :placeholder="t('characterEditor.advanced.createdByPlaceholder')"
                  />
                </AppFormItem>
              </div>
              <div class="form-column">
                <AppFormItem :label="t('characterEditor.advanced.characterVersion')">
                  <AppTextarea
                    v-if="localCharacter.data"
                    v-model="localCharacter.data.character_version!"
                    :rows="2"
                    :placeholder="t('characterEditor.advanced.characterVersionPlaceholder')"
                  />
                </AppFormItem>
              </div>
            </div>
            <div class="form-row">
              <div class="form-column" data-field-name="data.creator_notes">
                <AppFormItem :label="t('characterEditor.advanced.creatorNotes')">
                  <AppTextarea
                    v-if="localCharacter.data"
                    v-model="localCharacter.data.creator_notes!"
                    :rows="4"
                    :placeholder="t('characterEditor.advanced.creatorNotesPlaceholder')"
                    @maximize="openMaximizeEditor('data.creator_notes', t('characterEditor.advanced.creatorNotes'))"
                  />
                </AppFormItem>
              </div>
              <div class="form-column">
                <AppFormItem :label="t('characterEditor.advanced.tagsToEmbed')">
                  <AppTextarea
                    :model-value="localCharacter.tags?.join(', ') || ''"
                    :rows="4"
                    :placeholder="t('characterEditor.advanced.tagsToEmbedPlaceholder')"
                    @update:model-value="
                      (v) => (localCharacter ? (localCharacter.tags = v.split(',').map((s: string) => s.trim())) : null)
                    "
                  />
                </AppFormItem>
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
</style>
