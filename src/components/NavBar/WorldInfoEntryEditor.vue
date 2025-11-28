<script setup lang="ts">
import { type PropType, computed } from 'vue';
import {
  Button,
  Checkbox,
  CollapsibleSection,
  FormItem,
  Icon,
  Input,
  Select,
  TagInput,
  Textarea,
} from '../../components/UI';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { WorldInfoPosition } from '../../constants';
import { usePopupStore } from '../../stores/popup.store';
import { useWorldInfoUiStore } from '../../stores/world-info-ui.store';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { POPUP_RESULT, POPUP_TYPE, type WorldInfoEntry } from '../../types';

const props = defineProps({
  modelValue: {
    type: Object as PropType<WorldInfoEntry>,
    required: false,
    default: null,
  },
  showHeader: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['update:modelValue']);
const { t } = useStrictI18n();
const worldInfoStore = useWorldInfoStore();
const worldInfoUiStore = useWorldInfoUiStore();
const popupStore = usePopupStore();

const isAtDepth = computed(() => props.modelValue?.position === WorldInfoPosition.AT_DEPTH);
const isOutlet = computed(() => props.modelValue?.position === WorldInfoPosition.OUTLET);

function updateValue<K extends keyof WorldInfoEntry>(key: K, value: WorldInfoEntry[K]) {
  if (props.modelValue) {
    emit('update:modelValue', { ...props.modelValue, [key]: value });
  }
}

const entryState = computed({
  get() {
    if (props.modelValue?.constant) return 'constant';
    return 'normal';
  },
  set(value: 'constant' | 'normal') {
    switch (value) {
      case 'constant':
        updateValue('constant', true);
        break;
      case 'normal':
      default:
        updateValue('constant', false);
        break;
    }
  },
});

async function handleDeleteEntry() {
  const { result } = await popupStore.show({
    title: t('worldInfo.popup.deleteEntryTitle'),
    content: t('worldInfo.popup.deleteEntryContent', { name: props.modelValue?.comment }),
    type: POPUP_TYPE.CONFIRM,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && worldInfoUiStore.selectedFilename && props.modelValue) {
    await worldInfoStore.deleteEntry(worldInfoUiStore.selectedFilename, props.modelValue.uid);
    worldInfoUiStore.selectItem('global-settings');
  }
}

async function handleDuplicateEntry() {
  if (worldInfoUiStore.selectedFilename && props.modelValue) {
    const newUid = await worldInfoStore.duplicateEntry(worldInfoUiStore.selectedFilename, props.modelValue);
    if (newUid) {
      worldInfoUiStore.selectItem(`${worldInfoUiStore.selectedFilename}/${newUid}`);
    }
  }
}

const stateOptions = [
  { label: t('worldInfo.entry.entryStates.constant'), value: 'constant' },
  { label: t('worldInfo.entry.entryStates.normal'), value: 'normal' },
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
    <div v-if="props.showHeader" class="main-page-header">
      <div class="main-page-header-main">
        <!-- Toggle Icon -->
        <div
          class="toggle-icon-wrapper"
          :title="t('worldInfo.entry.toggle')"
          @click="updateValue('disable', !modelValue?.disable)"
        >
          <Icon :icon="modelValue?.disable ? 'fa-toggle-off' : 'fa-toggle-on'" />
        </div>

        <!-- Title Input (Using Input but ensuring it grows) -->
        <div style="flex-grow: 1">
          <Textarea
            :model-value="modelValue?.comment || ''"
            :rows="1"
            :placeholder="t('worldInfo.entry.titlePlaceholder')"
            :resizable="false"
            @update:model-value="updateValue('comment', $event)"
          />
        </div>
      </div>

      <div class="main-page-header-actions">
        <Button variant="ghost" icon="fa-right-left" :title="t('worldInfo.entry.move')" />
        <Button variant="ghost" icon="fa-paste" :title="t('worldInfo.entry.duplicate')" @click="handleDuplicateEntry" />
        <Button icon="fa-trash-can" variant="danger" :title="t('worldInfo.entry.delete')" @click="handleDeleteEntry" />
      </div>
    </div>

    <div class="world-entry-editor-form">
      <slot name="inline-header"></slot>
      <!-- Top Grid: State, Position, Order, Probability -->
      <div class="world-entry-editor-grid">
        <FormItem :label="t('worldInfo.entry.entryState')">
          <Select v-model="entryState" :options="stateOptions" />
        </FormItem>

        <FormItem :label="t('worldInfo.entry.positionLabel')">
          <Select
            :model-value="modelValue?.position ?? WorldInfoPosition.BEFORE_CHAR"
            :options="positionOptions"
            :title="t('worldInfo.entry.positionTooltip')"
            @update:model-value="(val) => updateValue('position', val as WorldInfoPosition)"
          />
        </FormItem>

        <FormItem v-show="isAtDepth" :label="t('worldInfo.entry.depth')">
          <Input
            type="number"
            :model-value="modelValue?.depth ?? 0"
            :placeholder="t('worldInfo.entry.depth')"
            @update:model-value="(val) => updateValue('depth', Number(val))"
          />
        </FormItem>

        <FormItem v-if="isOutlet" :label="t('worldInfo.entry.outletName')">
          <Input
            :model-value="modelValue?.outletName ?? ''"
            :placeholder="t('worldInfo.entry.outletName')"
            @update:model-value="(val) => updateValue('outletName', String(val))"
          />
        </FormItem>

        <FormItem :label="t('worldInfo.entry.order')">
          <Input
            type="number"
            :model-value="modelValue?.order ?? 0"
            :placeholder="t('worldInfo.entry.order')"
            @update:model-value="(val) => updateValue('order', Number(val))"
          />
        </FormItem>

        <FormItem :label="t('worldInfo.entry.trigger')">
          <Input
            type="number"
            :model-value="modelValue?.probability ?? 100"
            :placeholder="t('worldInfo.entry.trigger')"
            :min="0"
            :max="100"
            @update:model-value="(val) => updateValue('probability', Number(val))"
          />
        </FormItem>

        <FormItem :label="t('worldInfo.entry.delay')">
          <Input
            type="number"
            :model-value="modelValue?.delay ?? 0"
            :placeholder="t('worldInfo.entry.delay')"
            :min="0"
            @update:model-value="(val) => updateValue('delay', Number(val))"
          />
        </FormItem>

        <FormItem :label="t('worldInfo.scanDepth')">
          <!-- @vue-ignore -->
          <Input
            type="number"
            :model-value="modelValue?.scanDepth ?? null"
            :placeholder="t('common.global')"
            @update:model-value="(val) => updateValue('scanDepth', val === '' ? null : Number(val))"
          />
        </FormItem>
      </div>

      <!-- Keywords Section -->
      <div class="world-entry-editor-section">
        <div class="control-group flex-1">
          <FormItem :label="t('worldInfo.entry.keywordsPlaceholder')">
            <TagInput
              :model-value="modelValue?.key || []"
              :placeholder="t('worldInfo.entry.keywordsPlaceholder')"
              @update:model-value="(val) => updateValue('key', val)"
            />
          </FormItem>
          <div class="world-entry-editor-section" style="margin-top: 4px; gap: 12px">
            <Checkbox
              :model-value="modelValue?.matchWholeWords ?? false"
              :label="t('worldInfo.entry.matchWholeWords')"
              @update:model-value="updateValue('matchWholeWords', $event)"
            />
            <Checkbox
              :model-value="modelValue?.caseSensitive ?? false"
              :label="t('worldInfo.entry.caseSensitive')"
              @update:model-value="updateValue('caseSensitive', $event)"
            />
          </div>
        </div>

        <div class="control-group" style="min-width: 150px">
          <FormItem :label="t('worldInfo.entry.logic')">
            <Select
              :model-value="modelValue?.selectiveLogic ?? 0"
              :options="logicOptions"
              @update:model-value="(val) => updateValue('selectiveLogic', Number(val))"
            />
          </FormItem>
        </div>

        <div class="control-group flex-1">
          <FormItem :label="t('worldInfo.entry.filterPlaceholder')">
            <TagInput
              :model-value="modelValue?.keysecondary || []"
              :placeholder="t('worldInfo.entry.filterPlaceholder')"
              @update:model-value="(val) => updateValue('keysecondary', val)"
            />
          </FormItem>
        </div>
      </div>

      <!-- Content Section -->
      <div class="world-entry-editor-section--column">
        <FormItem :label="t('worldInfo.entry.content')">
          <Textarea
            :model-value="modelValue?.content ?? ''"
            :rows="8"
            :placeholder="t('worldInfo.entry.contentPlaceholder')"
            @update:model-value="updateValue('content', $event)"
          >
            <template #footer>
              <small class="uid-label">UID: {{ modelValue?.uid }}</small>
            </template>
          </Textarea>
        </FormItem>
      </div>

      <!-- Advanced Sections -->
      <CollapsibleSection :title="t('worldInfo.entry.groupSettings')">
        <div class="world-entry-editor-grid">
          <FormItem :label="t('worldInfo.entry.group')">
            <Input
              :model-value="modelValue?.group ?? ''"
              @update:model-value="(val) => updateValue('group', String(val))"
            />
          </FormItem>
          <FormItem :label="t('worldInfo.entry.groupWeight')">
            <Input
              type="number"
              :model-value="modelValue?.groupWeight ?? 100"
              @update:model-value="(val) => updateValue('groupWeight', Number(val))"
            />
          </FormItem>
          <FormItem>
            <Checkbox
              :model-value="modelValue?.groupOverride ?? false"
              :label="t('worldInfo.entry.groupOverride')"
              @update:model-value="updateValue('groupOverride', $event)"
            />
          </FormItem>
        </div>
      </CollapsibleSection>

      <CollapsibleSection :title="t('worldInfo.entry.recursionSettings')">
        <div class="world-entry-editor-section">
          <FormItem :label="t('worldInfo.entry.delayUntilRecursion')">
            <Input
              type="number"
              :model-value="Number(modelValue?.delayUntilRecursion ?? 0)"
              :min="0"
              @update:model-value="(val) => updateValue('delayUntilRecursion', Number(val))"
            />
          </FormItem>
          <div class="control-group">
            <Checkbox
              :model-value="modelValue?.preventRecursion ?? false"
              :label="t('worldInfo.entry.preventRecursion')"
              @update:model-value="updateValue('preventRecursion', $event)"
            />
            <Checkbox
              :model-value="modelValue?.excludeRecursion ?? false"
              :label="t('worldInfo.entry.excludeRecursion')"
              @update:model-value="updateValue('excludeRecursion', $event)"
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection :title="t('worldInfo.entry.characterFilters')">
        <div class="world-entry-editor-section--column">
          <FormItem :label="t('worldInfo.entry.filterCharNames')">
            <TagInput
              :model-value="modelValue?.characterFilterNames || []"
              @update:model-value="(val) => updateValue('characterFilterNames', val)"
            />
          </FormItem>
          <FormItem :label="t('worldInfo.entry.filterCharTags')">
            <TagInput
              :model-value="modelValue?.characterFilterTags || []"
              @update:model-value="(val) => updateValue('characterFilterTags', val)"
            />
          </FormItem>
          <Checkbox
            :model-value="modelValue?.characterFilterExclude ?? false"
            :label="t('worldInfo.entry.filterCharExclude')"
            @update:model-value="updateValue('characterFilterExclude', $event)"
          />
        </div>
      </CollapsibleSection>

      <!-- Collapsible Additional Sources -->
      <CollapsibleSection :title="t('worldInfo.entry.additionalSources')">
        <div class="world-entry-editor-checkbox-grid">
          <Checkbox
            :model-value="modelValue?.matchCharacterDescription ?? false"
            :label="t('worldInfo.entry.charDescription')"
            @update:model-value="updateValue('matchCharacterDescription', $event)"
          />
          <Checkbox
            :model-value="modelValue?.matchPersonaDescription ?? false"
            :label="t('worldInfo.entry.personaDescription')"
            @update:model-value="updateValue('matchPersonaDescription', $event)"
          />
          <Checkbox
            :model-value="modelValue?.matchCharacterPersonality ?? false"
            :label="t('worldInfo.entry.charPersonality')"
            @update:model-value="updateValue('matchCharacterPersonality', $event)"
          />
          <Checkbox
            :model-value="modelValue?.matchCharacterDepthPrompt ?? false"
            :label="t('worldInfo.entry.charNote')"
            @update:model-value="updateValue('matchCharacterDepthPrompt', $event)"
          />
          <Checkbox
            :model-value="modelValue?.matchScenario ?? false"
            :label="t('worldInfo.entry.scenario')"
            @update:model-value="updateValue('matchScenario', $event)"
          />
          <Checkbox
            :model-value="modelValue?.matchCreatorNotes ?? false"
            :label="t('worldInfo.entry.creatorNotes')"
            @update:model-value="updateValue('matchCreatorNotes', $event)"
          />
          <Checkbox
            :model-value="modelValue?.ignoreBudget ?? false"
            :label="t('worldInfo.entry.ignoreBudget')"
            @update:model-value="updateValue('ignoreBudget', $event)"
          />
        </div>
      </CollapsibleSection>
    </div>
  </div>
</template>
