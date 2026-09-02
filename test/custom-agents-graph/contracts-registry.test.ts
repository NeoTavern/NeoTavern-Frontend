import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import { validateGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/validate';
import {
  defineNode,
  defineTriggerNode,
  triggerDeclarationSchema,
} from '../../src/extensions/built-in/custom-agents/registry/node-definition';
import { NodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/node-registry';
import { basePreset, createTestRegistry } from '../fixtures/custom-agents/test-registry';

describe('custom-agent canonical graph contracts and registry', () => {
  it('accepts only the exact new unversioned envelope and serialized port shape', () => {
    const registry = createTestRegistry();
    expect(validateGraphPreset(basePreset(), registry).valid).toBe(true);
    expect(validateGraphPreset({ format: 'UNSUPPORTED_FORMAT', agent: basePreset().agent }, registry).valid).toBe(
      false,
    );
    expect(validateGraphPreset({ ...basePreset(), version: 1 }, registry).valid).toBe(false);

    const extraPortField = basePreset();
    extraPortField.agent.flows[0]!.kind = 'SUBFLOW';
    extraPortField.agent.flows[0]!.nodes = [];
    extraPortField.agent.flows[0]!.edges = [];
    extraPortField.agent.flows[0]!.inputs = [
      { id: 'value', label: 'Value', required: true, cardinality: 'ONE', schema: {}, valueType: 'JSON' } as never,
    ];
    expect(validateGraphPreset(extraPortField, registry).valid).toBe(false);
  });

  it('rejects authored refs/defs, non-finite positions, invalid defaults, and extra node fields', () => {
    const registry = createTestRegistry();
    for (const schema of [
      { type: 'object', $ref: '#/$defs/x' },
      { type: 'object', $defs: { x: { type: 'string' } } },
      { type: 'object', properties: { x: { $ref: '#/definitions/x' } } },
    ]) {
      const preset = basePreset();
      preset.agent.configurationSchema = schema;
      expect(validateGraphPreset(preset, registry).valid).toBe(false);
    }
    const badPosition = basePreset();
    badPosition.agent.flows[0]!.nodes[0]!.position.x = Number.POSITIVE_INFINITY;
    expect(validateGraphPreset(badPosition, registry).valid).toBe(false);
    const badDefault = basePreset();
    badDefault.agent.configurationSchema = {
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    };
    expect(validateGraphPreset(badDefault, registry).valid).toBe(false);
    const extraNode = structuredClone(basePreset()) as unknown as {
      agent: { flows: Array<{ nodes: Array<Record<string, unknown>> }> };
    };
    extraNode.agent.flows[0]!.nodes[0]!.legacy = true;
    expect(validateGraphPreset(extraNode, registry).valid).toBe(false);
  });

  it('rejects duplicate registry IDs and parses typed callbacks at the sole erasure boundary', async () => {
    const schema = z.strictObject({ count: z.number() });
    let received = 0;
    const definition = defineNode({
      type: 'test.typed',
      labelKey: 'typed',
      descriptionKey: 'typed',
      category: 'DATA',
      executionClass: 'PURE_DATA',
      dataSchema: schema,
      initialData: () => ({ count: 1 }),
      initialInputValues: () => ({}),
      ports: (data) => {
        received = data.count;
        return { inputs: [], outputs: [] };
      },
      fields: () => [],
      runtime: {
        kind: 'EXECUTOR',
        execute: async ({ data }) => {
          received = data.count;
          return { control: [], outputs: {}, effects: [] };
        },
      },
    });
    const registry = new NodeRegistry([definition]);
    expect(
      createTestRegistry()
        .list()
        .some((item) => item.type === 'scope.entry'),
    ).toBe(true);
    expect(() => registry.register(definition)).toThrow('Duplicate node type test.typed');
    definition.ports(
      { count: 4 },
      {
        agent: basePreset().agent,
        flow: basePreset().agent.flows[0]!,
        nodeId: 'node',
        resolveSubflow: () => undefined,
        resolveInputBinding: () => ({ kind: 'UNBOUND' }),
        resolveNestedReturnSource: () => undefined,
      },
    );
    expect(received).toBe(4);
    expect(() =>
      definition.ports(
        { count: 'bad' },
        {
          agent: basePreset().agent,
          flow: basePreset().agent.flows[0]!,
          nodeId: 'node',
          resolveSubflow: () => undefined,
          resolveInputBinding: () => ({ kind: 'UNBOUND' }),
          resolveNestedReturnSource: () => undefined,
        },
      ),
    ).toThrow();
  });

  it('rejects semantically invalid trigger declarations from the canonical getter', () => {
    const invalidTrigger = defineTriggerNode({
      type: 'test.invalid-trigger',
      labelKey: 'invalid',
      descriptionKey: 'invalid',
      category: 'TRIGGER',
      executionClass: 'CONTROLLED',
      dataSchema: z.strictObject({}),
      initialData: () => ({}),
      initialInputValues: () => ({}),
      ports: () => ({
        inputs: [],
        outputs: [{ id: 'out', direction: 'OUTPUT', kind: 'CONTROL', cardinality: 'MANY', labelKey: 'out' }],
      }),
      fields: () => [],
      runtime: { kind: 'TRIGGER' },
      getTriggerDeclaration: () => ({
        event: 'AFTER_USER',
        generationModes: ['NEW'],
        schedule: { type: 'ALWAYS' },
      }),
    });
    const definitions = createTestRegistry()
      .list()
      .filter((item) => item.type !== 'test.trigger');
    const registry = new NodeRegistry([...definitions, invalidTrigger]);
    const preset = basePreset();
    preset.agent.flows[0]!.nodes[0]!.type = 'test.invalid-trigger';
    const result = validateGraphPreset(preset, registry);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.diagnostics.map((item) => item.code)).toContain('TRIGGER_DECLARATION');
  });

  it('owns one strict recursive trigger declaration schema', () => {
    const valid = {
      event: 'BEFORE_GENERATION',
      generationModes: ['NEW', 'ADD_SWIPE'],
      schedule: { type: 'EVERY_N_EVENTS', interval: 2 },
      condition: {
        op: 'all',
        conditions: [
          { op: 'exists', reference: { $ref: 'event.message' } },
          {
            op: 'equals',
            left: { nested: [{ $ref: 'config.enabled' }] },
            right: { $ref: 'state.enabled' },
          },
        ],
      },
    };
    expect(triggerDeclarationSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, extra: true },
      { ...valid, condition: { op: 'all', conditions: [] } },
      { ...valid, condition: { op: 'any', conditions: [] } },
      { ...valid, condition: { op: 'exists', reference: { $ref: 'input.value' } } },
      { ...valid, condition: { op: 'exists', reference: { $ref: 'state.__proto__.value' } } },
      { ...valid, schedule: { type: 'EVERY_N_EVENTS', interval: 0 } },
      { ...valid, generationModes: ['ADD_SWIPE', 'NEW'] },
      { ...valid, generationModes: ['NEW', 'NEW'] },
      { ...valid, role: 'LEGACY' },
      {
        ...valid,
        event: 'MANUAL',
        generationModes: [],
        schedule: { type: 'EVERY_N_EVENTS', interval: 1 },
      },
    ])
      expect(triggerDeclarationSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects missing, wrong, and extra trigger structural ports', () => {
    const definitions = createTestRegistry()
      .list()
      .filter((item) => item.type !== 'test.trigger');
    const variants = [
      [{ id: 'out', direction: 'OUTPUT', kind: 'CONTROL', cardinality: 'MANY', labelKey: 'out' }],
      [
        { id: 'out', direction: 'OUTPUT', kind: 'CONTROL', cardinality: 'MANY', labelKey: 'out' },
        {
          id: 'event',
          direction: 'OUTPUT',
          kind: 'DATA',
          cardinality: 'MANY',
          required: true,
          schema: { type: 'string' },
          labelKey: 'event',
        },
      ],
      [
        { id: 'out', direction: 'OUTPUT', kind: 'CONTROL', cardinality: 'MANY', labelKey: 'out' },
        {
          id: 'event',
          direction: 'OUTPUT',
          kind: 'DATA',
          cardinality: 'MANY',
          required: true,
          schema: { type: 'object' },
          labelKey: 'event',
        },
        {
          id: 'extra',
          direction: 'OUTPUT',
          kind: 'DATA',
          cardinality: 'MANY',
          required: true,
          schema: {},
          labelKey: 'extra',
        },
      ],
    ] as const;
    for (const outputs of variants) {
      const malformed = defineTriggerNode({
        type: 'test.trigger',
        labelKey: 'trigger',
        descriptionKey: 'trigger',
        category: 'TRIGGER',
        executionClass: 'CONTROLLED',
        dataSchema: z.strictObject({}),
        initialData: () => ({}),
        initialInputValues: () => ({}),
        ports: () => ({ inputs: [], outputs: [...outputs] }),
        fields: () => [],
        runtime: { kind: 'TRIGGER' },
        getTriggerDeclaration: () => ({
          event: 'MANUAL',
          generationModes: [],
          schedule: { type: 'ALWAYS' },
        }),
      });
      const result = validateGraphPreset(basePreset(), new NodeRegistry([...definitions, malformed]));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.diagnostics.map((item) => item.code)).toContain('TRIGGER_PORT_CONTRACT');
    }
  });

  it('extracts trigger declarations into an immutable plan', () => {
    const compiled = compileGraphPreset(basePreset(), createTestRegistry());
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    expect(compiled.plan.agent.flows[0]!.trigger).toEqual({
      event: 'MANUAL',
      generationModes: [],
      schedule: { type: 'ALWAYS' },
    });
    expect(Object.isFrozen(compiled.plan)).toBe(true);
    expect(Object.isFrozen(compiled.plan.agent.flows[0]!.nodes)).toBe(true);
    expect(() => Object.assign(compiled.plan.agent.flows[0]!, { name: 'changed' })).toThrow();
  });
});
