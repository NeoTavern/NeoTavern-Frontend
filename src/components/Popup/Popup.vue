<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import DOMPurify from 'dompurify';
import type { Component, PropType } from 'vue';
import { computed, onMounted, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { POPUP_RESULT, POPUP_TYPE, type CustomPopupButton } from '../../types';
import type { I18nKey } from '../../types/i18n';
import { formatText } from '../../utils/chat';
import { Button, ImageCropper, Select, Textarea } from '../UI';

const props = defineProps({
  id: { type: String, required: true },
  visible: { type: Boolean, default: false },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  type: { type: Number as PropType<POPUP_TYPE>, default: POPUP_TYPE.TEXT },
  inputValue: { type: String, default: '' },
  selectValue: { type: [String, Array] as PropType<string | string[]>, default: '' },
  selectOptions: { type: Array as PropType<{ label: string; value: string }[]>, default: () => [] },
  selectMultiple: { type: Boolean, default: false },

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
const mainInputComponent = ref<InstanceType<typeof Textarea> | null>(null);
const cropper = ref<InstanceType<typeof ImageCropper> | null>(null);
const internalInputValue = ref(props.inputValue);
const internalSelectValue = ref(props.selectValue);
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
    case POPUP_TYPE.SELECT:
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
      internalSelectValue.value = props.selectValue;
      resolveOptions();
      setTimeout(() => {
        if (props.type === POPUP_TYPE.INPUT && mainInputComponent.value) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const textarea = (mainInputComponent.value as any).$el.querySelector('textarea');
          textarea?.focus();
        }
      }, 100);
    }
  },
);

onMounted(() => {
  if (props.visible) {
    internalInputValue.value = props.inputValue;
    internalSelectValue.value = props.selectValue;
    resolveOptions();
  }
});

function handleResult(result: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: { result: number; value: any } = { result, value: null };
  if (result !== POPUP_RESULT.CANCELLED) {
    if (props.type === POPUP_TYPE.INPUT) {
      payload.value = internalInputValue.value;
    } else if (props.type === POPUP_TYPE.CROP && cropper.value) {
      payload.value = cropper.value.getData();
    } else if (props.type === POPUP_TYPE.SELECT) {
      payload.value = internalSelectValue.value;
    }
  }
  emit('submit', payload);
  emit('close');
}

// function handleEnter(evt: KeyboardEvent) {
//   if (evt.key === 'Enter' && !evt.shiftKey && !evt.altKey) {
//     const target = evt.target as HTMLElement;
//     const isInput =
//       target.tagName === 'TEXTAREA' ||
//       target.tagName === 'INPUT' ||
//       target.isContentEditable ||
//       target.className.includes('cm-');
//     if (!isInput) {
//       evt.preventDefault();
//       handleResult(props.defaultResult ?? POPUP_RESULT.AFFIRMATIVE);
//     }
//   }
// }
</script>

<template>
  <Teleport to="body">
    <Transition name="popup-fade">
      <div
        v-if="visible"
        class="popup-overlay"
        :role="type === POPUP_TYPE.CONFIRM ? 'alertdialog' : 'dialog'"
        :aria-labelledby="title ? `${id}-title` : undefined"
        :aria-describedby="content ? `${id}-content` : undefined"
        aria-modal="true"
      >
        <div :id="id" class="popup" :class="{ wide: wide, large: large }">
          <div class="popup-body">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <h3 v-if="title" :id="`${id}-title`" class="popup-title" v-html="sanitizedTitle"></h3>
            <div
              class="popup-content"
              :class="{
                'is-input': type === POPUP_TYPE.INPUT,
                'is-crop': type === POPUP_TYPE.CROP,
                'is-select': type === POPUP_TYPE.SELECT,
              }"
            >
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div v-if="content" :id="`${id}-content`" class="popup-message" v-html="formattedContent"></div>

              <component :is="component" v-if="component" v-bind="componentProps" />

              <Textarea
                v-if="type === POPUP_TYPE.INPUT"
                ref="mainInputComponent"
                v-model="internalInputValue"
                class="popup-input-wrapper"
                :rows="rows"
              />

              <Select
                v-if="type === POPUP_TYPE.SELECT"
                v-model="internalSelectValue"
                :searchable="selectOptions.length > 10"
                class="popup-input-wrapper"
                :options="selectOptions"
                :multiple="selectMultiple"
              />

              <div v-if="type === POPUP_TYPE.CROP" class="crop-container">
                <ImageCropper ref="cropper" :src="cropImage" :aspect-ratio="1" />
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
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
