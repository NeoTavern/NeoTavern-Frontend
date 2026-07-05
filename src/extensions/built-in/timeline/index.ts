import type { ApiChatMessage, StructuredResponseOptions } from '../../../types/generation';
import { resolveConnectionProfile } from '../_shared/runtime/connection-profile';
import { cloneJson } from '../_shared/data-utils';
import { getChatExtra, mergeChatExtra } from '../_shared/runtime/extension-extra';
import { generateStructuredResult, repairStructuredGeneration } from '../_shared/runtime/structured-generation';
import { createStructuredResponse } from '../_shared/runtime/structured-request-format';
import { parseStoryDatetime } from '../tracker/story-time';
import type { TrackerService } from '../tracker/types';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import TimelinePanel from './TimelinePanel.vue';
import {
  EXTENSION_ID,
  TIMELINE_UPDATED_EVENT,
  type TimelineChatExtra,
  type TimelineChatExtraData,
  type TimelineEvent,
  type TimelineExtensionAPI,
  type TimelineOperation,
  type TimelineOperationResponse,
  type TimelineRecurrenceUnit,
  type TimelineSettings,
  type TimelineTimeRef,
  migrateTimelineSettings,
  resolveTimelinePrompts,
} from './types';

export { manifest };

const SIDEBAR_ID = 'timeline-panel';
const QUICK_ACTION_GROUP_ID = 'core.context-ai';
const MAX_SCHEMA_REPAIRS = 3;
const MS_BY_UNIT: Record<Exclude<TimelineRecurrenceUnit, 'month'>, number> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

interface TimelineGenerationResult {
  operations?: TimelineOperation[];
  rawContent: string;
  parseError?: string;
  messages?: ApiChatMessage[];
}

function normalizeEventId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || `event-${Date.now()}`;
}

function addRelativeTime(comparable: number, amount: number, unit: TimelineRecurrenceUnit): number {
  if (unit === 'month') {
    const date = new Date(comparable);
    date.setUTCMonth(date.getUTCMonth() + amount);
    return date.getTime();
  }
  return comparable + amount * MS_BY_UNIT[unit];
}

function formatTime(comparable: number, precision: TimelineTimeRef['precision'] = 'minute'): string {
  const date = new Date(comparable);
  const pad = (value: number) => String(value).padStart(2, '0');
  const base = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}`;
  return precision === 'second' ? `${base}:${pad(date.getUTCSeconds())}` : base;
}

function getTimelineExtra(api: TimelineExtensionAPI): TimelineChatExtraData {
  return getChatExtra<TimelineChatExtraData>(api, EXTENSION_ID) ?? {};
}

function getEvents(api: TimelineExtensionAPI): TimelineEvent[] {
  return cloneJson(getTimelineExtra(api).events ?? []);
}

async function setEvents(api: TimelineExtensionAPI, events: TimelineEvent[]): Promise<void> {
  mergeChatExtra<TimelineChatExtra>(api, EXTENSION_ID, {
    events,
    lastExtractionAt: new Date().toISOString(),
  });
  await api.events.emit(TIMELINE_UPDATED_EVENT);
}

function getDueEvents(events: TimelineEvent[], nowComparable: number): TimelineEvent[] {
  return events
    .filter(
      (event) =>
        event.inject !== false && event.status === 'pending' && event.dueAt && event.dueAt.comparable <= nowComparable,
    )
    .sort((a, b) => (a.dueAt?.comparable ?? 0) - (b.dueAt?.comparable ?? 0));
}

function getUpcomingEvents(events: TimelineEvent[], nowComparable: number): TimelineEvent[] {
  return events
    .filter(
      (event) =>
        event.inject !== false && event.status === 'pending' && event.dueAt && event.dueAt.comparable > nowComparable,
    )
    .sort((a, b) => (a.dueAt?.comparable ?? 0) - (b.dueAt?.comparable ?? 0));
}

function limitEvents(events: TimelineEvent[], limit: number): TimelineEvent[] {
  if (limit === -1) return events;
  if (limit <= 0) return [];
  return events.slice(0, limit);
}

function resolveDueAt(operation: TimelineOperation, current?: TimelineTimeRef): TimelineTimeRef | undefined {
  if (operation.dueIn) {
    if (!current) return undefined;
    const comparable = addRelativeTime(current.comparable, operation.dueIn.amount, operation.dueIn.unit);
    return {
      comparable,
      display: formatTime(comparable, current.precision),
      precision: current.precision,
    };
  }
  if (operation.dueAtDatetime) {
    const parsed = parseStoryDatetime(operation.dueAtDatetime);
    if (parsed) {
      return {
        comparable: parsed.comparable,
        display: operation.dueAtDatetime,
        precision: parsed.precision,
      };
    }
  }
  return undefined;
}

function mergeOperations(
  existingEvents: TimelineEvent[],
  operations: TimelineOperation[],
  currentStoryTime?: TimelineTimeRef,
): TimelineEvent[] {
  const now = new Date().toISOString();
  const eventsById = new Map(existingEvents.map((event) => [event.id, cloneJson(event)]));

  for (const operation of operations) {
    const id = normalizeEventId(operation.id);
    const existing = eventsById.get(id);

    if (operation.operation === 'resolve' || operation.operation === 'cancel') {
      if (existing) {
        existing.status = operation.operation === 'resolve' ? 'resolved' : 'cancelled';
        existing.title = operation.title || existing.title;
        existing.description = operation.description || existing.description;
        existing.updatedAt = now;
        eventsById.set(id, existing);
      }
      continue;
    }

    const dueAt = resolveDueAt(operation, currentStoryTime) ?? existing?.dueAt;
    const event: TimelineEvent = {
      id,
      type: operation.type,
      title: operation.title,
      description: operation.description,
      createdAt: existing?.createdAt ?? currentStoryTime,
      dueAt,
      recurrence: operation.recurrence ?? existing?.recurrence,
      status: existing?.status === 'resolved' || existing?.status === 'cancelled' ? existing.status : 'pending',
      inject: operation.inject,
      importance: operation.importance,
      relatedCharacters: operation.relatedCharacters,
      tags: operation.tags,
      updatedAt: now,
    };

    eventsById.set(id, event);
  }

  return [...eventsById.values()].sort((a, b) => {
    const aDue = a.dueAt?.comparable ?? Number.MAX_SAFE_INTEGER;
    const bDue = b.dueAt?.comparable ?? Number.MAX_SAFE_INTEGER;
    return aDue - bDue || a.title.localeCompare(b.title);
  });
}

function getTimelineStructuredResponse(format: TimelineSettings['structuredRequestFormat']): StructuredResponseOptions {
  return createStructuredResponse(format, {
    name: 'timeline_operations',
    value: {
      type: 'object',
      required: ['operations'],
      additionalProperties: false,
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'operation',
              'id',
              'type',
              'title',
              'description',
              'inject',
              'importance',
              'relatedCharacters',
              'tags',
            ],
            additionalProperties: false,
            properties: {
              operation: { type: 'string', enum: ['create', 'update', 'resolve', 'cancel'] },
              id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
              type: {
                type: 'string',
                enum: ['event', 'resource', 'npc_action', 'travel', 'deadline', 'cooldown', 'promise'],
              },
              title: { type: 'string' },
              description: { type: 'string' },
              dueIn: {
                type: 'object',
                required: ['amount', 'unit'],
                additionalProperties: false,
                properties: {
                  amount: { type: 'integer', minimum: 0 },
                  unit: { type: 'string', enum: ['minute', 'hour', 'day', 'week', 'month'] },
                },
              },
              dueAtDatetime: {
                type: 'string',
                pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?$',
                description:
                  'Concrete in-world due datetime when it can be derived without guessing. Use the same story calendar as the Tracker time. Format: YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss.',
              },
              recurrence: {
                type: 'object',
                required: ['interval', 'unit'],
                additionalProperties: false,
                properties: {
                  interval: { type: 'integer', minimum: 1 },
                  unit: { type: 'string', enum: ['minute', 'hour', 'day', 'week', 'month'] },
                  limit: { type: 'integer', minimum: 1 },
                },
              },
              inject: {
                type: 'boolean',
                description:
                  'Whether this event should be injected into narrator/AI prompt context when due/upcoming. Use true only if it should affect story, narration, character decisions, available options, consequences, or scene state when its time arrives. Use false for reference notes, bookkeeping, low-impact reminders, uncertain usefulness, or anything helpful to track but not needed for the AI response. If unsure, use false.',
              },
              importance: { type: 'string', enum: ['low', 'normal', 'high'] },
              relatedCharacters: { type: 'array', items: { type: 'string' } },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  });
}

class TimelineManager {
  private pending = false;
  private injectedGenerationIds = new Set<string>();
  private unregisterChatUiFns: Array<() => void> = [];

  constructor(private api: TimelineExtensionAPI) {}

  private getSettings(): TimelineSettings {
    const settings = migrateTimelineSettings(this.api.settings.get());
    this.api.settings.set(undefined, settings);
    return settings;
  }

  public async getCurrentStoryTime(): Promise<TimelineTimeRef | undefined> {
    const tracker = this.api.extensions.getService<TrackerService>('core.tracker');
    const storyTime = tracker?.getLatestStoryTime();
    if (!storyTime || storyTime.status !== 'valid') return undefined;
    return {
      display: storyTime.display,
      comparable: storyTime.comparable,
      precision: storyTime.precision,
    };
  }

  public getEvents(): TimelineEvent[] {
    return getEvents(this.api);
  }

  public async saveEvents(events: TimelineEvent[]): Promise<void> {
    await setEvents(this.api, events);
  }

  private async buildExtractionContext(structuredResponse: StructuredResponseOptions): Promise<ApiChatMessage[]> {
    const settings = this.getSettings();
    const history = this.api.chat.getHistory();
    const chatHistory =
      settings.includeLastXMessages === -1 ? history : history.slice(-Math.max(0, settings.includeLastXMessages));
    const itemizedPrompt = await this.api.chat.buildPrompt({
      chatHistory,
      generationId: `timeline-${Date.now()}`,
      structuredResponse,
    });

    const existingEvents = this.getEvents();
    const messages: ApiChatMessage[] = [
      ...itemizedPrompt.messages,
      {
        role: 'system',
        name: 'System',
        content: this.api.macro.process(resolveTimelinePrompts(settings).extractionPrompt),
      },
      {
        role: 'user',
        name: 'User',
        content: `[Existing timeline events]\n${JSON.stringify(existingEvents, null, 2)}`,
      },
    ];

    return messages;
  }

  private async generateOperations(
    messages: ApiChatMessage[],
    structuredResponse: StructuredResponseOptions,
  ): Promise<TimelineGenerationResult> {
    const settings = this.getSettings();
    const connectionProfile = resolveConnectionProfile(this.api, settings.connectionProfile);
    if (!connectionProfile) throw new Error('No connection profile selected for Timeline.');

    const generation = await generateStructuredResult<TimelineOperationResponse>(this.api, {
      messages,
      options: {
        connectionProfile,
        samplerOverrides: { max_tokens: settings.maxResponseTokens, stream: false },
        structuredResponse,
      },
      streamErrorMessage: 'Timeline extraction unexpectedly returned a stream.',
      missingStructuredContentMessage: 'Timeline extraction returned no structured content.',
    });

    return {
      operations: generation.structuredContent?.operations,
      rawContent: generation.rawContent,
      parseError: generation.parseError,
    };
  }

  private async repairOperations(
    originalMessages: ApiChatMessage[],
    rawContent: string,
    parseError: string,
    structuredResponse: StructuredResponseOptions,
  ): Promise<TimelineGenerationResult> {
    const repairMessages: ApiChatMessage[] = [
      ...originalMessages,
      { role: 'assistant', name: 'Assistant', content: rawContent },
      {
        role: 'user',
        name: 'User',
        content: `[Schema validation error]\n${parseError}\n\nRepair your previous Timeline operations JSON. Return the complete corrected object, not a patch or prose explanation. Preserve valid operations unless the schema error requires changing that specific field.`,
      },
    ];

    const repaired = await this.generateOperations(repairMessages, structuredResponse);
    return {
      ...repaired,
      messages: repairMessages,
    };
  }

  public async runExtraction(): Promise<void> {
    if (this.pending) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.timeline.toasts.extractionAlreadyRunning'), 'info');
      return;
    }

    const settings = this.getSettings();
    if (!settings.enabled) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.timeline.toasts.disabled'), 'info');
      return;
    }

    this.pending = true;
    try {
      const currentStoryTime = await this.getCurrentStoryTime();
      const structuredResponse = getTimelineStructuredResponse(settings.structuredRequestFormat);
      const messages = await this.buildExtractionContext(structuredResponse);
      let generation = await this.generateOperations(messages, structuredResponse);
      generation = await repairStructuredGeneration({
        generation,
        messages,
        maxRepairs: MAX_SCHEMA_REPAIRS,
        getValue: (result) => result.operations,
        onRepair: (count, max) => {
          this.api.ui.showToast(
            this.api.i18n.t('extensionsBuiltin.timeline.toasts.schemaRepair', { count, max }),
            'info',
          );
        },
        repair: ({ messages: repairMessages, rawContent, parseError }) =>
          this.repairOperations(repairMessages, rawContent, parseError, structuredResponse),
      });

      if (!generation.operations) {
        throw new Error(generation.parseError ?? 'Timeline extraction returned no operations.');
      }

      const merged = mergeOperations(this.getEvents(), generation.operations, currentStoryTime);
      await this.saveEvents(merged);
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.timeline.toasts.updated'), 'success');
    } catch (error) {
      console.error('Timeline extraction failed:', error);
      this.api.ui.showToast(
        error instanceof Error ? error.message : this.api.i18n.t('extensionsBuiltin.timeline.toasts.extractionFailed'),
        'error',
      );
    } finally {
      this.pending = false;
    }
  }

  public async openPanel(): Promise<void> {
    this.api.ui.openSidebar(SIDEBAR_ID);
  }

  public injectChatUi(): void {
    this.unregisterChatUiFns.forEach((fn) => fn());
    this.unregisterChatUiFns = [];
    if (!this.api.chat.getChatInfo()) return;

    this.unregisterChatUiFns.push(
      this.api.ui.registerChatQuickAction(
        QUICK_ACTION_GROUP_ID,
        this.api.i18n.t('extensionsBuiltin.timeline.contextAi'),
        {
          id: 'timeline-open',
          icon: 'fa-solid fa-calendar-days',
          label: this.api.i18n.t('extensionsBuiltin.timeline.title'),
          onClick: () => this.openPanel(),
        },
      ),
    );
    this.unregisterChatUiFns.push(
      this.api.ui.registerChatFormOptionsMenuItem({
        id: 'timeline-extract',
        icon: 'fa-solid fa-calendar-days',
        label: this.api.i18n.t('extensionsBuiltin.timeline.extractTimeline'),
        onClick: () => this.runExtraction(),
      }),
    );
  }

  public async injectContext(
    apiMessages: ApiChatMessage[],
    index: number,
    chatLength: number,
    generationId: string,
  ): Promise<void> {
    const settings = this.getSettings();
    if (!settings.enabled || generationId.startsWith('timeline-')) return;
    if (index !== chatLength - 1 || this.injectedGenerationIds.has(generationId)) return;

    const currentStoryTime = await this.getCurrentStoryTime();
    if (!currentStoryTime) return;

    const events = this.getEvents();
    const due = limitEvents(getDueEvents(events, currentStoryTime.comparable), settings.maxDueInjected);
    const upcoming = limitEvents(getUpcomingEvents(events, currentStoryTime.comparable), settings.maxUpcomingInjected);
    if (due.length === 0 && upcoming.length === 0) return;

    const lines = ['[Story Agenda]'];
    if (due.length > 0) {
      lines.push('Due now:');
      due.forEach((event) => lines.push(`- ${event.title}: ${event.description}`));
    }
    if (upcoming.length > 0) {
      lines.push('Upcoming:');
      upcoming.forEach((event) => lines.push(`- ${event.title}${event.dueAt ? ` (${event.dueAt.display})` : ''}`));
    }

    apiMessages.push({ role: 'system', name: 'System', content: lines.join('\n') });
    this.injectedGenerationIds.add(generationId);
    if (this.injectedGenerationIds.size > 100) this.injectedGenerationIds.clear();
  }

  public unmount(): void {
    this.unregisterChatUiFns.forEach((fn) => fn());
    this.unregisterChatUiFns = [];
    this.injectedGenerationIds.clear();
  }
}

export function activate(api: TimelineExtensionAPI) {
  const settingsContainer = document.getElementById(api.meta.containerId);
  const settingsApp = settingsContainer ? api.ui.mount(settingsContainer, SettingsPanel, { api }) : null;
  const manager = new TimelineManager(api);

  api.ui.registerSidebar(SIDEBAR_ID, TimelinePanel, 'right', {
    icon: 'fa-calendar-days',
    title: api.i18n.t('extensionsBuiltin.timeline.title'),
    props: {
      api,
      runExtraction: () => manager.runExtraction(),
      getCurrentStoryTime: () => manager.getCurrentStoryTime(),
    },
  });

  const unbinds: Array<() => void> = [];
  unbinds.push(api.events.on('chat:entered', () => manager.injectChatUi()));
  unbinds.push(api.events.on('chat:cleared', () => manager.unmount()));
  unbinds.push(api.events.on('chat:deleted', () => manager.unmount()));
  unbinds.push(
    api.events.on(
      'prompt:history-message-processing',
      async (
        payload: { apiMessages: ApiChatMessage[] },
        context: { index: number; generationId: string; chatLength: number },
      ) => {
        await manager.injectContext(payload.apiMessages, context.index, context.chatLength, context.generationId);
      },
    ),
  );

  if (api.chat.getChatInfo()) manager.injectChatUi();

  return () => {
    unbinds.forEach((unbind) => unbind());
    manager.unmount();
    settingsApp?.unmount();
    api.ui.unregisterSidebar(SIDEBAR_ID, 'right');
  };
}

export type { TimelineManager };
