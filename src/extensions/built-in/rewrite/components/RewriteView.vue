<script setup lang="ts">
import * as Diff from 'diff';
import { ref, watch } from 'vue';
import { useStrictI18n } from '../../../../composables/useStrictI18n';

const props = defineProps<{
  originalText: string;
  generatedText: string;
  isGenerating?: boolean;
  ignoreInput?: boolean;
}>();

const emit = defineEmits<{
  (e: 'copy-output'): void;
}>();

const { t } = useStrictI18n();

// Diff State
const leftHtml = ref<string>('');
const rightHtml = ref<string>('');
const leftPaneRef = ref<HTMLElement | null>(null);
const rightPaneRef = ref<HTMLElement | null>(null);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateDiff() {
  if (!props.generatedText) {
    leftHtml.value = escapeHtml(props.originalText);
    rightHtml.value = '';
    return;
  }

  if (props.ignoreInput) {
    rightHtml.value = escapeHtml(props.generatedText);
    return;
  }

  const diff = Diff.diffWords(props.originalText, props.generatedText);
  let lHtml = '';
  let rHtml = '';

  diff.forEach((part) => {
    const escapedVal = escapeHtml(part.value);
    if (part.removed) {
      lHtml += `<span class="diff-del">${escapedVal}</span>`;
    } else if (part.added) {
      rHtml += `<span class="diff-ins">${escapedVal}</span>`;
    } else {
      lHtml += escapedVal;
      rHtml += escapedVal;
    }
  });

  leftHtml.value = lHtml;
  rightHtml.value = rHtml;
}

watch(() => [props.originalText, props.generatedText], updateDiff, { immediate: true });

// Scroll Sync
let isSyncingLeft = false;
let isSyncingRight = false;

function onLeftScroll() {
  if (!leftPaneRef.value || !rightPaneRef.value) return;
  if (isSyncingLeft) {
    isSyncingLeft = false;
    return;
  }
  isSyncingRight = true;
  rightPaneRef.value.scrollTop = leftPaneRef.value.scrollTop;
  rightPaneRef.value.scrollLeft = leftPaneRef.value.scrollLeft;
}

function onRightScroll() {
  if (!leftPaneRef.value || !rightPaneRef.value) return;
  if (isSyncingRight) {
    isSyncingRight = false;
    return;
  }
  isSyncingLeft = true;
  leftPaneRef.value.scrollTop = rightPaneRef.value.scrollTop;
  leftPaneRef.value.scrollLeft = rightPaneRef.value.scrollLeft;
}
</script>
<template>
  <div v-if="!ignoreInput" class="split-view">
    <!-- Original / Left Pane -->
    <div class="pane">
      <div class="pane-header">{{ t('extensionsBuiltin.rewrite.popup.original') }}</div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div ref="leftPaneRef" class="pane-content diff-content" @scroll="onLeftScroll" v-html="leftHtml"></div>
    </div>

    <!-- Generated / Right Pane -->
    <div class="pane">
      <div class="pane-header">
        <span>
          {{ t('extensionsBuiltin.rewrite.popup.new') }}
          <span v-if="isGenerating" class="generating-indicator">
            <i class="fa-solid fa-circle-notch fa-spin"></i>
          </span>
        </span>
        <button v-if="generatedText" class="copy-btn" :title="t('common.copy')" @click="emit('copy-output')">
          <i class="fa-solid fa-copy"></i>
        </button>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div ref="rightPaneRef" class="pane-content diff-content" @scroll="onRightScroll" v-html="rightHtml"></div>
    </div>
  </div>

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
        <button v-if="generatedText" class="copy-btn" :title="t('common.copy')" @click="emit('copy-output')">
          <i class="fa-solid fa-copy"></i>
        </button>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div ref="rightPaneRef" class="pane-content" v-html="rightHtml"></div>
    </div>
  </div>
</template>
<style scoped lang="scss">
.split-view,
.single-view {
  display: flex;
  gap: 10px;
  flex: 1;
  min-height: 300px;
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

:deep(.diff-del) {
  background-color: var(--color-accent-crimson-70a);
  text-decoration: line-through;
  opacity: 0.8;
  border-radius: 2px;
}

:deep(.diff-ins) {
  background-color: var(--color-accent-green-70a);
  border-radius: 2px;
}

.generating-indicator {
  color: var(--theme-text-color);
  opacity: 0.7;
}
</style>
