<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import 'cropperjs';
import DOMPurify from 'dompurify';
import type { Component, PropType } from 'vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useSettingsStore } from '../../stores/settings.store';
import { POPUP_RESULT, POPUP_TYPE, type CustomPopupButton } from '../../types';
import type { I18nKey } from '../../types/i18n';
import { formatText } from '../../utils/chat';
import { Button, Textarea } from '../UI';

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
  rows: { type: Number, default: 4 },
  wide: { type: Boolean, default: false },
  large: { type: Boolean, default: false },
  customButtons: { type: Array as PropType<CustomPopupButton[]>, default: undefined },
  defaultResult: { type: Number, default: undefined },
  cropImage: { type: String, default: '' },

  component: { type: Object as PropType<Component>, default: undefined },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentProps: { type: Object as PropType<Record<string, any>>, default: () => ({}) },
});

const emit = defineEmits(['close', 'submit']);

const { t } = useStrictI18n();
const settings = useSettingsStore();
const dialog = ref<HTMLDialogElement | null>(null);
const mainInputComponent = ref<InstanceType<typeof Textarea> | null>(null);
const cropperSelection = ref<CropperSelectionElement | null>(null);
const internalInputValue = ref(props.inputValue);
const generatedButtons = ref<CustomPopupButton[]>([]);
const sanitizedTitle = computed(() => DOMPurify.sanitize(props.title));
const formattedContent = computed(() => formatText(props.content));

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
    case POPUP_TYPE.DISPLAY:
      if (showOk) {
        buttons.push({ text: getButtonText(okButton, 'common.ok'), result: POPUP_RESULT.AFFIRMATIVE, isDefault: true });
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

function getButtonVariant(button: CustomPopupButton): 'default' | 'confirm' | 'danger' {
  if (button.result === POPUP_RESULT.AFFIRMATIVE) return 'confirm';
  if (button.result === POPUP_RESULT.NEGATIVE && props.type === POPUP_TYPE.CONFIRM) return 'danger';
  return 'default';
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
        if (props.type === POPUP_TYPE.INPUT && mainInputComponent.value) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const textarea = (mainInputComponent.value as any).$el.querySelector('textarea');
          textarea?.focus();
        } else if (props.type !== POPUP_TYPE.CROP) {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    :id="id"
    ref="dialog"
    class="popup"
    :class="{ wide: wide, large: large }"
    @cancel="onCancel"
    @keydown="handleEnter"
  >
    <div class="popup-body">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <h3 v-if="title" class="popup-title" v-html="sanitizedTitle"></h3>
      <div
        class="popup-content"
        :class="{ 'is-input': type === POPUP_TYPE.INPUT, 'is-crop': type === POPUP_TYPE.CROP }"
      >
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="content" class="popup-message" v-html="formattedContent"></div>

        <component :is="component" v-if="component" v-bind="componentProps" />

        <Textarea
          v-if="type === POPUP_TYPE.INPUT"
          ref="mainInputComponent"
          v-model="internalInputValue"
          class="popup-input-wrapper"
          :rows="rows"
        />

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
        <Button
          v-for="button in generatedButtons"
          :key="button.text"
          :variant="getButtonVariant(button)"
          :class="button.classes"
          @click="handleResult(button.result)"
        >
          {{ button.text }}
        </Button>
      </div>
    </div>
  </dialog>
</template>
