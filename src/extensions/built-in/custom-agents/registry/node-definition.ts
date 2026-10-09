import { z } from 'zod';
import type { ChatMessage } from '../../../../types/chat';
import { isSafePath } from '../generic/path';
import type { JsonObject, JsonPrimitive, JsonValue } from '../generic/json';
import type { CustomAgentEvent, GenerationMode, MessageValue } from '../host/contracts';
import type { ToolId } from './tool-contracts';
import type { FlowSignature, GraphAgent, GraphEdge, GraphFlow, GraphNode, PortCardinality } from '../graph/contracts';
import type { GraphDiagnostic } from '../graph/diagnostics';

export type NodeExecutionClass = 'PURE_DATA' | 'CONTROLLED' | 'MERGE_ANY' | 'MERGE_ALL';
export type NodeCategory = 'TRIGGER' | 'CONTROL' | 'DATA' | 'LOGIC' | 'LLM' | 'TOOL' | 'EFFECT';

export type ControlPortDefinition = {
  id: string;
  direction: 'INPUT' | 'OUTPUT';
  kind: 'CONTROL';
  cardinality: PortCardinality;
  labelKey: string;
  literalLabel?: true;
};

export type DataPortDefinition = {
  id: string;
  direction: 'INPUT' | 'OUTPUT';
  kind: 'DATA';
  cardinality: PortCardinality;
  required: boolean;
  schema: JsonObject;
  labelKey: string;
  literalLabel?: true;
  inlineEditor?: 'SCHEMA' | 'SCHEMA_PATH' | 'TEXTAREA' | 'JSON' | 'CONNECTION_PROFILE';
  schemaPathSource?: { inputPortId: string; mode: 'VALUE' | 'ARRAY_ITEMS' };
};

export type PortDefinition = ControlPortDefinition | DataPortDefinition;

export type InspectorFieldDefinition =
  | {
      id: string;
      path: string;
      labelKey: string;
      control: 'INPUT' | 'TEXTAREA' | 'NUMBER' | 'TOGGLE';
      rows?: number;
      allowMaximize?: boolean;
    }
  | { id: string; path: string; labelKey: string; control: 'JSON'; optional?: boolean }
  | {
      id: string;
      path: string;
      labelKey: string;
      control: 'SCHEMA_PATH';
      schemaSource: 'CONFIGURATION' | 'STATE' | 'EVENT' | 'INPUT_VALUE';
      allowRoot: boolean;
    }
  | {
      id: string;
      path: string;
      labelKey: string;
      control: 'SELECT' | 'CHECKBOX_GROUP';
      options: Array<{ labelKey: string; value: JsonValue }>;
    }
  | {
      id: string;
      path: string;
      labelKey: string;
      control: 'REPEATER';
      minimum: number;
      itemFields: InspectorFieldDefinition[];
    }
  | { id: string; path: string; labelKey: string; control: 'SCOPE_EDITOR' };

export type ResolvedInputBinding =
  | { kind: 'EDGE'; source: Readonly<DataPortDefinition> }
  | { kind: 'INLINE'; value: JsonValue }
  | { kind: 'UNBOUND' };

export type NodePortContext = {
  agent: Readonly<GraphAgent>;
  flow: Readonly<GraphFlow>;
  nodeId: string;
  scopeSignature?: Readonly<FlowSignature>;
  scopeSignatureKind: 'AUTHORED' | 'FOR_EACH';
  resolveSubflow: (flowId: string) => Readonly<FlowSignature> | undefined;
  resolveInputBinding: (inputPortId: string) => ResolvedInputBinding;
  resolveNestedReturnSource: (returnPortId: string) => Readonly<DataPortDefinition> | undefined;
};

export type RandomSource = { next: () => number };
export type IdSource = { generate: () => string };
export type ToolDispatcher = {
  dispatch: (
    toolId: ToolId,
    input: JsonValue,
    services: { signal: AbortSignal; random: RandomSource; ids: IdSource },
  ) => Promise<JsonValue>;
};
export type GraphLlmPlacement =
  | { type: 'AFTER_CONTEXT'; role: 'SYSTEM' | 'USER' }
  | { type: 'IN_CHAT'; role: 'SYSTEM' | 'USER' | 'ASSISTANT'; depth: number };
export type GraphLlmAssembly =
  | {
      type: 'NORMAL_CHAT';
      history: 'NONE' | 'FULL_CURRENT' | 'FULL_TARGET' | 'RECENT_CURRENT' | 'RECENT_TARGET';
      placement: GraphLlmPlacement;
    }
  | { type: 'STANDALONE'; role: 'SYSTEM' | 'USER' };
export type GraphPromptContext = {
  chatHistory: readonly ChatMessage[];
  targetMessage?: MessageValue;
  currentCharacter: JsonObject | null;
  persona: JsonObject | null;
};
export type TemplateRenderRequest = {
  template: string;
  variables: Readonly<Record<string, JsonValue>>;
  event: Readonly<CustomAgentEvent>;
  configuration: Readonly<JsonObject>;
  state: Readonly<JsonObject>;
  iteration?: Readonly<{ item: JsonValue; index: number; accumulator?: JsonValue }>;
  promptContext: Readonly<GraphPromptContext>;
  signal: AbortSignal;
};
export type TemplateRenderer = { render: (request: TemplateRenderRequest) => Promise<string> };
export type GraphLlmRequest = {
  requestId: string;
  source: 'core.custom-agents';
  nodeId: string;
  flowId: string;
  prompt: string;
  variables: Readonly<Record<string, JsonValue>>;
  assembly: GraphLlmAssembly;
  connectionProfileId: string | null;
  structuredFormat: 'NATIVE' | 'JSON' | 'XML';
  outputSchema: JsonObject;
  event: Readonly<CustomAgentEvent>;
  configuration: Readonly<JsonObject>;
  state: Readonly<JsonObject>;
  iteration?: Readonly<{ item: JsonValue; index: number; accumulator?: JsonValue }>;
  promptContext: Readonly<GraphPromptContext>;
  signal: AbortSignal;
};
export type LlmDispatcher = { dispatch: (request: GraphLlmRequest) => Promise<JsonValue> };

export type NodeInitializationContext = { ids: IdSource };
export type ReadonlyNodeRegistry = {
  get: (type: string) => RegisteredNodeDefinition | undefined;
  list: () => readonly RegisteredNodeDefinition[];
};

export type NodeValidationContext<TData> = {
  agent: Readonly<GraphAgent>;
  flow: Readonly<GraphFlow>;
  node: Readonly<GraphNode<TData>>;
  ports: Readonly<{ inputs: PortDefinition[]; outputs: PortDefinition[] }>;
  edges: readonly GraphEdge[];
  registry: ReadonlyNodeRegistry;
};

export type ResolvedNodeInputs = Readonly<Record<string, JsonValue>>;
export type InjectionLifetime =
  | { type: 'ONCE' }
  | { type: 'UNTIL_REMOVED' }
  | { type: 'FOR_N_GENERATIONS'; generations: number };
export type ResolvedInjectionActivation = { type: 'ALWAYS' } | { type: 'PROBABILITY'; probability: number };
export type GraphNodeEffect =
  | { type: 'STATE_SET'; path: string; value: JsonValue }
  | { type: 'STATE_REMOVE'; path: string }
  | {
      type: 'INJECTION_SET';
      injectionId: string;
      content: string;
      placement: 'relative' | 'in-chat';
      depth: number;
      lifetime: InjectionLifetime;
      activation: ResolvedInjectionActivation;
    }
  | { type: 'INJECTION_REMOVE'; injectionId: string }
  | { type: 'VISIBLE_MESSAGE'; operation: 'REPLACE_TARGET' | 'APPEND_TARGET' | 'CREATE'; content: string }
  | { type: 'GENERATION_RESPONSE'; content: string };
export type NodeTerminal = { type: 'STOP' } | { type: 'RETURN'; outputs: Record<string, JsonValue> };
export type NodeExecutionResult = {
  control: string[];
  outputs: Record<string, JsonValue>;
  effects: GraphNodeEffect[];
  terminal?: NodeTerminal;
};
export type NodeExecutionContext<TData> = {
  nodeId: string;
  flowId: string;
  data: Readonly<TData>;
  inputs: ResolvedNodeInputs;
  event: Readonly<CustomAgentEvent>;
  configuration: Readonly<JsonObject>;
  state: Readonly<JsonObject>;
  iteration?: Readonly<{ item: JsonValue; index: number; accumulator?: JsonValue }>;
  signal: AbortSignal;
  random: RandomSource;
  ids: IdSource;
  tools: ToolDispatcher;
  llm: LlmDispatcher;
  templates: TemplateRenderer;
  promptContext: Readonly<GraphPromptContext>;
};

export type EligibilityReference = { $ref: `${'event' | 'config' | 'state'}.${string}` };
export type EligibilityValue =
  | JsonPrimitive
  | EligibilityReference
  | EligibilityValue[]
  | { [key: string]: EligibilityValue };
export type EligibilityCondition =
  | { op: 'all' | 'any'; conditions: EligibilityCondition[] }
  | { op: 'not'; condition: EligibilityCondition }
  | { op: 'exists' | 'missing'; reference: EligibilityReference }
  | {
      op: 'equals' | 'notEquals' | 'gt' | 'gte' | 'lt' | 'lte';
      left: EligibilityValue;
      right: EligibilityValue;
    }
  | { op: 'in'; value: EligibilityValue; collection: EligibilityValue };
export type TriggerSchedule = { type: 'ALWAYS' } | { type: 'EVERY_N_EVENTS'; interval: number };
export type TriggerDeclaration = {
  event: 'AFTER_USER' | 'BEFORE_GENERATION' | 'GENERATE_ASSISTANT' | 'AFTER_GENERATION' | 'MANUAL';
  generationModes: GenerationMode[];
  schedule: TriggerSchedule;
  condition?: EligibilityCondition;
};

const eligibilityReferenceValueSchema = z.custom<EligibilityReference['$ref']>((value) => {
  if (typeof value !== 'string') return false;
  const separator = value.indexOf('.');
  if (separator < 0) return false;
  const root = value.slice(0, separator);
  return ['event', 'config', 'state'].includes(root) && isSafePath(value.slice(separator + 1));
}, 'must reference a safe event, config, or state path');

const eligibilityReferenceSchema: z.ZodType<EligibilityReference> = z.strictObject({
  $ref: eligibilityReferenceValueSchema,
});
const eligibilityPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const eligibilityValueSchema: z.ZodType<EligibilityValue> = z.lazy(() =>
  z.union([
    eligibilityPrimitiveSchema,
    eligibilityReferenceSchema,
    z.array(eligibilityValueSchema),
    z
      .record(z.string(), eligibilityValueSchema)
      .refine((value) => !Object.hasOwn(value, '$ref'), 'an object containing $ref must be an exact reference'),
  ]),
);
const eligibilityConditionSchema: z.ZodType<EligibilityCondition> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.strictObject({ op: z.enum(['all', 'any']), conditions: z.array(eligibilityConditionSchema).min(1) }),
    z.strictObject({ op: z.literal('not'), condition: eligibilityConditionSchema }),
    z.strictObject({ op: z.enum(['exists', 'missing']), reference: eligibilityReferenceSchema }),
    z.strictObject({
      op: z.enum(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte']),
      left: eligibilityValueSchema,
      right: eligibilityValueSchema,
    }),
    z.strictObject({ op: z.literal('in'), value: eligibilityValueSchema, collection: eligibilityValueSchema }),
  ]),
);
const triggerScheduleSchema: z.ZodType<TriggerSchedule> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ALWAYS') }),
  z.strictObject({ type: z.literal('EVERY_N_EVENTS'), interval: z.number().int().positive() }),
]);
const generationModeSchema = z.enum(['NEW', 'REGENERATE', 'ADD_SWIPE']);
const canonicalGenerationModes: readonly GenerationMode[] = ['NEW', 'REGENERATE', 'ADD_SWIPE'];

export const triggerDeclarationSchema: z.ZodType<TriggerDeclaration> = z
  .strictObject({
    event: z.enum(['AFTER_USER', 'BEFORE_GENERATION', 'GENERATE_ASSISTANT', 'AFTER_GENERATION', 'MANUAL']),
    generationModes: z.array(generationModeSchema),
    schedule: triggerScheduleSchema,
    condition: eligibilityConditionSchema.optional(),
  })
  .superRefine((declaration, context) => {
    const generationEvent = ['BEFORE_GENERATION', 'GENERATE_ASSISTANT', 'AFTER_GENERATION'].includes(declaration.event);
    if (generationEvent && declaration.generationModes.length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['generationModes'],
        message: 'generation trigger declarations require generation modes',
      });
    if (!generationEvent && declaration.generationModes.length !== 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['generationModes'],
        message: 'non-generation triggers cannot declare generation modes',
      });
    const modeIndexes = declaration.generationModes.map((mode) => canonicalGenerationModes.indexOf(mode));
    const canonical = modeIndexes.every((modeIndex, index) => index === 0 || modeIndexes[index - 1]! < modeIndex);
    if (generationEvent && !canonical)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['generationModes'],
        message: 'generation modes must be unique and use canonical order',
      });
    if (declaration.event === 'MANUAL' && declaration.schedule.type !== 'ALWAYS')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedule'],
        message: 'manual triggers always use the ALWAYS schedule',
      });
  });

export type StructuralRuntimeKind = 'SCOPE_ENTRY' | 'SCOPE_RETURN' | 'RUN_SUBFLOW' | 'FOR_EACH' | 'STOP';
export type TypedNodeRuntime<TData extends JsonObject> =
  | { kind: 'EXECUTOR'; execute: (context: NodeExecutionContext<TData>) => Promise<NodeExecutionResult> }
  | { kind: 'TRIGGER' }
  | { kind: StructuralRuntimeKind };

export type TypedNodeDefinition<TData extends JsonObject> = {
  type: string;
  labelKey: string;
  descriptionKey: string;
  category: NodeCategory;
  executionClass: NodeExecutionClass;
  dataSchema: z.ZodType<TData>;
  initialData: (context: NodeInitializationContext) => TData;
  initialInputValues: (context: NodeInitializationContext, data: TData) => Record<string, JsonValue>;
  ports: (data: TData, context: NodePortContext) => { inputs: PortDefinition[]; outputs: PortDefinition[] };
  fields: (data: TData) => InspectorFieldDefinition[];
  validate?: (context: NodeValidationContext<TData>) => GraphDiagnostic[];
  runtime: TypedNodeRuntime<TData>;
};

export type TypedTriggerNodeDefinition<TData extends JsonObject> = TypedNodeDefinition<TData> & {
  category: 'TRIGGER';
  executionClass: 'CONTROLLED';
  runtime: { kind: 'TRIGGER' };
  getTriggerDeclaration: (data: TData) => TriggerDeclaration;
};

export type RegisteredNodeDefinition = {
  type: string;
  labelKey: string;
  descriptionKey: string;
  category: NodeCategory;
  executionClass: NodeExecutionClass;
  dataSchema: z.ZodType<JsonObject>;
  initialData: (context: NodeInitializationContext) => JsonObject;
  initialInputValues: (context: NodeInitializationContext, data: JsonObject) => Record<string, JsonValue>;
  ports: (data: JsonObject, context: NodePortContext) => { inputs: PortDefinition[]; outputs: PortDefinition[] };
  fields: (data: JsonObject) => InspectorFieldDefinition[];
  validate?: (context: NodeValidationContext<JsonObject>) => GraphDiagnostic[];
  runtime:
    | { kind: 'EXECUTOR'; execute: (context: NodeExecutionContext<JsonObject>) => Promise<NodeExecutionResult> }
    | { kind: 'TRIGGER'; getTriggerDeclaration: (data: JsonObject) => TriggerDeclaration }
    | { kind: StructuralRuntimeKind };
};

function commonDefinition<TData extends JsonObject>(definition: TypedNodeDefinition<TData>) {
  const parseData = (data: JsonObject): TData => definition.dataSchema.parse(data);
  const typedValidate = definition.validate;
  const validate = typedValidate
    ? (context: NodeValidationContext<JsonObject>): GraphDiagnostic[] => {
        const node: GraphNode<TData> = { ...context.node, data: parseData(context.node.data) };
        return typedValidate({ ...context, node });
      }
    : undefined;
  return {
    type: definition.type,
    labelKey: definition.labelKey,
    descriptionKey: definition.descriptionKey,
    category: definition.category,
    executionClass: definition.executionClass,
    dataSchema: definition.dataSchema,
    initialData: (context: NodeInitializationContext) => definition.dataSchema.parse(definition.initialData(context)),
    initialInputValues: (context: NodeInitializationContext, data: JsonObject) =>
      definition.initialInputValues(context, parseData(data)),
    ports: (data: JsonObject, context: NodePortContext) => definition.ports(parseData(data), context),
    fields: (data: JsonObject) => definition.fields(parseData(data)),
    ...(validate ? { validate } : {}),
  };
}

export function defineNode<TData extends JsonObject>(definition: TypedNodeDefinition<TData>): RegisteredNodeDefinition {
  if (definition.runtime.kind === 'TRIGGER') throw new Error(`Trigger ${definition.type} must use defineTriggerNode`);
  const common = commonDefinition(definition);
  if (definition.runtime.kind === 'EXECUTOR') {
    const execute = definition.runtime.execute;
    return {
      ...common,
      runtime: {
        kind: 'EXECUTOR',
        execute: (context) => execute({ ...context, data: definition.dataSchema.parse(context.data) }),
      },
    };
  }
  return { ...common, runtime: definition.runtime };
}

export function defineTriggerNode<TData extends JsonObject>(
  definition: TypedTriggerNodeDefinition<TData>,
): RegisteredNodeDefinition {
  const common = commonDefinition(definition);
  return {
    ...common,
    runtime: {
      kind: 'TRIGGER',
      getTriggerDeclaration: (data) =>
        triggerDeclarationSchema.parse(definition.getTriggerDeclaration(definition.dataSchema.parse(data))),
    },
  };
}
