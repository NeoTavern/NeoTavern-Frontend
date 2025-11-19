<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { useApiStore } from '../../stores/api.store';
import { usePopupStore } from '../../stores/popup.store';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { slideTransitionHooks } from '../../utils/dom';
import { useSettingsStore } from '../../stores/settings.store';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

const { t } = useStrictI18n();
const apiStore = useApiStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();

const dialog = ref<HTMLDialogElement | null>(null);
const expandedPrompts = ref<Set<string>>(new Set());
const { beforeEnter, enter, afterEnter, beforeLeave, leave, afterLeave } = slideTransitionHooks;
const selectedPromptToAdd = ref<string | null>(null);

// Drag & Drop state
const draggedIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

// Assuming the first prompt_order config is the one we're editing
const promptOrderConfig = computed(() => settingsStore.settings.api.samplers.prompt_order);

const orderedPrompts = computed(() => {
  if (!promptOrderConfig.value) return [];

  return promptOrderConfig.value.order.map((orderItem) => {
    const promptDetail = settingsStore.settings.api.samplers.prompts?.find(
      (p) => p.identifier === orderItem.identifier,
    );
    return {
      ...promptDetail,
      ...orderItem,
    };
  });
});

const unusedPrompts = computed(() => {
  if (!promptOrderConfig.value || !settingsStore.settings.api.samplers.prompts) return [];
  const usedIdentifiers = new Set(promptOrderConfig.value.order.map((item) => item.identifier));
  return settingsStore.settings.api.samplers.prompts.filter((p) => !usedIdentifiers.has(p.identifier));
});

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      dialog.value?.showModal();
    } else {
      dialog.value?.close();
    }
  },
);

onMounted(() => {
  if (props.visible) {
    dialog.value?.showModal();
  }
});

function close() {
  emit('close');
}

function toggleExpand(identifier: string) {
  if (expandedPrompts.value.has(identifier)) {
    expandedPrompts.value.delete(identifier);
  } else {
    expandedPrompts.value.add(identifier);
  }
}

function handleDragStart(index: number, event: DragEvent) {
  draggedIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
  (event.currentTarget as HTMLElement)?.classList.add('is-dragging');
}

function handleDragOver(index: number) {
  if (index !== draggedIndex.value) {
    dragOverIndex.value = index;
  }
}

function handleDragLeave() {
  dragOverIndex.value = null;
}

function handleDrop(targetIndex: number, event: DragEvent) {
  (event.currentTarget as HTMLElement)?.classList.remove('is-dragging');
  if (draggedIndex.value === null || draggedIndex.value === targetIndex) {
    cleanupDrag();
    return;
  }
  if (!promptOrderConfig.value) return;

  const newOrder = [...promptOrderConfig.value.order];
  const [draggedItem] = newOrder.splice(draggedIndex.value, 1);
  newOrder.splice(targetIndex, 0, draggedItem);

  apiStore.updatePromptOrder(newOrder);
  cleanupDrag();
}

function cleanupDrag() {
  draggedIndex.value = null;
  dragOverIndex.value = null;
}

function removePromptFromOrder(identifier: string) {
  apiStore.removePromptFromOrder(identifier);
}

function addSelectedPrompt() {
  if (selectedPromptToAdd.value) {
    apiStore.addPromptToOrder(selectedPromptToAdd.value);
    selectedPromptToAdd.value = null; // Reset dropdown
  }
}

function updateContent(identifier: string, content: string) {
  apiStore.updatePromptContent(identifier, content);
}

function toggleEnabled(identifier: string, enabled: boolean) {
  apiStore.togglePromptEnabled(identifier, enabled);
}

async function handleReset() {
  const { result } = await popupStore.show({
    title: t('promptManager.resetConfirm.title'),
    content: t('promptManager.resetConfirm.content'),
    type: POPUP_TYPE.CONFIRM,
  });
  if (result === POPUP_RESULT.AFFIRMATIVE) {
    apiStore.resetPrompts();
  }
}
</script>

<template>
  <dialog ref="dialog" class="popup wide" @cancel="close">
    <div class="popup-body">
      <div class="prompt-manager-popup-header">
        <h3>{{ t('promptManager.title') }}</h3>
        <div class="menu-button" @click="handleReset">
          <i class="fa-solid fa-undo"></i>
          <span>&nbsp;{{ t('promptManager.resetAll') }}</span>
        </div>
      </div>
      <small class="prompt-manager-popup-description">{{ t('promptManager.description') }}</small>
      <div class="prompt-manager-popup-content">
        <h4>{{ t('promptManager.promptOrderTitle') }}</h4>
        <div
          v-for="(prompt, index) in orderedPrompts"
          :key="prompt.identifier"
          class="prompt-item"
          :class="{ 'is-dragging-over': dragOverIndex === index }"
          draggable="true"
          :title="t('promptManager.promptItem.dragHandle')"
          @dragstart="handleDragStart(index, $event)"
          @dragover.prevent="handleDragOver(index)"
          @dragleave="handleDragLeave()"
          @drop.prevent="handleDrop(index, $event)"
          @dragend="cleanupDrag"
        >
          <div class="prompt-item-header" @click="toggleExpand(prompt.identifier)">
            <div class="prompt-item-name">
              <i class="fa-solid fa-grip-vertical menu-button-icon drag-handle"></i>
              <i
                class="fa-solid fa-chevron-right prompt-item-chevron"
                :class="{ 'is-open': expandedPrompts.has(prompt.identifier) }"
              ></i>
              <span>{{ prompt.name }}</span>
            </div>
            <div class="prompt-item-controls">
              <label class="checkbox-label" :title="t('promptManager.promptItem.enabled')">
                <input
                  type="checkbox"
                  :checked="prompt.enabled"
                  @click.stop
                  @change="toggleEnabled(prompt.identifier, ($event.target as HTMLInputElement).checked)"
                />
              </label>
              <i
                class="menu-button-icon fa-solid fa-xmark remove"
                :title="t('promptManager.promptItem.remove')"
                @click.stop="removePromptFromOrder(prompt.identifier)"
              ></i>
            </div>
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
            <div v-show="expandedPrompts.has(prompt.identifier)">
              <div v-if="!prompt.marker" class="prompt-item-content">
                <label>{{ t('promptManager.promptItem.role') }}</label>
                <select class="text-pole" :value="prompt.role">
                  <option value="system">System</option>
                  <option value="user">User</option>
                  <option value="assistant">Assistant</option>
                </select>
                <label>{{ t('promptManager.promptItem.content') }}</label>
                <textarea
                  class="text-pole"
                  rows="6"
                  :value="prompt.content"
                  @input="updateContent(prompt.identifier, ($event.target as HTMLTextAreaElement).value)"
                ></textarea>
              </div>
              <div v-else class="prompt-item-content prompt-item-content--marker">
                This is a system marker. Its content is automatically generated from the character data.
              </div>
            </div>
          </Transition>
        </div>
        <h4>{{ t('promptManager.addSectionTitle') }}</h4>
        <div class="prompt-manager-popup-add-section">
          <select v-model="selectedPromptToAdd" class="text-pole">
            <option :value="null" disabled>{{ t('promptManager.selectToAdd') }}</option>
            <option v-for="prompt in unusedPrompts" :key="prompt.identifier" :value="prompt.identifier">
              {{ prompt.name }}
            </option>
          </select>
          <button class="menu-button" :disabled="!selectedPromptToAdd" @click="addSelectedPrompt">
            {{ t('promptManager.addPrompt') }}
          </button>
        </div>
      </div>
      <div class="popup-controls">
        <button class="menu-button" @click="close">{{ t('common.ok') }}</button>
      </div>
    </div>
  </dialog>
</template>
