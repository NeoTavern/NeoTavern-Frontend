<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Button, Tabs } from '../../../components/UI';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
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

const activeTab = ref('due');
const events = ref<TimelineEvent[]>([]);
const currentStoryTime = ref<TimelineTimeRef | undefined>();
const loading = ref(false);

const tabs = [
  { label: 'Due', value: 'due' },
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'Recurring', value: 'recurring' },
  { label: 'History', value: 'history' },
  { label: 'Time', value: 'time' },
];

function getTimelineExtra(): TimelineChatExtraData {
  return props.api.chat.metadata.get()?.extra?.[EXTENSION_ID] ?? {};
}

async function refresh(): Promise<void> {
  events.value = [...(getTimelineExtra().events ?? [])];
  currentStoryTime.value = await props.getCurrentStoryTime();
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
  const currentExtra = props.api.chat.metadata.get()?.extra ?? {};
  props.api.chat.metadata.update({
    extra: {
      ...currentExtra,
      [EXTENSION_ID]: {
        ...((currentExtra[EXTENSION_ID] as TimelineChatExtraData | undefined) ?? {}),
        events: nextEvents,
      },
    } as Record<string, unknown> & TimelineChatExtra,
  });
  await props.api.events.emit(TIMELINE_UPDATED_EVENT);
}

async function updateStatus(event: TimelineEvent, status: TimelineEvent['status']): Promise<void> {
  const next = events.value.map((item) =>
    item.id === event.id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
  );
  await setEvents(next);
}

async function toggleInject(event: TimelineEvent): Promise<void> {
  const next = events.value.map((item) =>
    item.id === event.id ? { ...item, inject: item.inject === false, updatedAt: new Date().toISOString() } : item,
  );
  await setEvents(next);
}

async function removeEvent(event: TimelineEvent): Promise<void> {
  await setEvents(events.value.filter((item) => item.id !== event.id));
}

async function clearAll(): Promise<void> {
  const { result } = await props.api.ui.showPopup({
    title: 'Clear Timeline?',
    content: 'Remove all timeline events for this chat?',
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
    props.api.ui.showToast('Timeline JSON copied.', 'success');
  } catch {
    props.api.ui.showToast('Failed to copy Timeline JSON.', 'error');
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
      <Button icon="fa-wand-magic-sparkles" :loading="loading" @click="extract">Extract</Button>
      <Button icon="fa-rotate" variant="ghost" @click="refresh">Refresh</Button>
      <Button icon="fa-copy" variant="ghost" :disabled="events.length === 0" @click="copyJson">Copy JSON</Button>
      <Button icon="fa-trash" variant="danger" :disabled="events.length === 0" @click="clearAll">Clear</Button>
    </div>

    <div class="timeline-panel__time">
      <span>Story time</span>
      <strong>{{ currentStoryTime?.display ?? 'No valid tracker time' }}</strong>
    </div>

    <div class="timeline-panel__tabs">
      <Tabs v-model="activeTab" :options="tabs" />
    </div>

    <div class="timeline-panel__content">
      <div v-if="activeTab === 'due'" class="timeline-list">
        <div v-if="dueEvents.length === 0" class="timeline-empty">No due events.</div>
        <article v-for="event in dueEvents" :key="event.id" class="timeline-item timeline-item--due">
          <div class="timeline-item__header">
            <strong>{{ event.title }}</strong>
            <span>{{ event.type }}</span>
          </div>
          <p>{{ event.description }}</p>
          <div class="timeline-item__meta">
            <span>{{ event.dueAt?.display }}</span>
            <span>{{ event.importance }} · {{ event.inject === false ? 'muted' : 'injects' }}</span>
          </div>
          <div class="timeline-item__actions">
            <Button variant="confirm" icon="fa-check" @click="updateStatus(event, 'resolved')">Resolve</Button>
            <Button variant="ghost" icon="fa-ban" @click="updateStatus(event, 'cancelled')">Cancel</Button>
            <Button variant="ghost" icon="fa-bullhorn" @click="toggleInject(event)">
              {{ event.inject === false ? 'Inject' : 'Mute' }}
            </Button>
            <Button variant="danger" icon="fa-trash" @click="removeEvent(event)">Remove</Button>
          </div>
        </article>
      </div>

      <div v-if="activeTab === 'upcoming'" class="timeline-list">
        <div v-if="upcomingEvents.length === 0" class="timeline-empty">No upcoming events.</div>
        <article v-for="event in upcomingEvents" :key="event.id" class="timeline-item">
          <div class="timeline-item__header">
            <strong>{{ event.title }}</strong>
            <span>{{ event.dueAt?.display }}</span>
          </div>
          <p>{{ event.description }}</p>
          <div class="timeline-item__meta">
            <span>{{ event.type }}</span>
            <span>{{ event.inject === false ? 'muted' : 'injects' }} · {{ event.tags.join(', ') }}</span>
          </div>
          <div class="timeline-item__actions">
            <Button variant="confirm" icon="fa-check" @click="updateStatus(event, 'resolved')">Resolve</Button>
            <Button variant="ghost" icon="fa-ban" @click="updateStatus(event, 'cancelled')">Cancel</Button>
            <Button variant="ghost" icon="fa-bullhorn" @click="toggleInject(event)">
              {{ event.inject === false ? 'Inject' : 'Mute' }}
            </Button>
            <Button variant="danger" icon="fa-trash" @click="removeEvent(event)">Remove</Button>
          </div>
        </article>
      </div>

      <div v-if="activeTab === 'recurring'" class="timeline-list">
        <div v-if="recurringEvents.length === 0" class="timeline-empty">No recurring events.</div>
        <article v-for="event in recurringEvents" :key="event.id" class="timeline-item">
          <div class="timeline-item__header">
            <strong>{{ event.title }}</strong>
            <span>{{ recurrenceLabel(event) }}</span>
          </div>
          <p>{{ event.description }}</p>
          <div class="timeline-item__meta">
            <span>{{ event.dueAt?.display ?? 'No due time' }}</span>
            <span>{{ event.inject === false ? 'muted' : 'injects' }} · {{ event.tags.join(', ') }}</span>
          </div>
          <div class="timeline-item__actions">
            <Button variant="confirm" icon="fa-check" @click="updateStatus(event, 'resolved')">Resolve</Button>
            <Button variant="ghost" icon="fa-ban" @click="updateStatus(event, 'cancelled')">Cancel</Button>
            <Button variant="ghost" icon="fa-bullhorn" @click="toggleInject(event)">
              {{ event.inject === false ? 'Inject' : 'Mute' }}
            </Button>
            <Button variant="danger" icon="fa-trash" @click="removeEvent(event)">Remove</Button>
          </div>
        </article>
      </div>

      <div v-if="activeTab === 'history'" class="timeline-list">
        <div v-if="historyEvents.length === 0" class="timeline-empty">No resolved or cancelled events.</div>
        <article v-for="event in historyEvents" :key="event.id" class="timeline-item timeline-item--muted">
          <div class="timeline-item__header">
            <strong>{{ event.title }}</strong>
            <span>{{ event.status }}</span>
          </div>
          <p>{{ event.description }}</p>
          <div class="timeline-item__actions">
            <Button variant="ghost" icon="fa-bullhorn" @click="toggleInject(event)">
              {{ event.inject === false ? 'Inject' : 'Mute' }}
            </Button>
            <Button variant="danger" icon="fa-trash" @click="removeEvent(event)">Remove</Button>
          </div>
        </article>
      </div>

      <div v-if="activeTab === 'time'" class="timeline-time-details">
        <div>
          <span>Current</span>
          <strong>{{ currentStoryTime?.display ?? 'Unavailable' }}</strong>
        </div>
        <div>
          <span>Comparable</span>
          <strong>{{ currentStoryTime?.comparable ?? 'Unavailable' }}</strong>
        </div>
        <div>
          <span>Precision</span>
          <strong>{{ currentStoryTime?.precision ?? 'Unavailable' }}</strong>
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

.timeline-empty {
  color: var(--theme-text-color-secondary);
  padding: var(--spacing-md);
  text-align: center;
}

.timeline-item {
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-sm);
  background: var(--theme-background-color);
}

.timeline-item--due {
  border-left: 3px solid var(--color-warning-amber);
}

.timeline-item--muted {
  opacity: 0.75;
}

.timeline-item__header,
.timeline-item__meta,
.timeline-item__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.timeline-item__header span {
  color: var(--theme-text-color-secondary);
  font-size: 0.8rem;
}

.timeline-item p {
  margin: var(--spacing-xs) 0;
  line-height: 1.4;
}

.timeline-item__actions {
  justify-content: flex-start;
  margin-top: var(--spacing-sm);
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
