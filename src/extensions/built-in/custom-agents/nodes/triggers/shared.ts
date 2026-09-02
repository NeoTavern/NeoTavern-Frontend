import { z } from 'zod';
import type { JsonObject } from '../../graph/contracts';
import type { GenerationMode } from '../../host/contracts';
import {
  type EligibilityCondition,
  type TriggerSchedule,
  triggerDeclarationSchema,
} from '../../registry/node-definition';

export const modes = ['NEW', 'REGENERATE', 'ADD_SWIPE'] as const;
export type ObserverTriggerData = { schedule: TriggerSchedule; condition?: EligibilityCondition };
export type GenerationTriggerData = ObserverTriggerData & { generationModes: GenerationMode[] };
const scheduleValue = z.custom<TriggerSchedule>();
const conditionValue = z.custom<EligibilityCondition>();
export const observerTriggerDataSchema: z.ZodType<ObserverTriggerData> = z
  .strictObject({ schedule: scheduleValue, condition: conditionValue.optional() })
  .superRefine((data, context) => {
    const result = triggerDeclarationSchema.safeParse({
      event: 'AFTER_USER',
      generationModes: [],
      ...data,
    });
    if (!result.success)
      for (const issue of result.error.issues)
        context.addIssue({
          ...issue,
          path: issue.path.filter((item) => item !== 'event' && item !== 'role' && item !== 'generationModes'),
        });
  });
export const generationTriggerDataSchema: z.ZodType<GenerationTriggerData> = z
  .strictObject({
    generationModes: z.array(z.enum(modes)),
    schedule: scheduleValue,
    condition: conditionValue.optional(),
  })
  .superRefine((data, context) => {
    const result = triggerDeclarationSchema.safeParse({ event: 'BEFORE_GENERATION', ...data });
    if (!result.success)
      for (const issue of result.error.issues)
        context.addIssue({ ...issue, path: issue.path.filter((item) => item !== 'event' && item !== 'role') });
  });

export const messageValueJsonSchema: JsonObject = {
  type: 'object',
  properties: {
    index: { type: 'number' },
    role: { type: 'string', enum: ['USER', 'ASSISTANT', 'SYSTEM'] },
    name: { type: 'string' },
    content: { type: 'string' },
    swipeIndex: { type: 'number' },
  },
  required: ['index', 'role', 'name', 'content'],
  additionalProperties: false,
};
const generationModeJsonSchema: JsonObject = { type: 'string', enum: [...modes] };
export const triggerEventSchemas: Record<string, JsonObject> = {
  'trigger.after-user': {
    type: 'object',
    properties: { trigger: { const: 'AFTER_USER_MESSAGE' }, message: messageValueJsonSchema },
    required: ['trigger', 'message'],
    additionalProperties: false,
  },
  'trigger.before-generation': {
    type: 'object',
    properties: {
      trigger: { const: 'BEFORE_ASSISTANT_GENERATION' },
      generationId: { type: 'string' },
      generationMode: generationModeJsonSchema,
      targetMessage: messageValueJsonSchema,
    },
    required: ['trigger', 'generationId', 'generationMode'],
    additionalProperties: false,
  },
  'trigger.generate-assistant': {
    type: 'object',
    properties: {
      trigger: { const: 'ASSISTANT_GENERATION' },
      generationId: { type: 'string' },
      generationMode: generationModeJsonSchema,
      targetMessage: messageValueJsonSchema,
    },
    required: ['trigger', 'generationId', 'generationMode'],
    additionalProperties: false,
  },
  'trigger.after-generation': {
    type: 'object',
    properties: {
      trigger: { const: 'AFTER_ASSISTANT_MESSAGE' },
      generationId: { type: 'string' },
      generationMode: generationModeJsonSchema,
      message: messageValueJsonSchema,
    },
    required: ['trigger', 'generationId', 'generationMode', 'message'],
    additionalProperties: false,
  },
  'trigger.manual': {
    type: 'object',
    properties: { trigger: { const: 'MANUAL' }, input: {} },
    required: ['trigger', 'input'],
    additionalProperties: false,
  },
};
export const triggerPorts = (type: string, extras: Array<{ id: string; schema: JsonObject }> = []) => ({
  inputs: [],
  outputs: [
    {
      id: 'out',
      direction: 'OUTPUT' as const,
      kind: 'CONTROL' as const,
      cardinality: 'MANY' as const,
      labelKey: 'out',
    },
    {
      id: 'event',
      direction: 'OUTPUT' as const,
      kind: 'DATA' as const,
      cardinality: 'MANY' as const,
      required: true,
      schema: triggerEventSchemas[type]!,
      labelKey: 'event',
    },
    ...extras.map(({ id, schema }) => ({
      id,
      direction: 'OUTPUT' as const,
      kind: 'DATA' as const,
      cardinality: 'MANY' as const,
      required: true,
      schema,
      labelKey: id,
    })),
  ],
});
export const triggerFields = (generation: boolean, data?: ObserverTriggerData) => [
  ...(generation
    ? [
        {
          id: 'generationModes',
          path: 'generationModes',
          labelKey: 'generationModes',
          control: 'CHECKBOX_GROUP' as const,
          options: modes.map((mode) => ({ labelKey: mode, value: mode })),
        },
      ]
    : []),
  {
    id: 'scheduleType',
    path: 'schedule.type',
    labelKey: 'scheduleType',
    control: 'SELECT' as const,
    options: [
      { labelKey: 'ALWAYS', value: 'ALWAYS' },
      { labelKey: 'EVERY_N_EVENTS', value: 'EVERY_N_EVENTS' },
    ],
  },
  ...(data?.schedule.type === 'EVERY_N_EVENTS'
    ? [{ id: 'scheduleInterval', path: 'schedule.interval', labelKey: 'scheduleInterval', control: 'NUMBER' as const }]
    : []),
  { id: 'condition', path: 'condition', labelKey: 'condition', control: 'JSON' as const, optional: true },
];
