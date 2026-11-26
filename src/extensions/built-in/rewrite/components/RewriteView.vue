<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../../../composables/useStrictI18n';
import TextDiff from '../../_shared/components/TextDiff.vue';
import type { FieldChange } from '../types';

const props = defineProps<{
  changes?: FieldChange[];
  originalText?: string;
  generatedText?: string;
  isGenerating?: boolean;
  ignoreInput?: boolean;
}>();

const emit = defineEmits<{
  (e: 'copy-output'): void;
}>();

const { t } = useStrictI18n();

const fieldChanges = computed<FieldChange[]>(() => {
  if (props.changes) return props.changes;
  if (props.originalText !== undefined && props.generatedText !== undefined) {
    return [
      {
        fieldId: 'text',
        label: t('extensionsBuiltin.rewrite.popup.output'),
        oldValue: props.originalText,
        newValue: props.generatedText,
      },
    ];
  }
  return [];
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
</script>
<template>
  <div class="multi-diff-view">
    <div v-for="(change, index) in fieldChanges" :key="index" class="field-diff">
      <div class="field-header">{{ change.label }}</div>
      <TextDiff v-if="!ignoreInput" :old-value="change.oldValue" :new-value="change.newValue">
        <template #old-header>{{ t('extensionsBuiltin.rewrite.popup.original') }}</template>
        <template #new-header="{ hasOutput }">
          <span>
            {{ t('extensionsBuiltin.rewrite.popup.new') }}
            <span v-if="isGenerating" class="generating-indicator">
              <i class="fa-solid fa-circle-notch fa-spin"></i>
            </span>
          </span>
          <button v-if="hasOutput" class="copy-btn" :title="t('common.copy')" @click="emit('copy-output')">
            <i class="fa-solid fa-copy"></i>
          </button>
        </template>
      </TextDiff>

      <!-- Single output view for templates that ignore input -->
      <div v-else class="single-view">
        <div class="pane">
          <div class="pane-header">
            <span>
              {{ t('extensionsBuiltin.rewrite.popup.output') }}
              <span v-if="isGenerating" class="generating-indicator">
                <i class="fa-solid fa-circle-notch fa-spin"></i>
              </span>
            </span>
            <button v-if="change.newValue" class="copy-btn" :title="t('common.copy')" @click="emit('copy-output')">
              <i class="fa-solid fa-copy"></i>
            </button>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="pane-content" v-html="escapeHtml(change.newValue)"></div>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped lang="scss">
.multi-diff-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
  flex: 1;
  min-height: 300px;
  overflow: auto;
}

.field-diff {
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background-color: var(--black-20a);
  overflow: hidden;
}

.field-header {
  padding: 8px 10px;
  background-color: var(--white-10a);
  font-weight: bold;
  border-bottom: 1px solid var(--theme-border-color);
}

.single-view {
  display: flex;
  gap: 10px;
  flex: 1;
  min-height: 200px;
  overflow: hidden;
}

.pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background-color: var(--black-30a);
  min-width: 0;
  min-height: 0;
  max-height: 100%;
}

.pane-header {
  padding: 5px 10px;
  border-bottom: 1px solid var(--theme-border-color);
  font-weight: bold;
  background-color: var(--white-20a);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.copy-btn {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  padding: 4px 8px;
  border-radius: 3px;
  transition: opacity 0.2s;

  &:hover {
    opacity: 1;
    background-color: var(--black-20a);
  }
}

.pane-content {
  flex: 1;
  padding: 10px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
  line-height: 1.5;
}

.generating-indicator {
  color: var(--theme-text-color);
  opacity: 0.7;
}
</style>
