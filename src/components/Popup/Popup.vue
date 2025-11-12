<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { PropType } from 'vue';
import { useSettingsStore } from '../../stores/settings.store';
import { POPUP_TYPE, POPUP_RESULT, type PopupOptions } from '../../types';

const props = defineProps({
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  type: { type: Number as PropType<POPUP_TYPE>, default: POPUP_TYPE.TEXT },
  inputValue: { type: String, default: '' },
  options: { type: Object as PropType<PopupOptions>, default: () => ({}) },
});

const emit = defineEmits(['close', 'submit']);

const settings = useSettingsStore();
const dialog = ref<HTMLDialogElement | null>(null);
const mainInput = ref<HTMLTextAreaElement | null>(null);
const internalInputValue = ref(props.inputValue);

const okText = ref('OK');
const cancelText = ref('Cancel');
const showOk = ref(true);
const showCancel = ref(false);

function resolveOptions() {
  const { okButton, cancelButton } = props.options;
  switch (props.type) {
    case POPUP_TYPE.CONFIRM:
      okText.value = typeof okButton === 'string' ? okButton : 'Yes';
      cancelText.value = typeof cancelButton === 'string' ? cancelButton : 'No';
      showOk.value = okButton !== false;
      showCancel.value = cancelButton !== false;
      break;
    case POPUP_TYPE.INPUT:
      okText.value = typeof okButton === 'string' ? okButton : 'Save';
      cancelText.value = typeof cancelButton === 'string' ? cancelButton : 'Cancel';
      showOk.value = okButton !== false;
      showCancel.value = cancelButton !== false;
      break;
    default: // TEXT
      okText.value = typeof okButton === 'string' ? okButton : 'OK';
      cancelText.value = typeof cancelButton === 'string' ? cancelButton : 'Cancel';
      showOk.value = okButton !== false;
      showCancel.value = !!cancelButton;
  }
}

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      internalInputValue.value = props.inputValue;
      resolveOptions();
      dialog.value?.showModal();
      // Auto-focus logic
      setTimeout(() => {
        if (props.type === POPUP_TYPE.INPUT && mainInput.value) {
          mainInput.value.focus();
        } else {
          (dialog.value?.querySelector('.menu-button') as HTMLElement)?.focus();
        }
      }, 100); // Delay to allow dialog to render
    } else {
      dialog.value?.close();
    }
  },
);

onMounted(() => {
  if (props.visible) {
    internalInputValue.value = props.inputValue;
    resolveOptions();
    dialog.value?.showModal();
  }
});

function handleResult(result: number) {
  const payload: { result: number; value: any } = { result, value: null };
  if (result === POPUP_RESULT.AFFIRMATIVE) {
    if (props.type === POPUP_TYPE.INPUT) {
      payload.value = internalInputValue.value;
    }
  }
  emit('submit', payload);
  emit('close');
}

function onCancel() {
  emit('submit', { result: POPUP_RESULT.CANCELLED, value: null });
  emit('close');
}

function handleEnter(evt: KeyboardEvent) {
  if (evt.key === 'Enter' && !evt.shiftKey && !evt.altKey) {
    const target = evt.target as HTMLElement;
    const isInput = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT';
    if (!isInput || settings.shouldSendOnEnter) {
      evt.preventDefault();
      handleResult(props.options.defaultResult ?? POPUP_RESULT.AFFIRMATIVE);
    }
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="popup"
    :class="{ wide: options.wide, large: options.large }"
    @cancel="onCancel"
    @keydown="handleEnter"
  >
    <div class="popup-body">
      <h3 v-if="title" v-html="title"></h3>
      <div class="popup-content" :class="{ 'is-input': type === POPUP_TYPE.INPUT }">
        <div v-if="content" v-html="content"></div>
        <textarea
          v-if="type === POPUP_TYPE.INPUT"
          ref="mainInput"
          class="popup-input"
          :rows="options.rows"
          v-model="internalInputValue"
        ></textarea>
      </div>

      <!-- TODO: Implement CROP and custom inputs if needed -->

      <div class="popup-controls">
        <button
          v-if="showCancel"
          type="button"
          class="menu-button popup-button-cancel"
          @click="handleResult(POPUP_RESULT.NEGATIVE)"
        >
          {{ cancelText }}
        </button>
        <button
          v-if="showOk"
          type="button"
          class="menu-button default ok"
          @click="handleResult(POPUP_RESULT.AFFIRMATIVE)"
        >
          {{ okText }}
        </button>
      </div>
    </div>
  </dialog>
</template>
