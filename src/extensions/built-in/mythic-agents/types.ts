import { z } from 'zod';
import type { ExtensionAPI } from '../../../types';

// Enums
export const mythicOddsEnum = z.enum([
  'Impossible',
  'No Way',
  'Very Unlikely',
  'Unlikely',
  '50/50',
  'Somewhat Likely',
  'Likely',
  'Very Likely',
  'Near Sure Thing',
  'A Sure Thing',
  'Has to be',
]);

export type MythicOdds = z.infer<typeof mythicOddsEnum>;

// Schemas
export const AnalysisOutputSchema = z.object({
  extracted_question: z.string(),
  odds: mythicOddsEnum,
  requires_fate_roll: z.boolean(),
  justification: z.string(),
});

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export const FateRollResultSchema = z.object({
  roll: z.number().min(2).max(20),
  chaosDie: z.number().min(1).max(10),
  outcome: z.enum(['Yes', 'No', 'Exceptional Yes', 'Exceptional No']),
  exceptional: z.boolean(),
});

export type FateRollResult = z.infer<typeof FateRollResultSchema>;

export const UNENpcProfileSchema = z.object({
  modifier: z.string(),
  noun: z.string(),
  motivation_verb: z.string(),
  motivation_noun: z.string(),
});

export type UNENpcProfile = z.infer<typeof UNENpcProfileSchema>;

export const MythicCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  une_profile: UNENpcProfileSchema,
});

export type MythicCharacter = z.infer<typeof MythicCharacterSchema>;

export const EventMeaningResultSchema = z.object({
  focus: z.string(),
  action: z.string(),
  subject: z.string(),
  new_npcs: z.array(MythicCharacterSchema).optional(),
  characters: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
  threads: z.array(z.string()).optional(),
});

export type EventMeaningResult = z.infer<typeof EventMeaningResultSchema>;

export const SceneSchema = z.object({
  chaos_rank: z.number().min(1).max(9),
  characters: z.array(MythicCharacterSchema),
  threads: z.array(z.string()),
});

export type Scene = z.infer<typeof SceneSchema>;

export const SceneUpdateSchema = z.object({
  characters: z.array(z.object({ name: z.string(), type: z.string() })),
  threads: z.array(z.string()),
  scene_outcome: z.enum(['player_in_control', 'chaotic']),
  justification: z.string(),
});

export type SceneUpdate = z.infer<typeof SceneUpdateSchema>;

export const ActionDataSchema = z.object({
  analysis: AnalysisOutputSchema,
  fateRollResult: FateRollResultSchema.optional(),
  randomEvent: EventMeaningResultSchema.optional(),
});

export type ActionData = z.infer<typeof ActionDataSchema>;

export const MythicChatExtraSchema = z.object({
  actionHistory: z.array(ActionDataSchema).optional(),
  resolved_threads: z.array(z.string()).optional(),
});

export type MythicChatExtraData = z.infer<typeof MythicChatExtraSchema>;

export const MythicMessageExtraSchema = z.object({
  action: ActionDataSchema.optional(),
  scene: SceneSchema.optional(),
  chaos: z.number().min(1).max(9).optional(),
});

export type MythicMessageExtraData = z.infer<typeof MythicMessageExtraSchema>;

export const MythicSwipeExtraDataSchema = z.object({
  action: ActionDataSchema,
  scene: SceneSchema,
  chaos: z.number().min(1).max(9),
});

export type MythicSwipeExtraData = z.infer<typeof MythicSwipeExtraDataSchema>;

// Settings Structures

export const FateChartEntrySchema = z.object({
  chance: z.number(),
  exceptional_yes: z.number(),
  exceptional_no: z.number(),
});

export type FateChartEntry = z.infer<typeof FateChartEntrySchema>;

export const FateChartDataSchema = z.record(z.string(), z.record(z.string(), FateChartEntrySchema));
export type FateChartData = z.infer<typeof FateChartDataSchema>;

export const EventFocusSchema = z.object({
  min: z.number(),
  max: z.number(),
  focus: z.string(),
  action: z.string().optional(),
});

export type EventFocus = z.infer<typeof EventFocusSchema>;

export const EventGenerationDataSchema = z.object({
  focuses: z.array(EventFocusSchema),
  actions: z.array(z.string()),
  subjects: z.array(z.string()),
});

export type EventGenerationData = z.infer<typeof EventGenerationDataSchema>;

export const UNESettingsSchema = z.object({
  modifiers: z.array(z.string()),
  nouns: z.array(z.string()),
  motivation_verbs: z.array(z.string()),
  motivation_nouns: z.array(z.string()),
});

export type UNESettings = z.infer<typeof UNESettingsSchema>;

export const MythicPresetDataSchema = z.object({
  fateChart: FateChartDataSchema,
  eventGeneration: EventGenerationDataSchema,
  une: UNESettingsSchema,
  characterTypes: z.array(z.string()),
});

export type MythicPresetData = z.infer<typeof MythicPresetDataSchema>;

export const MythicPresetSchema = z.object({
  name: z.string(),
  data: MythicPresetDataSchema,
});

export type MythicPreset = z.infer<typeof MythicPresetSchema>;

export const MythicSettingsSchema = z.object({
  enabled: z.boolean(),
  autoAnalyze: z.boolean(),
  autoSceneUpdate: z.boolean().default(true),
  connectionProfileId: z.string().optional(),
  chaos: z.number().min(1).max(9).default(5),
  language: z.string().default('English'),
  prompts: z
    .object({
      initialScene: z.string(),
      analysis: z.string(),
      narration: z.string(),
    })
    .default({
      initialScene: '',
      analysis: '',
      narration: '',
    }),
  selectedPreset: z.string().default('Default'),
  presets: z.array(MythicPresetSchema).default([]),
});

export type MythicSettings = z.infer<typeof MythicSettingsSchema>;

export interface MythicMessageExtra {
  'core.mythic-agents'?: MythicMessageExtraData;
}

export type MythicExtensionAPI = ExtensionAPI<MythicSettings, MythicChatExtraData, MythicMessageExtra>;
