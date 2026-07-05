import type { Character, ChatMessage, StructuredResponseSchema } from '../../../types';
import type {
  FieldChange,
  RewriteField,
  RewriteLLMResponse,
  RewriteSession,
  RewriteSessionMessage,
  RewriteSettings,
  RewriteTemplate,
  RewriteTemplateOverride,
} from './types';

export function deepToRaw<T>(source: T): T {
  if (Array.isArray(source)) {
    return source.map((item) => deepToRaw(item)) as T;
  }

  if (source && typeof source === 'object') {
    const sourceRecord = source as Record<string, unknown>;
    return Object.keys(sourceRecord).reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = deepToRaw(sourceRecord[key]);
      return acc;
    }, {}) as T;
  }

  return source;
}

function applyFieldChange(
  finalState: Map<string, string>,
  fieldChanges: Map<string, { oldValue: string; newValue: string }>,
  fieldId: string,
  newValue: string,
) {
  if (!fieldChanges.has(fieldId)) {
    fieldChanges.set(fieldId, {
      oldValue: finalState.get(fieldId) || '',
      newValue,
    });
  } else {
    const existing = fieldChanges.get(fieldId)!;
    if (existing.newValue === existing.oldValue) {
      existing.oldValue = finalState.get(fieldId) || '';
    }
    existing.newValue = newValue;
  }

  finalState.set(fieldId, newValue);
}

export function getLatestSessionChanges(session: RewriteSession | null): FieldChange[] {
  if (!session || session.messages.length === 0) return [];

  const initialFieldsMap = new Map(session.initialFields.map((field) => [field.id, field]));
  const finalState = new Map<string, string>();
  const fieldChanges = new Map<string, { oldValue: string; newValue: string }>();

  session.initialFields.forEach((field) => {
    finalState.set(field.id, field.value);
    fieldChanges.set(field.id, { oldValue: field.value, newValue: field.value });
  });

  for (const message of session.messages) {
    if (message.role !== 'assistant') continue;

    const content = message.content as RewriteLLMResponse;
    if (!content) continue;

    content.changes?.forEach((change) => {
      applyFieldChange(finalState, fieldChanges, change.fieldId, change.newValue);
    });

    if (content.response) {
      const primaryField = session.initialFields[0];
      if (primaryField) {
        applyFieldChange(finalState, fieldChanges, primaryField.id, content.response);
      }
    }
  }

  const result: FieldChange[] = [];
  fieldChanges.forEach((value, fieldId) => {
    if (value.oldValue !== value.newValue) {
      const initialField = initialFieldsMap.get(fieldId);
      result.push({
        fieldId,
        label: initialField?.label || fieldId,
        oldValue: value.oldValue,
        newValue: value.newValue,
      });
    }
  });

  return result;
}

export function getRewriteMessageContent(message: RewriteSessionMessage): RewriteLLMResponse | string {
  if (message.role !== 'assistant') return message.content as string;

  try {
    if (typeof message.content === 'string') {
      return JSON.parse(message.content) as RewriteLLMResponse;
    }
    return message.content;
  } catch {
    return message.content as string;
  }
}

export function hasRewriteMessageJustification(message: RewriteSessionMessage): boolean {
  const content = getRewriteMessageContent(message);
  return (
    typeof content === 'object' &&
    content &&
    'justification' in content &&
    typeof content.justification === 'string' &&
    content.justification.trim() !== ''
  );
}

export function hasRewriteMessageToolCalls(message: RewriteSessionMessage): boolean {
  const content = getRewriteMessageContent(message);
  return (
    typeof content === 'object' &&
    content &&
    'toolCalls' in content &&
    Array.isArray(content.toolCalls) &&
    content.toolCalls.length > 0
  );
}

export function getChangesFromMessage(
  message: RewriteSessionMessage,
  messageIndex: number,
  messages: RewriteSessionMessage[],
  initialFields: RewriteField[],
): FieldChange[] {
  const content = getRewriteMessageContent(message);
  if (typeof content === 'string' || !content) return [];

  const previousState = new Map<string, string>();
  initialFields.forEach((field) => {
    previousState.set(field.id, field.value);
  });

  for (let i = 0; i < messageIndex; i++) {
    const previousMessage = messages[i];
    if (previousMessage.role !== 'assistant') continue;

    const previousContent = getRewriteMessageContent(previousMessage);
    if (typeof previousContent === 'string' || !previousContent) continue;

    if (previousContent.changes) {
      previousContent.changes.forEach((change) => {
        previousState.set(change.fieldId, change.newValue);
      });
    } else if (previousContent.response && initialFields.length > 0) {
      const field = initialFields[0];
      previousState.set(field.id, previousContent.response);
    }
  }

  const initialFieldsMap = new Map(initialFields.map((field) => [field.id, field]));

  if (content.changes) {
    return content.changes.map((change) => {
      const field = initialFieldsMap.get(change.fieldId);
      return {
        ...change,
        label: field?.label || change.fieldId,
        oldValue: previousState.get(change.fieldId) || '',
      };
    });
  }

  if (content.response && initialFields.length > 0) {
    const field = initialFields[0];
    return [
      {
        fieldId: field.id,
        label: field.label,
        oldValue: previousState.get(field.id) || '',
        newValue: content.response,
      },
    ];
  }

  return [];
}

export function extractCodeBlock(text: string): string {
  const completeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
  const completeMatch = text.match(completeBlockRegex);
  if (completeMatch && completeMatch[1]) {
    return completeMatch[1];
  }

  const incompleteBlockRegex = /```(?:[\w]*\n)?([\s\S]*)/i;
  const incompleteMatch = text.match(incompleteBlockRegex);
  if (incompleteMatch && incompleteMatch[1]) {
    return incompleteMatch[1];
  }

  return text;
}

export function createRewriteResponseSchema(availableFields: RewriteField[]): StructuredResponseSchema {
  const isMultiField = availableFields.length > 1;

  return {
    name: 'rewrite_response',
    strict: true,
    value: {
      type: 'object',
      properties: {
        justification: {
          type: 'string',
          description: 'A brief explanation of the changes made and the reasoning behind them.',
        },
        ...(isMultiField
          ? {
              changes: {
                type: 'array',
                description: 'An array of proposed changes to one or more fields.',
                items: {
                  type: 'object',
                  properties: {
                    fieldId: {
                      type: 'string',
                      description: 'The ID of the field to change.',
                      enum: availableFields.map((field) => field.id),
                    },
                    newValue: {
                      type: 'string',
                      description: 'The new, rewritten content for the field.',
                    },
                  },
                  required: ['fieldId', 'newValue'],
                },
              },
            }
          : {
              response: {
                type: 'string',
                description: 'The full, rewritten text for the single field.',
              },
            }),
        toolCalls: {
          type: 'array',
          description: 'Optional tool calls to execute before providing the final response.',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The name of the tool function to call.',
              },
              arguments: {
                type: 'string',
                description: 'A JSON string of the arguments to pass to the tool function.',
              },
            },
            required: ['name', 'arguments'],
          },
        },
      },
      required: [],
      additionalProperties: false,
    },
  };
}

export function formatRewriteContextMessages(
  history: Pick<ChatMessage, 'mes' | 'name'>[],
  contextMessageCount: number,
  referenceMessageIndex?: number,
): string {
  if (contextMessageCount <= 0 || history.length === 0) return '';

  const endIndex = referenceMessageIndex !== undefined ? referenceMessageIndex : history.length;
  const startIndex = Math.max(0, endIndex - contextMessageCount);
  return history
    .slice(startIndex, endIndex)
    .map((message) => `${message.name}: ${message.mes}`)
    .join('\n');
}

export function formatRewriteCharacterContext(characters: Character[]): string {
  return characters
    .map((character) => {
      let text = `Name: ${character.name}`;
      if (character.description) text += `\nDescription: ${character.description}`;
      if (character.personality) text += `\nPersonality: ${character.personality}`;
      if (character.scenario) text += `\nScenario: ${character.scenario}`;
      if (character.mes_example) text += `\nExample Messages: ${character.mes_example}`;
      return text;
    })
    .join('\n\n');
}

export function getInitialRewriteTemplateId(settings: RewriteSettings, identifier: string): string {
  const lastUsedTemplateId = settings.lastUsedTemplates[identifier];
  if (lastUsedTemplateId && settings.templates.some((template) => template.id === lastUsedTemplateId)) {
    return lastUsedTemplateId;
  }

  const preferredTemplateId = identifier.startsWith('world_info.')
    ? 'world-info-refiner'
    : identifier.startsWith('character.')
      ? 'character-polisher'
      : undefined;

  if (preferredTemplateId) {
    const preferredTemplate = settings.templates.find((template) => template.id === preferredTemplateId);
    if (preferredTemplate) return preferredTemplate.id;
  }

  return settings.templates[0]?.id ?? '';
}

export function resolveRewriteTemplateArgOverrides(
  template: RewriteTemplate | undefined,
  overrides: RewriteTemplateOverride,
): Record<string, boolean | number | string> {
  const args: Record<string, boolean | number | string> = {};

  template?.args?.forEach((arg) => {
    args[arg.key] = overrides.args?.[arg.key] ?? arg.defaultValue;
  });

  return args;
}
