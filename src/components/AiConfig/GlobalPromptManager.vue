<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import type { KnownPromptIdentifiers, MessageRole, Prompt, StrictOmitString } from '../../types';
import { DraggableList, EmptyState } from '../common';
import { Button, FormItem, Input, Select, Textarea } from '../UI';

const props = defineProps<{
  closePopup?: () => void;
}>();

const settingsStore = useSettingsStore();
const { t } = useStrictI18n();

const prompts = computed({
  get: () => settingsStore.settings.prompts || [],
  set: (val) => (settingsStore.settings.prompts = val),
});

const expandedPrompts = ref(new Set<string>());

const roleOptions = [
  { label: 'System', value: 'system' },
  { label: 'User', value: 'user' },
  { label: 'Assistant', value: 'assistant' },
];

function createNewPrompt() {
  const id = `global-${Date.now()}`;
  const newPrompt: Prompt = {
    name: 'New Global Prompt',
    identifier: id as KnownPromptIdentifiers,
    role: 'system',
    content: '',
    enabled: true,
    marker: false,
  };
  prompts.value = [...prompts.value, newPrompt];
  expandedPrompts.value.add(id);
}

function deletePrompt(identifier: string) {
  const prompt = prompts.value.find((p) => p.identifier === identifier);

  if (prompt?.marker) return;

  prompts.value = prompts.value.filter((p) => p.identifier !== identifier);
  expandedPrompts.value.delete(identifier);
}

function toggleExpand(identifier: string) {
  if (expandedPrompts.value.has(identifier)) {
    expandedPrompts.value.delete(identifier);
  } else {
    expandedPrompts.value.add(identifier);
  }
}

function updatePromptField(index: number, field: keyof Prompt, value: never) {
  (prompts.value[index] as never)[field] = value;
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
  <div class="prompt-manager-popup">
    <div class="prompt-manager-popup-header">
      <h3>{{ t('aiConfig.promptManager.globalPrompts') }}</h3>
      <div class="actions">
        <Button icon="fa-plus" @click="createNewPrompt">
          {{ t('aiConfig.promptManager.newPrompt') }}
        </Button>
        <Button icon="fa-xmark" variant="ghost" @click="props.closePopup?.()" />
      </div>
    </div>

    <div class="prompt-manager-popup-content">
      <DraggableList
        :items="prompts"
        item-key="identifier"
        handle-class="prompt-item-drag-handle"
        class="prompt-manager-list"
        @update:items="(items) => (prompts = items)"
      >
        <template #default="{ item: prompt, index }">
          <div
            class="prompt-item"
            :class="{ 'is-editing': expandedPrompts.has(prompt.identifier) }"
            :data-identifier="prompt.identifier"
          >
            <!-- Header -->
            <div class="prompt-item-header">
              <div class="prompt-item-actions">
                <div class="menu-button fa-solid fa-grip-lines prompt-item-drag-handle"></div>
              </div>

              <div class="prompt-item-info" @click="toggleExpand(prompt.identifier)">
                <span class="prompt-item-name">{{ prompt.name }}</span>
                <div class="prompt-item-badges">
                  <span class="prompt-item-badge" :class="getBadgeClass(prompt.role)">{{ prompt.role }}</span>
                </div>
              </div>

              <div class="prompt-item-actions">
                <Button
                  v-if="!prompt.marker"
                  icon="fa-trash"
                  variant="danger"
                  @click.stop="deletePrompt(prompt.identifier)"
                />
              </div>
            </div>

            <!-- Editor -->
            <div v-if="expandedPrompts.has(prompt.identifier)" class="prompt-item-editor">
              <FormItem :label="t('common.name')">
                <Input
                  :model-value="prompt.name"
                  @update:model-value="(v) => updatePromptField(index, 'name', v as never)"
                />
              </FormItem>

              <FormItem :label="t('aiConfig.promptManager.role')">
                <Select
                  :model-value="prompt.role || 'system'"
                  :options="roleOptions"
                  @update:model-value="(v) => updatePromptField(index, 'role', v as never)"
                />
              </FormItem>

              <FormItem :label="t('aiConfig.promptManager.content')">
                <Textarea
                  v-show="!prompt.marker"
                  allow-maximize
                  identifier="prompt.content"
                  :model-value="prompt.content || ''"
                  :rows="5"
                  @update:model-value="(v) => updatePromptField(index, 'content', v as never)"
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
        v-if="prompts.length === 0"
        icon="fa-layer-group"
        :description="t('aiConfig.promptManager.noPrompts')"
      />
    </div>
  </div>
</template>
