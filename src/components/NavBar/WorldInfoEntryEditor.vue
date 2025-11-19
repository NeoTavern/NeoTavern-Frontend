<script setup lang="ts">
import { ref, type PropType, computed } from 'vue';
import { WorldInfoPosition, type WorldInfoEntry } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { slideTransitionHooks } from '../../utils/dom';
import { useWorldInfoStore } from '../../stores/world-info.store';

const props = defineProps({
  modelValue: {
    type: Object as PropType<WorldInfoEntry>,
    required: false,
    default: null,
  },
});

const emit = defineEmits(['update:modelValue']);
const { t } = useStrictI18n();
const worldInfoStore = useWorldInfoStore();
const { beforeEnter, enter, afterEnter, beforeLeave, leave } = slideTransitionHooks;

const isAdditionalSourcesExpanded = ref(false);
const isAtDepth = computed(() => props.modelValue?.position === WorldInfoPosition.AT_DEPTH);

function updateValue<K extends keyof WorldInfoEntry>(key: K, value: WorldInfoEntry[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

const entryState = computed({
  get() {
    if (props.modelValue?.constant) return 'constant';
    if (props.modelValue?.vectorized) return 'vectorized';
    return 'normal';
  },
  set(value: 'constant' | 'normal' | 'vectorized') {
    switch (value) {
      case 'constant':
        updateValue('constant', true);
        updateValue('vectorized', false);
        break;
      case 'vectorized':
        updateValue('constant', false);
        updateValue('vectorized', true);
        break;
      case 'normal':
      default:
        updateValue('constant', false);
        updateValue('vectorized', false);
        break;
    }
  },
});
</script>

<template>
  <div class="world-entry-editor" :class="{ 'is-disabled': modelValue?.disable }">
    <div class="editor-header">
      <div class="editor-header-main">
        <!-- TODO: This should be near item in WorldInfoDrawer -->
        <i
          class="fa-solid"
          :class="modelValue?.disable ? 'fa-toggle-off' : 'fa-toggle-on'"
          :title="t('worldInfo.entry.toggle')"
          @click="updateValue('disable', !modelValue?.disable)"
        ></i>
        <textarea
          class="text-pole"
          rows="1"
          :value="modelValue?.comment"
          :placeholder="t('worldInfo.entry.titlePlaceholder')"
          @input="updateValue('comment', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
      </div>
      <div class="editor-header-actions">
        <i class="menu-button fa-solid fa-right-left" :title="t('worldInfo.entry.move')"></i>
        <i
          class="menu-button fa-solid fa-paste"
          :title="t('worldInfo.entry.duplicate')"
          @click="worldInfoStore.duplicateSelectedEntry"
        ></i>
        <i
          class="menu-button fa-solid fa-trash-can"
          :title="t('worldInfo.entry.delete')"
          @click="worldInfoStore.deleteSelectedEntry"
        ></i>
      </div>
    </div>
    <form class="world-entry-editor-form">
      <div class="world-entry-editor-grid">
        <select v-model="entryState" class="text-pole" :title="t('worldInfo.entry.entryState')">
          <option value="constant">{{ t('worldInfo.entry.entryStates.constant') }}</option>
          <option value="normal">{{ t('worldInfo.entry.entryStates.normal') }}</option>
          <option value="vectorized">{{ t('worldInfo.entry.entryStates.vectorized') }}</option>
        </select>

        <select
          class="text-pole"
          :title="t('worldInfo.entry.positionTooltip')"
          :value="modelValue?.position"
          @change="updateValue('position', Number(($event.target as HTMLSelectElement).value) as WorldInfoPosition)"
        >
          <option :value="WorldInfoPosition.BEFORE_CHAR">{{ t('worldInfo.entry.positionOptions.beforeChar') }}</option>
          <option :value="WorldInfoPosition.AFTER_CHAR">{{ t('worldInfo.entry.positionOptions.afterChar') }}</option>
          <option :value="WorldInfoPosition.BEFORE_EM">{{ t('worldInfo.entry.positionOptions.beforeEM') }}</option>
          <option :value="WorldInfoPosition.AFTER_EM">{{ t('worldInfo.entry.positionOptions.afterEM') }}</option>
          <option :value="WorldInfoPosition.BEFORE_AN">{{ t('worldInfo.entry.positionOptions.beforeAN') }}</option>
          <option :value="WorldInfoPosition.AFTER_AN">{{ t('worldInfo.entry.positionOptions.afterAN') }}</option>
          <option :value="WorldInfoPosition.AT_DEPTH">{{ t('worldInfo.entry.positionOptions.atDepthSystem') }}</option>
          <option :value="WorldInfoPosition.OUTLET">{{ t('worldInfo.entry.positionOptions.outlet') }}</option>
        </select>
        <input
          v-show="isAtDepth"
          type="number"
          class="text-pole"
          :title="t('worldInfo.entry.depth')"
          :value="modelValue?.depth"
          @input="updateValue('depth', Number(($event.target as HTMLInputElement).value))"
        />
        <input
          type="number"
          class="text-pole"
          :title="t('worldInfo.entry.order')"
          :value="modelValue?.order"
          @input="updateValue('order', Number(($event.target as HTMLInputElement).value))"
        />
        <input
          type="number"
          class="text-pole"
          :title="t('worldInfo.entry.trigger')"
          :value="modelValue?.probability"
          min="0"
          max="100"
          @input="updateValue('probability', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <div class="world-entry-editor-section">
        <div class="control-group flex-1">
          <small>{{ t('worldInfo.entry.primaryKeywords') }}</small>
          <textarea
            class="text-pole"
            rows="1"
            :value="modelValue?.key.join(', ')"
            :placeholder="t('worldInfo.entry.keywordsPlaceholder')"
            @input="
              updateValue(
                'key',
                ($event.target as HTMLTextAreaElement).value.split(',').map((k) => k.trim()),
              )
            "
          ></textarea>
        </div>
        <div class="control-group">
          <small>{{ t('worldInfo.entry.logic') }}</small>
          <select
            class="text-pole"
            :value="modelValue?.selectiveLogic"
            @change="updateValue('selectiveLogic', Number(($event.target as HTMLSelectElement).value))"
          >
            <option value="0">{{ t('worldInfo.entry.logicOptions.andAny') }}</option>
            <option value="3">{{ t('worldInfo.entry.logicOptions.andAll') }}</option>
            <option value="1">{{ t('worldInfo.entry.logicOptions.notAll') }}</option>
            <option value="2">{{ t('worldInfo.entry.logicOptions.notAny') }}</option>
          </select>
        </div>
        <div class="control-group flex-1">
          <small>{{ t('worldInfo.entry.optionalFilter') }}</small>
          <textarea
            class="text-pole"
            rows="1"
            :value="modelValue?.keysecondary.join(', ')"
            :placeholder="t('worldInfo.entry.filterPlaceholder')"
            @input="
              updateValue(
                'keysecondary',
                ($event.target as HTMLTextAreaElement).value.split(',').map((k) => k.trim()),
              )
            "
          ></textarea>
        </div>
      </div>

      <div class="world-entry-editor-section world-entry-editor-section--column">
        <label class="world-entry-editor-label--with-uid">
          <small>{{ t('worldInfo.entry.content') }}</small>
          <small>(UID: {{ modelValue?.uid }})</small>
        </label>
        <textarea
          class="text-pole"
          rows="8"
          :value="modelValue?.content"
          :placeholder="t('worldInfo.entry.contentPlaceholder')"
          @input="updateValue('content', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
      </div>

      <div class="additional-sources inline-drawer">
        <div class="inline-drawer-header" @click="isAdditionalSourcesExpanded = !isAdditionalSourcesExpanded">
          <b>{{ t('worldInfo.entry.additionalSources') }}</b>
          <div
            class="fa-solid fa-circle-chevron-down inline-drawer-icon"
            :class="{ 'is-open': isAdditionalSourcesExpanded }"
          ></div>
        </div>
        <transition
          name="slide-js"
          @before-enter="beforeEnter"
          @enter="enter"
          @after-enter="afterEnter"
          @before-leave="beforeLeave"
          @leave="leave"
        >
          <div v-show="isAdditionalSourcesExpanded" class="inline-drawer-content world-entry-editor-checkbox-grid">
            <label class="checkbox-label"
              ><input type="checkbox" :checked="modelValue?.matchCharacterDescription" /><span>{{
                t('worldInfo.entry.charDescription')
              }}</span></label
            >
            <label class="checkbox-label"
              ><input type="checkbox" :checked="modelValue?.matchPersonaDescription" /><span>{{
                t('worldInfo.entry.personaDescription')
              }}</span></label
            >
            <label class="checkbox-label"
              ><input type="checkbox" :checked="modelValue?.matchCharacterPersonality" /><span>{{
                t('worldInfo.entry.charPersonality')
              }}</span></label
            >
            <label class="checkbox-label"
              ><input type="checkbox" :checked="modelValue?.matchCharacterDepthPrompt" /><span>{{
                t('worldInfo.entry.charNote')
              }}</span></label
            >
            <label class="checkbox-label"
              ><input type="checkbox" :checked="modelValue?.matchScenario" /><span>{{
                t('worldInfo.entry.scenario')
              }}</span></label
            >
            <label class="checkbox-label"
              ><input type="checkbox" :checked="modelValue?.matchCreatorNotes" /><span>{{
                t('worldInfo.entry.creatorNotes')
              }}</span></label
            >
          </div>
        </transition>
      </div>
    </form>
  </div>
</template>
