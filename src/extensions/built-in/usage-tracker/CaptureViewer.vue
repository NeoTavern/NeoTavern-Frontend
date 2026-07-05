<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { EmptyState } from '../../../components/common';
import { Button } from '../../../components/UI';
import { useStrictI18n } from '../../../composables/useStrictI18n';
import type { UsageCaptureEntry } from './types';

const props = defineProps<{
  captures: UsageCaptureEntry[];
  formatSource?: (source: string) => string;
}>();

const PRETTY_MODE_STORAGE_KEY = 'NeoTavern_UsageTracker_CaptureViewer_PrettyMode';
const { t } = useStrictI18n();

function getSavedPrettyMode(): boolean {
  try {
    const saved = localStorage.getItem(PRETTY_MODE_STORAGE_KEY);
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

const selectedId = ref(props.captures[0]?.id ?? '');
const activePane = ref<'request' | 'response'>('request');
const prettyMode = ref(getSavedPrettyMode());

watch(prettyMode, (value) => {
  try {
    localStorage.setItem(PRETTY_MODE_STORAGE_KEY, String(value));
  } catch {}
});

const selectedCapture = computed(
  () => props.captures.find((capture) => capture.id === selectedId.value) ?? props.captures[0],
);

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatContent(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!isRecord(part)) return stringify(part);
        if (part.type === 'text') return typeof part.text === 'string' ? part.text : '';
        if (typeof part.type === 'string') return `[${part.type}] ${stringify(part)}`;
        return stringify(part);
      })
      .filter((part) => part.trim().length > 0)
      .join('\n');
  }

  return stringify(content);
}

function formatMessages(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;

  return messages
    .map((message) => {
      if (!isRecord(message)) return stringify(message);
      const role =
        typeof message.role === 'string'
          ? message.role.toUpperCase()
          : t('extensionsBuiltin.usageTracker.message').toUpperCase();
      const name = typeof message.name === 'string' && message.name ? ` (${message.name})` : '';
      const content = formatContent(message.content);
      const toolCalls = message.tool_calls
        ? `\n\n${t('extensionsBuiltin.usageTracker.toolCalls').toUpperCase()}:\n${stringify(message.tool_calls)}`
        : '';
      return `${role}${name}:\n${content}${toolCalls}`;
    })
    .join('\n\n');
}

function formatRequest(request: unknown): string {
  if (!isRecord(request)) return stringify(request);

  const formattedMessages = formatMessages(request.messages);
  if (formattedMessages) return formattedMessages;

  if (typeof request.prompt === 'string') {
    return `${t('extensionsBuiltin.usageTracker.prompt').toUpperCase()}:\n${request.prompt}`;
  }

  return stringify(request);
}

function formatResponse(response: unknown, responseText?: string): string {
  if (responseText?.trim()) return responseText;
  if (!isRecord(response)) return stringify(response);

  const sections: string[] = [];
  if (typeof response.content === 'string' && response.content.trim()) {
    sections.push(`${t('extensionsBuiltin.usageTracker.content').toUpperCase()}:\n${response.content}`);
  }
  if (typeof response.reasoning === 'string' && response.reasoning.trim()) {
    sections.push(`${t('extensionsBuiltin.usageTracker.reasoning').toUpperCase()}:\n${response.reasoning}`);
  }
  if (response.tool_calls)
    sections.push(`${t('extensionsBuiltin.usageTracker.toolCalls').toUpperCase()}:\n${stringify(response.tool_calls)}`);
  if (response.images)
    sections.push(`${t('extensionsBuiltin.usageTracker.images').toUpperCase()}:\n${stringify(response.images)}`);
  if (typeof response.error === 'string' && response.error.trim()) {
    sections.push(`${t('extensionsBuiltin.usageTracker.error').toUpperCase()}:\n${response.error}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : stringify(response);
}

const activeContent = computed(() => {
  const capture = selectedCapture.value;
  if (!capture) return '';

  if (!prettyMode.value) {
    if (activePane.value === 'request') return stringify(capture.request);
    return stringify(capture.response ?? capture.responseText ?? '');
  }

  if (activePane.value === 'request') return formatRequest(capture.request);
  return formatResponse(capture.response, capture.responseText);
});

function sourceLabel(source: string): string {
  return props.formatSource?.(source) ?? source;
}
</script>

<template>
  <div class="usage-capture-viewer">
    <aside class="capture-list">
      <button
        v-for="capture in captures"
        :key="capture.id"
        class="capture-list-item"
        :class="{ active: capture.id === selectedCapture?.id }"
        @click="selectedId = capture.id"
      >
        <span>{{ new Date(capture.timestamp).toLocaleString() }}</span>
        <small :title="capture.source">{{ sourceLabel(capture.source) }}</small>
        <small>{{ capture.model }} · #{{ capture.messageIndex ?? '-' }}</small>
      </button>
    </aside>

    <section v-if="selectedCapture" class="capture-detail">
      <div class="capture-meta">
        <span class="badge">{{ selectedCapture.status }}</span>
        <span>{{ Math.ceil(selectedCapture.sizeBytes / 1024) }} KB</span>
      </div>

      <div class="capture-toolbar">
        <div class="capture-tabs">
          <Button
            :variant="activePane === 'request' ? 'default' : 'ghost'"
            icon="fa-arrow-up"
            @click="activePane = 'request'"
          >
            {{ t('extensionsBuiltin.usageTracker.request') }}
          </Button>
          <Button
            :variant="activePane === 'response' ? 'default' : 'ghost'"
            icon="fa-arrow-down"
            @click="activePane = 'response'"
          >
            {{ t('extensionsBuiltin.usageTracker.response') }}
          </Button>
        </div>

        <Button
          :variant="prettyMode ? 'default' : 'ghost'"
          icon="fa-wand-magic-sparkles"
          @click="prettyMode = !prettyMode"
        >
          {{ prettyMode ? t('extensionsBuiltin.usageTracker.pretty') : t('extensionsBuiltin.usageTracker.raw') }}
        </Button>
      </div>

      <pre class="capture-code">{{ activeContent || t('extensionsBuiltin.usageTracker.noDataCaptured') }}</pre>
    </section>

    <EmptyState v-else :description="t('extensionsBuiltin.usageTracker.noCaptures')" />
  </div>
</template>

<style scoped lang="scss">
.usage-capture-viewer {
  display: grid;
  grid-template-columns: minmax(180px, 260px) 1fr;
  gap: 1rem;
  height: clamp(280px, 52dvh, 560px);
  max-height: calc(95dvh - 220px);
  min-height: 240px;
  overflow: hidden;
}

.capture-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid var(--theme-border-color);
  padding-right: 0.75rem;
}

.capture-list-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.55rem;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background: var(--black-30a);
  color: inherit;
  text-align: left;
  cursor: pointer;

  &.active,
  &:hover {
    background: var(--white-20a);
  }

  small {
    color: var(--theme-emphasis-color);
  }
}

.capture-detail {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.capture-meta,
.capture-toolbar,
.capture-tabs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.capture-toolbar {
  flex: 0 0 auto;
  justify-content: space-between;
}
.badge {
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  background: var(--grey-5050a);
  text-transform: uppercase;
  font-size: 0.8em;
}

.capture-code {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  margin: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  padding: 1rem;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background: var(--black-50a);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-family: var(--font-family-mono);
  font-size: 0.85em;
}

@media (max-width: 700px) {
  .usage-capture-viewer {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    height: clamp(320px, 62dvh, 640px);
    max-height: calc(95dvh - 220px);
  }

  .capture-list {
    border-right: 0;
    border-bottom: 1px solid var(--theme-border-color);
    padding-right: 0;
    padding-bottom: 0.75rem;
    max-height: 180px;
  }
}
</style>
