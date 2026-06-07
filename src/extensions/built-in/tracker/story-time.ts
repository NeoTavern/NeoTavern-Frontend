import type { ChatMessage } from '../../../types';
import type { TrackerData, TrackerSettings, TrackerStoryTime } from './types';

interface StoryTimeSchemaInfo {
  displayPath?: string;
  datetimePath?: string;
  parseFormat?: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPathValue(source: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((current, part) => {
    if (!isRecord(current)) return undefined;
    return current[part];
  }, source);
}

function walkSchema(node: unknown, path: string[], info: StoryTimeSchemaInfo): void {
  if (!isRecord(node)) return;

  const role = node['x-neotavern-story-time-role'];
  if (role === 'display') {
    info.displayPath = path.join('.');
  } else if (role === 'datetime') {
    info.datetimePath = path.join('.');
    const parseFormat = node['x-neotavern-parse-format'];
    if (typeof parseFormat === 'string') info.parseFormat = parseFormat;
  }

  const properties = node.properties;
  if (!isRecord(properties)) return;

  for (const [key, child] of Object.entries(properties)) {
    walkSchema(child, [...path, key], info);
  }
}

export function getStoryTimeSchemaInfo(schema: unknown): StoryTimeSchemaInfo {
  const info: StoryTimeSchemaInfo = {};
  walkSchema(schema, [], info);

  return info;
}

function parseIsoLikeDatetime(value: string): { comparable: number; precision: 'minute' | 'second' } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const comparable = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0,
  );

  if (!Number.isFinite(comparable)) return null;
  return { comparable, precision: second ? 'second' : 'minute' };
}

function buildDateRegex(format: string): { regex: RegExp; groups: string[] } | null {
  const tokens = ['yyyy', 'MM', 'dd', 'HH', 'mm', 'ss'] as const;
  const groups: string[] = [];
  let pattern = '';

  for (let i = 0; i < format.length; ) {
    const optionalSecondToken = format.slice(i).startsWith('[:ss]');
    if (optionalSecondToken) {
      groups.push('ss');
      pattern += '(?::(\\d{2}))?';
      i += 5;
      continue;
    }

    const token = tokens.find((item) => format.slice(i).startsWith(item));
    if (token) {
      groups.push(token);
      pattern += token === 'yyyy' ? '(\\d{4})' : '(\\d{2})';
      i += token.length;
      continue;
    }

    const char = format[i];
    pattern += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }

  try {
    return { regex: new RegExp(`^${pattern}$`), groups };
  } catch {
    return null;
  }
}

function parseFormattedDatetime(value: string, format: string): { comparable: number; precision: 'minute' | 'second' } | null {
  const compiled = buildDateRegex(format);
  if (!compiled) return null;

  const match = value.match(compiled.regex);
  if (!match) return null;

  const parts: Record<string, number> = {};
  compiled.groups.forEach((group, index) => {
    const raw = match[index + 1];
    if (raw !== undefined) parts[group] = Number(raw);
  });

  if (!parts.yyyy || !parts.MM || !parts.dd || parts.HH === undefined || parts.mm === undefined) return null;

  const comparable = Date.UTC(parts.yyyy, parts.MM - 1, parts.dd, parts.HH, parts.mm, parts.ss ?? 0);
  if (!Number.isFinite(comparable)) return null;

  return { comparable, precision: parts.ss === undefined ? 'minute' : 'second' };
}

export function parseStoryDatetime(
  value: string,
  format?: string,
): { comparable: number; precision: 'minute' | 'second' } | null {
  return parseIsoLikeDatetime(value) ?? (format ? parseFormattedDatetime(value, format) : null);
}

function getTrackerDataFromMessage(message: ChatMessage, schemaName: string): TrackerData | undefined {
  const trackers = message.extra?.['core.tracker']?.trackers as Record<string, TrackerData> | undefined;
  return trackers?.[schemaName];
}

export function getLatestTrackerStoryTime(
  settings: TrackerSettings,
  history: ChatMessage[],
): TrackerStoryTime | null {
  const presets = settings.schemaPresets ?? [];

  for (let messageIndex = history.length - 1; messageIndex >= 0; messageIndex--) {
    const message = history[messageIndex];

    for (const preset of presets) {
      let schema: unknown;
      try {
        schema = JSON.parse(preset.schema);
      } catch {
        continue;
      }

      const schemaInfo = getStoryTimeSchemaInfo(schema);
      if (!schemaInfo.datetimePath) continue;

      const tracker = getTrackerDataFromMessage(message, preset.name);
      if (tracker?.status !== 'success' || !tracker.trackerJson) continue;

      const rawDatetime = getPathValue(tracker.trackerJson, schemaInfo.datetimePath);
      if (typeof rawDatetime !== 'string' || rawDatetime.trim().length === 0) continue;

      const rawDisplay = schemaInfo.displayPath ? getPathValue(tracker.trackerJson, schemaInfo.displayPath) : undefined;
      const parsed = parseStoryDatetime(rawDatetime.trim(), schemaInfo.parseFormat);

      if (!parsed) {
        return {
          schemaName: preset.name,
          sourceMessageIndex: messageIndex,
          raw: rawDatetime,
          display: typeof rawDisplay === 'string' ? rawDisplay : rawDatetime,
          comparable: 0,
          precision: 'minute',
          status: 'invalid',
          error: `Unable to parse story time at "${schemaInfo.datetimePath}".`,
        };
      }

      return {
        schemaName: preset.name,
        sourceMessageIndex: messageIndex,
        raw: rawDatetime,
        display: typeof rawDisplay === 'string' ? rawDisplay : rawDatetime,
        comparable: parsed.comparable,
        precision: parsed.precision,
        status: 'valid',
      };
    }
  }

  return null;
}
