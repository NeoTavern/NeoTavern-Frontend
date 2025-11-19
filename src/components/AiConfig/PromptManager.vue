<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore } from '../../stores/settings.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import type { Prompt } from '../../types/settings';

const settingsStore = useSettingsStore();
const { t } = useStrictI18n();

const prompts = computed(() => settingsStore.settings.api.samplers.prompts || []);

// TODO: Implement add/edit/delete/reorder logic once API methods are available in the store/API
function handleEdit(prompt: Prompt) {
  console.log('Edit prompt', prompt);
}

function handleDelete(index: number) {
  // Placeholder
  const newPrompts = [...prompts.value];
  newPrompts.splice(index, 1);
  settingsStore.settings.api.samplers.prompts = newPrompts;
}

function createNewPrompt() {
  const newPrompt: Prompt = {
    name: 'New Prompt',
    identifier: `prompt-${Date.now()}`,
    system_prompt: false,
    content: '',
    enabled: true,
  } as unknown as Prompt;

  const newPrompts = [...prompts.value, newPrompt];
  settingsStore.settings.api.samplers.prompts = newPrompts;
}
</script>

<template>
  <div class="prompt-manager">
    <div class="prompt-manager-header">
      <button class="menu-button" @click="createNewPrompt">
        <i class="fa-solid fa-plus"></i>
        {{ t('aiConfig.promptManager.newPrompt') }}
      </button>
    </div>

    <div class="prompt-list">
      <div v-for="(prompt, index) in prompts" :key="prompt.identifier" class="prompt-item">
        <div class="prompt-item-header">
          <span class="prompt-name">{{ prompt.name }}</span>
          <div class="prompt-actions">
            <button class="menu-button-icon fa-solid fa-pencil" @click="handleEdit(prompt)"></button>
            <button class="menu-button-icon fa-solid fa-trash" @click="handleDelete(index)"></button>
          </div>
        </div>
        <div class="prompt-item-details">
          <small>{{ prompt.role || 'system' }}</small>
        </div>
      </div>

      <div v-if="prompts.length === 0" class="prompt-empty-state">
        {{ t('aiConfig.promptManager.noPrompts') }}
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.prompt-manager {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &-header {
    display: flex;
    justify-content: flex-end;
  }
}

.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-item {
  background-color: var(--black-30a);
  border: 1px solid var(--theme-border-color);
  border-radius: 5px;
  padding: 8px;

  &-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: bold;
  }

  &-details {
    font-size: 0.85em;
    opacity: 0.7;
    margin-top: 4px;
  }
}

.prompt-empty-state {
  text-align: center;
  opacity: 0.6;
  padding: 20px;
  font-style: italic;
}
</style>
