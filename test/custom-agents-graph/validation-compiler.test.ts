import { describe, expect, it } from 'vitest';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import type { GraphPreset, JsonValue } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { validateGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/validate';
import type { RegisteredNodeDefinition } from '../../src/extensions/built-in/custom-agents/registry/node-definition';
import { NodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/node-registry';
import { basePreset, createTestRegistry, edge, node } from '../fixtures/custom-agents/test-registry';

function codes(value: unknown): string[] {
  const result = validateGraphPreset(value, createTestRegistry());
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
}

function replaceDefinition(
  type: string,
  replace: (definition: RegisteredNodeDefinition) => RegisteredNodeDefinition,
): NodeRegistry {
  return new NodeRegistry(
    createTestRegistry()
      .list()
      .map((definition) => (definition.type === type ? replace(definition) : definition)),
  );
}

function structuralPreset(): GraphPreset {
  const preset = basePreset();
  const body = {
    nodes: [node('body-entry', 'scope.entry'), node('body-return', 'scope.return')],
    edges: [edge('body-control', 'CONTROL', 'body-entry', 'out', 'body-return', 'in')],
  };
  const main = preset.agent.flows[0]!;
  main.nodes.push(
    node('run', 'control.run-flow', { flowId: 'echo' }),
    { ...node('loop', 'control.for-each', { accumulator: false, body }), inputValues: { items: [] } },
    node('stop', 'control.stop'),
  );
  main.edges.push(
    edge('finish-run', 'CONTROL', 'finish', 'out', 'run', 'in'),
    edge('run-loop', 'CONTROL', 'run', 'out', 'loop', 'in'),
    edge('loop-stop', 'CONTROL', 'loop', 'out', 'stop', 'in'),
  );
  preset.agent.flows.push({
    id: 'echo',
    name: 'Echo',
    kind: 'SUBFLOW',
    inputs: [{ id: 'optionalInput', label: 'Optional input', required: false, cardinality: 'ONE', schema: {} }],
    outputs: [{ id: 'optionalOutput', label: 'Optional output', required: false, cardinality: 'ONE', schema: {} }],
    nodes: [node('entry', 'scope.entry'), node('return', 'scope.return')],
    edges: [edge('scope-control', 'CONTROL', 'entry', 'out', 'return', 'in')],
  });
  return preset;
}

function bindingPreset(mode: 'EDGE' | 'INLINE' | 'NULL' | 'UNBOUND'): GraphPreset {
  const preset = basePreset();
  const flow = preset.agent.flows[0]!;
  flow.nodes.push(node('source', 'test.source', { schema: { type: 'string' } }));
  flow.nodes.push({
    ...node('binding', 'test.binding'),
    inputValues: mode === 'INLINE' ? { value: 9 } : mode === 'NULL' ? { value: null } : {},
  });
  if (mode === 'EDGE') flow.edges.push(edge('data', 'DATA', 'source', 'value', 'binding', 'value'));
  return preset;
}

describe('custom-agent graph validation and compilation', () => {
  it('resolves exact EDGE, INLINE including null, and UNBOUND dynamic schemas', () => {
    const expected = { EDGE: 'STRING', INLINE: 'NUMBER', NULL: 'JSON', UNBOUND: 'JSON' } as const;
    for (const mode of ['EDGE', 'INLINE', 'NULL', 'UNBOUND'] as const) {
      const result = compileGraphPreset(bindingPreset(mode), createTestRegistry());
      expect(result.success).toBe(true);
      if (!result.success) continue;
      const output = result.plan.agent.flows[0]!.nodes.find((item) => item.id === 'binding')!.outputs.find(
        (port) => port.id === 'result',
      )!;
      expect(output.kind).toBe('DATA');
      if (output.kind === 'DATA') {
        const type = output.schema.type;
        expect(
          type === 'integer' ? 'NUMBER' : type === 'number' ? 'NUMBER' : type === 'string' ? 'STRING' : 'JSON',
        ).toBe(expected[mode]);
      }
      expect(result.plan.agent.flows[0]!.nodes.find((item) => item.id === 'binding')!.inputBindings.value!.kind).toBe(
        mode === 'NULL' ? 'INLINE' : mode,
      );
    }
  });

  it('diagnoses conflicting/missing/stale/invalid bindings and incompatible edges stably', () => {
    const conflict = basePreset();
    conflict.agent.flows[0]!.nodes.push(node('source', 'test.source', { schema: { type: 'string' } }));
    conflict.agent.flows[0]!.nodes.push({
      ...node('consumer', 'test.controlled', { inputSchema: { type: 'string' } }),
      inputValues: { value: 'inline' },
    });
    conflict.agent.flows[0]!.edges.push(edge('consumer-control', 'CONTROL', 'trigger', 'out', 'consumer', 'in'));
    conflict.agent.flows[0]!.edges.push(edge('consumer-data', 'DATA', 'source', 'value', 'consumer', 'value'));
    expect(codes(conflict)).toContain('DATA_BINDING_CONFLICT');

    const missing = structuredClone(conflict);
    missing.agent.flows[0]!.nodes.find((item) => item.id === 'consumer')!.inputValues = {};
    missing.agent.flows[0]!.edges = missing.agent.flows[0]!.edges.filter((item) => item.id !== 'consumer-data');
    expect(codes(missing)).toContain('DATA_BINDING_REQUIRED');

    const stale = basePreset();
    stale.agent.flows[0]!.nodes[1]!.inputValues = { removed: null };
    expect(codes(stale)).toContain('INPUT_VALUE_STALE');

    const literal = structuredClone(conflict);
    literal.agent.flows[0]!.edges = literal.agent.flows[0]!.edges.filter((item) => item.id !== 'consumer-data');
    literal.agent.flows[0]!.nodes.find((item) => item.id === 'consumer')!.inputValues = { value: 3 };
    expect(codes(literal)).toContain('INLINE_SCHEMA');

    const incompatible = structuredClone(conflict);
    incompatible.agent.flows[0]!.nodes.find((item) => item.id === 'consumer')!.inputValues = {};
    incompatible.agent.flows[0]!.nodes.find((item) => item.id === 'consumer')!.data = {
      inputSchema: { type: 'number' },
    };
    expect(codes(incompatible)).toContain('DATA_TYPE_INCOMPATIBLE');

    for (const conflictingSchema of [
      { type: ['string', 'null'], enum: ['value'] },
      { type: 'unsupported', const: 'value' },
    ]) {
      const conflictingType = structuredClone(conflict);
      conflictingType.agent.flows[0]!.nodes.find((item) => item.id === 'consumer')!.inputValues = {};
      conflictingType.agent.flows[0]!.nodes.find((item) => item.id === 'source')!.data = {
        schema: conflictingSchema,
      };
      expect(codes(conflictingType)).toContain('DATA_TYPE_INCOMPATIBLE');
    }

    const first = validateGraphPreset(incompatible, createTestRegistry());
    const second = validateGraphPreset(incompatible, createTestRegistry());
    expect(first).toEqual(second);
  });

  it('rejects dangling/duplicate edges, cycles, undeclared fan-in, and incomplete merge readiness', () => {
    const dangling = basePreset();
    dangling.agent.flows[0]!.edges.push(edge('dangling', 'CONTROL', 'missing', 'out', 'finish', 'in'));
    expect(codes(dangling)).toContain('EDGE_DANGLING_NODE');

    const duplicate = basePreset();
    duplicate.agent.flows[0]!.edges.push(edge('other-id', 'CONTROL', 'trigger', 'out', 'finish', 'in'));
    expect(codes(duplicate)).toEqual(expect.arrayContaining(['EDGE_DUPLICATE', 'INPUT_FAN_IN']));

    const cycle = basePreset();
    cycle.agent.flows[0]!.edges.push(edge('cycle', 'CONTROL', 'finish', 'out', 'finish', 'in'));
    expect(codes(cycle)).toContain('CONTROL_CYCLE');

    const dataCycle = basePreset();
    dataCycle.agent.flows[0]!.nodes.push(node('data-a', 'test.binding'), node('data-b', 'test.binding'));
    dataCycle.agent.flows[0]!.edges.push(
      edge('data-a-b', 'DATA', 'data-a', 'result', 'data-b', 'value'),
      edge('data-b-a', 'DATA', 'data-b', 'result', 'data-a', 'value'),
    );
    expect(codes(dataCycle)).toContain('DATA_CYCLE');

    const mixedCycle = basePreset();
    mixedCycle.agent.flows[0]!.nodes.push(
      node('mixed-a', 'test.controlled', { inputSchema: { type: 'string' } }),
      node('mixed-b', 'test.controlled', { outputSchema: { type: 'string' } }),
    );
    mixedCycle.agent.flows[0]!.edges.push(
      edge('mixed-trigger-a', 'CONTROL', 'trigger', 'out', 'mixed-a', 'in'),
      edge('mixed-a-b', 'CONTROL', 'mixed-a', 'out', 'mixed-b', 'in'),
      edge('mixed-b-a-data', 'DATA', 'mixed-b', 'value', 'mixed-a', 'value'),
    );
    expect(codes(mixedCycle)).toContain('MIXED_DEPENDENCY_CYCLE');

    const merge = basePreset();
    merge.agent.flows[0]!.nodes.push(node('merge', 'control.merge-all'));
    merge.agent.flows[0]!.edges.push(edge('merge-left', 'CONTROL', 'finish', 'out', 'merge', 'left'));
    expect(codes(merge)).toContain('CONTROL_INPUT_BINDING');
  });

  it('scopes edge IDs to a top-level flow including all nested bodies', () => {
    const parentBodyDuplicate = structuralPreset();
    const loop = parentBodyDuplicate.agent.flows[0]!.nodes.find((item) => item.id === 'loop')!;
    const body = loop.data.body as { edges: Array<{ id: string }> };
    body.edges[0]!.id = 'control';
    expect(codes(parentBodyDuplicate)).toContain('EDGE_ID_DUPLICATE');

    const nestedDuplicate = basePreset();
    const innerBody = {
      nodes: [node('inner-entry', 'scope.entry'), node('inner-return', 'scope.return')],
      edges: [edge('nested-duplicate', 'CONTROL', 'inner-entry', 'out', 'inner-return', 'in')],
    };
    const outerBody = {
      nodes: [
        node('outer-entry', 'scope.entry'),
        {
          ...node('inner-loop', 'control.for-each', { accumulator: false, body: innerBody }),
          inputValues: { items: [] },
        },
        node('outer-return', 'scope.return'),
      ],
      edges: [
        edge('nested-duplicate', 'CONTROL', 'outer-entry', 'out', 'inner-loop', 'in'),
        edge('outer-return-edge', 'CONTROL', 'inner-loop', 'out', 'outer-return', 'in'),
      ],
    };
    nestedDuplicate.agent.flows[0]!.nodes.push({
      ...node('outer-loop', 'control.for-each', { accumulator: false, body: outerBody }),
      inputValues: { items: [] },
    });
    nestedDuplicate.agent.flows[0]!.edges.push(
      edge('outer-loop-control', 'CONTROL', 'finish', 'out', 'outer-loop', 'in'),
    );
    expect(codes(nestedDuplicate)).toContain('EDGE_ID_DUPLICATE');

    const reusableAcrossFlows = basePreset();
    reusableAcrossFlows.agent.flows.push({
      id: 'second',
      name: 'Second',
      kind: 'TRIGGER',
      inputs: [],
      outputs: [],
      nodes: [node('trigger-two', 'test.trigger'), node('finish-two', 'test.controlled')],
      edges: [edge('control', 'CONTROL', 'trigger-two', 'out', 'finish-two', 'in')],
    });
    expect(validateGraphPreset(reusableAcrossFlows, createTestRegistry()).valid).toBe(true);
  });

  it('enforces exact two-way reserved runtime mappings and structural ports', () => {
    const preset = structuralPreset();
    expect(validateGraphPreset(preset, createTestRegistry()).valid).toBe(true);
    const compiled = compileGraphPreset(preset, createTestRegistry());
    expect(compiled.success).toBe(true);
    if (compiled.success) {
      const main = compiled.plan.agent.flows.find((flow) => flow.id === 'main')!;
      const echo = compiled.plan.agent.flows.find((flow) => flow.id === 'echo')!;
      const dataRequiredness = (ports: (typeof main.nodes)[number]['outputs']) =>
        ports.filter((port) => port.kind === 'DATA').map((port) => [port.id, port.required]);
      expect(dataRequiredness(echo.nodes.find((item) => item.id === 'entry')!.outputs)).toEqual([
        ['optionalInput', false],
      ]);
      expect(dataRequiredness(main.nodes.find((item) => item.id === 'run')!.outputs)).toEqual([
        ['optionalOutput', false],
      ]);
      expect(dataRequiredness(main.nodes.find((item) => item.id === 'loop')!.outputs)).toEqual([['items', true]]);
    }
    for (const type of ['scope.entry', 'scope.return', 'control.run-flow', 'control.for-each', 'control.stop']) {
      const wrongRuntime = replaceDefinition(type, (definition) => ({
        ...definition,
        runtime: {
          kind: 'EXECUTOR',
          execute: async () => ({ control: [], outputs: {}, effects: [] }),
        },
      }));
      const runtimeResult = validateGraphPreset(preset, wrongRuntime);
      expect(runtimeResult.valid).toBe(false);
      if (!runtimeResult.valid)
        expect(runtimeResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain('STRUCTURAL_RUNTIME_MAPPING');

      const wrongPorts = replaceDefinition(type, (definition) => ({
        ...definition,
        ports: () => ({ inputs: [], outputs: [] }),
      }));
      const portResult = validateGraphPreset(preset, wrongPorts);
      expect(portResult.valid).toBe(false);
      if (!portResult.valid)
        expect(portResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain('STRUCTURAL_PORT_CONTRACT');
    }

    const impostor = replaceDefinition('test.controlled', (definition) => ({
      ...definition,
      runtime: { kind: 'SCOPE_ENTRY' },
    }));
    const reverseResult = validateGraphPreset(basePreset(), impostor);
    expect(reverseResult.valid).toBe(false);
    if (!reverseResult.valid)
      expect(reverseResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain('STRUCTURAL_RUNTIME_MAPPING');
  });

  it('rejects ordinary distinct-input control fan-in and accepts declared merge classes', () => {
    const fanInPreset = (type: string): GraphPreset => {
      const preset = basePreset();
      const flow = preset.agent.flows[0]!;
      flow.nodes.push(node('branch', 'test.branch'), node('join', type));
      flow.edges.push(
        edge('finish-branch', 'CONTROL', 'finish', 'out', 'branch', 'in'),
        edge('branch-left', 'CONTROL', 'branch', 'yes', 'join', 'left'),
        edge('branch-right', 'CONTROL', 'branch', 'no', 'join', 'right'),
      );
      return preset;
    };
    expect(codes(fanInPreset('test.fan-in'))).toContain('CONTROL_FAN_IN_UNDECLARED');
    for (const type of ['control.merge-any', 'control.merge-all'])
      expect(validateGraphPreset(fanInPreset(type), createTestRegistry()).valid).toBe(true);
  });

  it('validates scope boundaries, signature-derived Run Flow ports, and call cycles', () => {
    const preset = basePreset();
    preset.agent.flows.push({
      id: 'echo',
      name: 'Echo',
      kind: 'SUBFLOW',
      inputs: [{ id: 'input', label: 'Input', required: true, cardinality: 'ONE', schema: { type: 'string' } }],
      outputs: [{ id: 'output', label: 'Output', required: true, cardinality: 'ONE', schema: { type: 'string' } }],
      nodes: [node('entry', 'scope.entry'), node('return', 'scope.return')],
      edges: [
        edge('scope-control', 'CONTROL', 'entry', 'out', 'return', 'in'),
        edge('scope-data', 'DATA', 'entry', 'input', 'return', 'output'),
      ],
    });
    const main = preset.agent.flows[0]!;
    main.nodes.push({ ...node('run', 'control.run-flow', { flowId: 'echo' }), inputValues: { input: 'hello' } });
    main.edges.push(edge('run-control', 'CONTROL', 'finish', 'out', 'run', 'in'));
    const compiled = compileGraphPreset(preset, createTestRegistry());
    expect(compiled.success).toBe(true);
    if (compiled.success) {
      const run = compiled.plan.agent.flows
        .find((flow) => flow.id === 'main')!
        .nodes.find((item) => item.id === 'run')!;
      expect(run.inputs.map((port) => port.id)).toEqual(['in', 'input']);
      expect(run.outputs.map((port) => port.id)).toEqual(['out', 'output']);
      expect(run.targetPlan?.id).toBe('echo');
    }

    const malformed = structuredClone(preset);
    malformed.agent.flows.find((flow) => flow.id === 'echo')!.nodes = [node('only-entry', 'scope.entry')];
    malformed.agent.flows.find((flow) => flow.id === 'echo')!.edges = [];
    expect(codes(malformed)).toEqual(expect.arrayContaining(['SCOPE_RETURN_COUNT']));

    const recursive = structuredClone(preset);
    const echo = recursive.agent.flows.find((flow) => flow.id === 'echo')!;
    echo.nodes.splice(1, 0, {
      ...node('self-call', 'control.run-flow', { flowId: 'echo' }),
      inputValues: { input: 'again' },
    });
    echo.edges = [
      edge('entry-call', 'CONTROL', 'entry', 'out', 'self-call', 'in'),
      edge('call-return', 'CONTROL', 'self-call', 'out', 'return', 'in'),
      edge('entry-data', 'DATA', 'entry', 'input', 'self-call', 'input'),
      edge('call-data', 'DATA', 'self-call', 'output', 'return', 'output'),
    ];
    expect(codes(recursive)).toContain('SUBFLOW_CALL_CYCLE');
  });

  it('stages For Each body resolution and derives output array items from the nested return source', () => {
    const preset = basePreset();
    const body = {
      nodes: [
        node('body-entry', 'scope.entry'),
        node('body-value', 'test.source', { schema: { type: 'string' } }),
        node('body-return', 'scope.return'),
      ],
      edges: [
        edge('body-control', 'CONTROL', 'body-entry', 'out', 'body-return', 'in'),
        edge('body-value-edge', 'DATA', 'body-value', 'value', 'body-return', 'value'),
        edge('body-accumulator-edge', 'DATA', 'body-entry', 'accumulator', 'body-return', 'accumulator'),
      ],
    };
    preset.agent.flows[0]!.nodes.push({
      ...node('loop', 'control.for-each', { accumulator: true, body }),
      inputValues: { items: [], initialAccumulator: { count: 0 } },
    });
    preset.agent.flows[0]!.edges.push(edge('loop-control', 'CONTROL', 'finish', 'out', 'loop', 'in'));
    const compiled = compileGraphPreset(preset, createTestRegistry());
    expect(compiled.success, compiled.success ? '' : JSON.stringify(compiled.diagnostics, null, 2)).toBe(true);
    if (!compiled.success) return;
    const loop = compiled.plan.agent.flows[0]!.nodes.find((item) => item.id === 'loop')!;
    const output = loop.outputs.find((port) => port.id === 'items')!;
    expect(output.kind === 'DATA' ? output.schema : {}).toEqual({ type: 'array', items: { type: 'string' } });
    const accumulator = loop.outputs.find((port) => port.id === 'accumulator')!;
    expect(accumulator.kind === 'DATA' ? accumulator.schema : {}).toEqual({ type: 'object' });
    expect(loop.inputs.filter((port) => port.kind === 'DATA').map((port) => [port.id, port.required])).toEqual([
      ['items', true],
      ['initialAccumulator', true],
    ]);
    expect(loop.outputs.filter((port) => port.kind === 'DATA').map((port) => [port.id, port.required])).toEqual([
      ['items', true],
      ['accumulator', true],
    ]);
    expect(loop.bodyPlan?.entryNodeId).toBe('body-entry');
    expect(loop.bodyPlan?.returnNodeId).toBe('body-return');
  });

  it('is independent of graph container order and positions while preserving semantic data array order', () => {
    const first = bindingPreset('EDGE');
    first.agent.flows[0]!.nodes.find((item) => item.id === 'source')!.data.semanticOrder = ['b', 'a'];
    const second = structuredClone(first);
    second.agent.flows.reverse();
    second.agent.flows[0]!.nodes.reverse();
    second.agent.flows[0]!.edges.reverse();
    second.agent.flows[0]!.nodes.forEach((item, index) => {
      item.position = { x: index * 99, y: -index };
    });
    const a = compileGraphPreset(first, createTestRegistry());
    const b = compileGraphPreset(second, createTestRegistry());
    expect(a.success && b.success).toBe(true);
    if (!a.success || !b.success) return;
    const summarize = (plan: typeof a.plan) =>
      plan.agent.flows.map((flow) => ({
        id: flow.id,
        edges: flow.edges.map((item) => item.id),
        nodes: flow.nodes.map((item) => ({ id: item.id, data: item.data, inputs: item.inputs, outputs: item.outputs })),
      }));
    expect(summarize(a.plan)).toEqual(summarize(b.plan));
    expect(a.plan.agent.flows[0]!.nodes.find((item) => item.id === 'source')!.data.semanticOrder as JsonValue).toEqual([
      'b',
      'a',
    ]);
  });
});
