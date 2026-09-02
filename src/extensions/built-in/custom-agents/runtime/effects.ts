import { z } from 'zod';
import type { JsonObject, JsonValue } from '../graph/contracts';
import { jsonValueSchema } from '../graph/schemas';
import type { GraphNodeEffect } from '../registry/node-definition';
import { isSafePath } from '../generic/path';
import { validateSchemaValue } from '../generic/schema';

const lifetimeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ONCE') }),
  z.strictObject({ type: z.literal('UNTIL_REMOVED') }),
  z.strictObject({ type: z.literal('FOR_N_GENERATIONS'), generations: z.number().int().positive() }),
]);
const activationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ALWAYS') }),
  z.strictObject({ type: z.literal('PROBABILITY'), probability: z.number().finite().min(0).max(1) }),
]);

export const graphNodeEffectSchema: z.ZodType<GraphNodeEffect> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('STATE_SET'), path: z.string().min(1), value: jsonValueSchema }),
  z.strictObject({ type: z.literal('STATE_REMOVE'), path: z.string().min(1) }),
  z.strictObject({
    type: z.literal('INJECTION_SET'),
    injectionId: z.string().min(1),
    content: z.string(),
    placement: z.enum(['relative', 'in-chat']),
    depth: z.number().int().nonnegative(),
    lifetime: lifetimeSchema,
    activation: activationSchema,
  }),
  z.strictObject({ type: z.literal('INJECTION_REMOVE'), injectionId: z.string().min(1) }),
  z.strictObject({
    type: z.literal('VISIBLE_MESSAGE'),
    operation: z.enum(['REPLACE_TARGET', 'APPEND_TARGET', 'CREATE']),
    content: z.string(),
  }),
  z.strictObject({ type: z.literal('GENERATION_RESPONSE'), content: z.string() }),
]);

function objectValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mutatePath(state: JsonObject, path: string, value: JsonValue | undefined, remove: boolean): void {
  if (!isSafePath(path)) throw new Error(`Unsafe state path ${path}`);
  const segments = path.split('.');
  const final = segments.pop()!;
  let parent: unknown = state;
  for (const segment of segments) {
    if (Array.isArray(parent)) {
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index < 0 || index >= parent.length)
        throw new Error(`Unresolved path ${path}`);
      parent = parent[index];
    } else if (objectValue(parent) && Object.hasOwn(parent, segment)) parent = parent[segment];
    else throw new Error(`Unresolved path ${path}`);
  }
  if (Array.isArray(parent)) {
    const index = Number(final);
    if (!Number.isSafeInteger(index) || index < 0 || index >= parent.length) throw new Error(`Unresolved path ${path}`);
    if (remove) parent.splice(index, 1);
    else parent[index] = structuredClone(value!);
  } else if (objectValue(parent)) {
    if (remove) {
      if (!Object.hasOwn(parent, final)) throw new Error(`Unresolved path ${path}`);
      delete parent[final];
    } else parent[final] = structuredClone(value!);
  } else throw new Error(`Path ${path} has an incompatible parent`);
}

export class GraphEffectState {
  #state: JsonObject;
  readonly #stateSchema: JsonObject;
  readonly #effects: GraphNodeEffect[] = [];
  #generationResponse: string | undefined;

  constructor(state: JsonObject, stateSchema: JsonObject) {
    this.#state = structuredClone(state);
    this.#stateSchema = stateSchema;
    this.assertState('initial state');
  }

  private assertState(label: string): void {
    const checked = validateSchemaValue(this.#stateSchema, this.#state, label);
    if (!checked.valid)
      throw new Error(`${label} does not satisfy the agent state schema: ${checked.errors.join('; ')}`);
  }

  apply(rawEffects: readonly GraphNodeEffect[]): void {
    for (const rawEffect of rawEffects) {
      const effect = graphNodeEffectSchema.parse(rawEffect);
      if (effect.type === 'STATE_SET') {
        const next = structuredClone(this.#state);
        mutatePath(next, effect.path, effect.value, false);
        this.#state = next;
        this.assertState('graph state');
      } else if (effect.type === 'STATE_REMOVE') {
        const next = structuredClone(this.#state);
        mutatePath(next, effect.path, undefined, true);
        this.#state = next;
        this.assertState('graph state');
      } else if (effect.type === 'GENERATION_RESPONSE') {
        if (this.#generationResponse !== undefined) throw new Error('Generation response was supplied more than once');
        this.#generationResponse = effect.content;
      }
      this.#effects.push(structuredClone(effect));
    }
  }

  stateSnapshot(): JsonObject {
    return structuredClone(this.#state);
  }

  publish(): { state: JsonObject; effects: GraphNodeEffect[]; generationResponse?: string } {
    return {
      state: this.stateSnapshot(),
      effects: structuredClone(this.#effects),
      ...(this.#generationResponse === undefined ? {} : { generationResponse: this.#generationResponse }),
    };
  }
}
