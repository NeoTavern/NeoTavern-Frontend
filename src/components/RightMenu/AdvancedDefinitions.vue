<script setup lang="ts">
import { ref, computed } from 'vue';
import type { PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { depth_prompt_depth_default, depth_prompt_role_default, talkativeness_default } from '../../constants';
import type { Character, PopupOptions } from '../../types';
import { POPUP_TYPE } from '../../types';
import Popup from '../Popup/Popup.vue';
import { useCharacterStore } from '../../stores/character.store';
import { slideTransitionHooks } from '../../utils/dom';
import { get } from 'lodash-es';

const props = defineProps({
  modelValue: { type: Object as PropType<Partial<Character>>, required: true },
});
const emit = defineEmits(['close', 'update:modelValue']);

const { t } = useI18n();
const characterStore = useCharacterStore();
const tokenCounts = computed(() => characterStore.tokenCounts.fields);

// Helper function to update nested properties without mutating props directly
function updateValue(path: string, value: any) {
  // Deep clone to avoid prop mutation.
  const newModelValue = JSON.parse(JSON.stringify(props.modelValue));

  // Ensure path exists in the new object
  const fields = path.split('.');
  let current: any = newModelValue;
  for (let i = 0; i < fields.length - 1; i++) {
    const field = fields[i];
    if (current[field] === undefined || current[field] === null) {
      current[field] = {};
    }
    current = current[field];
  }

  current[fields[fields.length - 1]] = value;

  // The parent's v-model will handle this event
  emit('update:modelValue', newModelValue);
}

// Initialize missing data structures on the prop if they don't exist
// This is done once when the component is created to avoid template errors.
if (!props.modelValue.data) {
  props.modelValue.data = {};
}
if (!props.modelValue.data.depth_prompt) {
  props.modelValue.data.depth_prompt = {
    prompt: '',
    depth: depth_prompt_depth_default,
    role: depth_prompt_role_default,
  };
}
if (props.modelValue.talkativeness === undefined) {
  props.modelValue.talkativeness = talkativeness_default;
}

// Drawer states
const isPromptOverridesOpen = ref(false);
const isMetadataOpen = ref(false);

// Popup state for maximizing editors
type EditableField =
  | 'personality'
  | 'scenario'
  | 'mes_example'
  | 'data.system_prompt'
  | 'data.post_history_instructions'
  | 'data.creator_notes'
  | 'data.depth_prompt.prompt';
const isEditorPopupVisible = ref(false);
const editorPopupValue = ref('');
const editingFieldName = ref<EditableField | null>(null);
const editorPopupOptions = ref<PopupOptions>({});
const editorPopupTitle = ref('');

// --- Transition Hooks for Drawers ---
const { beforeEnter, enter, afterEnter, beforeLeave, leave, afterLeave } = slideTransitionHooks;

const characterName = computed(() => props.modelValue.name);
const joinedTags = computed({
  get: () => props.modelValue.tags?.join(', ') || '',
  set: (value) => {
    updateValue(
      'tags',
      value.split(',').map((t) => t.trim()),
    );
  },
});

function openMaximizeEditor(fieldName: EditableField, title: string) {
  editingFieldName.value = fieldName;
  editorPopupTitle.value = t('advancedDefinitions.editingTitle', { title });
  editorPopupValue.value = get(props.modelValue, fieldName) ?? '';
  editorPopupOptions.value = { wide: true, large: true, okButton: 'OK', cancelButton: false };
  isEditorPopupVisible.value = true;
}

function handleEditorSubmit({ value }: { value: string }) {
  if (editingFieldName.value) {
    updateValue(editingFieldName.value, value);
  }
}

function close() {
  emit('close');
}
</script>

<template>
  <div class="advanced-definitions-popup__wrapper" @click.self="close">
    <div v-if="modelValue.data" class="advanced-definitions-popup">
      <header class="advanced-definitions-popup__header">
        <h3>{{ t('advancedDefinitions.title', { characterName }) }}</h3>
        <div class="advanced-definitions-popup__close-button fa-solid fa-circle-xmark" @click="close"></div>
      </header>
      <hr />

      <div class="advanced-definitions-popup__content">
        <!-- Prompt Overrides Drawer -->
        <div class="inline-drawer">
          <div class="inline-drawer-header" @click="isPromptOverridesOpen = !isPromptOverridesOpen">
            <h4 class="inline-drawer-header__title">
              {{ t('advancedDefinitions.promptOverrides') }}
              <small>{{ t('advancedDefinitions.promptOverridesHint') }}</small>
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
                <small>{{ t('advancedDefinitions.promptHint') }}</small>
                <div>
                  <label>
                    <span>{{ t('advancedDefinitions.mainPrompt') }}</span>
                    <i
                      class="editor-maximize-icon fa-solid fa-maximize"
                      :title="$t('characterEditor.expandEditor')"
                      @click="openMaximizeEditor('data.system_prompt', t('advancedDefinitions.mainPrompt'))"
                    ></i>
                  </label>
                  <textarea
                    :value="modelValue.data.system_prompt"
                    @input="updateValue('data.system_prompt', ($event.target as HTMLTextAreaElement).value)"
                    class="text-pole"
                    rows="3"
                    :placeholder="t('advancedDefinitions.mainPromptPlaceholder')"
                  ></textarea>
                  <div class="token-counter">
                    {{ t('common.tokens') }}: <span>{{ tokenCounts['data.system_prompt'] || 0 }}</span>
                  </div>
                </div>
                <div>
                  <label>
                    <span>{{ t('advancedDefinitions.postHistoryInstructions') }}</span>
                    <i
                      class="editor-maximize-icon fa-solid fa-maximize"
                      :title="$t('characterEditor.expandEditor')"
                      @click="
                        openMaximizeEditor(
                          'data.post_history_instructions',
                          t('advancedDefinitions.postHistoryInstructions'),
                        )
                      "
                    ></i>
                  </label>
                  <textarea
                    :value="modelValue.data.post_history_instructions"
                    @input="updateValue('data.post_history_instructions', ($event.target as HTMLTextAreaElement).value)"
                    class="text-pole"
                    rows="3"
                    :placeholder="t('advancedDefinitions.postHistoryInstructionsPlaceholder')"
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

        <!-- Creator's Metadata Drawer -->
        <div class="inline-drawer">
          <div class="inline-drawer-header" @click="isMetadataOpen = !isMetadataOpen">
            <h4 class="inline-drawer-header__title">
              {{ t('advancedDefinitions.metadata') }} <small>{{ t('advancedDefinitions.metadataHint') }}</small>
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
                <small>{{ t('advancedDefinitions.metadataOptional') }}</small>
                <div class="u-flex u-flex-nowrap">
                  <div class="u-w-full">
                    <label>{{ t('advancedDefinitions.createdBy') }}</label>
                    <textarea
                      :value="modelValue.data.creator"
                      @input="updateValue('data.creator', ($event.target as HTMLTextAreaElement).value)"
                      class="text-pole"
                      rows="2"
                      :placeholder="t('advancedDefinitions.createdByPlaceholder')"
                    ></textarea>
                  </div>
                  <div class="u-w-full">
                    <label>{{ t('advancedDefinitions.characterVersion') }}</label>
                    <textarea
                      :value="modelValue.data.character_version"
                      @input="updateValue('data.character_version', ($event.target as HTMLTextAreaElement).value)"
                      class="text-pole"
                      rows="2"
                      :placeholder="t('advancedDefinitions.characterVersionPlaceholder')"
                    ></textarea>
                  </div>
                </div>
                <div class="u-flex u-flex-nowrap">
                  <div class="u-w-full">
                    <label>
                      <span>{{ t('advancedDefinitions.creatorNotes') }}</span>
                      <i
                        class="editor-maximize-icon fa-solid fa-maximize"
                        :title="$t('characterEditor.expandEditor')"
                        @click="openMaximizeEditor('data.creator_notes', t('advancedDefinitions.creatorNotes'))"
                      ></i>
                    </label>
                    <textarea
                      :value="modelValue.data.creator_notes"
                      @input="updateValue('data.creator_notes', ($event.target as HTMLTextAreaElement).value)"
                      class="text-pole"
                      rows="4"
                      :placeholder="t('advancedDefinitions.creatorNotesPlaceholder')"
                    ></textarea>
                  </div>
                  <div class="u-w-full">
                    <label>{{ t('advancedDefinitions.tagsToEmbed') }}</label>
                    <textarea
                      v-model="joinedTags"
                      class="text-pole"
                      rows="4"
                      :placeholder="t('advancedDefinitions.tagsToEmbedPlaceholder')"
                    ></textarea>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <hr />

        <!-- Other fields -->
        <div class="advanced-definitions-popup__section">
          <label
            ><span>{{ t('advancedDefinitions.personality') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="$t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('personality', t('advancedDefinitions.personality'))"
            ></i>
          </label>
          <textarea
            :value="modelValue.personality"
            @input="updateValue('personality', ($event.target as HTMLTextAreaElement).value)"
            class="text-pole"
            rows="4"
            :placeholder="t('advancedDefinitions.personalityPlaceholder')"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['personality'] || 0 }}</span>
          </div>
        </div>
        <div class="advanced-definitions-popup__section">
          <label>
            <span>{{ t('advancedDefinitions.scenario') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="$t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('scenario', t('advancedDefinitions.scenario'))"
            ></i>
          </label>
          <textarea
            :value="modelValue.scenario"
            @input="updateValue('scenario', ($event.target as HTMLTextAreaElement).value)"
            class="text-pole"
            rows="4"
            :placeholder="t('advancedDefinitions.scenarioPlaceholder')"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['scenario'] || 0 }}</span>
          </div>
        </div>
        <div class="advanced-definitions-popup__section character-note">
          <div class="u-w-full">
            <label>
              <span>{{ t('advancedDefinitions.characterNote') }}</span>
              <i
                class="editor-maximize-icon fa-solid fa-maximize"
                :title="$t('characterEditor.expandEditor')"
                @click="openMaximizeEditor('data.depth_prompt.prompt', t('advancedDefinitions.characterNote'))"
              ></i>
            </label>
            <textarea
              :value="modelValue.data.depth_prompt!.prompt"
              @input="updateValue('data.depth_prompt.prompt', ($event.target as HTMLTextAreaElement).value)"
              class="text-pole"
              rows="5"
              :placeholder="t('advancedDefinitions.characterNotePlaceholder')"
            ></textarea>
          </div>
          <div>
            <label>{{ t('advancedDefinitions.depth') }}</label>
            <input
              :value="modelValue.data.depth_prompt!.depth"
              @input="updateValue('data.depth_prompt.depth', ($event.target as HTMLInputElement).valueAsNumber)"
              type="number"
              min="0"
              max="9999"
              class="text-pole"
            />
            <label>{{ t('advancedDefinitions.role') }}</label>
            <select
              :value="modelValue.data.depth_prompt!.role"
              @change="updateValue('data.depth_prompt.role', ($event.target as HTMLSelectElement).value)"
              class="text-pole"
            >
              <option value="system">{{ $t('advancedDefinitions.roles.system') }}</option>
              <option value="user">{{ $t('advancedDefinitions.roles.user') }}</option>
              <option value="assistant">{{ $t('advancedDefinitions.roles.assistant') }}</option>
            </select>
          </div>
        </div>
        <div class="advanced-definitions-popup__section">
          <label>{{ t('advancedDefinitions.talkativeness') }}</label>
          <small>{{ t('advancedDefinitions.talkativenessHint') }}</small>
          <input
            :value="modelValue.talkativeness"
            @input="updateValue('talkativeness', ($event.target as HTMLInputElement).valueAsNumber)"
            type="range"
            min="0"
            max="1"
            step="0.05"
          />
          <div class="slider-hint">
            <span>{{ t('advancedDefinitions.talkativenessShy') }}</span>
            <span>{{ t('advancedDefinitions.talkativenessNormal') }}</span>
            <span>{{ t('advancedDefinitions.talkativenessChatty') }}</span>
          </div>
        </div>
        <hr />
        <div class="advanced-definitions-popup__section">
          <label>
            <span>{{ t('advancedDefinitions.dialogueExamples') }}</span>
            <i
              class="editor-maximize-icon fa-solid fa-maximize"
              :title="$t('characterEditor.expandEditor')"
              @click="openMaximizeEditor('mes_example', t('advancedDefinitions.dialogueExamples'))"
            ></i>
          </label>
          <small>{{ t('advancedDefinitions.dialogueExamplesHint') }}</small>
          <textarea
            :value="modelValue.mes_example"
            @input="updateValue('mes_example', ($event.target as HTMLTextAreaElement).value)"
            class="text-pole"
            rows="6"
            :placeholder="t('advancedDefinitions.dialogueExamplesPlaceholder')"
          ></textarea>
          <div class="token-counter">
            {{ t('common.tokens') }}: <span>{{ tokenCounts['mes_example'] || 0 }}</span>
          </div>
        </div>
      </div>
    </div>
    <Popup
      id="advanced-definitions-editor-popup"
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
