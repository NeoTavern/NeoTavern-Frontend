import type { FlowSignature, GraphAgent, JsonObject, JsonValue } from './contracts';
import type {
  TriggerDeclaration,
  DataPortDefinition,
  PortDefinition,
  RegisteredNodeDefinition,
} from '../registry/node-definition';

export type CompiledInputBinding =
  | { kind: 'EDGE'; sourceNodeId: string; sourcePortId: string; source: Readonly<DataPortDefinition> }
  | { kind: 'INLINE'; value: JsonValue }
  | { kind: 'UNBOUND' };

export type CompiledGraphEdge = {
  id: string;
  kind: 'CONTROL' | 'DATA';
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
};

export type CompiledScopePlan = {
  id: string;
  signature: Readonly<FlowSignature>;
  nodes: readonly CompiledNodePlan[];
  edges: readonly CompiledGraphEdge[];
  entryNodeId?: string;
  returnNodeId?: string;
};

export type CompiledNodePlan = {
  id: string;
  type: string;
  data: Readonly<JsonObject>;
  definition: RegisteredNodeDefinition;
  inputs: readonly PortDefinition[];
  outputs: readonly PortDefinition[];
  inputBindings: Readonly<Record<string, CompiledInputBinding>>;
  incomingControl: readonly CompiledGraphEdge[];
  outgoingControl: Readonly<Record<string, readonly CompiledGraphEdge[]>>;
  outgoingData: Readonly<Record<string, readonly CompiledGraphEdge[]>>;
  targetFlowId?: string;
  targetPlan?: CompiledFlowPlan;
  bodyPlan?: CompiledScopePlan;
};

export type CompiledFlowPlan = CompiledScopePlan & {
  name: string;
  kind: 'TRIGGER' | 'SUBFLOW';
  trigger?: Readonly<TriggerDeclaration>;
};

export type CompiledAgentPlan = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  configurationSchema: Readonly<JsonObject>;
  stateSchema: Readonly<JsonObject>;
  flows: readonly CompiledFlowPlan[];
};

export type CompiledPresetPlan = {
  format: 'NEOTAVERN_CUSTOM_AGENT_FLOW';
  agent: CompiledAgentPlan;
};

export type ValidatedGraphPreset = {
  preset: Readonly<{ format: 'NEOTAVERN_CUSTOM_AGENT_FLOW'; agent: Readonly<GraphAgent> }>;
  resolvedFlows: readonly CompiledFlowPlan[];
};
