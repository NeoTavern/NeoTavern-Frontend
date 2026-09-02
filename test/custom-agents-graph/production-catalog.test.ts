import fs from 'node:fs';
import Ajv from 'ajv';
import { describe, expect, it, vi } from 'vitest';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import type { GraphPreset, JsonObject, JsonValue } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import type {
  InspectorFieldDefinition,
  NodeExecutionContext,
  NodePortContext,
  RegisteredNodeDefinition,
  ResolvedInputBinding,
} from '../../src/extensions/built-in/custom-agents/registry/node-definition';
import { executeGraphPlan } from '../../src/extensions/built-in/custom-agents/runtime/execute-plan';
import { genericToolCatalog } from '../../src/extensions/built-in/custom-agents/registry/tools';

const fixture = (name: string): GraphPreset =>
  JSON.parse(
    fs.readFileSync(new URL(`../fixtures/custom-agents/${name}.flow.json`, import.meta.url), 'utf8'),
  ) as GraphPreset;
const jsonFixture = (name: string): unknown =>
  JSON.parse(fs.readFileSync(new URL(`../fixtures/custom-agents/${name}`, import.meta.url), 'utf8'));
const english = JSON.parse(fs.readFileSync(new URL('../../locales/en.json', import.meta.url), 'utf8')) as JsonObject;
function localeValue(path: string): JsonValue | undefined {
  let value: JsonValue = english;
  for (const segment of path.split('.')) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = value[segment]!;
  }
  return value;
}
function resolvedEditorKey(key: string): boolean {
  if (typeof localeValue(key) === 'string') return true;
  const catalogKey = key.replaceAll(/[^A-Za-z0-9_$]/g, '_');
  return typeof localeValue(`extensionsBuiltin.customAgents.catalog.${catalogKey}`) === 'string';
}
function context(
  bindings: Record<string, ResolvedInputBinding> = {},
  overrides: Partial<NodePortContext> = {},
): NodePortContext {
  return {
    agent: {
      id: 'a',
      name: 'A',
      enabled: true,
      priority: 0,
      configurationSchema: { type: 'object' },
      configurationDefaults: {},
      stateSchema: { type: 'object' },
      initialState: {},
      flows: [],
      views: [],
    },
    flow: { id: 'f', name: 'F', kind: 'TRIGGER', inputs: [], outputs: [], nodes: [], edges: [] },
    nodeId: 'n',
    scopeSignatureKind: 'AUTHORED',
    resolveSubflow: () => undefined,
    resolveInputBinding: (id) => bindings[id] ?? { kind: 'UNBOUND' },
    resolveNestedReturnSource: () => undefined,
    ...overrides,
  };
}
function source(schema: JsonObject): ResolvedInputBinding {
  return {
    kind: 'EDGE',
    source: {
      id: 'source',
      direction: 'OUTPUT',
      kind: 'DATA',
      cardinality: 'MANY',
      required: true,
      schema,
      labelKey: 'source',
    },
  };
}
function portContract(definition: RegisteredNodeDefinition, data: JsonObject, portContext = context()) {
  return definition.ports(data, portContext);
}
function compactPorts(ports: ReturnType<RegisteredNodeDefinition['ports']>) {
  const compact = (port: (typeof ports.inputs)[number]) =>
    port.kind === 'CONTROL'
      ? `${port.direction}:${port.kind}:${port.id}:${port.cardinality}:label=${port.labelKey}:literal=${port.literalLabel === true}`
      : `${port.direction}:${port.kind}:${port.id}:${port.cardinality}:${port.required ? 'required' : 'optional'}:schema=${JSON.stringify(port.schema)}:editor=${port.inlineEditor ?? '-'}${port.schemaPathSource ? `:pathSource=${port.schemaPathSource.inputPortId}/${port.schemaPathSource.mode}` : ''}:label=${port.labelKey}:literal=${port.literalLabel === true}`;
  return { inputs: ports.inputs.map(compact), outputs: ports.outputs.map(compact) };
}
function definition(type: string): RegisteredNodeDefinition {
  const found = builtinNodeRegistry.get(type);
  if (!found) throw new Error(`Missing definition ${type}`);
  return found;
}
function compile(preset: GraphPreset) {
  const result = compileGraphPreset(preset, builtinNodeRegistry);
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}
function executorContext(
  data: JsonObject,
  inputs: Record<string, JsonValue>,
  overrides: Partial<NodeExecutionContext<JsonObject>> = {},
): NodeExecutionContext<JsonObject> {
  return {
    nodeId: 'node',
    flowId: 'flow',
    data,
    inputs,
    event: { trigger: 'MANUAL', input: {} },
    configuration: {},
    state: {},
    signal: new AbortController().signal,
    random: { next: () => 0.25 },
    ids: { generate: () => 'controlled-id' },
    tools: genericToolCatalog,
    llm: { dispatch: async () => ({ content: 'generated' }) },
    templates: { render: async ({ template }) => template },
    promptContext: { chatHistory: [], currentCharacter: null, persona: null },
    ...overrides,
  };
}
async function executeDefinition(
  type: string,
  data: JsonObject,
  inputs: Record<string, JsonValue>,
  overrides: Partial<NodeExecutionContext<JsonObject>> = {},
) {
  const runtime = definition(type).runtime;
  if (runtime.kind !== 'EXECUTOR') throw new Error(`${type} is not executable`);
  return runtime.execute(executorContext(data, inputs, overrides));
}
function request(
  plan: ReturnType<typeof compile>,
  flowId: string,
  event: Parameters<typeof executeGraphPlan>[0]['event'],
  overrides: Partial<Parameters<typeof executeGraphPlan>[0]> = {},
) {
  return {
    plan,
    flowId,
    event,
    configuration: {},
    state: {},
    signal: new AbortController().signal,
    random: { next: () => 0.1 },
    ids: { generate: () => `request-${Math.random()}` },
    tools: genericToolCatalog,
    llm: { dispatch: async () => ({ content: 'generated' }) },
    templates: { render: async ({ template }: { template: string }) => template },
    promptContext: { chatHistory: [], currentCharacter: null, persona: null },
    ...overrides,
  };
}

describe('production custom-agent node catalog', () => {
  it('enumerates the exact closed 66-node API', () => {
    const types = builtinNodeRegistry.list().map((item) => item.type);
    expect(types).toHaveLength(66);
    expect(new Set(types).size).toBe(66);
    expect(types.filter((type) => type.startsWith('tool.'))).toHaveLength(31);
  });
  it('resolves every fixed English catalog label emitted by the closed API', () => {
    const keys = new Set<string>();
    const collectFields = (fields: readonly InspectorFieldDefinition[]) => {
      for (const field of fields) {
        keys.add(field.labelKey);
        if (field.control === 'SELECT' || field.control === 'CHECKBOX_GROUP')
          for (const option of field.options) keys.add(option.labelKey);
        if (field.control === 'REPEATER') collectFields(field.itemFields);
      }
    };
    const collectDefinition = (
      item: RegisteredNodeDefinition,
      data: JsonObject,
      portContext: NodePortContext = context(),
    ) => {
      keys.add(item.labelKey);
      keys.add(item.descriptionKey);
      collectFields(item.fields(data));
      const ports = item.ports(data, portContext);
      for (const port of [...ports.inputs, ...ports.outputs]) if (!port.literalLabel) keys.add(port.labelKey);
    };
    for (const item of builtinNodeRegistry.list()) {
      let nextId = 0;
      const initialization = { ids: { generate: () => `catalog-${++nextId}` } };
      collectDefinition(item, item.initialData(initialization));
    }
    for (const type of [
      'trigger.after-user',
      'trigger.before-generation',
      'trigger.generate-assistant',
      'trigger.after-generation',
    ]) {
      const item = definition(type);
      const data = item.initialData({ ids: { generate: () => 'catalog-trigger' } });
      collectDefinition(item, { ...data, schedule: { type: 'EVERY_N_EVENTS', interval: 2 } });
    }
    const llm = definition('llm.request');
    for (const data of [
      {
        prompt: '',
        variables: [],
        assembly: {
          type: 'NORMAL_CHAT',
          history: 'RECENT_CURRENT',
          placement: { type: 'IN_CHAT', role: 'USER', depth: 1 },
        },
        outputSchema: {},
      },
      { prompt: '', variables: [], assembly: { type: 'STANDALONE', role: 'USER' }, outputSchema: {} },
    ])
      collectDefinition(llm, data);
    collectDefinition(definition('effect.set-injection'), {
      injectionId: 'injection',
      placement: 'relative',
      depth: 0,
      lifetime: { type: 'FOR_N_GENERATIONS', generations: 2 },
      activation: { type: 'PROBABILITY' },
    });
    collectDefinition(definition('control.for-each'), {
      accumulator: true,
      body: { nodes: [], edges: [] },
    });
    const forEachSignature = {
      inputs: [
        { id: 'item', label: 'item', required: true, cardinality: 'ONE' as const, schema: {} },
        { id: 'index', label: 'index', required: true, cardinality: 'ONE' as const, schema: { type: 'number' } },
        { id: 'accumulator', label: 'accumulator', required: true, cardinality: 'ONE' as const, schema: {} },
      ],
      outputs: [
        { id: 'value', label: 'value', required: false, cardinality: 'ONE' as const, schema: {} },
        { id: 'accumulator', label: 'accumulator', required: true, cardinality: 'ONE' as const, schema: {} },
      ],
    };
    for (const boundary of [definition('scope.entry'), definition('scope.return')])
      collectDefinition(
        boundary,
        {},
        context({}, { scopeSignature: forEachSignature, scopeSignatureKind: 'FOR_EACH' }),
      );
    keys.add('extensionsBuiltin.customAgents.editor.stalePort');
    for (const category of ['trigger', 'control', 'data', 'logic', 'llm', 'tool', 'effect'])
      keys.add(`extensionsBuiltin.customAgents.editor.categories.${category}`);
    for (const status of ['running', 'completed', 'skipped', 'failed', 'cancelled'])
      keys.add(`extensionsBuiltin.customAgents.runStatus.${status}`);
    for (const kind of ['control', 'string', 'number', 'boolean', 'array', 'object', 'json', 'null'])
      keys.add(`extensionsBuiltin.customAgents.editor.portKinds.${kind}`);
    expect([...keys].filter((key) => !resolvedEditorKey(key)).sort()).toEqual([]);
  });
  it('classifies generated For Each boundaries as fixed and authored reusable signatures as literal', () => {
    const generatedSignature = {
      inputs: [
        { id: 'item', label: 'item', required: true, cardinality: 'ONE' as const, schema: {} },
        { id: 'index', label: 'index', required: true, cardinality: 'ONE' as const, schema: { type: 'number' } },
      ],
      outputs: [{ id: 'value', label: 'value', required: false, cardinality: 'ONE' as const, schema: {} }],
    };
    const generatedEntry = portContract(
      definition('scope.entry'),
      {},
      context({}, { scopeSignature: generatedSignature, scopeSignatureKind: 'FOR_EACH' }),
    );
    const generatedReturn = portContract(
      definition('scope.return'),
      {},
      context({}, { scopeSignature: generatedSignature, scopeSignatureKind: 'FOR_EACH' }),
    );
    expect(generatedEntry.outputs.filter((port) => port.kind === 'DATA')).toMatchObject([
      { id: 'item', labelKey: 'item' },
      { id: 'index', labelKey: 'index' },
    ]);
    expect(generatedEntry.outputs.filter((port) => port.kind === 'DATA')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ literalLabel: true })]),
    );
    expect(generatedReturn.inputs.find((port) => port.id === 'value')).toMatchObject({
      labelKey: 'value',
    });
    expect(generatedReturn.inputs.find((port) => port.id === 'value')).not.toHaveProperty('literalLabel');

    const authoredSignature = {
      inputs: [{ id: 'authored-in', label: 'value', required: true, cardinality: 'ONE' as const, schema: {} }],
      outputs: [{ id: 'authored-out', label: 'input', required: true, cardinality: 'ONE' as const, schema: {} }],
    };
    expect(
      portContract(
        definition('scope.entry'),
        {},
        context({}, { scopeSignature: authoredSignature, scopeSignatureKind: 'AUTHORED' }),
      ).outputs.find((port) => port.id === 'authored-in'),
    ).toMatchObject({ labelKey: 'value', literalLabel: true });
    expect(
      portContract(
        definition('scope.return'),
        {},
        context({}, { scopeSignature: authoredSignature, scopeSignatureKind: 'AUTHORED' }),
      ).inputs.find((port) => port.id === 'authored-out'),
    ).toMatchObject({ labelKey: 'input', literalLabel: true });
  });
  it('propagates generated and authored signature kinds through compiler port resolution', () => {
    const preset = fixture('nested-subflow');
    const authored = preset.agent.flows.find((flow) => flow.id === 'accumulate')!;
    authored.inputs[0]!.label = 'value';
    authored.outputs[0]!.label = 'input';
    const plan = compile(preset);
    const compiled = plan.agent.flows.find((flow) => flow.id === 'accumulate')!;
    expect(
      compiled.nodes.find((node) => node.id === 'sub-entry')?.outputs.find((port) => port.id === 'numbers'),
    ).toMatchObject({ labelKey: 'value', literalLabel: true });
    expect(
      compiled.nodes.find((node) => node.id === 'sub-return')?.inputs.find((port) => port.id === 'result'),
    ).toMatchObject({ labelKey: 'input', literalLabel: true });
    const body = compiled.nodes.find((node) => node.id === 'loop')!.bodyPlan!;
    expect(
      body.nodes.find((node) => node.id === 'body-entry')?.outputs.find((port) => port.id === 'item'),
    ).toMatchObject({ labelKey: 'item' });
    expect(
      body.nodes.find((node) => node.id === 'body-entry')?.outputs.find((port) => port.id === 'item'),
    ).not.toHaveProperty('literalLabel');
    expect(
      body.nodes.find((node) => node.id === 'body-return')?.inputs.find((port) => port.id === 'value'),
    ).not.toHaveProperty('literalLabel');
  });
  it('freezes every default contract in the closed API', async () => {
    const contracts = builtinNodeRegistry.list().map((item) => {
      let nextId = 0;
      const initialization = { ids: { generate: () => `generated-${++nextId}` } };
      const initialData = item.initialData(initialization);
      return {
        type: item.type,
        class: `${item.category}/${item.executionClass}/${item.runtime.kind}`,
        initialData: JSON.stringify(initialData),
        initialInputValues: JSON.stringify(item.initialInputValues(initialization, initialData)),
        ...compactPorts(item.ports(initialData, context())),
        fields: JSON.stringify(item.fields(initialData)),
      };
    });
    expect(contracts).toHaveLength(66);
    expect(contracts).toEqual(jsonFixture('production-catalog-defaults.snapshot.json'));
  });
  it('declares exact value versus array-item sources for every tool schema path port', () => {
    let generated = 0;
    const paths = builtinNodeRegistry
      .list()
      .flatMap((item) =>
        item
          .ports(item.initialData({ ids: { generate: () => `source-id-${++generated}` } }), context())
          .inputs.flatMap((port) =>
            port.kind === 'DATA' && port.inlineEditor === 'SCHEMA_PATH'
              ? [[item.type, port.id, port.schemaPathSource] as const]
              : [],
          ),
      );
    expect(paths).toHaveLength(10);
    expect(
      paths
        .filter(([type]) => type.startsWith('tool.json.'))
        .every(([, , source]) => source?.inputPortId === 'value' && source.mode === 'VALUE'),
    ).toBe(true);
    expect(paths.filter(([type]) => type.startsWith('tool.collection.'))).toEqual([
      ['tool.collection.extract', 'path', { inputPortId: 'items', mode: 'ARRAY_ITEMS' }],
      ['tool.collection.filterString', 'path', { inputPortId: 'items', mode: 'ARRAY_ITEMS' }],
    ]);
  });
  it('makes only random and ID tools controlled', () => {
    for (const definition of builtinNodeRegistry.list().filter((item) => item.type.startsWith('tool.'))) {
      const expected = definition.type.startsWith('tool.random.') || definition.type === 'tool.id.generate';
      expect(definition.executionClass, definition.type).toBe(expected ? 'CONTROLLED' : 'PURE_DATA');
    }
  });
  it('adapts the authoritative logic.compare oneOf contract and executes both members', async () => {
    const compare = definition('tool.logic.compare');
    expect(portContract(compare, {}).inputs).toEqual([
      {
        id: 'operator',
        direction: 'INPUT',
        kind: 'DATA',
        cardinality: 'ONE',
        required: true,
        schema: { type: 'string' },
        labelKey: 'operator',
      },
      {
        id: 'left',
        direction: 'INPUT',
        kind: 'DATA',
        cardinality: 'ONE',
        required: true,
        schema: {},
        labelKey: 'left',
      },
      {
        id: 'right',
        direction: 'INPUT',
        kind: 'DATA',
        cardinality: 'ONE',
        required: true,
        schema: {},
        labelKey: 'right',
      },
    ]);
    await expect(executeDefinition('tool.logic.compare', {}, { operator: 'GT', left: 3, right: 2 })).resolves.toEqual({
      control: [],
      outputs: { result: { result: true } },
      effects: [],
    });
    await expect(
      executeDefinition(
        'tool.logic.compare',
        {},
        { operator: 'EQUALS', left: { nested: [1] }, right: { nested: [1] } },
      ),
    ).resolves.toEqual({ control: [], outputs: { result: { result: true } }, effects: [] });
    await expect(
      executeDefinition('tool.logic.compare', {}, { operator: 'GT', left: '3', right: 2 }),
    ).rejects.toThrow();
  });
  it('emits independently compilable schemas for every static catalog port', () => {
    const ajv = new Ajv({ strict: false });
    for (const definition of builtinNodeRegistry.list()) {
      let id = 0;
      const data = definition.initialData({ ids: { generate: () => `generated-${++id}` } });
      for (const port of [...definition.ports(data, context()).inputs, ...definition.ports(data, context()).outputs])
        if (port.kind === 'DATA') {
          expect(() => ajv.compile(port.schema), `${definition.type}.${port.id}`).not.toThrow();
          expect(JSON.stringify(port.schema), `${definition.type}.${port.id}`).not.toMatch(/"\$(?:ref|defs)"/);
        }
    }
  });
  it('freezes focused dynamic contracts across schema- and list-dependent nodes', async () => {
    const signature = {
      inputs: [
        { id: 'argument', label: 'Argument', required: true, cardinality: 'ONE' as const, schema: { type: 'string' } },
      ],
      outputs: [
        { id: 'returned', label: 'Returned', required: false, cardinality: 'ONE' as const, schema: { type: 'number' } },
      ],
    };
    const profileSchema: JsonObject = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };
    const schemaAgent = {
      ...context().agent,
      configurationSchema: {
        type: 'object',
        properties: { profile: profileSchema },
        required: ['profile'],
      },
      stateSchema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] },
    };
    const manualFlow = {
      ...context().flow,
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.manual',
          position: { x: 0, y: 0 },
          data: {
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false,
            },
          },
          inputValues: {},
        },
      ],
    };
    const nestedSource = source({ type: 'number' });
    if (nestedSource.kind !== 'EDGE') throw new Error('Expected edge source');
    const dynamicContracts = {
      scopeEntry: portContract(definition('scope.entry'), {}, context({}, { scopeSignature: signature })),
      scopeReturn: portContract(definition('scope.return'), {}, context({}, { scopeSignature: signature })),
      branch: portContract(definition('control.branch'), {
        cases: [
          { id: 'first', label: 'First' },
          { id: 'second', label: 'Second' },
        ],
      }),
      mergeAny: portContract(definition('control.merge-any'), {
        inputs: [
          { id: 'plain', label: 'Plain', carriesValue: false },
          { id: 'value', label: 'Value', carriesValue: true },
        ],
      }),
      mergeAll: portContract(definition('control.merge-all'), {
        inputs: [
          { id: 'left', label: 'Left', carriesValue: true },
          { id: 'right', label: 'Right', carriesValue: true },
        ],
      }),
      object: portContract(definition('data.object'), {
        fields: [
          { id: 'name', key: 'name', schema: { type: 'string' } },
          { id: 'score', key: 'score', schema: { type: 'number' } },
        ],
      }),
      arrayKnown: portContract(
        definition('data.array'),
        {
          items: [
            { id: 'one', label: 'One' },
            { id: 'two', label: 'Two' },
          ],
        },
        context({
          one: { kind: 'UNBOUND' },
          'item.one': source({ type: 'string' }),
          'item.two': source({ type: 'string' }),
        }),
      ),
      all: portContract(definition('logic.all'), {
        inputs: [
          { id: 'first', label: 'value' },
          { id: 'second', label: 'input' },
        ],
      }),
      any: portContract(definition('logic.any'), {
        inputs: [
          { id: 'first', label: 'value' },
          { id: 'second', label: 'input' },
        ],
      }),
      template: portContract(definition('data.template'), {
        template: '{{value}} {{input}}',
        variables: [
          { id: 'first', name: 'value' },
          { id: 'second', name: 'input' },
        ],
      }),
      arrayMixed: portContract(
        definition('data.array'),
        {
          items: [
            { id: 'one', label: 'One' },
            { id: 'two', label: 'Two' },
          ],
        },
        context({ 'item.one': source({ type: 'string' }), 'item.two': source({ type: 'number' }) }),
      ),
      llm: portContract(definition('llm.request'), {
        prompt: 'Prompt',
        variables: [{ id: 'topic', name: 'topic' }],
        assembly: {
          type: 'NORMAL_CHAT',
          history: 'RECENT_CURRENT',
          placement: { type: 'IN_CHAT', role: 'USER', depth: 2 },
        },
        outputSchema: {
          type: 'object',
          properties: { answer: { type: 'string' }, score: { type: 'number' } },
          required: ['answer', 'score'],
          additionalProperties: false,
        },
      }),
      runFlow: portContract(
        definition('control.run-flow'),
        { flowId: 'child' },
        context({}, { resolveSubflow: () => signature }),
      ),
      forEach: portContract(
        definition('control.for-each'),
        { accumulator: true, body: { nodes: [], edges: [] } },
        context(
          {
            initialAccumulator: source({ type: 'string' }),
            items: source({ type: 'array', items: { type: 'boolean' } }),
          },
          { resolveNestedReturnSource: () => nestedSource.source },
        ),
      ),
      configuration: portContract(
        definition('data.configuration'),
        { path: 'profile' },
        context({}, { agent: schemaAgent }),
      ),
      state: portContract(definition('data.state'), { path: 'count' }, context({}, { agent: schemaAgent })),
      event: portContract(definition('data.event'), { path: 'input' }, context({}, { flow: manualFlow })),
      get: portContract(
        definition('data.get'),
        { path: 'profile.name' },
        context({ value: source(schemaAgent.configurationSchema) }),
      ),
      unpack: portContract(definition('data.unpack-object'), {}, context({ value: source(profileSchema) })),
      weightedTool: portContract(
        definition('tool.random.selectWeighted'),
        {},
        context({
          items: source({
            type: 'array',
            items: {
              type: 'object',
              properties: { value: { type: 'string' }, weight: { type: 'number' } },
              required: ['value', 'weight'],
            },
          }),
        }),
      ),
    };
    const compactContracts = Object.fromEntries(
      Object.entries(dynamicContracts).map(([name, ports]) => [name, compactPorts(ports)]),
    );
    expect(compactContracts).toEqual(jsonFixture('production-catalog-dynamic.snapshot.json'));
  });
  it('exposes canonical schema-path inspector metadata without node-specific UI inference', () => {
    expect(definition('data.configuration').fields({ path: null })).toEqual([
      {
        id: 'path',
        path: 'path',
        labelKey: 'path',
        control: 'SCHEMA_PATH',
        schemaSource: 'CONFIGURATION',
        allowRoot: true,
      },
    ]);
    expect(definition('data.state').fields({ path: null })).toEqual([
      { id: 'path', path: 'path', labelKey: 'path', control: 'SCHEMA_PATH', schemaSource: 'STATE', allowRoot: true },
    ]);
    expect(definition('data.event').fields({ path: null })).toEqual([
      { id: 'path', path: 'path', labelKey: 'path', control: 'SCHEMA_PATH', schemaSource: 'EVENT', allowRoot: true },
    ]);
    expect(definition('data.get').fields({ path: '' })).toEqual([
      {
        id: 'path',
        path: 'path',
        labelKey: 'path',
        control: 'SCHEMA_PATH',
        schemaSource: 'INPUT_VALUE',
        allowRoot: false,
      },
    ]);
    for (const type of ['effect.set-state', 'effect.remove-state'])
      expect(definition(type).fields({ path: '' }), type).toEqual([
        { id: 'path', path: 'path', labelKey: 'path', control: 'SCHEMA_PATH', schemaSource: 'STATE', allowRoot: false },
      ]);
  });
  it('derives lookup schemas for literal, additional, common, fallback, and chained tables', () => {
    const definition = builtinNodeRegistry.get('tool.table.lookupKey')!;
    const value = (bindings: Record<string, ResolvedInputBinding>) =>
      definition
        .ports({}, context(bindings))
        .outputs.find((port) => port.id === 'property/value' && port.kind === 'DATA')!.schema;
    expect(
      value({
        table: source({ type: 'object', properties: { chaos: { type: 'number' } } }),
        key: { kind: 'INLINE', value: 'chaos' },
      }),
    ).toEqual({ type: 'number' });
    expect(value({ table: source({ type: 'object', additionalProperties: { type: 'string' } }) })).toEqual({
      type: 'string',
    });
    expect(
      value({
        table: source({
          type: 'object',
          properties: {
            a: { type: 'array', items: { type: 'number' } },
            b: { items: { type: 'number' }, type: 'array' },
          },
        }),
      }),
    ).toEqual({ type: 'array', items: { type: 'number' } });
    expect(
      value({ table: source({ type: 'object', properties: { a: { type: 'number' }, b: { type: 'string' } } }) }),
    ).toEqual({});
    const first = value({
      table: source({
        type: 'object',
        properties: { '5': { type: 'object', properties: { Likely: { type: 'number' } }, required: ['Likely'] } },
      }),
      key: { kind: 'INLINE', value: '5' },
    });
    expect(first).toMatchObject({ type: 'object' });
    expect(value({ table: source(first), key: { kind: 'INLINE', value: 'Likely' } })).toEqual({ type: 'number' });
  });
  it('keeps visible-message flow compatibility exact across every trigger declaration', () => {
    const visible = definition('effect.visible-message');
    const triggerCases: Array<{ type: string; data: JsonObject; allowed: boolean }> = [
      { type: 'trigger.after-user', data: { schedule: { type: 'ALWAYS' } }, allowed: true },
      {
        type: 'trigger.before-generation',
        data: { generationModes: ['NEW'], schedule: { type: 'ALWAYS' } },
        allowed: false,
      },
      {
        type: 'trigger.generate-assistant',
        data: { generationModes: ['NEW'], schedule: { type: 'ALWAYS' } },
        allowed: false,
      },
      {
        type: 'trigger.after-generation',
        data: { generationModes: ['NEW'], schedule: { type: 'ALWAYS' } },
        allowed: true,
      },
      {
        type: 'trigger.manual',
        data: { inputSchema: { type: 'object', additionalProperties: true } },
        allowed: true,
      },
    ];
    for (const triggerCase of triggerCases) {
      for (const operation of ['REPLACE_TARGET', 'APPEND_TARGET', 'CREATE'] as const) {
        const triggerNode = {
          id: 'trigger',
          type: triggerCase.type,
          position: { x: 0, y: 0 },
          data: triggerCase.data,
          inputValues: {},
        };
        const effectNode = {
          id: 'effect',
          type: visible.type,
          position: { x: 200, y: 0 },
          data: { operation },
          inputValues: { content: 'content' },
        };
        const flow = {
          ...context().flow,
          nodes: [triggerNode, effectNode],
        };
        const diagnostics = visible.validate?.({
          agent: context().agent,
          flow,
          node: effectNode,
          ports: visible.ports(effectNode.data, context({}, { flow })),
          edges: [],
          registry: builtinNodeRegistry,
        });
        expect(
          diagnostics?.map((item) => item.code),
          `${triggerCase.type}/${operation}`,
        ).toEqual(triggerCase.allowed ? [] : ['VISIBLE_MESSAGE_CONTEXT']);
      }
    }
  });
  it('reports exact context diagnostics for assistant-generation-visible effects and subflow event reads', () => {
    const generator = structuredClone(fixture('generation-agent'));
    const generationFlow = generator.agent.flows[0];
    if (!generationFlow) throw new Error('Missing assistant-generation flow');
    generationFlow.nodes.push({
      id: 'invalid-visible',
      type: 'effect.visible-message',
      position: { x: 200, y: 200 },
      data: { operation: 'CREATE' },
      inputValues: { content: 'not allowed' },
    });
    generationFlow.edges.push({
      id: 'invalid-visible-control',
      kind: 'CONTROL',
      source: { nodeId: 'trigger', portId: 'out' },
      target: { nodeId: 'invalid-visible', portId: 'in' },
    });
    const generationResult = compileGraphPreset(generator, builtinNodeRegistry);
    expect(generationResult.success).toBe(false);
    if (generationResult.success) throw new Error('Expected assistant-generation validation failure');
    expect(generationResult.diagnostics.map((item) => item.code)).toContain('VISIBLE_MESSAGE_CONTEXT');

    const nested = structuredClone(fixture('nested-subflow'));
    const subflow = nested.agent.flows.find((flow) => flow.kind === 'SUBFLOW');
    if (!subflow) throw new Error('Missing subflow');
    subflow.nodes.push({
      id: 'invalid-event',
      type: 'data.event',
      position: { x: 0, y: 200 },
      data: { path: null },
      inputValues: {},
    });
    const subflowResult = compileGraphPreset(nested, builtinNodeRegistry);
    expect(subflowResult.success).toBe(false);
    if (subflowResult.success) throw new Error('Expected subflow validation failure');
    expect(subflowResult.diagnostics.map((item) => item.code)).toContain('EVENT_CONTEXT');
  });
  it('validates all canonical fixtures and executes applicable paths', async () => {
    for (const name of ['minimal-observer', 'generation-agent', 'director', 'nested-subflow'])
      expect(() => compile(fixture(name)), name).not.toThrow();
    const minimal = compile(fixture('minimal-observer'));
    const result = await executeGraphPlan(
      request(
        minimal,
        'count-user-messages',
        { trigger: 'AFTER_USER_MESSAGE', message: { index: 0, role: 'USER', name: 'User', content: 'Hi' } },
        { state: { count: 4 } },
      ),
    );
    expect(result).toMatchObject({ status: 'COMPLETED', state: { count: 5 } });
    const director = compile(fixture('director'));
    const directorResult = await executeGraphPlan(
      request(
        director,
        'direct',
        {
          trigger: 'AFTER_USER_MESSAGE',
          message: { index: 0, role: 'USER', name: 'User', content: 'Direct this.' },
        },
        { state: { direction: '' } },
      ),
    );
    if (directorResult.status !== 'COMPLETED') throw new Error(directorResult.error);
    expect(directorResult).toMatchObject({ status: 'COMPLETED', state: { direction: 'Introduce a complication.' } });
    const cleanupResult = await executeGraphPlan(
      request(
        director,
        'cleanup',
        {
          trigger: 'AFTER_ASSISTANT_MESSAGE',
          generationId: 'director-generation',
          generationMode: 'NEW',
          message: { index: 1, role: 'ASSISTANT', name: 'Assistant', content: 'Response' },
        },
        { state: directorResult.state },
      ),
    );
    expect(cleanupResult).toMatchObject({ status: 'COMPLETED', state: { direction: '' } });
    const nested = compile(fixture('nested-subflow'));
    const nestedResult = await executeGraphPlan(
      request(nested, 'manual-main', { trigger: 'MANUAL', input: { numbers: [1, 2, 3] } }),
    );
    expect(nestedResult, nestedResult.status === 'FAILED' ? nestedResult.error : '').toMatchObject({
      status: 'COMPLETED',
    });
  });
  it('fails target visible-message operations before staging when prompt context has no target', async () => {
    const visiblePreset = (operation: 'REPLACE_TARGET' | 'APPEND_TARGET' | 'CREATE'): GraphPreset => ({
      format: 'NEOTAVERN_CUSTOM_AGENT_FLOW',
      agent: {
        id: 'visible-agent',
        name: 'Visible',
        enabled: true,
        priority: 0,
        configurationSchema: { type: 'object', additionalProperties: false },
        configurationDefaults: {},
        stateSchema: { type: 'object', additionalProperties: false },
        initialState: {},
        views: [],
        flows: [
          {
            id: 'visible-flow',
            name: 'Visible flow',
            kind: 'TRIGGER',
            inputs: [],
            outputs: [],
            nodes: [
              {
                id: 'trigger',
                type: 'trigger.manual',
                position: { x: 0, y: 0 },
                data: { inputSchema: { type: 'object', additionalProperties: true } },
                inputValues: {},
              },
              {
                id: 'effect',
                type: 'effect.visible-message',
                position: { x: 200, y: 0 },
                data: { operation },
                inputValues: { content: 'message content' },
              },
            ],
            edges: [
              {
                id: 'control',
                kind: 'CONTROL',
                source: { nodeId: 'trigger', portId: 'out' },
                target: { nodeId: 'effect', portId: 'in' },
              },
            ],
          },
        ],
      },
    });
    for (const operation of ['REPLACE_TARGET', 'APPEND_TARGET'] as const) {
      const plan = compile(visiblePreset(operation));
      const missing = await executeGraphPlan(request(plan, 'visible-flow', { trigger: 'MANUAL', input: {} }));
      expect(missing).toMatchObject({ status: 'FAILED', error: `${operation} requires a target message` });
      expect(missing).not.toHaveProperty('effects');
      const targetMessage = { index: 1, role: 'ASSISTANT' as const, name: 'Assistant', content: 'old' };
      const allowed = await executeGraphPlan(
        request(
          plan,
          'visible-flow',
          { trigger: 'MANUAL', input: {} },
          { promptContext: { chatHistory: [], targetMessage, currentCharacter: null, persona: null } },
        ),
      );
      expect(allowed).toMatchObject({
        status: 'COMPLETED',
        effects: [{ type: 'VISIBLE_MESSAGE', operation, content: 'message content' }],
      });
    }
    const created = await executeGraphPlan(
      request(compile(visiblePreset('CREATE')), 'visible-flow', { trigger: 'MANUAL', input: {} }),
    );
    expect(created).toMatchObject({
      status: 'COMPLETED',
      effects: [{ type: 'VISIBLE_MESSAGE', operation: 'CREATE', content: 'message content' }],
    });
  });
  it('executes controlled random/ID tools and a pure deterministic tool with exact services', async () => {
    await expect(
      executeDefinition('tool.random.chance', {}, { probability: 0.5 }, { random: { next: () => 0.25 } }),
    ).resolves.toEqual({ control: ['out'], outputs: { result: { roll: 0.25, result: true } }, effects: [] });
    await expect(
      executeDefinition('tool.id.generate', {}, {}, { ids: { generate: () => 'exact-id' } }),
    ).resolves.toEqual({ control: ['out'], outputs: { result: { id: 'exact-id' } }, effects: [] });
    await expect(executeDefinition('tool.number.add', {}, { value: 2, amount: 3 })).resolves.toEqual({
      control: [],
      outputs: { result: { value: 5 } },
      effects: [],
    });
  });
  it('projects every required structured LLM property during graph execution', async () => {
    const preset: GraphPreset = {
      format: 'NEOTAVERN_CUSTOM_AGENT_FLOW',
      agent: {
        id: 'structured-agent',
        name: 'Structured',
        enabled: true,
        priority: 0,
        configurationSchema: { type: 'object', additionalProperties: false },
        configurationDefaults: {},
        stateSchema: {
          type: 'object',
          properties: { score: { type: 'number' } },
          required: ['score'],
          additionalProperties: false,
        },
        initialState: { score: 0 },
        views: [],
        flows: [
          {
            id: 'structured-flow',
            name: 'Structured flow',
            kind: 'TRIGGER',
            inputs: [],
            outputs: [],
            nodes: [
              {
                id: 'trigger',
                type: 'trigger.manual',
                position: { x: 0, y: 0 },
                data: { inputSchema: { type: 'object', additionalProperties: true } },
                inputValues: {},
              },
              {
                id: 'llm',
                type: 'llm.request',
                position: { x: 200, y: 0 },
                data: {
                  prompt: 'Return structure',
                  variables: [],
                  assembly: { type: 'STANDALONE', role: 'USER' },
                  outputSchema: {
                    type: 'object',
                    properties: { answer: { type: 'string' }, score: { type: 'number' } },
                    required: ['answer', 'score'],
                    additionalProperties: false,
                  },
                },
                inputValues: { structuredFormat: 'NATIVE' },
              },
              {
                id: 'state',
                type: 'effect.set-state',
                position: { x: 400, y: 0 },
                data: { path: 'score' },
                inputValues: {},
              },
            ],
            edges: [
              {
                id: 'start',
                kind: 'CONTROL',
                source: { nodeId: 'trigger', portId: 'out' },
                target: { nodeId: 'llm', portId: 'in' },
              },
              {
                id: 'continue',
                kind: 'CONTROL',
                source: { nodeId: 'llm', portId: 'out' },
                target: { nodeId: 'state', portId: 'in' },
              },
              {
                id: 'score',
                kind: 'DATA',
                source: { nodeId: 'llm', portId: 'property/score' },
                target: { nodeId: 'state', portId: 'value' },
              },
            ],
          },
        ],
      },
    };
    const result = await executeGraphPlan(
      request(
        compile(preset),
        'structured-flow',
        { trigger: 'MANUAL', input: {} },
        {
          state: { score: 0 },
          llm: { dispatch: async () => ({ answer: 'yes', score: 9 }) },
        },
      ),
    );
    expect(result, result.status === 'FAILED' ? result.error : '').toMatchObject({
      status: 'COMPLETED',
      state: { score: 9 },
    });
  });
  it('publishes no graph effects when an LLM capability fails', async () => {
    const plan = compile(fixture('generation-agent'));
    const result = await executeGraphPlan(
      request(
        plan,
        'generate',
        { trigger: 'ASSISTANT_GENERATION', generationId: 'failed', generationMode: 'NEW' },
        {
          llm: {
            dispatch: async () => {
              throw new Error('capability failed');
            },
          },
        },
      ),
    );
    expect(result).toMatchObject({ status: 'FAILED', error: 'capability failed' });
    expect(result).not.toHaveProperty('effects');
    expect(result).not.toHaveProperty('generationResponse');
  });
  it('dispatches LLM capability requests with unique attributed IDs and validates output', async () => {
    const plan = compile(fixture('generation-agent'));
    const dispatch = vi.fn(async () => ({ content: 'hello' }) as JsonValue);
    let id = 0;
    const result = await executeGraphPlan(
      request(
        plan,
        'generate',
        { trigger: 'ASSISTANT_GENERATION', generationId: 'g', generationMode: 'NEW' },
        { ids: { generate: () => `request-${++id}` }, llm: { dispatch } },
      ),
    );
    expect(result, result.status === 'FAILED' ? result.error : '').toMatchObject({
      status: 'COMPLETED',
      generationResponse: 'hello',
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        source: 'core.custom-agents',
        nodeId: 'llm',
        flowId: 'generate',
        prompt: 'Write the response.',
        variables: {},
        assembly: {
          type: 'NORMAL_CHAT',
          history: 'FULL_CURRENT',
          placement: { type: 'AFTER_CONTEXT', role: 'SYSTEM' },
        },
        connectionProfileId: null,
        structuredFormat: 'NATIVE',
        outputSchema: expect.objectContaining({ type: 'object' }),
      }),
    );
  });
});
