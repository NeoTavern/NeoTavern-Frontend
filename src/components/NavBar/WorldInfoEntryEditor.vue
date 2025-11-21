<script setup lang="ts">
import { type PropType, computed } from 'vue';
import { WorldInfoPosition, type WorldInfoEntry } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useWorldInfoStore } from '../../stores/world-info.store';
import {
  AppInput,
  AppTextarea,
  AppSelect,
  AppCheckbox,
  AppIconButton,
  CollapsibleSection,
  AppIcon,
  TagInput,
} from '../../components/UI';

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

const isAtDepth = computed(() => props.modelValue?.position === WorldInfoPosition.AT_DEPTH);

function updateValue<K extends keyof WorldInfoEntry>(key: K, value: WorldInfoEntry[K]) {
  if (props.modelValue) {
    emit('update:modelValue', { ...props.modelValue, [key]: value });
  }
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

const stateOptions = [
  { label: t('worldInfo.entry.entryStates.constant'), value: 'constant' },
  { label: t('worldInfo.entry.entryStates.normal'), value: 'normal' },
  { label: t('worldInfo.entry.entryStates.vectorized'), value: 'vectorized' },
];

const positionOptions = [
  { label: t('worldInfo.entry.positionOptions.beforeChar'), value: WorldInfoPosition.BEFORE_CHAR },
  { label: t('worldInfo.entry.positionOptions.afterChar'), value: WorldInfoPosition.AFTER_CHAR },
  { label: t('worldInfo.entry.positionOptions.beforeEM'), value: WorldInfoPosition.BEFORE_EM },
  { label: t('worldInfo.entry.positionOptions.afterEM'), value: WorldInfoPosition.AFTER_EM },
  { label: t('worldInfo.entry.positionOptions.beforeAN'), value: WorldInfoPosition.BEFORE_AN },
  { label: t('worldInfo.entry.positionOptions.afterAN'), value: WorldInfoPosition.AFTER_AN },
  { label: t('worldInfo.entry.positionOptions.atDepthSystem'), value: WorldInfoPosition.AT_DEPTH },
  { label: t('worldInfo.entry.positionOptions.outlet'), value: WorldInfoPosition.OUTLET },
];

const logicOptions = [
  { label: t('worldInfo.entry.logicOptions.andAny'), value: 0 },
  { label: t('worldInfo.entry.logicOptions.andAll'), value: 3 },
  { label: t('worldInfo.entry.logicOptions.notAll'), value: 1 },
  { label: t('worldInfo.entry.logicOptions.notAny'), value: 2 },
];
</script>

<template>
  <div class="world-entry-editor" :class="{ 'is-disabled': modelValue?.disable }">
    <div class="editor-header">
      <div class="editor-header-main">
        <!-- Toggle Icon -->
        <div
          class="toggle-icon-wrapper"
          :title="t('worldInfo.entry.toggle')"
          @click="updateValue('disable', !modelValue?.disable)"
        >
          <AppIcon :icon="modelValue?.disable ? 'fa-toggle-off' : 'fa-toggle-on'" />
        </div>

        <!-- Title Input (Using AppInput but ensuring it grows) -->
        <div style="flex-grow: 1">
          <AppTextarea
            :model-value="modelValue?.comment || ''"
            :rows="1"
            :placeholder="t('worldInfo.entry.titlePlaceholder')"
            :resizable="false"
            @update:model-value="updateValue('comment', $event)"
          />
        </div>
      </div>

      <div class="editor-header-actions">
        <AppIconButton icon="fa-right-left" :title="t('worldInfo.entry.move')" />
        <AppIconButton
          icon="fa-paste"
          :title="t('worldInfo.entry.duplicate')"
          @click="worldInfoStore.duplicateSelectedEntry"
        />
        <AppIconButton
          icon="fa-trash-can"
          variant="danger"
          :title="t('worldInfo.entry.delete')"
          @click="worldInfoStore.deleteSelectedEntry"
        />
      </div>
    </div>

    <div class="world-entry-editor-form">
      <!-- Top Grid: State, Position, Order, Probability -->
      <div class="world-entry-editor-grid">
        <AppSelect v-model="entryState" :options="stateOptions" :title="t('worldInfo.entry.entryState')" />

        <AppSelect
          :model-value="modelValue?.position ?? WorldInfoPosition.BEFORE_CHAR"
          :options="positionOptions"
          :title="t('worldInfo.entry.positionTooltip')"
          @update:model-value="(val) => updateValue('position', val as WorldInfoPosition)"
        />

        <AppInput
          v-if="isAtDepth"
          type="number"
          :model-value="modelValue?.depth ?? 0"
          :placeholder="t('worldInfo.entry.depth')"
          :title="t('worldInfo.entry.depth')"
          @update:model-value="(val) => updateValue('depth', Number(val))"
        />

        <AppInput
          type="number"
          :model-value="modelValue?.order ?? 0"
          :placeholder="t('worldInfo.entry.order')"
          :title="t('worldInfo.entry.order')"
          @update:model-value="(val) => updateValue('order', Number(val))"
        />

        <AppInput
          type="number"
          :model-value="modelValue?.probability ?? 100"
          :placeholder="t('worldInfo.entry.trigger')"
          :title="t('worldInfo.entry.trigger')"
          :min="0"
          :max="100"
          @update:model-value="(val) => updateValue('probability', Number(val))"
        />
      </div>

      <!-- Keywords Section -->
      <div class="world-entry-editor-section">
        <div class="control-group flex-1">
          <TagInput
            :model-value="modelValue?.key || []"
            :placeholder="t('worldInfo.entry.keywordsPlaceholder')"
            @update:model-value="(val) => updateValue('key', val)"
          />
        </div>

        <div class="control-group" style="min-width: 150px">
          <AppSelect
            :model-value="modelValue?.selectiveLogic ?? 0"
            :options="logicOptions"
            :label="t('worldInfo.entry.logic')"
            @update:model-value="(val) => updateValue('selectiveLogic', Number(val))"
          />
        </div>

        <div class="control-group flex-1">
          <TagInput
            :model-value="modelValue?.keysecondary || []"
            :placeholder="t('worldInfo.entry.filterPlaceholder')"
            @update:model-value="(val) => updateValue('keysecondary', val)"
          />
        </div>
      </div>

      <!-- Content Section -->
      <div class="world-entry-editor-section--column">
        <AppTextarea
          :model-value="modelValue?.content ?? ''"
          :label="t('worldInfo.entry.content')"
          :rows="8"
          :placeholder="t('worldInfo.entry.contentPlaceholder')"
          @update:model-value="updateValue('content', $event)"
        >
          <template #footer>
            <small class="uid-label">UID: {{ modelValue?.uid }}</small>
          </template>
        </AppTextarea>
      </div>

      <!-- Collapsible Additional Sources -->
      <CollapsibleSection :title="t('worldInfo.entry.additionalSources')">
        <div class="world-entry-editor-checkbox-grid">
          <AppCheckbox
            :model-value="modelValue?.matchCharacterDescription ?? false"
            :label="t('worldInfo.entry.charDescription')"
            @update:model-value="updateValue('matchCharacterDescription', $event)"
          />
          <AppCheckbox
            :model-value="modelValue?.matchPersonaDescription ?? false"
            :label="t('worldInfo.entry.personaDescription')"
            @update:model-value="updateValue('matchPersonaDescription', $event)"
          />
          <AppCheckbox
            :model-value="modelValue?.matchCharacterPersonality ?? false"
            :label="t('worldInfo.entry.charPersonality')"
            @update:model-value="updateValue('matchCharacterPersonality', $event)"
          />
          <AppCheckbox
            :model-value="modelValue?.matchCharacterDepthPrompt ?? false"
            :label="t('worldInfo.entry.charNote')"
            @update:model-value="updateValue('matchCharacterDepthPrompt', $event)"
          />
          <AppCheckbox
            :model-value="modelValue?.matchScenario ?? false"
            :label="t('worldInfo.entry.scenario')"
            @update:model-value="updateValue('matchScenario', $event)"
          />
          <AppCheckbox
            :model-value="modelValue?.matchCreatorNotes ?? false"
            :label="t('worldInfo.entry.creatorNotes')"
            @update:model-value="updateValue('matchCreatorNotes', $event)"
          />
        </div>
      </CollapsibleSection>
    </div>
  </div>
</template>
