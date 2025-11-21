<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSettingsStore } from '../../stores/settings.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import type { Prompt } from '../../types/settings';
import { cloneDeep } from 'lodash-es';
import { toast } from '../../composables/useToast';
import type { MessageRole } from '@/types';
import DraggableList from '../Common/DraggableList.vue';
import { AppButton, AppIconButton, AppInput, AppSelect, AppTextarea } from '../UI';
import EmptyState from '../Common/EmptyState.vue';

const settingsStore = useSettingsStore();
const { t } = useStrictI18n();

// Local state for editing
const editingIdentifier = ref<string | null>(null);

// Interface for the UI list
interface DisplayPrompt extends Prompt {
  enabled: boolean;
}

// Compute the list by merging definitions with the order configuration
const displayPrompts = computed<DisplayPrompt[]>(() => {
  const definitions = settingsStore.settings.api.samplers.prompts || [];
  const orderConfig = settingsStore.settings.api.samplers.prompt_order?.order || [];

  // Create a map for quick lookup
  const defMap = new Map(definitions.map((p) => [p.identifier, p]));

  const result: DisplayPrompt[] = [];
  const processedIds = new Set<string>();

  // 1. Add items based on order
  for (const item of orderConfig) {
    const def = defMap.get(item.identifier);
    if (def) {
      result.push({ ...def, enabled: item.enabled });
      processedIds.add(item.identifier);
    }
  }

  // 2. Add any definitions not present in the order (fallback/safety)
  for (const def of definitions) {
    if (!processedIds.has(def.identifier)) {
      result.push({ ...def, enabled: true });
    }
  }

  return result;
});

const roleOptions = [
  { label: 'System', value: 'system' },
  { label: 'User', value: 'user' },
  { label: 'Assistant', value: 'assistant' },
];

function saveChanges(newDisplayList: DisplayPrompt[]) {
  // 1. Update Definitions (Prompt[])
  // We filter out the 'enabled' property to match the Prompt type
  const newDefinitions: Prompt[] = newDisplayList.map((p) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { enabled, ...rest } = p;
    return rest;
  });

  // 2. Update Order ({ identifier, enabled }[])
  const newOrder = newDisplayList.map((p) => ({
    identifier: p.identifier,
    enabled: p.enabled,
  }));

  settingsStore.settings.api.samplers.prompts = newDefinitions;
  settingsStore.settings.api.samplers.prompt_order = { order: newOrder };
}

function createNewPrompt() {
  const id = `custom-${Date.now()}`;
  const newPrompt: DisplayPrompt = {
    name: 'New Prompt',
    identifier: id,
    system_prompt: true,
    content: '',
    role: 'system',
    enabled: true,
  };

  const newList = [...displayPrompts.value, newPrompt];
  saveChanges(newList);
  editingIdentifier.value = id;
}

function deletePrompt(identifier: string) {
  const p = displayPrompts.value.find((x) => x.identifier === identifier);
  if (!p) return;

  if (p.marker) {
    toast.error(t('aiConfig.promptManager.cannotDeleteMarker'));
    return;
  }

  const newList = displayPrompts.value.filter((x) => x.identifier !== identifier);
  saveChanges(newList);

  if (editingIdentifier.value === identifier) {
    editingIdentifier.value = null;
  }
}

function toggleEdit(identifier: string) {
  if (editingIdentifier.value === identifier) {
    editingIdentifier.value = null;
  } else {
    editingIdentifier.value = identifier;
  }
}

function toggleEnabled(index: number) {
  const newList = cloneDeep(displayPrompts.value);
  newList[index].enabled = !newList[index].enabled;
  saveChanges(newList);
}

// When editing fields (name, content, etc), we need to update the definition in the store
function updatePromptField(index: number, field: keyof Prompt, value: string | number | MessageRole) {
  const newList = cloneDeep(displayPrompts.value);
  // @ts-expect-error Dynamic assignment
  newList[index][field] = value;
  saveChanges(newList);
}

function getBadgeClass(role?: string) {
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
      <AppButton icon="fa-plus" @click="createNewPrompt">
        {{ t('aiConfig.promptManager.newPrompt') }}
      </AppButton>
    </div>

    <div class="prompt-manager-list-container">
      <DraggableList
        :items="displayPrompts"
        item-key="identifier"
        handle-class="prompt-item-drag-handle"
        class="prompt-manager-list"
        @update:items="saveChanges"
      >
        <template #default="{ item: prompt, index }">
          <div
            class="prompt-item"
            :class="{
              disabled: !prompt.enabled,
              'is-editing': editingIdentifier === prompt.identifier,
            }"
            :data-identifier="prompt.identifier"
          >
            <!-- Header Row -->
            <div class="prompt-item-header">
              <div class="prompt-item-actions">
                <div
                  class="menu-button-icon fa-solid fa-grip-lines prompt-item-drag-handle"
                  :title="t('common.dragToReorder')"
                ></div>
              </div>

              <div class="prompt-item-info" @click="toggleEdit(prompt.identifier)">
                <span class="prompt-item-name">{{ prompt.name }}</span>
                <div class="prompt-item-badges">
                  <span v-if="prompt.marker" class="prompt-item-badge prompt-item-badge--marker">Marker</span>
                  <span v-else class="prompt-item-badge" :class="getBadgeClass(prompt.role)">{{ prompt.role }}</span>
                </div>
              </div>

              <div class="prompt-item-actions">
                <AppIconButton
                  :icon="prompt.enabled ? 'fa-toggle-on' : 'fa-toggle-off'"
                  :title="t('common.toggle')"
                  @click.stop="toggleEnabled(index)"
                />

                <AppIconButton
                  icon="fa-trash"
                  variant="danger"
                  :disabled="!!prompt.marker"
                  @click.stop="deletePrompt(prompt.identifier)"
                />
              </div>
            </div>

            <!-- Editor Row (Expandable) -->
            <div v-show="editingIdentifier === prompt.identifier" class="prompt-item-editor">
              <AppInput
                :model-value="prompt.name"
                :label="t('common.name')"
                @update:model-value="(v) => updatePromptField(index, 'name', v)"
              />

              <template v-if="!prompt.marker">
                <AppSelect
                  :model-value="prompt.role || 'system'"
                  :options="roleOptions"
                  :label="t('aiConfig.promptManager.role')"
                  @update:model-value="(v) => updatePromptField(index, 'role', v as MessageRole)"
                />

                <AppTextarea
                  :model-value="prompt.content || ''"
                  :label="t('aiConfig.promptManager.content')"
                  :rows="5"
                  @update:model-value="(v) => updatePromptField(index, 'content', v)"
                />
              </template>
              <div v-else class="prompt-empty-state" style="padding: 5px; font-size: 0.9em">
                {{ t('aiConfig.promptManager.markerHint') }}
              </div>
            </div>
          </div>
        </template>
      </DraggableList>

      <EmptyState
        v-if="displayPrompts.length === 0"
        icon="fa-layer-group"
        :description="t('aiConfig.promptManager.noPrompts')"
      />
    </div>
  </div>
</template>
