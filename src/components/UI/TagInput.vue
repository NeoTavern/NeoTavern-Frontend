<script setup lang="ts">
import { ref } from 'vue';
import AppButton from './AppButton.vue';

interface Props {
  modelValue: string[]; // Array of tags
  placeholder?: string;
}

const props = defineProps<Props>();
const emit = defineEmits(['update:modelValue']);

const inputRef = ref<HTMLInputElement | null>(null);
const inputValue = ref('');

function addTag() {
  const val = inputValue.value.trim();
  if (!val) return;

  // Split by comma if user pasted text
  const newTags = val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Deduplicate against existing
  const distinct = newTags.filter((t) => !props.modelValue.includes(t));

  if (distinct.length > 0) {
    emit('update:modelValue', [...props.modelValue, ...distinct]);
  }
  inputValue.value = '';
}

function removeTag(index: number) {
  const newTags = [...props.modelValue];
  newTags.splice(index, 1);
  emit('update:modelValue', newTags);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag();
  } else if (e.key === 'Backspace' && inputValue.value === '' && props.modelValue.length > 0) {
    removeTag(props.modelValue.length - 1);
  }
}
</script>

<template>
  <div class="tag-input-container">
    <div class="tag-input-controls">
      <input
        ref="inputRef"
        v-model="inputValue"
        class="text-pole"
        :placeholder="placeholder"
        @keydown="handleKeydown"
        @blur="addTag"
      />
      <AppButton icon="fa-plus" @click="addTag" />
    </div>
    <div class="tags-list">
      <span v-for="(tag, idx) in modelValue" :key="idx" class="tag">
        {{ tag }}
        <i class="fa-solid fa-xmark tag-close" @click="removeTag(idx)"></i>
      </span>
    </div>
  </div>
</template>
