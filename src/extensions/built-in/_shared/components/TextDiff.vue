<script setup lang="ts">
import * as Diff from 'diff';
import { computed } from 'vue';

const props = defineProps<{
  oldValue: string;
  newValue: string;
}>();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Word diff of the two values. An empty new value shows the old one unmarked. */
const html = computed(() => {
  if (!props.newValue) return { left: escapeHtml(props.oldValue), right: '' };

  let left = '';
  let right = '';
  for (const part of Diff.diffWords(props.oldValue, props.newValue)) {
    const escaped = escapeHtml(part.value);
    if (part.removed) {
      left += `<span class="diff-del">${escaped}</span>`;
    } else if (part.added) {
      right += `<span class="diff-ins">${escaped}</span>`;
    } else {
      left += escaped;
      right += escaped;
    }
  }
  return { left, right };
});
</script>
<template>
  <div class="text-diff">
    <div class="pane">
      <div class="pane-header"><slot name="old-header" /></div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="pane-content" v-html="html.left"></div>
    </div>
    <div class="pane">
      <div class="pane-header"><slot name="new-header" :has-output="html.right !== ''" /></div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="pane-content" v-html="html.right"></div>
    </div>
  </div>
</template>
<style scoped lang="scss">
.text-diff {
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
</style>
