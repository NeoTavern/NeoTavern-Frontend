<script setup lang="ts">
import { cloneDeep } from 'lodash-es';
import { computed, ref, shallowRef } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import type { MessageRole, StrictOmitString } from '../../types';
import type { KnownPromptIdentifiers, Prompt } from '../../types/settings';
import { DraggableList, EmptyState } from '../common';
import { Button, FormItem, Input, Select, Textarea } from '../UI';
import GlobalPromptManager from './GlobalPromptManager.vue';

const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const { t } = useStrictI18n();

const expandedPrompts = ref(new Set<string>());

const presetPrompts = computed<Prompt[]>({
  get: () => settingsStore.settings.api.samplers.prompts || [],
  set: (val) => (settingsStore.settings.api.samplers.prompts = val),
});

const roleOptions = [
  { label: 'System', value: 'system' },
  { label: 'User', value: 'user' },
  { label: 'Assistant', value: 'assistant' },
];

const selectedLibraryPrompt = ref<string>('');

const libraryOptions = computed(() => {
  const globalPrompts = settingsStore.settings.prompts || [];
  return [
    { label: t('aiConfig.promptManager.selectFromLibrary'), value: '' },
    ...globalPrompts
      .filter((p) => presetPrompts.value.every((pp) => pp.identifier !== p.identifier && pp.name !== p.name))
      .map((p) => ({
        label: p.name,
        value: p.identifier,
      })),
  ];
});

function openGlobalManager() {
  popupStore.show({
    component: shallowRef(GlobalPromptManager),
    wide: true,
  });
}

function addFromLibrary(identifier: string | string[]) {
  if (!identifier) return;

  const original = settingsStore.settings.prompts.find((p) => p.identifier === identifier);
  if (!original) return;

  const clone: Prompt = cloneDeep(original);
  clone.identifier = original.identifier;
  if (!original.marker) {
    clone.identifier += `-${Date.now()}` as KnownPromptIdentifiers;
  }
  clone.enabled = true;

  presetPrompts.value = [...presetPrompts.value, clone];
  selectedLibraryPrompt.value = '';

  expandedPrompts.value.add(clone.identifier);
}

function createNewPrompt() {
  const id = `custom-${Date.now()}`;
  const newPrompt: Prompt = {
    name: 'New Prompt',
    identifier: id as KnownPromptIdentifiers,
    content: '',
    role: 'system',
    enabled: true,
    marker: false,
  };

  presetPrompts.value = [...presetPrompts.value, newPrompt];
  expandedPrompts.value.add(id);
}

function deletePrompt(identifier: string) {
  presetPrompts.value = presetPrompts.value.filter((x) => x.identifier !== identifier);
  expandedPrompts.value.delete(identifier);
}

function toggleExpand(identifier: string) {
  if (expandedPrompts.value.has(identifier)) {
    expandedPrompts.value.delete(identifier);
  } else {
    expandedPrompts.value.add(identifier);
  }
}

function toggleEnabled(index: number) {
  presetPrompts.value[index].enabled = !presetPrompts.value[index].enabled;
}

function updatePromptField(
  index: number,
  field: keyof Prompt,
  value: string | number | StrictOmitString<MessageRole, 'tool'>,
) {
  // @ts-expect-error Dynamic assignment
  presetPrompts.value[index][field] = value;
}

function getBadgeClass(role?: StrictOmitString<MessageRole, 'tool'>) {
  switch (role) {
    case 'system':
      return 'prompt-item-badge--system';
    case 'user':
      return 'prompt-item-badge--user';
    case 'assistant':
      return 'prompt-item-badge--assistant';
    default:
      return '';
  }
}
</script>

<template>
  <div class="prompt-manager">
    <div class="prompt-manager-header">
      <div class="prompt-manager-actions-row">
        <div style="flex-grow: 1">
          <Select
            v-model="selectedLibraryPrompt"
            :options="libraryOptions"
            searchable
            :placeholder="t('aiConfig.promptManager.addFromLibrary')"
            @update:model-value="addFromLibrary"
          />
        </div>

        <Button :title="t('aiConfig.promptManager.globalPrompts')" icon="fa-book" @click="openGlobalManager" />
      </div>

      <div class="prompt-manager-create-row">
        <Button icon="fa-plus" class="full-width" @click="createNewPrompt">
          {{ t('aiConfig.promptManager.newPrompt') }}
        </Button>
      </div>
    </div>

    <div class="prompt-manager-list-container">
      <DraggableList
        :items="presetPrompts"
        item-key="identifier"
        handle-class="prompt-item-drag-handle"
        class="prompt-manager-list"
        @update:items="(items) => (presetPrompts = items)"
      >
        <template #default="{ item: prompt, index }">
          <div
            class="prompt-item"
            :class="{
              disabled: !prompt.enabled,
              'is-editing': expandedPrompts.has(prompt.identifier),
            }"
            :data-identifier="prompt.identifier"
          >
            <!-- Header Row -->
            <div class="prompt-item-header">
              <div class="prompt-item-actions">
                <div
                  class="menu-button fa-solid fa-grip-lines prompt-item-drag-handle"
                  :title="t('common.dragToReorder')"
                ></div>
              </div>

              <div class="prompt-item-info" @click="toggleExpand(prompt.identifier)">
                <span class="prompt-item-name">{{ prompt.name }}</span>
                <div class="prompt-item-badges">
                  <span class="prompt-item-badge" :class="getBadgeClass(prompt.role)">{{ prompt.role }}</span>
                </div>
              </div>

              <div class="prompt-item-actions">
                <Button
                  :icon="prompt.enabled ? 'fa-toggle-on' : 'fa-toggle-off'"
                  variant="ghost"
                  :title="t('common.toggle')"
                  @click.stop="toggleEnabled(index)"
                />

                <Button icon="fa-trash" variant="danger" @click.stop="deletePrompt(prompt.identifier)" />
              </div>
            </div>

            <!-- Editor Row (Expandable) -->
            <div v-if="expandedPrompts.has(prompt.identifier)" class="prompt-item-editor">
              <FormItem :label="t('common.name')">
                <Input :model-value="prompt.name" @update:model-value="(v) => updatePromptField(index, 'name', v)" />
              </FormItem>

              <FormItem :label="t('aiConfig.promptManager.role')">
                <Select
                  :model-value="prompt.role || 'system'"
                  :options="roleOptions"
                  @update:model-value="
                    (v) => updatePromptField(index, 'role', v as StrictOmitString<MessageRole, 'tool'>)
                  "
                />
              </FormItem>

              <FormItem :label="t('aiConfig.promptManager.content')">
                <Textarea
                  v-show="!prompt.marker"
                  allow-maximize
                  identifier="prompt.content"
                  :model-value="prompt.content || ''"
                  :rows="5"
                  @update:model-value="(v) => updatePromptField(index, 'content', v)"
                />
                <div v-show="prompt.marker" class="prompt-empty-state">
                  {{ t('aiConfig.promptManager.markerHint') }}
                </div>
              </FormItem>
            </div>
          </div>
        </template>
      </DraggableList>

      <EmptyState
        v-if="presetPrompts.length === 0"
        icon="fa-layer-group"
        :description="t('aiConfig.promptManager.noPrompts')"
      />
    </div>
  </div>
</template>
