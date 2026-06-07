import { describe, expect, it } from 'vitest';
import {
  getLatestTrackerStoryTime,
  getStoryTimeSchemaInfo,
  parseStoryDatetime,
} from '../src/extensions/built-in/tracker/story-time';
import type { TrackerSettings } from '../src/extensions/built-in/tracker/types';
import type { ChatMessage } from '../src/types';

const schema = {
  type: 'object',
  properties: {
    time: {
      type: 'string',
      'x-neotavern-story-time-role': 'display',
    },
    datetime: {
      type: 'string',
      'x-neotavern-story-time-role': 'datetime',
      'x-neotavern-parse-format': 'dd/MM/yyyy HH:mm',
    },
  },
};

function messageWithTracker(datetime: string): ChatMessage {
  return {
    send_date: '',
    name: 'Assistant',
    mes: '',
    is_user: false,
    is_system: false,
    original_avatar: '',
    swipes: [],
    swipe_info: [],
    swipe_id: 0,
    extra: {
      'core.tracker': {
        trackers: {
          Scene: {
            status: 'success',
            schemaName: 'Scene',
            trackerJson: {
              time: `Display ${datetime}`,
              datetime,
            },
          },
        },
      },
    },
  };
}

describe('tracker story time', () => {
  it('discovers schema annotations', () => {
    expect(getStoryTimeSchemaInfo(schema)).toEqual({
      displayPath: 'time',
      datetimePath: 'datetime',
      parseFormat: 'dd/MM/yyyy HH:mm',
    });
  });

  it('parses ISO-like datetime without trusting a computed model field', () => {
    const result = parseStoryDatetime('2026-06-07T14:30');
    expect(result?.precision).toBe('minute');
    expect(result?.comparable).toBe(Date.UTC(2026, 5, 7, 14, 30));
  });

  it('uses schema parse format for custom date order', () => {
    const result = parseStoryDatetime('07/06/2026 14:30', 'dd/MM/yyyy HH:mm');
    expect(result?.comparable).toBe(Date.UTC(2026, 5, 7, 14, 30));
  });

  it('reads latest successful tracker story time', () => {
    const settings = {
      schemaPresets: [
        {
          name: 'Scene',
          schema: JSON.stringify(schema),
          template: '',
          prompt: '',
        },
      ],
    } as TrackerSettings;

    const storyTime = getLatestTrackerStoryTime(settings, [
      messageWithTracker('06/06/2026 12:00'),
      messageWithTracker('07/06/2026 14:30'),
    ]);

    expect(storyTime?.status).toBe('valid');
    expect(storyTime?.sourceMessageIndex).toBe(1);
    expect(storyTime?.display).toBe('Display 07/06/2026 14:30');
    expect(storyTime?.comparable).toBe(Date.UTC(2026, 5, 7, 14, 30));
  });
});
