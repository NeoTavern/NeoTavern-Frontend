<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { markRaw, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { usePopupStore } from '../../stores/popup.store';
import { POPUP_TYPE } from '../../types';
import TextareaExpanded from './TextareaExpanded.vue';

interface Props {
  modelValue: string;
  label?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  resizable?: boolean;
  allowMaximize?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  rows: 3,
  disabled: false,
  resizable: true,
  allowMaximize: false,
  label: undefined,
  placeholder: '',
});

const emit = defineEmits(['update:modelValue']);

const popupStore = usePopupStore();

const { t } = useStrictI18n();

const textareaRef = ref<HTMLTextAreaElement>();

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}

defineExpose({
  focus() {
    if (textareaRef.value) {
      textareaRef.value.focus();
      textareaRef.value.setSelectionRange(textareaRef.value.value.length, textareaRef.value.value.length);
    }
  },
});

async function maximizeEditor() {
  await popupStore.show({
    type: POPUP_TYPE.CONFIRM,
    title: props.label ? `${t('common.expandedEditor')}: ${props.label}` : t('common.expandedEditor'),
    large: true,
    wide: true,
    component: markRaw(TextareaExpanded),
    componentProps: {
      value: props.modelValue,
      label: props.label,
      'onUpdate:value': (value: string) => {
        emit('update:modelValue', value);
      },
    },
    okButton: 'common.close',
    cancelButton: false,
  });
}
</script>

<template>
  <div class="textarea-wrapper">
    <div v-if="label || $slots.header || props.allowMaximize" class="textarea-header">
      <label v-if="label">{{ label }}</label>
      <div v-if="props.allowMaximize" class="maximize-icon" @click="maximizeEditor">
        <i class="fa-solid fa-maximize"></i>
      </div>
    </div>

    <textarea
      ref="textareaRef"
      class="text-pole"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :style="{ resize: resizable ? 'vertical' : 'none' }"
      @input="onInput"
    ></textarea>
    <slot name="footer" />
  </div>
</template>
