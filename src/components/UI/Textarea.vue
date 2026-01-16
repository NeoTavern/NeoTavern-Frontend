<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed, markRaw, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useComponentRegistryStore } from '../../stores/component-registry.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import { POPUP_TYPE, type CodeMirrorTarget } from '../../types';
import type { TextareaToolDefinition } from '../../types/ExtensionAPI';
import { uuidv4 } from '../../utils/commons';
import CodeMirrorEditor from './CodeMirrorEditor.vue';
import TextareaExpanded from './TextareaExpanded.vue';

interface Props {
  modelValue: string;
  label?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  resizable?: boolean;
  allowMaximize?: boolean;
  codeMirror?: boolean;
  language?: 'markdown' | 'css';
  identifier?: CodeMirrorTarget | string;
  id?: string;
  tools?: TextareaToolDefinition[];
}

const props = withDefaults(defineProps<Props>(), {
  rows: 3,
  disabled: false,
  resizable: true,
  allowMaximize: false,
  label: undefined,
  placeholder: '',
  codeMirror: false,
  language: 'markdown',
  identifier: undefined,
  id: undefined,
  tools: () => [],
});

const emit = defineEmits(['update:modelValue']);

const popupStore = usePopupStore();
const settingsStore = useSettingsStore();
const registryStore = useComponentRegistryStore();

const { t } = useStrictI18n();

const textareaRef = ref<HTMLTextAreaElement>();
const codeEditorRef = ref<InstanceType<typeof CodeMirrorEditor>>();

const textareaId = computed(() => props.id || `textarea-${uuidv4()}`);

const isCodeMirrorActive = computed(() => {
  if (props.codeMirror) return true;
  if (
    props.identifier &&
    settingsStore.settings.ui.editor.codeMirrorIdentifiers.includes(props.identifier as CodeMirrorTarget)
  ) {
    return true;
  }
  return false;
});

const activeTools = computed(() => {
  const registryTools =
    props.identifier && typeof props.identifier === 'string' ? registryStore.getTextareaTools(props.identifier) : [];
  return [...registryTools, ...(props.tools || [])];
});

const showHeader = computed(() => {
  return !!props.label || !!props.allowMaximize || activeTools.value.length > 0;
});

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}

function onCodeMirrorUpdate(value: string) {
  emit('update:modelValue', value);
}

function handleToolClick(tool: TextareaToolDefinition) {
  tool.onClick({
    value: props.modelValue,
    setValue: (val: string) => emit('update:modelValue', val),
  });
}

defineExpose({
  focus() {
    if (isCodeMirrorActive.value && codeEditorRef.value) {
      codeEditorRef.value.focus();
    } else if (textareaRef.value) {
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
      language: props.language,
      codeMirror: isCodeMirrorActive.value,
      'onUpdate:value': (value: string) => {
        emit('update:modelValue', value);
      },
    },
    okButton: 'common.close',
    cancelButton: false,
  });
}

const cmMinHeight = computed(() => {
  return `calc(${props.rows} * 1em + var(--textarea-padding-y) * 2)`;
});
</script>

<template>
  <div class="textarea-wrapper">
    <div v-if="showHeader || $slots.header" class="textarea-header">
      <label v-if="label" :for="textareaId">{{ label }}</label>
      <div class="textarea-header-tools">
        <button
          v-for="tool in activeTools"
          :key="tool.id"
          class="tool-btn"
          :class="{
            active: tool.active,
            danger: tool.variant === 'danger',
            confirm: tool.variant === 'confirm',
          }"
          :title="tool.title"
          @click="handleToolClick(tool)"
        >
          <i :class="['fa-solid', tool.icon]"></i>
        </button>

        <button
          v-if="props.allowMaximize"
          class="tool-btn"
          :aria-label="t('common.expandedEditor')"
          :title="t('common.expandedEditor')"
          @click="maximizeEditor"
        >
          <i class="fa-solid fa-maximize" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <CodeMirrorEditor
      v-if="isCodeMirrorActive"
      ref="codeEditorRef"
      :language="language"
      :model-value="modelValue"
      :disabled="disabled"
      :placeholder="placeholder"
      :min-height="cmMinHeight"
      :max-height="resizable ? 'none' : cmMinHeight"
      :aria-label="label || placeholder"
      :resizable="resizable"
      @update:model-value="onCodeMirrorUpdate"
    />

    <textarea
      v-else
      :id="textareaId"
      ref="textareaRef"
      class="text-pole"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :disabled="disabled"
      :style="{ resize: resizable ? 'vertical' : 'none' }"
      :aria-label="!label ? placeholder : undefined"
      @input="onInput"
    ></textarea>
    <slot name="footer" />
  </div>
</template>

<style scoped>
/* TODO: Make sure this is sync with _ui-components.scss */
.textarea-header-tools {
  display: flex;
  margin-left: auto;
}

.textarea-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}
</style>
