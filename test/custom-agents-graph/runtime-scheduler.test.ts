import { describe, expect, it } from 'vitest';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import type { GraphPreset, JsonObject, JsonValue } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import type { CompiledPresetPlan } from '../../src/extensions/built-in/custom-agents/graph/plan-types';
import { executeGraphPlan } from '../../src/extensions/built-in/custom-agents/runtime/execute-plan';
import type { GraphExecutionRequest } from '../../src/extensions/built-in/custom-agents/runtime/execution-context';
import type { NodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/node-registry';
import { basePreset, edge, node } from '../fixtures/custom-agents/test-registry';
import { createRuntimeRegistry } from '../fixtures/custom-agents/runtime-registry';

function compile(preset: GraphPreset, registry: NodeRegistry): CompiledPresetPlan {
  const result = compileGraphPreset(preset, registry);
  if (!result.success) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.plan;
}

function request(plan: CompiledPresetPlan, overrides: Partial<GraphExecutionRequest> = {}): GraphExecutionRequest {
  return {
    plan,
    flowId: 'main',
    event: { trigger: 'MANUAL', input: null },
    configuration: {},
    state: {},
    signal: new AbortController().signal,
    random: { next: () => 0.5 },
    ids: { generate: () => 'id' },
    tools: { dispatch: async () => ({}) },
    llm: { dispatch: async () => ({}) },
    templates: { render: async ({ template }) => template },
    promptContext: { chatHistory: [], currentCharacter: null, persona: null },
    ...overrides,
  };
}

function resetMain(preset: GraphPreset): GraphPreset['agent']['flows'][number] {
  const flow = preset.agent.flows[0]!;
  flow.nodes = [node('trigger', 'test.trigger')];
  flow.edges = [];
  return flow;
}

function action(id: string, label = id, control: string[] = ['out'], extra: JsonObject = {}) {
  return node(id, 'test.runtime-action', { label, control, effect: 'NONE', ...extra });
}

function withInputs(value: ReturnType<typeof node>, inputValues: Record<string, JsonValue>) {
  return { ...value, inputValues };
}

describe('custom-agent deterministic graph runtime', () => {
  it('runs depth-first sequential fan-out in edge-ID order and each node once per scope', async () => {
    const log: string[] = [];
    const registry = createRuntimeRegistry({ record: (label) => log.push(label) });
    const preset = basePreset();
    const flow = resetMain(preset);
    flow.nodes.push(action('a'), action('b'), action('child'));
    flow.edges.push(
      edge('a-first', 'CONTROL', 'trigger', 'out', 'b', 'in'),
      edge('b-second', 'CONTROL', 'trigger', 'out', 'a', 'in'),
      edge('child-edge', 'CONTROL', 'b', 'out', 'child', 'in'),
    );
    const result = await executeGraphPlan(request(compile(preset, registry)));
    expect(result.status).toBe('COMPLETED');
    expect(log).toEqual(['b', 'child', 'a']);
  });

  it('evaluates pure data lazily and memoizes it once on demand', async () => {
    const log: string[] = [];
    const registry = createRuntimeRegistry({ record: (label) => log.push(label) });
    const preset = basePreset();
    const flow = resetMain(preset);
    flow.nodes.push(
      node('pure', 'test.runtime-pure', { label: 'pure', value: 7, schema: { type: 'number' } }),
      node('first', 'test.runtime-consume', { label: 'first', schema: { type: 'number' } }),
      node('second', 'test.runtime-consume', { label: 'second', schema: { type: 'number' } }),
    );
    flow.edges.push(
      edge('a-first', 'CONTROL', 'trigger', 'out', 'first', 'in'),
      edge('b-second', 'CONTROL', 'trigger', 'out', 'second', 'in'),
      edge('data-first', 'DATA', 'pure', 'value', 'first', 'value'),
      edge('data-second', 'DATA', 'pure', 'value', 'second', 'value'),
    );
    const result = await executeGraphPlan(request(compile(preset, registry)));
    expect(result.status).toBe('COMPLETED');
    expect(log).toEqual(['pure', 'first', 'second']);
  });

  it('fails explicitly when a controlled output has not executed', async () => {
    const registry = createRuntimeRegistry();
    const preset = basePreset();
    const flow = resetMain(preset);
    flow.nodes.push(
      node('consumer', 'test.runtime-consume', { label: 'consumer', schema: {} }),
      action('producer', 'producer', ['out'], { value: 'late' }),
    );
    flow.edges.push(
      edge('a-consumer', 'CONTROL', 'trigger', 'out', 'consumer', 'in'),
      edge('b-producer', 'CONTROL', 'trigger', 'out', 'producer', 'in'),
      edge('producer-data', 'DATA', 'producer', 'value', 'consumer', 'value'),
    );
    const result = await executeGraphPlan(request(compile(preset, registry)));
    expect(result).toMatchObject({ status: 'FAILED' });
    expect(result.status === 'FAILED' && result.error).toContain(
      'Controlled output main/producer.value is unavailable',
    );
  });

  it('validates executor output completeness and result shapes without coercion', async () => {
    const registry = createRuntimeRegistry();
    for (const [extra, expected] of [
      [{ value: 'wrong', outputSchema: { type: 'number' } }, 'failed schema validation'],
      [{ value: 1, outputSchema: { type: 'number' }, omitValue: true }, 'Required output main/bad.value was omitted'],
      [{ effect: 'BAD' }, 'Invalid discriminator value'],
    ] as const) {
      const preset = basePreset();
      const flow = resetMain(preset);
      flow.nodes.push(action('bad', 'bad', [], extra));
      flow.edges.push(edge('run-bad', 'CONTROL', 'trigger', 'out', 'bad', 'in'));
      const result = await executeGraphPlan(request(compile(preset, registry)));
      expect(result.status).toBe('FAILED');
      expect(result.status === 'FAILED' && result.error).toContain(expected);
      expect(result).not.toHaveProperty('effects');
    }
  });

  it('allows an omitted optional subflow input to remain unavailable through scope entry', async () => {
    const registry = createRuntimeRegistry();
    const preset = basePreset();
    const flow = resetMain(preset);
    flow.nodes.push(node('run', 'control.run-flow', { flowId: 'echo' }));
    flow.edges.push(edge('trigger-run', 'CONTROL', 'trigger', 'out', 'run', 'in'));
    preset.agent.flows.push({
      id: 'echo',
      name: 'Echo',
      kind: 'SUBFLOW',
      inputs: [{ id: 'optional', label: 'Optional', required: false, cardinality: 'ONE', schema: {} }],
      outputs: [],
      nodes: [
        node('entry', 'scope.entry'),
        node('return', 'scope.return'),
        node('unused-in-returning-scope', 'test.runtime-pure', {
          label: 'unused',
          value: 1,
          schema: { type: 'number' },
        }),
      ],
      edges: [edge('echo-control', 'CONTROL', 'entry', 'out', 'return', 'in')],
    });

    const result = await executeGraphPlan(request(compile(preset, registry)));
    expect(result.status).toBe('COMPLETED');
    expect(result.diagnostics.find((item) => item.flowId === 'echo' && item.nodeId === 'entry')?.output).toEqual({});
    expect(result.diagnostics.find((item) => item.nodeId === 'unused-in-returning-scope')).toMatchObject({
      scopeInvocationId: 'echo:1',
      status: 'SKIPPED',
    });
  });

  it('allows an omitted optional subflow output to remain unavailable from Run Flow', async () => {
    const registry = createRuntimeRegistry();
    const preset = basePreset();
    const flow = resetMain(preset);
    flow.nodes.push(node('run', 'control.run-flow', { flowId: 'optional-output' }));
    flow.edges.push(edge('trigger-run', 'CONTROL', 'trigger', 'out', 'run', 'in'));
    preset.agent.flows.push({
      id: 'optional-output',
      name: 'Optional output',
      kind: 'SUBFLOW',
      inputs: [],
      outputs: [{ id: 'optional', label: 'Optional', required: false, cardinality: 'ONE', schema: {} }],
      nodes: [node('entry', 'scope.entry'), node('return', 'scope.return')],
      edges: [edge('scope-control', 'CONTROL', 'entry', 'out', 'return', 'in')],
    });

    const result = await executeGraphPlan(request(compile(preset, registry)));
    expect(result.status).toBe('COMPLETED');
    expect(result.diagnostics.find((item) => item.flowId === 'main' && item.nodeId === 'run')?.output).toEqual({});
  });

  it('implements Merge Any first arrival and deterministic duplicate-arrival failure', async () => {
    const registry = createRuntimeRegistry();
    const preset = basePreset();
    const flow = resetMain(preset);
    flow.nodes.push(node('join', 'control.merge-any'));
    flow.edges.push(
      edge('a-left', 'CONTROL', 'trigger', 'out', 'join', 'left'),
      edge('b-right', 'CONTROL', 'trigger', 'out', 'join', 'right'),
    );
    const result = await executeGraphPlan(request(compile(preset, registry)));
    expect(result.status).toBe('FAILED');
    expect(result.status === 'FAILED' && result.error).toContain('Merge Any main/join received a duplicate arrival');

    const exclusive = basePreset();
    const exclusiveFlow = resetMain(exclusive);
    exclusiveFlow.nodes.push(action('branch', 'branch', ['left']), node('join', 'control.merge-any'));
    exclusiveFlow.edges.push(
      edge('trigger-branch', 'CONTROL', 'trigger', 'out', 'branch', 'in'),
      edge('left-join', 'CONTROL', 'branch', 'left', 'join', 'left'),
      edge('right-join', 'CONTROL', 'branch', 'right', 'join', 'right'),
    );
    expect((await executeGraphPlan(request(compile(exclusive, registry)))).status).toBe('COMPLETED');
  });

  it('marks non-selected routes and unused pure nodes skipped only after successful scope completion', async () => {
    const registry = createRuntimeRegistry();
    const preset = basePreset();
    const flow = resetMain(preset);
    flow.nodes.push(
      action('branch', 'branch', ['left']),
      action('selected', 'selected', []),
      action('not-selected', 'not-selected', []),
      node('unused-pure', 'test.runtime-pure', { label: 'unused', value: 1, schema: { type: 'number' } }),
    );
    flow.edges.push(
      edge('trigger-branch', 'CONTROL', 'trigger', 'out', 'branch', 'in'),
      edge('left-selected', 'CONTROL', 'branch', 'left', 'selected', 'in'),
      edge('right-not-selected', 'CONTROL', 'branch', 'right', 'not-selected', 'in'),
    );

    const result = await executeGraphPlan(request(compile(preset, registry)));
    expect(result.status).toBe('COMPLETED');
    expect(result.diagnostics.filter((item) => item.status === 'SKIPPED')).toEqual([
      { scopeInvocationId: 'main:1', flowId: 'main', nodeId: 'not-selected', status: 'SKIPPED' },
      { scopeInvocationId: 'main:1', flowId: 'main', nodeId: 'unused-pure', status: 'SKIPPED' },
    ]);

    const failed = basePreset();
    const failedFlow = resetMain(failed);
    failedFlow.nodes.push(action('failure', 'failure', [], { effect: 'BAD' }), action('untouched', 'untouched', []));
    failedFlow.edges.push(
      edge('a-failure', 'CONTROL', 'trigger', 'out', 'failure', 'in'),
      edge('b-untouched', 'CONTROL', 'trigger', 'out', 'untouched', 'in'),
    );
    const failedResult = await executeGraphPlan(request(compile(failed, registry)));
    expect(failedResult.status).toBe('FAILED');
    expect(failedResult.diagnostics.find((item) => item.nodeId === 'untouched')).toBeUndefined();
    expect(failedResult.diagnostics.some((item) => item.status === 'SKIPPED')).toBe(false);
  });

  it('executes Merge All after all arrivals, fails touched incomplete joins, and ignores unreachable joins', async () => {
    const registry = createRuntimeRegistry();

    const complete = basePreset();
    let flow = resetMain(complete);
    flow.nodes.push(node('join', 'control.merge-all'), action('done'));
    flow.edges.push(
      edge('a-left', 'CONTROL', 'trigger', 'out', 'join', 'left'),
      edge('b-right', 'CONTROL', 'trigger', 'out', 'join', 'right'),
      edge('join-done', 'CONTROL', 'join', 'out', 'done', 'in'),
    );
    expect((await executeGraphPlan(request(compile(complete, registry)))).status).toBe('COMPLETED');

    const incomplete = basePreset();
    flow = resetMain(incomplete);
    flow.nodes.push(action('branch', 'branch', ['left']), node('join', 'control.merge-all'));
    flow.edges.push(
      edge('trigger-branch', 'CONTROL', 'trigger', 'out', 'branch', 'in'),
      edge('left-join', 'CONTROL', 'branch', 'left', 'join', 'left'),
      edge('right-join', 'CONTROL', 'branch', 'right', 'join', 'right'),
    );
    const mergeTransitions: string[] = [];
    const incompleteResult = await executeGraphPlan(
      request(compile(incomplete, registry), {
        onDiagnostics: (snapshot) => {
          const join = snapshot.find((item) => item.nodeId === 'join');
          if (join && mergeTransitions.at(-1) !== join.status) mergeTransitions.push(join.status);
        },
      }),
    );
    expect(incompleteResult.status).toBe('FAILED');
    expect(incompleteResult.status === 'FAILED' && incompleteResult.error).toContain(
      'Merge All main/join is incomplete',
    );
    expect(mergeTransitions).toEqual(['RUNNING', 'FAILED']);
    expect(incompleteResult.diagnostics.find((item) => item.nodeId === 'join')).toMatchObject({ status: 'FAILED' });

    const unreachable = basePreset();
    flow = resetMain(unreachable);
    flow.nodes.push(action('branch', 'branch', ['skip']), node('join', 'control.merge-all'), action('done'));
    flow.edges.push(
      edge('trigger-branch', 'CONTROL', 'trigger', 'out', 'branch', 'in'),
      edge('left-join', 'CONTROL', 'branch', 'left', 'join', 'left'),
      edge('right-join', 'CONTROL', 'branch', 'right', 'join', 'right'),
      edge('skip-done', 'CONTROL', 'branch', 'skip', 'done', 'in'),
    );
    expect((await executeGraphPlan(request(compile(unreachable, registry)))).status).toBe('COMPLETED');
  });

  it('binds Run Flow inputs and returns only through the compiled signature', async () => {
    const registry = createRuntimeRegistry();
    const preset = basePreset();
    const flow = resetMain(preset);
    flow.nodes.push(
      withInputs(node('run', 'control.run-flow', { flowId: 'echo' }), { input: 4 }),
      withInputs(node('run-again', 'control.run-flow', { flowId: 'echo' }), { input: 5 }),
      node('consume', 'test.runtime-consume', { label: 'consume', schema: { type: 'number' } }),
    );
    flow.edges.push(
      edge('trigger-run', 'CONTROL', 'trigger', 'out', 'run', 'in'),
      edge('trigger-run-again', 'CONTROL', 'trigger', 'out', 'run-again', 'in'),
      edge('run-consume', 'CONTROL', 'run', 'out', 'consume', 'in'),
      edge('run-data', 'DATA', 'run', 'output', 'consume', 'value'),
    );
    preset.agent.flows.push({
      id: 'echo',
      name: 'Echo',
      kind: 'SUBFLOW',
      inputs: [{ id: 'input', label: 'Input', required: true, cardinality: 'ONE', schema: { type: 'number' } }],
      outputs: [{ id: 'output', label: 'Output', required: true, cardinality: 'ONE', schema: { type: 'number' } }],
      nodes: [node('entry', 'scope.entry'), node('return', 'scope.return')],
      edges: [
        edge('echo-control', 'CONTROL', 'entry', 'out', 'return', 'in'),
        edge('echo-data', 'DATA', 'entry', 'input', 'return', 'output'),
      ],
    });
    const result = await executeGraphPlan(request(compile(preset, registry)));
    expect(result.status).toBe('COMPLETED');
    expect(result.diagnostics.find((item) => item.nodeId === 'run')?.output).toEqual({ output: 4 });
    expect(
      result.diagnostics
        .filter((item) => item.flowId === 'echo' && item.nodeId === 'entry')
        .map((item) => item.scopeInvocationId),
    ).toEqual(['echo:1', 'echo:2']);
  });

  it('runs For Each body scopes sequentially, omits optional values, evolves the accumulator, and handles empty arrays', async () => {
    const registry = createRuntimeRegistry();
    const create = (items: number[], omitFirst: boolean) => {
      const preset = basePreset();
      const flow = resetMain(preset);
      const body = {
        nodes: [
          node('body-entry', 'scope.entry'),
          node('body-step', 'test.runtime-iteration', { omitFirst }),
          node('body-return', 'scope.return'),
        ],
        edges: [
          edge('body-entry-step', 'CONTROL', 'body-entry', 'out', 'body-step', 'in'),
          edge('body-step-return', 'CONTROL', 'body-step', 'out', 'body-return', 'in'),
          edge('body-item', 'DATA', 'body-entry', 'item', 'body-step', 'item'),
          edge('body-acc-in', 'DATA', 'body-entry', 'accumulator', 'body-step', 'accumulator'),
          edge('body-value', 'DATA', 'body-step', 'value', 'body-return', 'value'),
          edge('body-acc-out', 'DATA', 'body-step', 'accumulator', 'body-return', 'accumulator'),
        ],
      };
      flow.nodes.push(
        node('items-source', 'test.runtime-pure', {
          label: 'items',
          value: items,
          schema: { type: 'array', items: { type: 'number' } },
        }),
        withInputs(node('loop', 'control.for-each', { accumulator: true, body }), {
          initialAccumulator: 0,
        }),
      );
      flow.edges.push(
        edge('trigger-loop', 'CONTROL', 'trigger', 'out', 'loop', 'in'),
        edge('items-loop', 'DATA', 'items-source', 'value', 'loop', 'items'),
      );
      return preset;
    };
    const result = await executeGraphPlan(request(compile(create([1, 2, 3], true), registry)));
    expect(result.status).toBe('COMPLETED');
    expect(result.diagnostics.find((item) => item.nodeId === 'loop')?.output).toEqual({
      items: [3, 6],
      accumulator: 6,
    });
    expect(
      result.diagnostics.filter((item) => item.nodeId === 'body-step').map((item) => item.scopeInvocationId),
    ).toEqual(['main/loop:1', 'main/loop:2', 'main/loop:3']);

    const empty = await executeGraphPlan(request(compile(create([], false), registry)));
    expect(empty.status).toBe('COMPLETED');
    expect(empty.diagnostics.find((item) => item.nodeId === 'loop')?.output).toEqual({ items: [], accumulator: 0 });
  });

  it('honors observer and assistant-generation Stop semantics', async () => {
    const registry = createRuntimeRegistry();
    const observer = basePreset();
    let flow = resetMain(observer);
    flow.nodes.push(node('stop', 'control.stop'), action('after-stop'));
    flow.edges.push(
      edge('a-trigger-stop', 'CONTROL', 'trigger', 'out', 'stop', 'in'),
      edge('b-trigger-after-stop', 'CONTROL', 'trigger', 'out', 'after-stop', 'in'),
    );
    const observerResult = await executeGraphPlan(request(compile(observer, registry)));
    expect(observerResult.status).toBe('COMPLETED');
    expect(observerResult.diagnostics.find((item) => item.nodeId === 'after-stop')).toMatchObject({
      scopeInvocationId: 'main:1',
      status: 'SKIPPED',
    });

    const generator = basePreset();
    flow = resetMain(generator);
    flow.nodes[0]!.type = 'test.generator-trigger';
    flow.nodes.push(
      action('response', 'response', [], { effect: 'RESPONSE', value: 'discarded' }),
      node('stop', 'control.stop'),
    );
    flow.edges.push(
      edge('a-trigger-response', 'CONTROL', 'trigger', 'out', 'response', 'in'),
      edge('b-trigger-stop', 'CONTROL', 'trigger', 'out', 'stop', 'in'),
    );
    const plan = compile(generator, registry);
    const result = await executeGraphPlan(
      request(plan, {
        event: {
          trigger: 'ASSISTANT_GENERATION',
          generationId: 'generation',
          generationMode: 'NEW',
        },
      }),
    );
    expect(result).toMatchObject({
      status: 'FAILED',
      error: 'Assistant-generation flow stopped without a generation response',
    });
    expect(result).not.toHaveProperty('effects');
  });

  it('preserves pre-abort and mid-run AbortSignal reasons and publishes no staging', async () => {
    const preset = basePreset();
    const flow = resetMain(preset);
    preset.agent.stateSchema = {
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
      additionalProperties: false,
    };
    preset.agent.initialState = { count: 0 };
    flow.nodes.push(action('effect', 'effect', [], { effect: 'STATE', value: 1 }), action('cancel', 'cancel', []));
    flow.edges.push(
      edge('a-effect', 'CONTROL', 'trigger', 'out', 'effect', 'in'),
      edge('b-cancel', 'CONTROL', 'trigger', 'out', 'cancel', 'in'),
    );

    const preController = new AbortController();
    const preReason = new Error('pre-abort reason');
    preController.abort(preReason);
    const plan = compile(preset, createRuntimeRegistry());
    const preResult = await executeGraphPlan(request(plan, { state: { count: 0 }, signal: preController.signal }));
    expect(preResult).toEqual({ status: 'CANCELLED', flowId: 'main', error: preReason.message, diagnostics: [] });

    const midController = new AbortController();
    const midReason = new Error('mid-run reason');
    const midResult = await executeGraphPlan(
      request(compile(preset, createRuntimeRegistry({ cancel: () => midController.abort(midReason) })), {
        state: { count: 0 },
        signal: midController.signal,
      }),
    );
    expect(midResult).toMatchObject({ status: 'CANCELLED', error: midReason.message });
    expect(midResult.diagnostics.find((item) => item.nodeId === 'cancel')).toMatchObject({ status: 'CANCELLED' });
    expect(midResult.diagnostics.find((item) => item.nodeId === 'effect')).toMatchObject({ status: 'COMPLETED' });
    expect(midResult.diagnostics.some((item) => item.status === 'SKIPPED')).toBe(false);
    expect(midResult).not.toHaveProperty('state');
    expect(midResult).not.toHaveProperty('effects');
  });

  it('publishes immutable live RUNNING and terminal diagnostics for a pending executor', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshots: (readonly object[])[] = [];
    const registry = createRuntimeRegistry({
      wait: async (label) => {
        if (label === 'pending') await pending;
      },
    });
    const preset = basePreset();
    const flow = resetMain(preset);
    flow.nodes.push(action('pending'));
    flow.edges.push(edge('trigger-pending', 'CONTROL', 'trigger', 'out', 'pending', 'in'));

    const execution = executeGraphPlan(
      request(compile(preset, registry), {
        onDiagnostics: (snapshot) => snapshots.push(snapshot),
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    const running = snapshots.at(-1)!;
    expect(Object.isFrozen(running)).toBe(true);
    expect(Object.isFrozen(running.at(-1))).toBe(true);
    expect(running.at(-1)).toMatchObject({
      scopeInvocationId: 'main:1',
      nodeId: 'pending',
      status: 'RUNNING',
    });

    release();
    const result = await execution;
    expect(result.status).toBe('COMPLETED');
    expect(snapshots.at(-1)?.find((item) => 'nodeId' in item && item.nodeId === 'pending')).toMatchObject({
      status: 'COMPLETED',
    });
  });

  it('keeps the latest 200 diagnostics and omits oversized serialized outputs', async () => {
    const bounded = basePreset();
    const boundedFlow = resetMain(bounded);
    let previous = 'trigger';
    for (let index = 0; index < 205; index++) {
      const id = `step-${index}`;
      boundedFlow.nodes.push(action(id));
      boundedFlow.edges.push(edge(`edge-${index.toString().padStart(3, '0')}`, 'CONTROL', previous, 'out', id, 'in'));
      previous = id;
    }
    const boundedResult = await executeGraphPlan(request(compile(bounded, createRuntimeRegistry())));
    expect(boundedResult.diagnostics).toHaveLength(200);
    expect(boundedResult.diagnostics.at(0)?.nodeId).toBe('step-5');
    expect(boundedResult.diagnostics.at(-1)?.nodeId).toBe('step-204');

    const outputs = basePreset();
    const outputFlow = resetMain(outputs);
    outputFlow.nodes.push(
      action('within', 'within', [], { value: 'x'.repeat(8_180), outputSchema: { type: 'string' } }),
      action('over', 'over', [], { value: 'x'.repeat(8_181), outputSchema: { type: 'string' } }),
    );
    outputFlow.edges.push(
      edge('a-within', 'CONTROL', 'trigger', 'out', 'within', 'in'),
      edge('b-over', 'CONTROL', 'trigger', 'out', 'over', 'in'),
    );
    const outputResult = await executeGraphPlan(request(compile(outputs, createRuntimeRegistry())));
    expect(outputResult.diagnostics.find((item) => item.nodeId === 'within')).toHaveProperty('output');
    expect(outputResult.diagnostics.find((item) => item.nodeId === 'over')).not.toHaveProperty('output');
  });
});
