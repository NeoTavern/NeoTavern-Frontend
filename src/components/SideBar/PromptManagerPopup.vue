<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { useApiStore } from '../../stores/api.store';
import { usePopupStore } from '../../stores/popup.store';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { slideTransitionHooks } from '../../utils/dom';

const props = defineProps({
  visible: { type: Boolean, default: false },
});
const emit = defineEmits(['close']);

const { t } = useStrictI18n();
const apiStore = useApiStore();
const popupStore = usePopupStore();

const dialog = ref<HTMLDialogElement | null>(null);
const expandedPrompts = ref<Set<string>>(new Set());
const { beforeEnter, enter, afterEnter, beforeLeave, leave, afterLeave } = slideTransitionHooks;

// Assuming the first prompt_order config is the one we're editing
const promptOrderConfig = computed(() => apiStore.oaiSettings.prompt_order?.[0]);

const orderedPrompts = computed(() => {
  if (!promptOrderConfig.value) return [];

  return promptOrderConfig.value.order.map((orderItem) => {
    const promptDetail = apiStore.oaiSettings.prompts?.find((p) => p.identifier === orderItem.identifier);
    return {
      ...promptDetail,
      ...orderItem,
    };
  });
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

function movePrompt(index: number, direction: 'up' | 'down') {
  if (!promptOrderConfig.value) return;
  const newOrder = [...promptOrderConfig.value.order];
  const newIndex = direction === 'up' ? index - 1 : index + 1;

  if (newIndex < 0 || newIndex >= newOrder.length) return;

  [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]];
  apiStore.updatePromptOrder(newOrder);
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
      <div class="prompt-manager-popup__header">
        <h3>{{ t('promptManager.title') }}</h3>
        <div class="menu-button" @click="handleReset">
          <i class="fa-solid fa-undo"></i>
          <span>&nbsp;{{ t('promptManager.resetAll') }}</span>
        </div>
      </div>
      <small class="prompt-manager-popup__description">{{ t('promptManager.description') }}</small>
      <div class="prompt-manager-popup__content">
        <div v-for="(prompt, index) in orderedPrompts" :key="prompt.identifier" class="prompt-item">
          <div class="prompt-item__header" @click="toggleExpand(prompt.identifier)">
            <div class="prompt-item__name">
              <i
                class="fa-solid fa-chevron-right prompt-item__chevron"
                :class="{ 'is-open': expandedPrompts.has(prompt.identifier) }"
              ></i>
              <span>{{ prompt.name }}</span>
            </div>
            <div class="prompt-item__controls">
              <label class="checkbox-label" :title="t('promptManager.promptItem.enabled')">
                <input
                  type="checkbox"
                  :checked="prompt.enabled"
                  @click.stop
                  @change="toggleEnabled(prompt.identifier, ($event.target as HTMLInputElement).checked)"
                />
              </label>
              <i
                class="menu-button-icon fa-solid fa-arrow-up"
                :class="{ disabled: index === 0 }"
                :title="t('promptManager.promptItem.moveUp')"
                @click.stop="movePrompt(index, 'up')"
              ></i>
              <i
                class="menu-button-icon fa-solid fa-arrow-down"
                :class="{ disabled: index === orderedPrompts.length - 1 }"
                :title="t('promptManager.promptItem.moveDown')"
                @click.stop="movePrompt(index, 'down')"
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
              <div v-if="!prompt.marker" class="prompt-item__content">
                <label>{{ t('promptManager.promptItem.role') }}</label>
                <select class="text-pole" :value="prompt.role" disabled>
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
              <div v-else class="prompt-item__content prompt-item__content--marker">
                This is a system marker. Its content is automatically generated from the character data.
              </div>
            </div>
          </Transition>
        </div>
      </div>
      <div class="popup-controls">
        <button class="menu-button" @click="close">{{ t('common.ok') }}</button>
      </div>
    </div>
  </dialog>
</template>
