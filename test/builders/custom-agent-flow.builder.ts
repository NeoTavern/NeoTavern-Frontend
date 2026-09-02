import { describe, expect, it } from 'vitest';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import type {
  GraphEdge,
  GraphFlow,
  GraphNode,
  GraphPreset,
  JsonObject,
  JsonValue,
} from '../../src/extensions/built-in/custom-agents/graph/contracts';

export const graphNode = (
  id: string,
  type: string,
  data: JsonObject = {},
  inputValues: Record<string, JsonValue> = {},
): GraphNode => ({ id, type, position: { x: 0, y: 0 }, data, inputValues });
export const graphEdge = (
  id: string,
  kind: 'CONTROL' | 'DATA',
  sourceNode: string,
  sourcePort: string,
  targetNode: string,
  targetPort: string,
): GraphEdge => ({
  id,
  kind,
  source: { nodeId: sourceNode, portId: sourcePort },
  target: { nodeId: targetNode, portId: targetPort },
});
export function customAgentFlowBuilder(): GraphPreset {
  return {
    format: 'NEOTAVERN_CUSTOM_AGENT_FLOW',
    agent: {
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      priority: 0,
      configurationSchema: { type: 'object', additionalProperties: false },
      configurationDefaults: {},
      stateSchema: { type: 'object', additionalProperties: false },
      initialState: {},
      views: [],
      flows: [
        {
          id: 'main',
          name: 'Main',
          kind: 'TRIGGER',
          inputs: [],
          outputs: [],
          nodes: [
            graphNode('trigger', 'trigger.manual', { inputSchema: { type: 'object', additionalProperties: true } }),
          ],
          edges: [],
        },
      ],
    },
  };
}
export function mainFlow(preset: GraphPreset): GraphFlow {
  return preset.agent.flows[0]!;
}
export function withRequiredBinding(mode: 'EDGE' | 'INLINE' | 'BOTH' | 'MISSING'): GraphPreset {
  const preset = customAgentFlowBuilder(),
    flow = mainFlow(preset);
  flow.nodes.push(
    graphNode('constant', 'data.constant', { value: 1 }),
    graphNode(
      'effect',
      'effect.set-state',
      { path: 'value' },
      mode === 'INLINE' || mode === 'BOTH' ? { value: 1 } : {},
    ),
  );
  flow.edges.push(graphEdge('control', 'CONTROL', 'trigger', 'out', 'effect', 'in'));
  if (mode === 'EDGE' || mode === 'BOTH')
    flow.edges.push(graphEdge('data', 'DATA', 'constant', 'value', 'effect', 'value'));
  preset.agent.stateSchema = {
    type: 'object',
    properties: { value: { type: 'number' } },
    required: ['value'],
    additionalProperties: false,
  };
  preset.agent.initialState = { value: 0 };
  return preset;
}

describe('custom-agent flow builder', () => {
  it('builds edge-only and literal-only required bindings', () => {
    expect(compileGraphPreset(withRequiredBinding('EDGE'), builtinNodeRegistry).success).toBe(true);
    expect(compileGraphPreset(withRequiredBinding('INLINE'), builtinNodeRegistry).success).toBe(true);
  });
  it('builds invalid both-present and missing required bindings', () => {
    expect(compileGraphPreset(withRequiredBinding('BOTH'), builtinNodeRegistry).success).toBe(false);
    expect(compileGraphPreset(withRequiredBinding('MISSING'), builtinNodeRegistry).success).toBe(false);
  });
});
