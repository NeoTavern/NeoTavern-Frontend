<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { PropType } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import { POPUP_TYPE, POPUP_RESULT, type PopupOptions } from '../../types';
import 'cropperjs';

interface CropperSelectionElement extends HTMLElement {
  x: number;
  y: number;
  width: number;
  height: number;
}

const props = defineProps({
  id: { type: String, required: true },
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  type: { type: Number as PropType<POPUP_TYPE>, default: POPUP_TYPE.TEXT },
  inputValue: { type: String, default: '' },
  options: { type: Object as PropType<PopupOptions>, default: () => ({}) },
});

const emit = defineEmits(['close', 'submit']);

const { t } = useStrictI18n();
const settings = useSettingsStore();
const dialog = ref<HTMLDialogElement | null>(null);
const mainInput = ref<HTMLTextAreaElement | null>(null);
const cropperSelection = ref<CropperSelectionElement | null>(null);
const internalInputValue = ref(props.inputValue);

const okText = ref('OK');
const cancelText = ref('Cancel');
const showOk = ref(true);
const showCancel = ref(false);

function resolveOptions() {
  const { okButton, cancelButton } = props.options;
  switch (props.type) {
    case POPUP_TYPE.CONFIRM:
      okText.value = typeof okButton === 'string' ? okButton : t('common.yes');
      cancelText.value = typeof cancelButton === 'string' ? cancelButton : t('common.no');
      showOk.value = okButton !== false;
      showCancel.value = cancelButton !== false;
      break;
    case POPUP_TYPE.INPUT:
    case POPUP_TYPE.CROP:
      okText.value = typeof okButton === 'string' ? okButton : t('common.save');
      cancelText.value = typeof cancelButton === 'string' ? cancelButton : t('common.cancel');
      showOk.value = okButton !== false;
      showCancel.value = cancelButton !== false;
      break;
    default: // TEXT
      okText.value = typeof okButton === 'string' ? okButton : t('common.ok');
      cancelText.value = typeof cancelButton === 'string' ? cancelButton : t('common.cancel');
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
      if (!dialog.value?.open) {
        dialog.value?.showModal();
      }
      setTimeout(() => {
        if (props.type === POPUP_TYPE.INPUT && mainInput.value) {
          mainInput.value.focus();
        } else if (props.type !== POPUP_TYPE.CROP) {
          (dialog.value?.querySelector('.menu-button') as HTMLElement)?.focus();
        }
      }, 100);
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
    } else if (props.type === POPUP_TYPE.CROP && cropperSelection.value) {
      const { x, y, width, height } = cropperSelection.value;
      payload.value = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      };
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
      <div
        class="popup-content"
        :class="{ 'is-input': type === POPUP_TYPE.INPUT, 'is-crop': type === POPUP_TYPE.CROP }"
      >
        <div v-if="content" v-html="content"></div>
        <textarea
          v-if="type === POPUP_TYPE.INPUT"
          ref="mainInput"
          class="popup-input"
          :rows="options.rows"
          v-model="internalInputValue"
        ></textarea>
        <div v-if="type === POPUP_TYPE.CROP" class="crop-container">
          <cropper-canvas>
            <cropper-image :src="options.cropImage" alt="Image to crop" translatable></cropper-image>
            <cropper-shade hidden></cropper-shade>
            <cropper-handle action="move" plain></cropper-handle>
            <cropper-selection
              ref="cropperSelection"
              :initial-coverage="0.8"
              :aspect-ratio="1"
              :movable="false"
              :resizable="false"
            >
              <cropper-grid hidden></cropper-grid>
            </cropper-selection>
          </cropper-canvas>
        </div>
      </div>

      <div class="popup-controls">
        <button
          v-if="showOk"
          type="button"
          class="menu-button default ok"
          @click="handleResult(POPUP_RESULT.AFFIRMATIVE)"
        >
          {{ okText }}
        </button>
        <button
          v-if="showCancel"
          type="button"
          class="menu-button popup-button-cancel"
          @click="handleResult(POPUP_RESULT.NEGATIVE)"
        >
          {{ cancelText }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.crop-container {
  max-width: 100%;
  max-height: 70vh;
}
.is-crop {
  display: flex;
  justify-content: center;
}
</style>
