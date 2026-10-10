import { z } from 'zod';
import { stableIdSchema, jsonObjectSchema } from '../../graph/schemas';
import { defineNode } from '../../registry/node-definition';
import type { JsonObject } from '../../graph/contracts';
import { controlInput, controlOutput, controlled, dataInput, projectedOutputs, validateJson } from '../shared';
const placement = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('AFTER_CONTEXT'), role: z.enum(['SYSTEM', 'USER']) }),
  z.strictObject({
    type: z.literal('IN_CHAT'),
    role: z.enum(['SYSTEM', 'USER', 'ASSISTANT']),
    depth: z.number().int().nonnegative(),
  }),
]);
const assembly = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('NORMAL_CHAT'),
    history: z.enum(['NONE', 'FULL_CURRENT', 'FULL_TARGET', 'FULL_BEFORE_TARGET', 'RECENT_CURRENT', 'RECENT_TARGET']),
    placement,
  }),
  z.strictObject({ type: z.literal('STANDALONE'), role: z.enum(['SYSTEM', 'USER']) }),
]);
const variable = z.strictObject({ id: stableIdSchema, name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) });
const schema = z
  .strictObject({ prompt: z.string(), variables: z.array(variable), assembly, outputSchema: jsonObjectSchema })
  .superRefine((data, ctx) => {
    if (new Set(data.variables.map((v) => v.id)).size !== data.variables.length)
      ctx.addIssue({ code: 'custom', message: 'variable IDs must be unique' });
    if (new Set(data.variables.map((v) => v.name)).size !== data.variables.length)
      ctx.addIssue({ code: 'custom', message: 'variable names must be unique' });
  });
type RequestData = z.infer<typeof schema> & { outputSchema: JsonObject };
export const llmRequestNodeDefinition = defineNode<RequestData>({
  type: 'llm.request',
  labelKey: 'extensionsBuiltin.customAgents.nodes.llmRequest.label',
  descriptionKey: 'extensionsBuiltin.customAgents.nodes.llmRequest.description',
  category: 'LLM',
  executionClass: 'CONTROLLED',
  dataSchema: schema,
  initialData: () => ({
    prompt: '',
    variables: [],
    assembly: { type: 'NORMAL_CHAT', history: 'NONE', placement: { type: 'AFTER_CONTEXT', role: 'SYSTEM' } },
    outputSchema: {},
  }),
  initialInputValues: () => ({ structuredFormat: 'NATIVE' }),
  ports: (data) => ({
    inputs: [
      controlInput(),
      ...data.variables.map((v) => dataInput(`variable.${v.id}`, {}, true, undefined, v.name, undefined, true)),
      ...(data.assembly.type === 'NORMAL_CHAT' && data.assembly.history.startsWith('RECENT_')
        ? [dataInput('historyCount', { type: 'integer', minimum: 1 })]
        : []),
      dataInput('connectionProfileId', { type: 'string' }, false, 'CONNECTION_PROFILE'),
      dataInput('structuredFormat', { type: 'string', enum: ['NATIVE', 'JSON', 'XML'] }),
    ],
    outputs: [controlOutput(), ...projectedOutputs('result', data.outputSchema)],
  }),
  fields: (data) => [
    { id: 'prompt', path: 'prompt', labelKey: 'prompt', control: 'TEXTAREA' },
    {
      id: 'variables',
      path: 'variables',
      labelKey: 'variables',
      control: 'REPEATER',
      minimum: 0,
      itemFields: [{ id: 'name', path: 'name', labelKey: 'name', control: 'INPUT' }],
    },
    {
      id: 'assemblyType',
      path: 'assembly.type',
      labelKey: 'assemblyType',
      control: 'SELECT',
      options: ['NORMAL_CHAT', 'STANDALONE'].map((value) => ({ labelKey: value, value })),
    },
    ...(data.assembly.type === 'NORMAL_CHAT'
      ? [
          {
            id: 'history',
            path: 'assembly.history',
            labelKey: 'history',
            control: 'SELECT' as const,
            options: [
              'NONE',
              'FULL_CURRENT',
              'FULL_TARGET',
              'FULL_BEFORE_TARGET',
              'RECENT_CURRENT',
              'RECENT_TARGET',
            ].map((value) => ({
              labelKey: value,
              value,
            })),
          },
          {
            id: 'placementType',
            path: 'assembly.placement.type',
            labelKey: 'placementType',
            control: 'SELECT' as const,
            options: ['AFTER_CONTEXT', 'IN_CHAT'].map((value) => ({ labelKey: value, value })),
          },
          {
            id: 'placementRole',
            path: 'assembly.placement.role',
            labelKey: 'placementRole',
            control: 'SELECT' as const,
            options: (data.assembly.placement.type === 'IN_CHAT'
              ? ['SYSTEM', 'USER', 'ASSISTANT']
              : ['SYSTEM', 'USER']
            ).map((value) => ({ labelKey: value, value })),
          },
          ...(data.assembly.placement.type === 'IN_CHAT'
            ? [{ id: 'depth', path: 'assembly.placement.depth', labelKey: 'depth', control: 'NUMBER' as const }]
            : []),
        ]
      : [
          {
            id: 'standaloneRole',
            path: 'assembly.role',
            labelKey: 'standaloneRole',
            control: 'SELECT' as const,
            options: ['SYSTEM', 'USER'].map((value) => ({ labelKey: value, value })),
          },
        ]),
    { id: 'outputSchema', path: 'outputSchema', labelKey: 'outputSchema', control: 'JSON' },
  ],
  runtime: {
    kind: 'EXECUTOR',
    execute: async (context) => {
      context.signal.throwIfAborted();
      const variables = Object.fromEntries(
        context.data.variables.map((v) => [v.name, context.inputs[`variable.${v.id}`]!]),
      );
      const configured = context.inputs.connectionProfileId;
      let promptContext = context.promptContext;
      if (context.data.assembly.type === 'NORMAL_CHAT' && context.data.assembly.history.startsWith('RECENT_')) {
        const count = z.number().int().positive().parse(context.inputs.historyCount);
        const target =
          context.data.assembly.history === 'RECENT_TARGET' ? context.promptContext.targetMessage : undefined;
        let bounded = target
          ? context.promptContext.chatHistory.slice(0, target.index + 1)
          : [...context.promptContext.chatHistory];
        if (target) {
          const targetMessage = {
            name: target.name,
            mes: target.content,
            is_user: target.role === 'USER',
            is_system: target.role === 'SYSTEM',
            send_date: '',
            original_avatar: '',
            swipes: [target.content],
            swipe_id: target.swipeIndex ?? 0,
            swipe_info: [{ send_date: '', extra: {} }],
            extra: {},
          };
          if (target.index < bounded.length) bounded[target.index] = targetMessage;
          else bounded.push(targetMessage);
        }
        bounded = bounded.slice(-count);
        promptContext = {
          ...context.promptContext,
          chatHistory: bounded,
          ...(target ? { targetMessage: { ...target, index: bounded.length - 1 } } : {}),
        };
      }
      const connectionProfileId = configured === undefined || configured === '' ? null : z.string().parse(configured);
      const structuredFormat = z.enum(['NATIVE', 'JSON', 'XML']).parse(context.inputs.structuredFormat);
      const result = await context.llm.dispatch({
        requestId: context.ids.generate(),
        source: 'core.custom-agents',
        nodeId: context.nodeId,
        flowId: context.flowId,
        prompt: context.data.prompt,
        variables,
        assembly: context.data.assembly,
        connectionProfileId,
        structuredFormat,
        outputSchema: context.data.outputSchema,
        event: context.event,
        configuration: context.configuration,
        state: context.state,
        ...(context.iteration ? { iteration: context.iteration } : {}),
        promptContext,
        signal: context.signal,
      });
      context.signal.throwIfAborted();
      return controlled({ result: validateJson(context.data.outputSchema, result, 'LLM output') });
    },
  },
});
