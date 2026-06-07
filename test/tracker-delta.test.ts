import { describe, expect, it } from 'vitest';
import {
  applyTrackerDelta,
  buildTrackerDeltaSchema,
  validateAndApplyTrackerDelta,
  validateTrackerDeltaRules,
} from '../src/extensions/built-in/tracker/delta';

const schema = {
  type: 'object',
  properties: {
    time: {
      type: 'string',
      'x-neotavern-delta': {
        allow: true,
        requires: ['datetime'],
      },
    },
    datetime: {
      type: 'string',
      'x-neotavern-delta': {
        allow: true,
        requires: ['time'],
      },
    },
    location: {
      type: 'string',
      'x-neotavern-delta': true,
    },
    weather: {
      type: 'string',
    },
    note: {
      type: 'string',
      'x-neotavern-delta': {
        allow: true,
        delete: true,
      },
    },
    topics: {
      type: 'object',
      'x-neotavern-delta': true,
      properties: {
        primaryTopic: { type: 'string' },
        emotionalTone: { type: 'string' },
      },
      required: ['primaryTopic', 'emotionalTone'],
    },
    characters: {
      type: 'array',
      'x-neotavern-delta': {
        allow: true,
        arrayMerge: 'byKey',
        key: 'name',
        delete: true,
        deleteKey: '$delete',
      },
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          outfit: { type: 'string' },
          posture: { type: 'string' },
        },
        required: ['name', 'outfit', 'posture'],
      },
    },
  },
  required: ['time', 'datetime', 'location', 'weather', 'topics', 'characters'],
};

const previous = {
  time: '12:00',
  datetime: '2026-06-08T12:00',
  location: 'Tavern',
  weather: 'Rain',
  note: 'A note that can be removed',
  topics: {
    primaryTopic: 'Arrival',
    emotionalTone: 'Tense',
  },
  characters: [
    {
      name: 'Alice',
      outfit: 'Travel cloak',
      posture: 'Sitting by the hearth',
    },
  ],
};

describe('tracker delta', () => {
  it('derives a partial schema from x-neotavern-delta annotations', () => {
    const deltaSchema = buildTrackerDeltaSchema(schema).schema;
    const properties = deltaSchema.properties as Record<string, { items?: { required?: string[] } } | undefined>;

    expect(deltaSchema.required).toBeUndefined();
    expect(Object.keys(properties)).toEqual(['$unset', 'time', 'datetime', 'location', 'note', 'topics', 'characters']);
    expect(properties.weather).toBeUndefined();
    expect(properties.characters?.items?.required ?? []).toContain('name');
  });

  it('enforces delta dependency rules', () => {
    expect(() => validateTrackerDeltaRules({ time: '12:01' }, schema)).toThrow(
      '"time" requires "datetime" in the same delta.',
    );

    expect(() =>
      validateTrackerDeltaRules({ time: '12:01', datetime: '2026-06-08T12:01' }, schema),
    ).not.toThrow();
  });

  it('merges keyed array entries without replacing unchanged fields', () => {
    const full = applyTrackerDelta(
      previous,
      {
        characters: [
          {
            name: 'Alice',
            posture: 'Standing at the bar',
          },
        ],
      },
      schema,
    );

    expect(full).toMatchObject({
      characters: [
        {
          name: 'Alice',
          outfit: 'Travel cloak',
          posture: 'Standing at the bar',
        },
      ],
    });
  });

  it('validates the merged full tracker against the original schema', () => {
    const result = validateAndApplyTrackerDelta(
      previous,
      {
        time: '12:01',
        datetime: '2026-06-08T12:01',
        characters: [
          {
            name: 'Alice',
            posture: 'Standing at the bar',
          },
        ],
      },
      schema,
    );

    expect(result.full).toMatchObject({
      time: '12:01',
      datetime: '2026-06-08T12:01',
      weather: 'Rain',
      characters: [
        {
          name: 'Alice',
          outfit: 'Travel cloak',
          posture: 'Standing at the bar',
        },
      ],
    });
  });

  it('removes schema-approved object paths with $unset', () => {
    const result = validateAndApplyTrackerDelta(
      previous,
      {
        $unset: ['note'],
      },
      schema,
    );

    expect(result.full).not.toHaveProperty('note');
  });

  it('rejects $unset paths that are not marked deletable', () => {
    expect(() =>
      validateAndApplyTrackerDelta(
        previous,
        {
          $unset: ['weather'],
        },
        schema,
      ),
    ).toThrow('Tracker delta validation failed');
  });

  it('deletes keyed array entries with the configured delete key', () => {
    const result = validateAndApplyTrackerDelta(
      previous,
      {
        characters: [
          {
            name: 'Alice',
            $delete: true,
          },
        ],
      },
      schema,
    );

    expect(result.full.characters).toEqual([]);
  });
});
