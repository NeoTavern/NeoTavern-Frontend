<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { EmptyState } from '../../../components/common';
import { Button, Select, Tabs } from '../../../components/UI';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import { getChatExtra, mergeChatExtra } from '../_shared/runtime/extension-extra';
import { parseStoryDatetime } from '../tracker/story-time';
import {
  EXTENSION_ID,
  TIMELINE_UPDATED_EVENT,
  type TimelineChatExtra,
  type TimelineChatExtraData,
  type TimelineEvent,
  type TimelineExtensionAPI,
  type TimelineTimeRef,
} from './types';

const props = defineProps<{
  api: TimelineExtensionAPI;
  runExtraction: () => Promise<void>;
  getCurrentStoryTime: () => Promise<TimelineTimeRef | undefined>;
}>();

const t = props.api.i18n.t;
const activeTab = ref('due');
const events = ref<TimelineEvent[]>([]);
const currentStoryTime = ref<TimelineTimeRef | undefined>();
const loading = ref(false);
const dueDrafts = ref<Record<string, string>>({});
const expandedEventIds = ref<Set<string>>(new Set());

const tabs = [
  { label: t('extensionsBuiltin.timeline.tabs.due'), value: 'due' },
  { label: t('extensionsBuiltin.timeline.tabs.upcoming'), value: 'upcoming' },
  { label: t('extensionsBuiltin.timeline.tabs.recurring'), value: 'recurring' },
  { label: t('extensionsBuiltin.timeline.tabs.history'), value: 'history' },
  { label: t('extensionsBuiltin.timeline.tabs.time'), value: 'time' },
];

const statusOptions: Array<{ label: string; value: TimelineEvent['status'] }> = [
  { label: t('extensionsBuiltin.timeline.status.pending'), value: 'pending' },
  { label: t('extensionsBuiltin.timeline.status.resolved'), value: 'resolved' },
  { label: t('extensionsBuiltin.timeline.status.cancelled'), value: 'cancelled' },
];

function getTimelineExtra(): TimelineChatExtraData {
  return getChatExtra<TimelineChatExtraData>(props.api, EXTENSION_ID) ?? {};
}

async function refresh(): Promise<void> {
  events.value = [...(getTimelineExtra().events ?? [])];
  currentStoryTime.value = await props.getCurrentStoryTime();
  dueDrafts.value = Object.fromEntries(events.value.map((event) => [event.id, event.dueAt?.display ?? '']));
}

function isDue(event: TimelineEvent): boolean {
  return Boolean(
    currentStoryTime.value &&
    event.status === 'pending' &&
    event.dueAt &&
    event.dueAt.comparable <= currentStoryTime.value.comparable,
  );
}

const dueEvents = computed(() => events.value.filter((event) => isDue(event)));
const upcomingEvents = computed(() =>
  events.value
    .filter(
      (event) =>
        currentStoryTime.value &&
        event.status === 'pending' &&
        event.dueAt &&
        event.dueAt.comparable > currentStoryTime.value.comparable,
    )
    .sort((a, b) => (a.dueAt?.comparable ?? 0) - (b.dueAt?.comparable ?? 0)),
);
const recurringEvents = computed(() => events.value.filter((event) => event.status === 'pending' && event.recurrence));
const historyEvents = computed(() => events.value.filter((event) => event.status !== 'pending'));

async function setEvents(nextEvents: TimelineEvent[]): Promise<void> {
  mergeChatExtra<TimelineChatExtra>(props.api, EXTENSION_ID, { events: nextEvents });
  await props.api.events.emit(TIMELINE_UPDATED_EVENT);
}

async function updateStatus(event: TimelineEvent, status: TimelineEvent['status']): Promise<void> {
  const next = events.value.map((item) =>
    item.id === event.id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
  );
  await setEvents(next);
}

async function onStatusChange(event: TimelineEvent, value: string | number | Array<string | number>): Promise<void> {
  if (Array.isArray(value)) return;
  if (value !== 'pending' && value !== 'resolved' && value !== 'cancelled') return;
  await updateStatus(event, value);
}

async function toggleInject(event: TimelineEvent): Promise<void> {
  const next = events.value.map((item) =>
    item.id === event.id ? { ...item, inject: item.inject === false, updatedAt: new Date().toISOString() } : item,
  );
  await setEvents(next);
}

async function updateDueTime(event: TimelineEvent): Promise<void> {
  const draft = dueDrafts.value[event.id]?.trim() ?? '';
  if (!draft) {
    await clearDueTime(event);
    return;
  }

  const parsed = parseStoryDatetime(draft);
  if (!parsed) {
    props.api.ui.showToast(t('extensionsBuiltin.timeline.toasts.invalidTime'), 'error');
    return;
  }

  const dueAt: TimelineTimeRef = {
    display: draft,
    comparable: parsed.comparable,
    precision: parsed.precision,
  };
  const next = events.value.map((item) =>
    item.id === event.id ? { ...item, dueAt, updatedAt: new Date().toISOString() } : item,
  );
  await setEvents(next);
}

async function clearDueTime(event: TimelineEvent): Promise<void> {
  dueDrafts.value = { ...dueDrafts.value, [event.id]: '' };
  const next = events.value.map((item) => {
    if (item.id !== event.id) return item;
    const { dueAt, ...rest } = item;
    void dueAt;
    return { ...rest, updatedAt: new Date().toISOString() };
  });
  await setEvents(next);
}

async function removeEvent(event: TimelineEvent): Promise<void> {
  await setEvents(events.value.filter((item) => item.id !== event.id));
}

function isExpanded(eventId: string): boolean {
  return expandedEventIds.value.has(eventId);
}

function toggleExpanded(eventId: string): void {
  const next = new Set(expandedEventIds.value);
  if (next.has(eventId)) {
    next.delete(eventId);
  } else {
    next.add(eventId);
  }
  expandedEventIds.value = next;
}

async function clearAll(): Promise<void> {
  const { result } = await props.api.ui.showPopup({
    title: t('extensionsBuiltin.timeline.clearTimelineTitle'),
    content: t('extensionsBuiltin.timeline.clearTimelineContent'),
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.delete',
    cancelButton: 'common.cancel',
  });
  if (result !== POPUP_RESULT.AFFIRMATIVE) return;
  await setEvents([]);
}

async function copyJson(): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(events.value, null, 2));
    props.api.ui.showToast(t('extensionsBuiltin.timeline.toasts.jsonCopied'), 'success');
  } catch {
    props.api.ui.showToast(t('extensionsBuiltin.timeline.toasts.jsonCopyFailed'), 'error');
  }
}

async function extract(): Promise<void> {
  loading.value = true;
  try {
    await props.runExtraction();
    await refresh();
  } finally {
    loading.value = false;
  }
}

function recurrenceLabel(event: TimelineEvent): string {
  if (!event.recurrence) return '';
  return `Every ${event.recurrence.interval} ${event.recurrence.unit}${event.recurrence.interval === 1 ? '' : 's'}`;
}

let unbindTimeline: (() => void) | undefined;
let unbindChat: (() => void) | undefined;

onMounted(async () => {
  await refresh();
  unbindTimeline = props.api.events.on(TIMELINE_UPDATED_EVENT, () => refresh());
  unbindChat = props.api.events.on('chat:entered', () => refresh());
});

onBeforeUnmount(() => {
  unbindTimeline?.();
  unbindChat?.();
});
</script>

<template>
  <div class="timeline-panel">
    <div class="timeline-panel__toolbar">
      <Button icon="fa-wand-magic-sparkles" :loading="loading" @click="extract">
        {{ t('extensionsBuiltin.timeline.extract') }}
      </Button>
      <Button icon="fa-rotate" variant="ghost" @click="refresh">{{ t('common.refresh') }}</Button>
      <Button icon="fa-copy" variant="ghost" :disabled="events.length === 0" @click="copyJson">
        {{ t('extensionsBuiltin.timeline.copyJson') }}
      </Button>
      <Button icon="fa-trash" variant="danger" :disabled="events.length === 0" @click="clearAll">
        {{ t('common.clear') }}
      </Button>
    </div>

    <div class="timeline-panel__time">
      <span>{{ t('extensionsBuiltin.timeline.storyTime') }}</span>
      <strong>{{ currentStoryTime?.display ?? t('extensionsBuiltin.timeline.noValidTrackerTime') }}</strong>
    </div>

    <div class="timeline-panel__tabs">
      <Tabs v-model="activeTab" :options="tabs" />
    </div>

    <div class="timeline-panel__content">
      <div v-if="activeTab === 'due'" class="timeline-list">
        <EmptyState v-if="dueEvents.length === 0" :description="t('extensionsBuiltin.timeline.noDueEvents')" />
        <article v-for="event in dueEvents" :key="event.id" class="timeline-item timeline-item--due">
          <button class="timeline-item__summary" type="button" @click="toggleExpanded(event.id)">
            <span>
              <strong>{{ event.title }}</strong>
              <small>{{ event.type }} · {{ event.importance }}</small>
            </span>
            <span>{{ event.dueAt?.display }}</span>
            <i :class="['fa-solid', isExpanded(event.id) ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
          </button>
          <div class="timeline-item__body">
            <p>{{ event.description }}</p>
            <div class="timeline-item__meta">
              <span>{{ event.status }}</span>
              <span
                >{{
                  event.inject === false
                    ? t('extensionsBuiltin.timeline.muted')
                    : t('extensionsBuiltin.timeline.injects')
                }}
                · {{ event.tags.join(', ') || t('extensionsBuiltin.timeline.noTags') }}</span
              >
            </div>
          </div>
          <div v-if="isExpanded(event.id)" class="timeline-item__details">
            <div class="timeline-item__editor">
              <Select
                :model-value="event.status"
                :options="statusOptions"
                :title="t('extensionsBuiltin.timeline.statusTitle')"
                @change="onStatusChange(event, $event)"
              />
              <input
                v-model="dueDrafts[event.id]"
                class="text-pole timeline-item__time-input"
                :placeholder="t('extensionsBuiltin.timeline.timePlaceholder')"
              />
              <Button variant="ghost" icon="fa-floppy-disk" @click="updateDueTime(event)">
                {{ t('extensionsBuiltin.timeline.saveTime') }}
              </Button>
              <Button variant="ghost" icon="fa-clock-rotate-left" @click="clearDueTime(event)">
                {{ t('extensionsBuiltin.timeline.clearTime') }}
              </Button>
            </div>
            <div class="timeline-item__actions">
              <Button variant="ghost" icon="fa-bullhorn" @click="toggleInject(event)">
                {{
                  event.inject === false ? t('extensionsBuiltin.timeline.inject') : t('extensionsBuiltin.timeline.mute')
                }}
              </Button>
              <Button variant="danger" icon="fa-trash" @click="removeEvent(event)">{{ t('common.remove') }}</Button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="activeTab === 'upcoming'" class="timeline-list">
        <EmptyState
          v-if="upcomingEvents.length === 0"
          :description="t('extensionsBuiltin.timeline.noUpcomingEvents')"
        />
        <article v-for="event in upcomingEvents" :key="event.id" class="timeline-item">
          <button class="timeline-item__summary" type="button" @click="toggleExpanded(event.id)">
            <span>
              <strong>{{ event.title }}</strong>
              <small>{{ event.type }} · {{ event.importance }}</small>
            </span>
            <span>{{ event.dueAt?.display }}</span>
            <i :class="['fa-solid', isExpanded(event.id) ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
          </button>
          <div class="timeline-item__body">
            <p>{{ event.description }}</p>
            <div class="timeline-item__meta">
              <span>{{ event.status }}</span>
              <span
                >{{
                  event.inject === false
                    ? t('extensionsBuiltin.timeline.muted')
                    : t('extensionsBuiltin.timeline.injects')
                }}
                · {{ event.tags.join(', ') || t('extensionsBuiltin.timeline.noTags') }}</span
              >
            </div>
          </div>
          <div v-if="isExpanded(event.id)" class="timeline-item__details">
            <div class="timeline-item__editor">
              <Select
                :model-value="event.status"
                :options="statusOptions"
                :title="t('extensionsBuiltin.timeline.statusTitle')"
                @change="onStatusChange(event, $event)"
              />
              <input
                v-model="dueDrafts[event.id]"
                class="text-pole timeline-item__time-input"
                :placeholder="t('extensionsBuiltin.timeline.timePlaceholder')"
              />
              <Button variant="ghost" icon="fa-floppy-disk" @click="updateDueTime(event)">
                {{ t('extensionsBuiltin.timeline.saveTime') }}
              </Button>
              <Button variant="ghost" icon="fa-clock-rotate-left" @click="clearDueTime(event)">
                {{ t('extensionsBuiltin.timeline.clearTime') }}
              </Button>
            </div>
            <div class="timeline-item__actions">
              <Button variant="ghost" icon="fa-bullhorn" @click="toggleInject(event)">
                {{
                  event.inject === false ? t('extensionsBuiltin.timeline.inject') : t('extensionsBuiltin.timeline.mute')
                }}
              </Button>
              <Button variant="danger" icon="fa-trash" @click="removeEvent(event)">{{ t('common.remove') }}</Button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="activeTab === 'recurring'" class="timeline-list">
        <EmptyState
          v-if="recurringEvents.length === 0"
          :description="t('extensionsBuiltin.timeline.noRecurringEvents')"
        />
        <article v-for="event in recurringEvents" :key="event.id" class="timeline-item">
          <button class="timeline-item__summary" type="button" @click="toggleExpanded(event.id)">
            <span>
              <strong>{{ event.title }}</strong>
              <small>{{ recurrenceLabel(event) }}</small>
            </span>
            <span>{{ event.dueAt?.display ?? t('extensionsBuiltin.timeline.noDueTime') }}</span>
            <i :class="['fa-solid', isExpanded(event.id) ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
          </button>
          <div class="timeline-item__body">
            <p>{{ event.description }}</p>
            <div class="timeline-item__meta">
              <span>{{ event.status }}</span>
              <span
                >{{
                  event.inject === false
                    ? t('extensionsBuiltin.timeline.muted')
                    : t('extensionsBuiltin.timeline.injects')
                }}
                · {{ event.tags.join(', ') || t('extensionsBuiltin.timeline.noTags') }}</span
              >
            </div>
          </div>
          <div v-if="isExpanded(event.id)" class="timeline-item__details">
            <div class="timeline-item__editor">
              <Select
                :model-value="event.status"
                :options="statusOptions"
                :title="t('extensionsBuiltin.timeline.statusTitle')"
                @change="onStatusChange(event, $event)"
              />
              <input
                v-model="dueDrafts[event.id]"
                class="text-pole timeline-item__time-input"
                :placeholder="t('extensionsBuiltin.timeline.timePlaceholder')"
              />
              <Button variant="ghost" icon="fa-floppy-disk" @click="updateDueTime(event)">
                {{ t('extensionsBuiltin.timeline.saveTime') }}
              </Button>
              <Button variant="ghost" icon="fa-clock-rotate-left" @click="clearDueTime(event)">
                {{ t('extensionsBuiltin.timeline.clearTime') }}
              </Button>
            </div>
            <div class="timeline-item__actions">
              <Button variant="ghost" icon="fa-bullhorn" @click="toggleInject(event)">
                {{
                  event.inject === false ? t('extensionsBuiltin.timeline.inject') : t('extensionsBuiltin.timeline.mute')
                }}
              </Button>
              <Button variant="danger" icon="fa-trash" @click="removeEvent(event)">{{ t('common.remove') }}</Button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="activeTab === 'history'" class="timeline-list">
        <EmptyState v-if="historyEvents.length === 0" :description="t('extensionsBuiltin.timeline.noHistoryEvents')" />
        <article v-for="event in historyEvents" :key="event.id" class="timeline-item timeline-item--muted">
          <button class="timeline-item__summary" type="button" @click="toggleExpanded(event.id)">
            <span>
              <strong>{{ event.title }}</strong>
              <small>{{ event.type }} · {{ event.importance }}</small>
            </span>
            <span>{{ event.status }}</span>
            <i :class="['fa-solid', isExpanded(event.id) ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
          </button>
          <div class="timeline-item__body">
            <p>{{ event.description }}</p>
            <div class="timeline-item__meta">
              <span>{{ event.dueAt?.display ?? t('extensionsBuiltin.timeline.noDueTime') }}</span>
              <span
                >{{
                  event.inject === false
                    ? t('extensionsBuiltin.timeline.muted')
                    : t('extensionsBuiltin.timeline.injects')
                }}
                · {{ event.tags.join(', ') || t('extensionsBuiltin.timeline.noTags') }}</span
              >
            </div>
          </div>
          <div v-if="isExpanded(event.id)" class="timeline-item__details">
            <div class="timeline-item__editor">
              <Select
                :model-value="event.status"
                :options="statusOptions"
                :title="t('extensionsBuiltin.timeline.statusTitle')"
                @change="onStatusChange(event, $event)"
              />
              <input
                v-model="dueDrafts[event.id]"
                class="text-pole timeline-item__time-input"
                :placeholder="t('extensionsBuiltin.timeline.timePlaceholder')"
              />
              <Button variant="ghost" icon="fa-floppy-disk" @click="updateDueTime(event)">
                {{ t('extensionsBuiltin.timeline.saveTime') }}
              </Button>
              <Button variant="ghost" icon="fa-clock-rotate-left" @click="clearDueTime(event)">
                {{ t('extensionsBuiltin.timeline.clearTime') }}
              </Button>
            </div>
            <div class="timeline-item__actions">
              <Button variant="ghost" icon="fa-bullhorn" @click="toggleInject(event)">
                {{
                  event.inject === false ? t('extensionsBuiltin.timeline.inject') : t('extensionsBuiltin.timeline.mute')
                }}
              </Button>
              <Button variant="danger" icon="fa-trash" @click="removeEvent(event)">{{ t('common.remove') }}</Button>
            </div>
          </div>
        </article>
      </div>

      <div v-if="activeTab === 'time'" class="timeline-time-details">
        <div>
          <span>{{ t('extensionsBuiltin.timeline.current') }}</span>
          <strong>{{ currentStoryTime?.display ?? t('extensionsBuiltin.timeline.unavailable') }}</strong>
        </div>
        <div>
          <span>{{ t('extensionsBuiltin.timeline.comparable') }}</span>
          <strong>{{ currentStoryTime?.comparable ?? t('extensionsBuiltin.timeline.unavailable') }}</strong>
        </div>
        <div>
          <span>{{ t('extensionsBuiltin.timeline.precision') }}</span>
          <strong>{{ currentStoryTime?.precision ?? t('extensionsBuiltin.timeline.unavailable') }}</strong>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--theme-background-tint);
}

.timeline-panel__toolbar {
  display: flex;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--theme-border-color);
}

.timeline-panel__time {
  display: grid;
  gap: 2px;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--theme-border-color);
}

.timeline-panel__time span,
.timeline-item__meta,
.timeline-time-details span {
  color: var(--theme-text-color-secondary);
  font-size: 0.85rem;
}

.timeline-panel__tabs {
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--theme-border-color);
}

.timeline-panel__content {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md);
}

.timeline-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.timeline-item {
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background: var(--theme-background-color);
  overflow: hidden;
}

.timeline-item--due {
  border-left: 3px solid var(--color-warning-amber);
}

.timeline-item--muted {
  opacity: 0.75;
}

.timeline-item__meta,
.timeline-item__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.timeline-item__summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  width: 100%;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.timeline-item__summary > span:first-child {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.timeline-item__summary strong,
.timeline-item__summary small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-item__summary small,
.timeline-item__summary > span:nth-child(2),
.timeline-item__summary i {
  color: var(--theme-text-color-secondary);
  font-size: 0.8rem;
}

.timeline-item__summary:hover {
  background: var(--theme-background-tint);
}

.timeline-item__details {
  padding: 0 var(--spacing-sm) var(--spacing-sm);
  border-top: 1px solid var(--theme-border-color);
}

.timeline-item__body {
  display: grid;
  gap: var(--spacing-xs);
  padding: 0 var(--spacing-sm) var(--spacing-sm);
}

.timeline-item__editor {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(150px, 1.4fr);
  gap: var(--spacing-xs);
  margin-top: var(--spacing-sm);
}

.timeline-item__editor :deep(.select-wrapper) {
  min-width: 0;
}

.timeline-item__time-input {
  width: 100%;
  min-width: 0;
}

.timeline-item p {
  margin: 0;
  line-height: 1.4;
}

.timeline-item__meta {
  flex-wrap: wrap;
}

.timeline-item__meta span:last-child {
  overflow-wrap: anywhere;
  text-align: right;
}

.timeline-item__actions {
  flex-wrap: wrap;
  justify-content: flex-start;
  margin-top: var(--spacing-sm);
}

@media (max-width: 520px) {
  .timeline-item__editor {
    grid-template-columns: 1fr;
  }
}

.timeline-time-details {
  display: grid;
  gap: var(--spacing-sm);
}

.timeline-time-details > div {
  display: grid;
  gap: 2px;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-sm);
}
</style>
