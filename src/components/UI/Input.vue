<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed } from 'vue';
import type { TextareaToolDefinition } from '../../types/ExtensionAPI';
import { uuidv4 } from '../../utils/commons';

interface Props {
  modelValue: string | number;
  label?: string;
  type?: 'text' | 'number' | 'search' | 'password';
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  tools?: TextareaToolDefinition[];
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  disabled: false,
  label: undefined,
  placeholder: '',
  min: undefined,
  max: undefined,
  step: undefined,
  id: undefined,
  tools: () => [],
});

const emit = defineEmits(['update:modelValue', 'input', 'change']);

// Use provided ID or generate one
const inputId = props.id || `input-${uuidv4()}`;

const activeTools = computed(() => props.tools || []);
const showHeader = computed(() => !!props.label || activeTools.value.length > 0);

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  let val: string | number = target.value;

  if (target.type === 'number') {
    val = target.valueAsNumber;
  }

  emit('update:modelValue', val);
  emit('input', event);
}

function handleToolClick(tool: TextareaToolDefinition) {
  tool.onClick({
    // @ts-expect-error string/number
    value: props.modelValue,
    setValue: (val: string) => emit('update:modelValue', val),
  });
}
</script>

<template>
  <div class="input-wrapper">
    <div v-if="showHeader" class="input-header">
      <label v-if="label" :for="inputId" class="input-label">{{ label }}</label>
      <div class="input-header-tools">
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
      </div>
    </div>
    <input
      :id="inputId"
      class="text-pole"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :min="min"
      :max="max"
      :step="step"
      :aria-label="!label ? placeholder : undefined"
      @input="handleInput"
      @change="$emit('change', $event)"
    />
  </div>
</template>

<style scoped>
/* TODO: Make sure this is sync with _ui-components.scss */
.input-header-tools {
  display: flex;
  gap: 5px;
  margin-left: auto;
}

.input-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}
</style>
