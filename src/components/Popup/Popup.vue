<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import type { PropType } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import { POPUP_TYPE, POPUP_RESULT, type CustomPopupButton } from '../../types';
import 'cropperjs';
import type { I18nKey } from '../../types/i18n';

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

  okButton: { type: [String, Boolean] as PropType<I18nKey | boolean>, default: undefined },
  cancelButton: { type: [String, Boolean] as PropType<I18nKey | boolean>, default: undefined },
  rows: { type: Number },
  wide: { type: Boolean, default: false },
  large: { type: Boolean, default: false },
  customButtons: { type: Array as PropType<CustomPopupButton[]>, default: undefined },
  defaultResult: { type: Number },
  cropImage: { type: String },
});

const emit = defineEmits(['close', 'submit']);

const { t } = useStrictI18n();
const settings = useSettingsStore();
const dialog = ref<HTMLDialogElement | null>(null);
const mainInput = ref<HTMLTextAreaElement | null>(null);
const cropperSelection = ref<CropperSelectionElement | null>(null);
const internalInputValue = ref(props.inputValue);
const generatedButtons = ref<CustomPopupButton[]>([]);

function resolveOptions() {
  if (props.customButtons) {
    generatedButtons.value = props.customButtons;
    return;
  }

  const buttons: CustomPopupButton[] = [];
  const { okButton, cancelButton } = props;

  const showOk = okButton !== false;
  const showCancel = cancelButton !== false;

  const getButtonText = (buttonOption: I18nKey | boolean | undefined, defaultKey: I18nKey): string => {
    return typeof buttonOption === 'string' ? t(buttonOption) : t(defaultKey);
  };

  switch (props.type) {
    case POPUP_TYPE.CONFIRM:
      if (showOk) {
        buttons.push({
          text: getButtonText(okButton, 'common.yes'),
          result: POPUP_RESULT.AFFIRMATIVE,
          isDefault: true,
        });
      }
      if (showCancel) {
        buttons.push({ text: getButtonText(cancelButton, 'common.no'), result: POPUP_RESULT.NEGATIVE });
      }
      break;
    case POPUP_TYPE.INPUT:
    case POPUP_TYPE.CROP:
      if (showOk) {
        buttons.push({
          text: getButtonText(okButton, 'common.save'),
          result: POPUP_RESULT.AFFIRMATIVE,
          isDefault: true,
        });
      }
      if (showCancel) {
        buttons.push({ text: getButtonText(cancelButton, 'common.cancel'), result: POPUP_RESULT.CANCELLED });
      }
      break;
    default: // TEXT
      if (showOk) {
        buttons.push({ text: getButtonText(okButton, 'common.ok'), result: POPUP_RESULT.AFFIRMATIVE, isDefault: true });
      }
      if (cancelButton) {
        // Only show cancel if explicitly requested for TEXT type
        buttons.push({ text: getButtonText(cancelButton, 'common.cancel'), result: POPUP_RESULT.CANCELLED });
      }
  }
  generatedButtons.value = buttons;
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
          (dialog.value?.querySelector('.menu-button.default') as HTMLElement)?.focus();
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
  if (result !== POPUP_RESULT.CANCELLED) {
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
      handleResult(props.defaultResult ?? POPUP_RESULT.AFFIRMATIVE);
    }
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="popup"
    :id="id"
    :class="{ wide: wide, large: large }"
    @cancel="onCancel"
    @keydown="handleEnter"
  >
    <div class="popup-body">
      <h3 v-if="title" v-html="title" class="popup-title"></h3>
      <div
        class="popup-content"
        :class="{ 'is-input': type === POPUP_TYPE.INPUT, 'is-crop': type === POPUP_TYPE.CROP }"
      >
        <div v-if="content" v-html="content" class="popup-message"></div>
        <textarea
          v-if="type === POPUP_TYPE.INPUT"
          ref="mainInput"
          class="popup-input"
          :rows="rows"
          v-model="internalInputValue"
        ></textarea>
        <div v-if="type === POPUP_TYPE.CROP" class="crop-container">
          <cropper-canvas>
            <cropper-image :src="cropImage" alt="Image to crop" translatable></cropper-image>
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
          v-for="button in generatedButtons"
          :key="button.text"
          type="button"
          class="menu-button"
          :class="[{ default: button.isDefault }, button.classes]"
          @click="handleResult(button.result)"
        >
          {{ button.text }}
        </button>
      </div>
    </div>
  </dialog>
</template>
