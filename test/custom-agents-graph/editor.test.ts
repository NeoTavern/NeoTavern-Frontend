import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  GRAPH_NODE_MIN_HEIGHT,
  GRAPH_NODE_MIN_WIDTH,
  type FlowSignature,
  type GraphNode,
  type GraphPreset,
  type ScopeGraph,
} from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import { graphNodeSchema } from '../../src/extensions/built-in/custom-agents/graph/schemas';
import type { GraphDiagnostic } from '../../src/extensions/built-in/custom-agents/graph/diagnostics';
import { copySelection, pasteClipboard } from '../../src/extensions/built-in/custom-agents/editor/clipboard';
import { GraphEditorStore } from '../../src/extensions/built-in/custom-agents/editor/editor-store';
import { CommandHistory } from '../../src/extensions/built-in/custom-agents/editor/history';
import {
  createVueFlowRenderCache,
  fromVueFlow,
  isValidConnection,
  resolveEditorPorts,
  resolveEditorScope,
  toVueFlow,
  EditorPortResolutionCache,
} from '../../src/extensions/built-in/custom-agents/editor/vue-flow-adapter';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import type { ReadonlyNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/node-definition';

const fixture = (name: string): GraphPreset =>
  JSON.parse(
    fs.readFileSync(
      name === 'mythic'
        ? new URL('../../src/extensions/built-in/custom-agents/presets/mythic.flow.json', import.meta.url)
        : new URL(`../fixtures/custom-agents/${name}.flow.json`, import.meta.url),
      'utf8',
    ),
  ) as GraphPreset;
function ids(prefix = 'generated') {
  let index = 0;
  return { generate: () => `${prefix}${++index}` };
}

describe('Custom Agent graph editor', () => {
  it('validates the real Mythic preset through the production registry', () => {
    const preset = fixture('mythic');
    const result = compileGraphPreset(preset, builtinNodeRegistry);
    expect(result.success).toBe(true);
    expect(preset.agent.flows).toHaveLength(17);
    expect(preset.agent.flows.flatMap((flow) => flow.nodes)).toHaveLength(203);
    const nestedNodes = preset.agent.flows.flatMap((flow) =>
      flow.nodes.flatMap((node) => {
        const body = node.data.body as { nodes?: unknown[] } | undefined;
        return body?.nodes ?? [];
      }),
    );
    expect(nestedNodes).toHaveLength(131);
  }, 20_000);

  it('opens and applies an exact Mythic editor round trip', () => {
    const preset = fixture('mythic');
    const apply = vi.fn();
    const store = new GraphEditorStore({ executable: preset, registry: builtinNodeRegistry, ids: ids(), apply });
    expect(store.diagnostics.value).toEqual([]);
    expect(store.draft.value).toEqual(preset);
    expect(store.apply()).toBe(true);
    expect(apply).toHaveBeenCalledWith(preset);
  }, 20_000);

  it('keeps invalid drafts isolated until a complete definition can be applied', () => {
    const original = fixture('minimal-observer');
    const apply = vi.fn();
    const store = new GraphEditorStore({ executable: original, registry: builtinNodeRegistry, ids: ids(), apply });

    store.updateNodeData('save-count', 'path', '');
    expect(store.diagnostics.value.length).toBeGreaterThan(0);
    expect(store.apply()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(store.executable.value).toEqual(original);

    store.undo();
    expect(store.diagnostics.value).toEqual([]);
    expect(store.apply()).toBe(true);
    expect(apply).toHaveBeenCalledWith(original);
  });

  it('trusts an explicitly prepared initial executable while standalone construction and later edits validate', () => {
    const invalid = fixture('minimal-observer');
    invalid.agent.flows[0]!.nodes.find((node) => node.id === 'save-count')!.data.path = '';
    const preparedStore = new GraphEditorStore({
      executable: invalid,
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
      validatedExecutable: true,
    });
    expect(preparedStore.diagnostics.value).toEqual([]);
    preparedStore.updateInputValue('increment', 'amount', 2);
    expect(preparedStore.diagnostics.value.length).toBeGreaterThan(0);

    const standalone = new GraphEditorStore({
      executable: invalid,
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
    });
    expect(standalone.diagnostics.value.length).toBeGreaterThan(0);
  });

  it('synchronizes installed metadata without losing a dirty draft or its diagnostics', () => {
    const original = fixture('minimal-observer');
    const store = new GraphEditorStore({
      executable: original,
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
    });
    store.updateNodeData('save-count', 'path', '');
    const dirtyFlow = store.draft.value.agent.flows;
    const diagnostics = store.diagnostics.value;
    store.synchronizeMetadata({ name: 'Renamed', priority: 7, enabled: true });
    expect(store.executable.value.agent).toMatchObject({ name: 'Renamed', priority: 7, enabled: true });
    expect(store.draft.value.agent).toMatchObject({ name: 'Renamed', priority: 7, enabled: true });
    expect(store.draft.value.agent.flows).toBe(dirtyFlow);
    expect(store.diagnostics.value).toBe(diagnostics);
    expect(store.isDirty.value).toBe(true);
  });

  it('preserves synchronized metadata through undo, redo, and apply', () => {
    const original = fixture('minimal-observer');
    const apply = vi.fn();
    const store = new GraphEditorStore({
      executable: original,
      registry: builtinNodeRegistry,
      ids: ids(),
      apply,
    });
    store.updateInputValue('increment', 'amount', 2);
    store.synchronizeMetadata({ name: 'Installed name', priority: 9, enabled: false });

    store.undo();
    expect(store.draft.value.agent).toMatchObject({ name: 'Installed name', priority: 9, enabled: false });
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.inputValues.amount).toBe(1);
    store.redo();
    expect(store.draft.value.agent).toMatchObject({ name: 'Installed name', priority: 9, enabled: false });
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.inputValues.amount).toBe(2);
    expect(store.apply()).toBe(true);
    expect(apply.mock.calls[0]![0].agent).toMatchObject({ name: 'Installed name', priority: 9, enabled: false });
  });

  it('makes connect, inline removal, movement, deletion, and undo atomic commands', () => {
    const store = new GraphEditorStore({
      executable: fixture('minimal-observer'),
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
    });
    const constantId = store.addNode('data.constant', { x: 15, y: 25 })!;
    store.updateNodeData(constantId, 'value', 2);
    store.connect({
      kind: 'DATA',
      source: { nodeId: constantId, portId: 'value' },
      target: { nodeId: 'increment', portId: 'amount' },
    });
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.inputValues).not.toHaveProperty('amount');
    expect(store.currentGraph?.edges.some((edge) => edge.target.portId === 'amount')).toBe(true);

    store.undo();
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.inputValues.amount).toBe(1);
    store.redo();
    store.moveNodes({ [constantId]: { x: 100, y: 200 } });
    expect(store.currentGraph?.nodes.find((node) => node.id === constantId)?.position).toEqual({ x: 100, y: 200 });
    store.selectedNodeIds.value = [constantId];
    store.deleteSelection();
    expect(store.currentGraph?.nodes.some((node) => node.id === constantId)).toBe(false);
    expect(store.currentGraph?.edges.some((edge) => edge.source.nodeId === constantId)).toBe(false);
  });

  it('strictly validates optional presentation sizes and rejects undersized or extra values', () => {
    const node = fixture('minimal-observer').agent.flows[0]!.nodes[0]!;
    expect(
      graphNodeSchema.safeParse({
        ...node,
        size: { width: GRAPH_NODE_MIN_WIDTH, height: GRAPH_NODE_MIN_HEIGHT },
      }).success,
    ).toBe(true);
    expect(graphNodeSchema.safeParse({ ...node, size: { width: 319, height: 96 } }).success).toBe(false);
    expect(graphNodeSchema.safeParse({ ...node, size: { width: 320, height: 95 } }).success).toBe(false);
    expect(graphNodeSchema.safeParse({ ...node, size: { width: 320, height: 96, depth: 1 } }).success).toBe(false);
  });

  it('persists clamped node resizing as one undoable command and carries size through adapters and clipboard', () => {
    const store = new GraphEditorStore({
      executable: fixture('minimal-observer'),
      registry: builtinNodeRegistry,
      ids: ids('resize'),
      apply: vi.fn(),
    });
    const before = structuredClone(store.draft.value);
    store.resizeNode('increment', { width: 120, height: 20 });
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.size).toEqual({
      width: GRAPH_NODE_MIN_WIDTH,
      height: GRAPH_NODE_MIN_HEIGHT,
    });
    store.undo();
    expect(store.draft.value).toEqual(before);
    expect(store.canUndo).toBe(false);
    store.redo();

    const flow = store.currentGraph!;
    const ports = resolveEditorPorts(store.draft.value.agent, store.selectedFlow!, flow, builtinNodeRegistry);
    const adapted = toVueFlow(flow, ports, new Set(), new Set());
    const increment = adapted.nodes.find((node) => node.id === 'increment')!;
    expect(increment).toMatchObject({ width: GRAPH_NODE_MIN_WIDTH, height: GRAPH_NODE_MIN_HEIGHT });
    const selectedIncrement = toVueFlow(flow, ports, new Set(), new Set(), {}, new Set(['increment'])).nodes.find(
      (node) => node.id === 'increment',
    )!;
    expect(selectedIncrement).toMatchObject({
      width: increment.width,
      height: increment.height,
      selected: true,
    });
    expect(fromVueFlow(flow, adapted.nodes, adapted.edges).nodes.find((node) => node.id === 'increment')?.size).toEqual(
      {
        width: GRAPH_NODE_MIN_WIDTH,
        height: GRAPH_NODE_MIN_HEIGHT,
      },
    );
    const clipboard = copySelection(flow, new Set(['increment']));
    expect(clipboard.nodes[0]?.size).toEqual({ width: GRAPH_NODE_MIN_WIDTH, height: GRAPH_NODE_MIN_HEIGHT });
    const pasted = pasteClipboard(clipboard, new Set(flow.nodes.map((node) => node.id)), ids('sized-copy'));
    expect(pasted.nodes[0]?.size).toEqual({ width: GRAPH_NODE_MIN_WIDTH, height: GRAPH_NODE_MIN_HEIGHT });
  });

  it('patches geometry in place without semantic work and keeps port-resolution identities cached', () => {
    let registryGets = 0;
    const registry: ReadonlyNodeRegistry = {
      get: (type) => {
        registryGets++;
        return builtinNodeRegistry.get(type);
      },
      list: () => builtinNodeRegistry.list(),
    };
    const store = new GraphEditorStore({
      executable: fixture('minimal-observer'),
      registry,
      ids: ids(),
      apply: vi.fn(),
      validatedExecutable: true,
    });
    const revalidate = vi.spyOn(store, 'revalidate');
    const draft = store.draft.value;
    const agent = draft.agent;
    const flows = agent.flows;
    const flow = store.selectedFlow!;
    const nodes = flow.nodes;
    const edges = flow.edges;
    const increment = nodes.find((node) => node.id === 'increment')!;
    const nodeData = increment.data;
    const inputValues = increment.inputValues;
    const configurationSchema = agent.configurationSchema;
    const stateSchema = agent.stateSchema;
    const signatureInputs = flow.inputs;
    const signatureOutputs = flow.outputs;
    const diagnostics = store.diagnostics.value;
    const schemaBuffers = store.signatureSchemaBuffers.value;
    const cache = new EditorPortResolutionCache();
    const initiallyResolved = resolveEditorPorts(agent, flow, flow, registry, undefined, cache);
    const renderCache = createVueFlowRenderCache();
    const initiallyRendered = toVueFlow(
      flow,
      initiallyResolved,
      new Set(),
      new Set(),
      {},
      new Set(),
      undefined,
      renderCache,
    );
    registryGets = 0;

    store.moveNodes({ increment: { x: 401, y: 302 } });

    expect(registryGets).toBe(0);
    expect(revalidate).not.toHaveBeenCalled();
    expect(store.draft.value).toBe(draft);
    expect(store.draft.value.agent).toBe(agent);
    expect(agent.flows).toBe(flows);
    expect(store.selectedFlow).toBe(flow);
    expect(flow.nodes).toBe(nodes);
    expect(flow.edges).toBe(edges);
    expect(flow.nodes.find((node) => node.id === 'increment')).toBe(increment);
    expect(increment.data).toBe(nodeData);
    expect(increment.inputValues).toBe(inputValues);
    expect(agent.configurationSchema).toBe(configurationSchema);
    expect(agent.stateSchema).toBe(stateSchema);
    expect(flow.inputs).toBe(signatureInputs);
    expect(flow.outputs).toBe(signatureOutputs);
    expect(store.diagnostics.value).toBe(diagnostics);
    expect(store.signatureSchemaBuffers.value).toBe(schemaBuffers);
    expect(resolveEditorPorts(agent, flow, flow, registry, undefined, cache)).toBe(initiallyResolved);
    expect(registryGets).toBe(0);
    const rendered = toVueFlow(flow, initiallyResolved, new Set(), new Set(), {}, new Set(), undefined, renderCache);
    expect(rendered.nodes.find((node) => node.id === 'increment')).toMatchObject({ position: { x: 401, y: 302 } });
    expect(rendered.nodes.find((node) => node.id === 'increment')).not.toBe(
      initiallyRendered.nodes.find((node) => node.id === 'increment'),
    );
    expect(
      JSON.parse(JSON.stringify(store.draft.value)).agent.flows[0].nodes.find(
        (node: GraphNode) => node.id === 'increment',
      ).position,
    ).toEqual({
      x: 401,
      y: 302,
    });

    store.undo();
    expect(registryGets).toBe(0);
    expect(store.draft.value).toBe(draft);
    expect(increment.position).not.toEqual({ x: 401, y: 302 });
    store.redo();
    expect(registryGets).toBe(0);
    expect(revalidate).not.toHaveBeenCalled();
    expect(increment.position).toEqual({ x: 401, y: 302 });
  });

  it('interleaves sparse geometry and semantic snapshots and detects geometry no-ops', () => {
    let registryGets = 0;
    const registry: ReadonlyNodeRegistry = {
      get: (type) => {
        registryGets++;
        return builtinNodeRegistry.get(type);
      },
      list: () => builtinNodeRegistry.list(),
    };
    const store = new GraphEditorStore({
      executable: fixture('minimal-observer'),
      registry,
      ids: ids(),
      apply: vi.fn(),
      validatedExecutable: true,
    });
    const originalPosition = { ...store.currentGraph!.nodes.find((node) => node.id === 'increment')!.position };

    store.updateInputValue('increment', 'amount', 2);
    store.moveNodes({ increment: { x: 500, y: 600 } });
    const getsAfterMove = registryGets;
    store.updateInputValue('increment', 'amount', 3);
    store.undo();
    const getsAfterSemanticUndo = registryGets;
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')).toMatchObject({
      position: { x: 500, y: 600 },
      inputValues: { amount: 2 },
    });
    store.undo();
    expect(registryGets).toBe(getsAfterSemanticUndo);
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')).toMatchObject({
      position: originalPosition,
      inputValues: { amount: 2 },
    });
    store.undo();
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.inputValues.amount).toBe(1);
    store.redo();
    store.redo();
    expect(registryGets).toBeGreaterThan(getsAfterMove);
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')).toMatchObject({
      position: { x: 500, y: 600 },
      inputValues: { amount: 2 },
    });

    store.undo();
    expect(store.canRedo).toBe(true);
    store.moveNodes({ increment: originalPosition });
    expect(store.canRedo).toBe(true);
    store.resizeNode('increment', { width: 320, height: 96 });
    expect(store.canRedo).toBe(false);
    const getsAfterResize = registryGets;
    store.resizeNode('increment', { width: 320, height: 96 });
    expect(registryGets).toBe(getsAfterResize);
    store.undo();
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.size).toBeUndefined();
  });

  it('keeps reversible history commands on their original stack when callbacks throw', () => {
    const history = new CommandHistory<object>();
    const undo = vi.fn(() => {
      throw new Error('undo failed');
    });
    const redo = vi.fn(() => {
      throw new Error('redo failed');
    });
    history.record({ label: 'fallible', undo, redo });

    expect(() => history.undo()).toThrow('undo failed');
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    undo.mockImplementation(() => undefined);
    history.undo();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);

    expect(() => history.redo()).toThrow('redo failed');
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    redo.mockImplementation(() => undefined);
    history.redo();
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it('validates every recorded geometry target before undo or redo mutates any node', () => {
    const store = new GraphEditorStore({
      executable: fixture('minimal-observer'),
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
      validatedExecutable: true,
    });
    const graph = store.currentGraph!;
    const first = graph.nodes[0]!;
    const second = graph.nodes[1]!;
    const firstBefore = { ...first.position };
    const secondBefore = { ...second.position };
    const firstAfter = { x: 701, y: 702 };
    const secondAfter = { x: 801, y: 802 };
    store.layoutScopes([
      {
        flowId: store.selectedFlowId.value,
        scopePath: [],
        positions: { [first.id]: firstAfter, [second.id]: secondAfter },
      },
    ]);
    const secondIndex = graph.nodes.indexOf(second);
    graph.nodes.splice(secondIndex, 1);

    expect(() => store.undo()).toThrow(`Geometry patch invariant violated: node "${second.id}"`);
    expect(first.position).toEqual(firstAfter);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);

    graph.nodes.splice(secondIndex, 0, second);
    store.undo();
    expect(first.position).toEqual(firstBefore);
    expect(second.position).toEqual(secondBefore);
    expect(store.canRedo).toBe(true);
    graph.nodes.splice(secondIndex, 1);

    expect(() => store.redo()).toThrow(`Geometry patch invariant violated: node "${second.id}"`);
    expect(first.position).toEqual(firstBefore);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);

    graph.nodes.splice(secondIndex, 0, second);
    store.redo();
    expect(first.position).toEqual(firstAfter);
    expect(second.position).toEqual(secondAfter);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);
  });

  it('applies all-scope layout as one sparse command and restores every scope with one undo', () => {
    const store = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
      validatedExecutable: true,
    });
    const revalidate = vi.spyOn(store, 'revalidate');
    const flow = store.draft.value.agent.flows.find((candidate) => candidate.id === 'accumulate')!;
    const body = flow.nodes.find((node) => node.id === 'loop')!.data.body as ScopeGraph;
    const rootNode = flow.nodes[0]!;
    const bodyNode = body.nodes[0]!;
    const rootBefore = { ...rootNode.position };
    const bodyBefore = { ...bodyNode.position };

    store.layoutScopes([
      { flowId: flow.id, scopePath: [], positions: { [rootNode.id]: { x: 701, y: 702 } } },
      { flowId: flow.id, scopePath: ['loop'], positions: { [bodyNode.id]: { x: 801, y: 802 } } },
    ]);
    expect(rootNode.position).toEqual({ x: 701, y: 702 });
    expect(bodyNode.position).toEqual({ x: 801, y: 802 });
    expect(revalidate).not.toHaveBeenCalled();
    store.undo();
    expect(rootNode.position).toEqual(rootBefore);
    expect(bodyNode.position).toEqual(bodyBefore);
    expect(store.canUndo).toBe(false);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it('reuses cached node and edge render objects unless their actual inputs or selection change', () => {
    const preset = fixture('minimal-observer');
    const flow = preset.agent.flows[0]!;
    const resolved = resolveEditorPorts(preset.agent, flow, flow, builtinNodeRegistry);
    const cache = createVueFlowRenderCache();
    const initial = toVueFlow(flow, resolved, new Set(), new Set(), {}, new Set(), undefined, cache);
    const selected = toVueFlow(flow, resolved, new Set(), new Set(), {}, new Set(['increment']), undefined, cache);
    for (const node of initial.nodes.filter((node) => node.id !== 'increment')) {
      expect(selected.nodes.find((candidate) => candidate.id === node.id)).toBe(node);
    }
    for (const edge of initial.edges) expect(selected.edges.find((candidate) => candidate.id === edge.id)).toBe(edge);
    expect(selected.nodes.find((node) => node.id === 'increment')).not.toBe(
      initial.nodes.find((node) => node.id === 'increment'),
    );

    const edited = structuredClone(flow);
    edited.nodes.find((node) => node.id === 'increment')!.inputValues.amount = 3;
    const editedResolved = resolveEditorPorts(preset.agent, edited, edited, builtinNodeRegistry);
    const refreshed = toVueFlow(
      edited,
      editedResolved,
      new Set(),
      new Set(),
      {},
      new Set(['increment']),
      undefined,
      cache,
    );
    expect(refreshed.nodes.find((node) => node.id === 'increment')).not.toBe(
      selected.nodes.find((node) => node.id === 'increment'),
    );
    expect(refreshed.nodes.find((node) => node.id === 'read-count')).toBe(
      selected.nodes.find((node) => node.id === 'read-count'),
    );
  });

  it('copy/pastes only internal edges and remaps nested canvas IDs safely', () => {
    const source = fixture('nested-subflow');
    const flow = source.agent.flows.find((candidate) =>
      candidate.nodes.some((node) => node.type === 'control.for-each'),
    )!;
    const loop = flow.nodes.find((node) => node.type === 'control.for-each')!;
    const clipboard = copySelection(flow, new Set([loop.id]));
    const pasted = pasteClipboard(
      clipboard,
      new Set(source.agent.flows.flatMap((candidate) => candidate.nodes.map((node) => node.id))),
      ids('copy'),
    );
    expect(pasted.nodes).toHaveLength(1);
    expect(pasted.nodes[0]!.id).not.toBe(loop.id);
    const originalBody = loop.data.body as unknown as ScopeGraph;
    const pastedBody = pasted.nodes[0]!.data.body as unknown as ScopeGraph;
    expect(new Set(pastedBody.nodes.map((node) => node.id))).not.toEqual(
      new Set(originalBody.nodes.map((node) => node.id)),
    );
    const pastedBodyIds = new Set(pastedBody.nodes.map((node) => node.id));
    expect(pastedBodyIds.has(pastedBody.edges[0]!.source.nodeId)).toBe(true);
    expect(pastedBodyIds.has(pastedBody.edges[0]!.target.nodeId)).toBe(true);
  });

  it('keeps the compiler-equivalent nested For Each signature live after parent signature edits', () => {
    const preset = fixture('nested-subflow');
    const flow = preset.agent.flows.find((candidate) => candidate.id === 'accumulate')!;
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
    });
    store.selectFlow(flow.id);
    store.openBody('loop');
    const active = () =>
      resolveEditorScope(store.draft.value.agent, store.selectedFlow!, store.scopePath.value, builtinNodeRegistry)!;
    expect(
      active()
        .resolved.get('body-entry')
        ?.outputs.map((port) => [port.id, port.kind === 'DATA' && port.schema]),
    ).toEqual([
      ['out', false],
      ['item', { type: 'number' }],
      ['index', { type: 'number' }],
      ['accumulator', { type: 'number' }],
    ]);
    expect(
      active()
        .resolved.get('body-return')
        ?.inputs.map((port) => port.id),
    ).toEqual(['in', 'value', 'accumulator']);

    store.updateFlowPort('inputs', 'numbers', 'schema', { type: 'array', items: { type: 'string' } });
    expect(store.scopePath.value).toEqual(['loop']);
    expect(
      active()
        .resolved.get('body-entry')
        ?.outputs.find((port) => port.id === 'item'),
    ).toMatchObject({
      kind: 'DATA',
      schema: { type: 'string' },
    });
    expect(
      active()
        .resolved.get('body-entry')
        ?.outputs.map((port) => port.id),
    ).toEqual(['out', 'item', 'index', 'accumulator']);
  });

  it('authors reusable signatures with injected stable IDs, history, live handles, and retained stale edges', () => {
    const preset = fixture('nested-subflow');
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: ids('port'),
      apply: vi.fn(),
    });
    store.selectFlow('accumulate');
    const added = store.addFlowPort('inputs')!;
    expect(added).toBe('port1');
    store.updateFlowPort('inputs', added, 'label', 'Extra input');
    store.updateFlowPort('inputs', added, 'required', false);
    expect(store.updateFlowPortSchemaText('inputs', added, '{ invalid')).toBe(false);
    expect(store.canApply.value).toBe(false);
    expect(store.flowPortSchemaText('inputs', store.selectedFlow!.inputs.at(-1)!)).toBe('{ invalid');
    expect(store.selectedFlow?.inputs.at(-1)).toMatchObject({
      id: added,
      label: 'Extra input',
      required: false,
      schema: {},
    });
    store.updateFlowPortSchemaText('inputs', added, '{"type":"boolean"}');
    expect(store.signatureSchemaErrors.value.size).toBe(0);
    store.moveFlowPort('inputs', added, -1);
    expect(store.selectedFlow?.inputs[0]?.id).toBe(added);
    let active = resolveEditorScope(store.draft.value.agent, store.selectedFlow!, [], builtinNodeRegistry)!;
    expect(active.resolved.get('sub-entry')?.outputs.map((port) => port.id)).toContain(added);
    const caller = store.draft.value.agent.flows.find((flow) => flow.id === 'manual-main')!;
    const callerPorts = resolveEditorScope(store.draft.value.agent, caller, [], builtinNodeRegistry)!.resolved;
    const run = caller.nodes.find((node) => node.type === 'control.run-flow')!;
    expect(callerPorts.get(run.id)?.inputs.map((port) => port.id)).toContain(added);

    store.updateFlowPort('outputs', 'result', 'id', 'renamed-result');
    active = resolveEditorScope(store.draft.value.agent, store.selectedFlow!, [], builtinNodeRegistry)!;
    const adapted = toVueFlow(store.selectedFlow!, active.resolved, new Set(), new Set());
    expect(adapted.edges.find((edge) => edge.id === 'sub-loop-result')?.data?.invalid).toBe(true);
    expect(adapted.nodes.find((node) => node.id === 'sub-return')?.data.inputs.map((port) => port.id)).toContain(
      'result',
    );
    store.undo();
    expect(store.selectedFlow?.outputs[0]?.id).toBe('result');
    store.redo();
    expect(store.selectedFlow?.outputs[0]?.id).toBe('renamed-result');
    store.removeFlowPort('inputs', added);
    expect(store.selectedFlow?.inputs.some((port) => port.id === added)).toBe(false);
  });

  it('reconciles invalid signature schema drafts across add and ID-edit undo/redo', () => {
    const addedStore = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: ids('history-port'),
      apply: vi.fn(),
    });
    addedStore.selectFlow('accumulate');
    const added = addedStore.addFlowPort('inputs')!;
    expect(addedStore.updateFlowPortSchemaText('inputs', added, '{added-invalid')).toBe(false);
    addedStore.undo();
    expect(addedStore.selectedFlow?.inputs.some((port) => port.id === added)).toBe(false);
    expect(addedStore.canApply.value).toBe(true);
    addedStore.redo();
    const restoredAdded = addedStore.selectedFlow!.inputs.find((port) => port.id === added)!;
    expect(addedStore.flowPortSchemaText('inputs', restoredAdded)).toBe('{added-invalid');
    expect(addedStore.canApply.value).toBe(false);

    const renamedStore = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
    });
    renamedStore.selectFlow('accumulate');
    renamedStore.updateFlowPort('outputs', 'result', 'id', 'renamed-result');
    expect(renamedStore.updateFlowPortSchemaText('outputs', 'renamed-result', '{renamed-invalid')).toBe(false);
    renamedStore.undo();
    expect(renamedStore.selectedFlow?.outputs[0]?.id).toBe('result');
    expect(renamedStore.flowPortSchemaText('outputs', renamedStore.selectedFlow!.outputs[0]!)).toBe('{renamed-invalid');
    expect(renamedStore.canApply.value).toBe(false);
    renamedStore.redo();
    expect(renamedStore.selectedFlow?.outputs[0]?.id).toBe('renamed-result');
    expect(renamedStore.flowPortSchemaText('outputs', renamedStore.selectedFlow!.outputs[0]!)).toBe('{renamed-invalid');
    expect(renamedStore.canApply.value).toBe(false);

    const schemaStore = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
    });
    schemaStore.selectFlow('accumulate');
    expect(schemaStore.updateFlowPortSchemaText('outputs', 'result', '{"type":"string"}')).toBe(true);
    schemaStore.undo();
    expect(JSON.parse(schemaStore.flowPortSchemaText('outputs', schemaStore.selectedFlow!.outputs[0]!))).toEqual({
      type: 'array',
      items: { type: 'number' },
    });
    schemaStore.redo();
    expect(JSON.parse(schemaStore.flowPortSchemaText('outputs', schemaStore.selectedFlow!.outputs[0]!))).toEqual({
      type: 'string',
    });

    const removedStore = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
    });
    removedStore.selectFlow('accumulate');
    expect(removedStore.updateFlowPortSchemaText('outputs', 'result', '{removed-invalid')).toBe(false);
    removedStore.removeFlowPort('outputs', 'result');
    expect(removedStore.signatureSchemaErrors.value.size).toBe(0);
    removedStore.undo();
    expect(removedStore.flowPortSchemaText('outputs', removedStore.selectedFlow!.outputs[0]!)).toBe('{removed-invalid');
    expect(removedStore.canApply.value).toBe(false);
    removedStore.redo();
    expect(removedStore.selectedFlow?.outputs).toEqual([]);
    expect(removedStore.signatureSchemaErrors.value.size).toBe(0);
  });

  it('prunes only disappearing inline discriminator ports while keeping connected stale edges', () => {
    const store = new GraphEditorStore({
      executable: fixture('minimal-observer'),
      registry: builtinNodeRegistry,
      ids: ids('dynamic'),
      apply: vi.fn(),
    });
    const llm = store.addNode('llm.request')!;
    store.updateNodeData(llm, 'assembly.history', 'RECENT_CURRENT');
    store.updateInputValue(llm, 'historyCount', 4);
    store.updateNodeData(llm, 'assembly.history', 'NONE');
    expect(store.currentGraph?.nodes.find((node) => node.id === llm)?.inputValues).not.toHaveProperty('historyCount');
    store.undo();
    expect(store.currentGraph?.nodes.find((node) => node.id === llm)?.inputValues.historyCount).toBe(4);

    const count = store.addNode('data.constant')!;
    store.updateNodeData(count, 'value', 3);
    store.connect({
      kind: 'DATA',
      source: { nodeId: count, portId: 'value' },
      target: { nodeId: llm, portId: 'historyCount' },
    });
    store.updateNodeData(llm, 'assembly.history', 'NONE');
    expect(
      store.currentGraph?.edges.some((edge) => edge.target.nodeId === llm && edge.target.portId === 'historyCount'),
    ).toBe(true);

    const injection = store.addNode('effect.set-injection')!;
    store.updateNodeData(injection, 'activation.type', 'PROBABILITY');
    store.updateInputValue(injection, 'probability', 0.25);
    store.updateNodeData(injection, 'activation.type', 'ALWAYS');
    expect(store.currentGraph?.nodes.find((node) => node.id === injection)?.inputValues).not.toHaveProperty(
      'probability',
    );
    store.updateNodeData(injection, 'activation.type', 'PROBABILITY');
    store.connect({
      kind: 'DATA',
      source: { nodeId: count, portId: 'value' },
      target: { nodeId: injection, portId: 'probability' },
    });
    store.updateNodeData(injection, 'activation.type', 'ALWAYS');
    expect(
      store.currentGraph?.edges.some(
        (edge) => edge.target.nodeId === injection && edge.target.portId === 'probability',
      ),
    ).toBe(true);
  });

  it('parses compiler nested scope IDs and projects diagnostic selection', () => {
    const store = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
    });
    const focus = (location: GraphDiagnostic['location']) =>
      store.focusDiagnostic({ severity: 'ERROR', code: 'FOCUS', message: 'focus', location });
    focus({ kind: 'NODE', flowId: 'manual-main', nodeId: 'branch' });
    expect(store.selectedNodeIds.value).toEqual(['branch']);
    focus({ kind: 'PORT', flowId: 'manual-main', nodeId: 'call', portId: 'numbers' });
    expect(store.selectedNodeIds.value).toEqual(['call']);
    focus({ kind: 'EDGE', flowId: 'manual-main', edgeId: 'b-branch-call' });
    expect(store.selectedEdgeId.value).toBe('b-branch-call');
    focus({ kind: 'FLOW', flowId: 'manual-main' });
    expect(store.currentScopeKey).toBe('manual-main');

    focus({ kind: 'NODE', flowId: 'accumulate/loop', nodeId: 'add' });
    expect(store.currentScopeKey).toBe('accumulate/loop');
    expect(store.selectedNodeIds.value).toEqual(['add']);
    focus({ kind: 'PORT', flowId: 'accumulate/loop', nodeId: 'body-entry', portId: 'item' });
    expect(store.selectedFlowId.value).toBe('accumulate');
    expect(store.scopePath.value).toEqual(['loop']);
    expect(store.selectedNodeIds.value).toEqual(['body-entry']);
    const scope = resolveEditorScope(
      store.draft.value.agent,
      store.selectedFlow!,
      store.scopePath.value,
      builtinNodeRegistry,
    )!;
    let adapted = toVueFlow(
      scope.graph,
      scope.resolved,
      new Set(['body-entry']),
      new Set(),
      {},
      new Set(store.selectedNodeIds.value),
      store.selectedEdgeId.value,
    );
    expect(adapted.nodes.find((node) => node.id === 'body-entry')).toMatchObject({
      selected: true,
      data: { invalid: true },
    });

    focus({ kind: 'EDGE', flowId: 'accumulate/loop', edgeId: 'body-item-add' });
    adapted = toVueFlow(scope.graph, scope.resolved, new Set(), new Set(), {}, new Set(), store.selectedEdgeId.value);
    expect(adapted.edges.find((edge) => edge.id === 'body-item-add')?.selected).toBe(true);
    expect(store.focusRequest.value).toMatchObject({ scopeKey: 'accumulate/loop', edgeId: 'body-item-add' });
    focus({ kind: 'FLOW', flowId: 'accumulate/loop' });
    expect(store.currentScopeKey).toBe('accumulate/loop');
  });

  it('derives Run Flow and For Each ports from authoritative signatures', () => {
    const preset = fixture('nested-subflow');
    const caller = preset.agent.flows.find((flow) => flow.nodes.some((node) => node.type === 'control.run-flow'))!;
    const resolved = resolveEditorPorts(preset.agent, caller, caller, builtinNodeRegistry);
    const run = caller.nodes.find((node) => node.type === 'control.run-flow')!;
    const target = preset.agent.flows.find((flow) => flow.id === run.data.flowId)!;
    expect(
      resolved
        .get(run.id)
        ?.inputs.filter((port) => port.kind === 'DATA')
        .map((port) => port.id),
    ).toEqual(target.inputs.map((port) => port.id));
    expect(
      resolved
        .get(run.id)
        ?.outputs.filter((port) => port.kind === 'DATA')
        .map((port) => port.id),
    ).toEqual(target.outputs.map((port) => port.id));
    const loopFlow = preset.agent.flows.find((flow) => flow.nodes.some((node) => node.type === 'control.for-each'))!;
    const loop = loopFlow.nodes.find((node) => node.type === 'control.for-each')!;
    const loopPorts = resolveEditorPorts(preset.agent, loopFlow, loopFlow, builtinNodeRegistry);
    expect(loopPorts.get(loop.id)?.outputs.map((port) => port.id)).toContain('items');
  });

  it('derives handles, prevents incompatible connections, and retains stale edges visibly', () => {
    const preset = fixture('minimal-observer');
    const flow = preset.agent.flows[0]!;
    const ports = resolveEditorPorts(preset.agent, flow, flow, builtinNodeRegistry);
    expect(ports.get('read-count')?.outputs.map((port) => port.id)).toContain('value');
    expect(ports.get('increment')?.outputs.map((port) => port.id)).toContain('property/value');
    expect(
      isValidConnection(
        {
          kind: 'DATA',
          source: { nodeId: 'read-count', portId: 'value' },
          target: { nodeId: 'increment', portId: 'amount' },
        },
        flow,
        ports,
      ),
    ).toBe(true);
    expect(
      isValidConnection(
        {
          kind: 'CONTROL',
          source: { nodeId: 'read-count', portId: 'value' },
          target: { nodeId: 'save-count', portId: 'in' },
        },
        flow,
        ports,
      ),
    ).toBe(false);

    const stalePreset = structuredClone(preset);
    const stale = stalePreset.agent.flows[0]!;
    stale.nodes.find((node) => node.id === 'read-count')!.data.path = null;
    stale.edges.find((candidate) => candidate.id === 'data-count-increment')!.source.portId = 'property/count';
    stalePreset.agent.stateSchema = { type: 'object', properties: {}, required: [], additionalProperties: false };
    const stalePorts = resolveEditorPorts(stalePreset.agent, stale, stale, builtinNodeRegistry);
    const adapted = toVueFlow(stale, stalePorts, new Set(), new Set());
    const edge = adapted.edges.find((candidate) => candidate.id === 'data-count-increment')!;
    expect(edge.data?.invalid).toBe(true);
    const stalePort = adapted.nodes
      .find((node) => node.id === 'read-count')
      ?.data.outputs.find((port) => port.id === 'property/count');
    expect(stalePort).toMatchObject({
      id: 'property/count',
      labelKey: 'property/count',
      literalLabel: true,
      stale: true,
    });
    adapted.nodes[0]!.position = { x: 321, y: 654 };
    adapted.nodes[0]!.selected = true;
    const roundTrip = fromVueFlow(stale, adapted.nodes, adapted.edges);
    expect(roundTrip.nodes[0]!.position).toEqual({ x: 321, y: 654 });
    expect(roundTrip.nodes[0]).not.toHaveProperty('selected');
    expect(roundTrip.edges).toEqual(stale.edges);
  });

  it('derives each node once in data-dependency order and reuses only the unchanged draft scope', () => {
    const preset = fixture('minimal-observer');
    const flow = preset.agent.flows[0]!;
    const calls: string[] = [];
    const registry: ReadonlyNodeRegistry = {
      list: () => builtinNodeRegistry.list(),
      get: (type) => {
        const definition = builtinNodeRegistry.get(type);
        if (!definition) return undefined;
        return {
          ...definition,
          ports: (data, context) => {
            calls.push(context.nodeId);
            return definition.ports(data, context);
          },
        };
      },
    };
    const cache = new EditorPortResolutionCache();
    const first = resolveEditorPorts(preset.agent, flow, flow, registry, undefined, cache);
    expect(calls).toHaveLength(flow.nodes.length);
    expect(calls.indexOf('read-count')).toBeLessThan(calls.indexOf('increment'));
    calls.length = 0;
    expect(resolveEditorPorts(preset.agent, flow, flow, registry, undefined, cache)).toBe(first);
    expect(calls).toEqual([]);

    const replacement = structuredClone(preset);
    const replacementFlow = replacement.agent.flows[0]!;
    replacementFlow.nodes.find((node) => node.id === 'increment')!.inputValues.amount = 3;
    resolveEditorPorts(replacement.agent, replacementFlow, replacementFlow, registry, undefined, cache);
    expect(calls).toHaveLength(replacementFlow.nodes.length);
  });

  it('separates cached schemas for the same agent and scope under different effective signatures', () => {
    const preset = fixture('nested-subflow');
    const flow = preset.agent.flows.find((candidate) => candidate.id === 'accumulate')!;
    const loop = flow.nodes.find((node) => node.id === 'loop')!;
    const body = loop.data.body as unknown as ScopeGraph;
    const cache = new EditorPortResolutionCache();
    const signature = (type: 'string' | 'number'): FlowSignature => ({
      inputs: [{ id: 'item', label: 'item', required: true, cardinality: 'ONE', schema: { type } }],
      outputs: [],
    });

    const strings = resolveEditorPorts(
      preset.agent,
      flow,
      body,
      builtinNodeRegistry,
      signature('string'),
      cache,
      'FOR_EACH',
    );
    const numbers = resolveEditorPorts(
      preset.agent,
      flow,
      body,
      builtinNodeRegistry,
      signature('number'),
      cache,
      'FOR_EACH',
    );
    expect(strings.get('body-entry')?.outputs.find((port) => port.id === 'item')).toMatchObject({
      kind: 'DATA',
      schema: { type: 'string' },
    });
    expect(numbers.get('body-entry')?.outputs.find((port) => port.id === 'item')).toMatchObject({
      kind: 'DATA',
      schema: { type: 'number' },
    });
  });

  it('reuses port derivation across metadata-only agent identity replacement', () => {
    const preset = fixture('minimal-observer');
    let calls = 0;
    const registry: ReadonlyNodeRegistry = {
      list: () => builtinNodeRegistry.list(),
      get: (type) => {
        const definition = builtinNodeRegistry.get(type);
        return definition
          ? {
              ...definition,
              ports: (data, context) => {
                calls += 1;
                return definition.ports(data, context);
              },
            }
          : undefined;
      },
    };
    const store = new GraphEditorStore({ executable: preset, registry, ids: ids(), apply: vi.fn() });
    const flow = store.selectedFlow!;
    calls = 0;
    const cache = new EditorPortResolutionCache();
    resolveEditorScope(store.draft.value.agent, flow, [], registry, cache);
    expect(calls).toBe(flow.nodes.length);
    calls = 0;

    store.synchronizeMetadata({ name: 'Metadata only', priority: 4, enabled: false });
    expect(store.selectedFlow).toBe(flow);
    resolveEditorScope(store.draft.value.agent, store.selectedFlow!, [], registry, cache);
    expect(calls).toBe(0);
  });

  it('resolves a nested body once and reuses it when navigating away and back in one draft', () => {
    const preset = fixture('nested-subflow');
    const flow = preset.agent.flows.find((candidate) => candidate.id === 'accumulate')!;
    const calls = new Map<string, number>();
    const registry: ReadonlyNodeRegistry = {
      list: () => builtinNodeRegistry.list(),
      get: (type) => {
        const definition = builtinNodeRegistry.get(type);
        return definition
          ? {
              ...definition,
              ports: (data, context) => {
                calls.set(context.nodeId, (calls.get(context.nodeId) ?? 0) + 1);
                return definition.ports(data, context);
              },
            }
          : undefined;
      },
    };
    const cache = new EditorPortResolutionCache();
    resolveEditorScope(preset.agent, flow, ['loop'], registry, cache);
    expect([...calls.values()].every((count) => count === 1)).toBe(true);
    const firstCalls = new Map(calls);
    resolveEditorScope(preset.agent, flow, [], registry, cache);
    resolveEditorScope(preset.agent, flow, ['loop'], registry, cache);
    expect(calls).toEqual(firstCalls);
  });

  it('derives identical schemas regardless of serialized node order and terminates cyclic invalid drafts once per node', () => {
    const preset = fixture('minimal-observer');
    const flow = preset.agent.flows[0]!;
    const reversed = structuredClone(preset);
    reversed.agent.flows[0]!.nodes.reverse();
    const schemas = (definition: GraphPreset) => {
      const target = definition.agent.flows[0]!;
      const ports = resolveEditorPorts(definition.agent, target, target, builtinNodeRegistry);
      return Object.fromEntries(
        [...ports].map(([id, resolved]) => [
          id,
          resolved.outputs.map((port) => [port.id, port.kind === 'DATA' ? port.schema : 'CONTROL']),
        ]),
      );
    };
    expect(schemas(reversed)).toEqual(schemas(preset));

    flow.edges.push({
      id: 'invalid-data-cycle',
      kind: 'DATA',
      source: { nodeId: 'increment', portId: 'property/value' },
      target: { nodeId: 'read-count', portId: 'legacy-input' },
    });
    const calls = new Map<string, number>();
    const registry: ReadonlyNodeRegistry = {
      list: () => builtinNodeRegistry.list(),
      get: (type) => {
        const definition = builtinNodeRegistry.get(type);
        return definition
          ? {
              ...definition,
              ports: (data, context) => {
                calls.set(context.nodeId, (calls.get(context.nodeId) ?? 0) + 1);
                return definition.ports(data, context);
              },
            }
          : undefined;
      },
    };
    const resolved = resolveEditorPorts(preset.agent, flow, flow, registry);
    expect(resolved.size).toBe(flow.nodes.length);
    expect([...calls.values()]).toEqual(new Array(flow.nodes.length).fill(1));
  });

  it('keeps viewport and transient run diagnostics outside serialized drafts', () => {
    const store = new GraphEditorStore({
      executable: fixture('minimal-observer'),
      registry: builtinNodeRegistry,
      ids: ids(),
      apply: vi.fn(),
    });
    const serialized = JSON.stringify(store.draft.value);
    store.setViewport({ x: 12, y: 15, zoom: 1.4 });
    store.setRunOverlay({
      trigger: {
        status: 'COMPLETED',
        output: { private: true },
        invocations: [{ scopeInvocationId: 'main', status: 'COMPLETED', output: { private: true } }],
      },
    });
    expect(JSON.stringify(store.draft.value)).toBe(serialized);
    expect(store.viewport).toEqual({ x: 12, y: 15, zoom: 1.4 });

    const firstScopeKey = store.currentScopeKey;
    const secondFlowId = store.createFlow('SUBFLOW');
    const secondScopeKey = store.currentScopeKey;
    store.setViewport({ x: -30, y: 45, zoom: 0.7 });
    store.selectFlow(firstScopeKey);
    expect(store.viewport).toEqual({ x: 12, y: 15, zoom: 1.4 });
    store.setViewport({ x: 90, y: 100, zoom: 2 }, secondScopeKey);
    expect(store.viewport).toEqual({ x: 12, y: 15, zoom: 1.4 });
    store.selectFlow(secondFlowId);
    expect(store.viewport).toEqual({ x: 90, y: 100, zoom: 2 });
  });

  it('keeps Vue Flow imports confined to editor modules', () => {
    const roots = ['graph', 'registry', 'nodes', 'runtime', 'host'];
    for (const root of roots) {
      const files = fs.readdirSync(new URL(`../../src/extensions/built-in/custom-agents/${root}`, import.meta.url), {
        recursive: true,
        encoding: 'utf8',
      });
      for (const file of files.filter((candidate) => candidate.endsWith('.ts'))) {
        const text = fs.readFileSync(
          new URL(`../../src/extensions/built-in/custom-agents/${root}/${file}`, import.meta.url),
          'utf8',
        );
        expect(text).not.toContain('@vue-flow');
      }
    }
  });
});
