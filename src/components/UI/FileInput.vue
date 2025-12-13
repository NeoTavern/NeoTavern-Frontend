<script setup lang="ts">
import { ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import Button from './Button.vue';

const { t } = useStrictI18n();

defineProps<{
  accept?: string;
  multiple?: boolean;
  type?: 'icon' | 'button'; // default to icon
  icon?: string;
  label?: string; // Text for button mode or title for icon mode
}>();

const emit = defineEmits<{
  (e: 'change', files: File[]): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);

function trigger() {
  inputRef.value?.click();
}

function handleChange(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    emit('change', Array.from(target.files));
  }
  // Reset so same file can be selected again
  target.value = '';
}
</script>

<template>
  <div class="file-input">
    <input
      ref="inputRef"
      type="file"
      hidden
      :accept="accept"
      :multiple="multiple"
      tabindex="-1"
      @change="handleChange"
    />

    <Button v-if="type === 'button'" :icon="icon || 'fa-upload'" @click="trigger">
      {{ label || t('common.upload') }}
    </Button>

    <Button v-else :icon="icon || 'fa-upload'" :title="label || t('common.upload')" variant="ghost" @click="trigger" />
  </div>
</template>
