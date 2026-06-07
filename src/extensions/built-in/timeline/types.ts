import type { ExtensionAPI } from '../../../types';

export type TimelineEventType = 'event' | 'resource' | 'npc_action' | 'travel' | 'deadline' | 'cooldown' | 'promise';
export type TimelineEventStatus = 'pending' | 'resolved' | 'cancelled';
export type TimelineImportance = 'low' | 'normal' | 'high';
export type TimelineRecurrenceUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';

export interface TimelineTimeRef {
  display: string;
  comparable: number;
  precision: 'second' | 'minute';
}

export interface TimelineRecurrence {
  interval: number;
  unit: TimelineRecurrenceUnit;
  limit?: number;
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  title: string;
  description: string;
  createdAt?: TimelineTimeRef;
  dueAt?: TimelineTimeRef;
  recurrence?: TimelineRecurrence;
  status: TimelineEventStatus;
  inject: boolean;
  importance: TimelineImportance;
  relatedCharacters: string[];
  tags: string[];
  updatedAt: string;
}

export interface TimelineChatExtraData {
  events?: TimelineEvent[];
  lastExtractionAt?: string;
}

export interface TimelineChatExtra {
  'core.timeline'?: TimelineChatExtraData;
}

export interface TimelineSettings {
  enabled: boolean;
  connectionProfile: string;
  structuredRequestFormat: 'native' | 'json' | 'xml';
  includeLastXMessages: number;
  maxResponseTokens: number;
  maxDueInjected: number;
  maxUpcomingInjected: number;
  extractionPrompt: string;
}

export interface TimelineOperation {
  operation: 'create' | 'update' | 'resolve' | 'cancel';
  id: string;
  type: TimelineEventType;
  title: string;
  description: string;
  dueIn?: {
    amount: number;
    unit: TimelineRecurrenceUnit;
  };
  dueAtDatetime?: string;
  recurrence?: TimelineRecurrence;
  inject: boolean;
  importance: TimelineImportance;
  relatedCharacters: string[];
  tags: string[];
}

export interface TimelineOperationResponse {
  operations: TimelineOperation[];
}

export type TimelineExtensionAPI = ExtensionAPI<TimelineSettings, TimelineChatExtra>;

export const EXTENSION_ID = 'core.timeline';
export const TIMELINE_UPDATED_EVENT = 'timeline:updated';

export const DEFAULT_EXTRACTION_PROMPT = `You are a Timeline Reminder extractor for a roleplay chat.

Find active future obligations, recurring events, delayed consequences, cooldowns, deadlines, travel ETAs, meetings, promises, scheduled actions, and recurring state changes.

Scan all provided chat context, not only the latest message. Important timeline items may be many messages old.

Pay special attention to commitments and availability rules expressed as:
- partial fulfillment now, remaining fulfillment later
- supply/order/request added to a future cycle
- daily, weekly, monthly, or twice-weekly access
- rationing, quotas, limits, cooldowns, or eligibility windows
- conditional future availability, even if phrased as uncertain or "no promises"
- opening hours or recurring access windows only when they matter for future actions

Use the existing timeline events to avoid duplicates:
- If an obligation is already represented, update the existing id instead of creating another event.
- If an event happened, return a resolve operation.
- If an event is invalidated, return a cancel operation.
- If an event is delayed, return an update operation with a new relative due time.

Return only strict structured operations.

Rules:
- id must be a stable lowercase slug like "scheduled-follow-up".
- inject decides whether this event should be inserted into narrator/AI prompt context when due/upcoming. Set inject true only if the event should affect the story, narration, character decisions, available options, consequences, or scene state when its time arrives. Set inject false for reference notes, bookkeeping, low-impact reminders, uncertain usefulness, or anything that is helpful to track but does not need to shape the AI response. If unsure, set inject false.
- Do not output computed comparable timestamps.
- Use dueIn for clear relative times such as "in 7 days".
- Use dueAtDatetime when a concrete in-world datetime can be derived without guessing. Use the same story calendar as Tracker time. Format: YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss.
- Keep event-specific details in title and description, not a separate payload.
- Do not create reminders for imminent beats that should happen in the current scene, next message, or very short time. Track only events worth remembering after meaningful story progression.
- Ignore expired one-off events that are no longer relevant unless they resolve or cancel an existing pending event.
- Descriptions may be detailed when useful. Preserve concrete constraints, quotas, conditions, responsible parties, and recurring availability rules that the user or model may need later.
- If timing cannot be expressed as dueIn or dueAtDatetime, keep the natural timing in description and omit due time fields.`;

export const DEFAULT_SETTINGS: TimelineSettings = {
  enabled: true,
  connectionProfile: '',
  structuredRequestFormat: 'native',
  includeLastXMessages: 80,
  maxResponseTokens: 4096,
  maxDueInjected: 6,
  maxUpcomingInjected: 4,
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
};
