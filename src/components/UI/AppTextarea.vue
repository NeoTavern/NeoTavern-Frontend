<script setup lang="ts">
interface Props {
  modelValue: string;
  label?: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  resizable?: boolean;
}

withDefaults(defineProps<Props>(), {
  rows: 3,
  disabled: false,
  resizable: true,
  label: undefined,
  placeholder: '',
});

const emit = defineEmits(['update:modelValue', 'maximize']);

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <div class="app-textarea-wrapper">
    <div v-if="label || $slots.header" class="app-textarea-header">
      <label v-if="label">{{ label }}</label>
      <div v-if="$attrs.onMaximize" class="maximize-icon" @click="$emit('maximize')">
        <i class="fa-solid fa-maximize"></i>
      </div>
    </div>

    <textarea
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
