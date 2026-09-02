import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GraphEditorStore } from '../../src/extensions/built-in/custom-agents/editor/editor-store';
import {
  SMART_LAYOUT_COMPONENT_GAP,
  SMART_LAYOUT_HORIZONTAL_GAP,
  SMART_LAYOUT_VERTICAL_GAP,
  smartLayout,
  smartLayoutAvailability,
  type SmartLayoutDimensions,
} from '../../src/extensions/built-in/custom-agents/editor/smart-layout';
import type { GraphPreset, ScopeGraph } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';

function node(id: string) {
  return { id, type: 'test', position: { x: 999, y: 999 }, data: {}, inputValues: {} };
}

function edge(id: string, source: string, target: string, kind: 'CONTROL' | 'DATA' = 'DATA') {
  return {
    id,
    kind,
    source: { nodeId: source, portId: 'out' },
    target: { nodeId: target, portId: 'in' },
  } as const;
}

function successful(graph: ScopeGraph, dimensions: SmartLayoutDimensions = {}) {
  const result = smartLayout(graph, {
    ...Object.fromEntries(graph.nodes.map((item) => [item.id, { width: 320, height: 96 }])),
    ...dimensions,
  });
  expect(result.available).toBe(true);
  if (!result.available) throw new Error('Expected layout to be available');
  return result.positions;
}

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

describe('smart graph layout', () => {
  it('is deterministic and ranks every CONTROL and DATA dependency left-to-right', () => {
    const graph: ScopeGraph = {
      nodes: ['source', 'data', 'control', 'join'].map(node),
      edges: [
        edge('source-data', 'source', 'data'),
        edge('source-control', 'source', 'control', 'CONTROL'),
        edge('data-join', 'data', 'join'),
        edge('control-join', 'control', 'join', 'CONTROL'),
      ],
    };
    const first = successful(graph);
    const second = successful(structuredClone(graph));
    expect(second).toEqual(first);
    for (const dependency of graph.edges) {
      expect(first[dependency.target.nodeId]!.x).toBeGreaterThan(first[dependency.source.nodeId]!.x);
    }
  });

  it('respects variable dimensions and gaps while packing weak components without overlap', () => {
    const graph: ScopeGraph = {
      nodes: ['large', 'large-target', 'isolated', 'small', 'small-target'].map(node),
      edges: [edge('large-edge', 'large', 'large-target'), edge('small-edge', 'small', 'small-target')],
    };
    const dimensions = {
      large: { width: 610, height: 240 },
      'large-target': { width: 350, height: 130 },
      isolated: { width: 470, height: 180 },
      small: { width: 320, height: 96 },
      'small-target': { width: 390, height: 160 },
    };
    const positions = successful(graph, dimensions);
    expect(positions['large-target']!.x - positions.large!.x).toBe(610 + SMART_LAYOUT_HORIZONTAL_GAP);
    const rectangles = graph.nodes.map((item) => ({
      ...positions[item.id]!,
      ...dimensions[item.id as keyof typeof dimensions],
    }));
    for (let left = 0; left < rectangles.length; left++) {
      for (let right = left + 1; right < rectangles.length; right++) {
        expect(overlaps(rectangles[left]!, rectangles[right]!)).toBe(false);
      }
    }
    expect(SMART_LAYOUT_VERTICAL_GAP).toBeGreaterThan(0);
    expect(SMART_LAYOUT_COMPONENT_GAP).toBeGreaterThan(0);
  });

  it('prioritizes CONTROL relationships and otherwise preserves serialized peer order', () => {
    const graph: ScopeGraph = {
      nodes: ['source', 'data-first', 'control-second', 'unconnected-first', 'unconnected-second'].map(node),
      edges: [edge('data-peer', 'source', 'data-first'), edge('control-peer', 'source', 'control-second', 'CONTROL')],
    };
    const positions = successful(graph);
    expect(positions['control-second']!.y).toBeLessThan(positions['data-first']!.y);
    expect(positions['unconnected-first']!.y).toBeLessThan(positions['unconnected-second']!.y);
  });

  it('uses serialized port order to break crossing-reduction ties without mutating ports', () => {
    const graph: ScopeGraph = {
      nodes: ['source', 'bottom-target', 'top-target'].map(node),
      edges: [
        {
          ...edge('top-edge', 'source', 'top-target'),
          source: { nodeId: 'source', portId: 'top' },
        },
        {
          ...edge('bottom-edge', 'source', 'bottom-target'),
          source: { nodeId: 'source', portId: 'bottom' },
        },
      ],
    };
    const portOrders = {
      source: { inputs: [], outputs: ['top', 'bottom'] },
      'bottom-target': { inputs: ['in'], outputs: [] },
      'top-target': { inputs: ['in'], outputs: [] },
    };
    const before = structuredClone(portOrders);
    const result = smartLayout(
      graph,
      Object.fromEntries(graph.nodes.map((item) => [item.id, { width: 320, height: 96 }])),
      portOrders,
    );
    expect(result.available).toBe(true);
    if (!result.available) throw new Error('Expected layout to be available');
    expect(result.positions['top-target']!.y).toBeLessThan(result.positions['bottom-target']!.y);
    expect(portOrders).toEqual(before);
  });

  it('rejects cyclic scopes and handles empty and single-node scopes', () => {
    const cyclic: ScopeGraph = {
      nodes: [node('a'), node('b')],
      edges: [edge('a-b', 'a', 'b', 'CONTROL'), edge('b-a', 'b', 'a')],
    };
    expect(smartLayoutAvailability(cyclic)).toEqual({ available: false, reason: 'CYCLIC' });
    expect(smartLayout(cyclic)).toEqual({ available: false, reason: 'CYCLIC' });
    expect(smartLayout({ nodes: [], edges: [] })).toEqual({ available: true, positions: {} });
    expect(smartLayout({ nodes: [node('missing')], edges: [] })).toEqual({
      available: false,
      reason: 'UNMEASURED',
      nodeIds: ['missing'],
    });
    expect(successful({ nodes: [node('only')], edges: [] })).toEqual({ only: { x: 0, y: 0 } });
  });

  it('commits a nested active-scope layout as one command and one undo restores all positions', () => {
    const preset = JSON.parse(
      fs.readFileSync('test/fixtures/custom-agents/nested-subflow.flow.json', 'utf8'),
    ) as GraphPreset;
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'layout-id' },
      apply: vi.fn(),
    });
    store.selectFlow('accumulate');
    const rootPositionsBefore = structuredClone(
      store.currentGraph?.nodes.map(({ id, position, size }) => ({ id, position, size })),
    );
    store.openBody('loop');
    const bodyBefore = structuredClone(store.currentGraph);
    const positions = successful(store.currentGraph!, {
      'body-entry': { width: 420, height: 140 },
      add: { width: 510, height: 210 },
    });
    store.moveNodes(positions);

    expect(store.currentGraph?.nodes.map((item) => item.position)).not.toEqual(
      bodyBefore?.nodes.map((item) => item.position),
    );
    expect(store.canUndo).toBe(true);
    store.closeBody();
    expect(store.currentGraph?.nodes.map(({ id, position, size }) => ({ id, position, size }))).toEqual(
      rootPositionsBefore,
    );
    store.openBody('loop');
    store.undo();
    expect(store.currentGraph).toEqual(bodyBefore);
    expect(store.canUndo).toBe(false);
  });
});
