import type { JsonObject, JsonValue } from '../generic/json';
import type { ViewDefinition } from '../views/contracts';

export type { JsonObject, JsonPrimitive, JsonValue } from '../generic/json';

export const GRAPH_PRESET_FORMAT = 'NEOTAVERN_CUSTOM_AGENT_FLOW' as const;
export const GRAPH_NODE_MIN_WIDTH = 320;
export const GRAPH_NODE_MIN_HEIGHT = 96;

export type PortCardinality = 'ONE' | 'MANY';

export type FlowPortDeclaration = {
  id: string;
  label: string;
  required: boolean;
  cardinality: 'ONE';
  schema: JsonObject;
};

export type FlowSignature = {
  inputs: FlowPortDeclaration[];
  outputs: FlowPortDeclaration[];
};

export type GraphNode<TData = JsonObject> = {
  id: string;
  type: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  data: TData;
  inputValues: Record<string, JsonValue>;
};

export type GraphEdge = {
  id: string;
  kind: 'CONTROL' | 'DATA';
  source: { nodeId: string; portId: string };
  target: { nodeId: string; portId: string };
};

export type ScopeGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphFlow = FlowSignature & {
  id: string;
  name: string;
  kind: 'TRIGGER' | 'SUBFLOW';
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type GraphAgent = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  configurationSchema: JsonObject;
  configurationDefaults: JsonObject;
  stateSchema: JsonObject;
  initialState: JsonObject;
  flows: GraphFlow[];
  views: ViewDefinition[];
};

export type GraphPreset = {
  format: typeof GRAPH_PRESET_FORMAT;
  agent: GraphAgent;
};
