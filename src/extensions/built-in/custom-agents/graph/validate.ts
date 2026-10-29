import type { z } from 'zod';
import { validateAuthoredSchema, validateSchemaValue } from '../generic/schema';
import { validateViewDefinition, validateViewReferences } from '../views/schemas';
import type {
  DataPortDefinition,
  NodePortContext,
  PortDefinition,
  ReadonlyNodeRegistry,
  RegisteredNodeDefinition,
  ResolvedInputBinding,
} from '../registry/node-definition';
import type { FlowSignature, GraphEdge, GraphFlow, GraphNode, JsonObject, JsonValue, ScopeGraph } from './contracts';
import {
  agentLocation,
  compareDiagnostics,
  edgeLocation,
  errorDiagnostic,
  flowLocation,
  nodeLocation,
  portLocation,
  type GraphDiagnostic,
} from './diagnostics';
import type {
  CompiledFlowPlan,
  CompiledGraphEdge,
  CompiledInputBinding,
  CompiledNodePlan,
  CompiledScopePlan,
  ValidatedGraphPreset,
} from './plan-types';
import { arePortSchemasAssignable, schemaFromConstant, schemasCanonicallyEqual, schemaValueType } from './schema-ports';
import { parseGraphPresetShape, scopeGraphSchema } from './schemas';
import { dataDependencyOrder, forEachBodySignature } from './scope-structure';

export type GraphValidationResult =
  | { valid: true; value: ValidatedGraphPreset; diagnostics: [] }
  | { valid: false; diagnostics: GraphDiagnostic[] };

type MutableResolvedNode = {
  node: GraphNode;
  definition: RegisteredNodeDefinition;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  bindings: Record<string, CompiledInputBinding>;
  bodyPlan?: CompiledScopePlan;
  targetFlowId?: string;
};

type ResolveScopeOptions = {
  id: string;
  flow: GraphFlow;
  graph: ScopeGraph;
  signature: FlowSignature;
  scopeSignatureKind: NodePortContext['scopeSignatureKind'];
  nested: boolean;
  edgeIds: Set<string>;
};

function issuePath(parts: ReadonlyArray<PropertyKey>): string {
  return parts.reduce<string>(
    (path, part) => (typeof part === 'number' ? `${path}[${part}]` : `${path}.${String(part)}`),
    '$',
  );
}

function authoredSchemaErrors(schema: JsonObject, label: string): string[] {
  const checked = validateAuthoredSchema(schema, label);
  return checked.valid ? [] : checked.errors;
}

function schemaAccepts(schema: JsonObject, value: JsonValue): boolean {
  return validateSchemaValue(schema, value).valid;
}

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

function sortedUnique<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => compareText(key(left), key(right)));
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issuePath(issue.path)} ${issue.message}`).join('; ');
}

function validateDefinitionPorts(
  flowId: string,
  nodeId: string,
  ports: { inputs: PortDefinition[]; outputs: PortDefinition[] },
  diagnostics: GraphDiagnostic[],
): void {
  for (const [direction, list] of [
    ['INPUT', ports.inputs],
    ['OUTPUT', ports.outputs],
  ] as const) {
    const ids = new Set<string>();
    for (const port of list) {
      if (!port.id || ids.has(port.id))
        diagnostics.push(
          errorDiagnostic(
            'PORT_ID_DUPLICATE',
            `Port ID ${port.id || '(empty)'} is duplicated`,
            portLocation(flowId, nodeId, port.id || '(empty)'),
          ),
        );
      ids.add(port.id);
      if (port.direction !== direction)
        diagnostics.push(
          errorDiagnostic(
            'PORT_DIRECTION',
            `Port ${port.id} has the wrong direction`,
            portLocation(flowId, nodeId, port.id),
          ),
        );
      if (port.cardinality !== (direction === 'INPUT' ? 'ONE' : 'MANY'))
        diagnostics.push(
          errorDiagnostic(
            'PORT_CARDINALITY',
            `Port ${port.id} has invalid cardinality`,
            portLocation(flowId, nodeId, port.id),
          ),
        );
      const allowedKeys =
        port.kind === 'CONTROL'
          ? new Set(['id', 'direction', 'kind', 'cardinality', 'labelKey', 'literalLabel'])
          : new Set([
              'id',
              'direction',
              'kind',
              'cardinality',
              'required',
              'schema',
              'labelKey',
              'literalLabel',
              'inlineEditor',
              'schemaPathSource',
            ]);
      if (
        Object.keys(port).some((key) => !allowedKeys.has(key)) ||
        (port.literalLabel !== undefined && port.literalLabel !== true)
      )
        diagnostics.push(
          errorDiagnostic(
            'PORT_SHAPE',
            `Port ${port.id} contains fields outside its canonical contract`,
            portLocation(flowId, nodeId, port.id),
          ),
        );
      if (port.kind === 'CONTROL') {
        if (Object.hasOwn(port, 'required') || Object.hasOwn(port, 'schema'))
          diagnostics.push(
            errorDiagnostic(
              'CONTROL_PORT_SHAPE',
              `Control port ${port.id} cannot carry data fields`,
              portLocation(flowId, nodeId, port.id),
            ),
          );
      } else {
        for (const message of authoredSchemaErrors(port.schema, `port ${port.id}.schema`))
          diagnostics.push(errorDiagnostic('PORT_SCHEMA', message, portLocation(flowId, nodeId, port.id, 'schema')));
        const pathSource = port.schemaPathSource;
        const validSource =
          pathSource &&
          ports.inputs.some(
            (candidate) =>
              candidate.kind === 'DATA' && candidate.id === pathSource.inputPortId && candidate.id !== port.id,
          );
        if (
          (port.inlineEditor === 'SCHEMA_PATH' && !validSource) ||
          (port.inlineEditor !== 'SCHEMA_PATH' && pathSource !== undefined)
        )
          diagnostics.push(
            errorDiagnostic(
              'SCHEMA_PATH_SOURCE',
              `SCHEMA_PATH port ${port.id} must declare one existing sibling data-input source`,
              portLocation(flowId, nodeId, port.id),
            ),
          );
      }
    }
  }
}

const reservedRuntimeByType = new Map([
  ['scope.entry', 'SCOPE_ENTRY'],
  ['scope.return', 'SCOPE_RETURN'],
  ['control.run-flow', 'RUN_SUBFLOW'],
  ['control.for-each', 'FOR_EACH'],
  ['control.stop', 'STOP'],
]);
const structuralRuntimeKinds = new Set<string>(reservedRuntimeByType.values());
const reservedExecutionClassByType = new Map([
  ['control.merge-any', 'MERGE_ANY'],
  ['control.merge-all', 'MERGE_ALL'],
]);

function expectedControlPort(id: string, direction: 'INPUT' | 'OUTPUT'): PortDefinition {
  return {
    id,
    direction,
    kind: 'CONTROL',
    cardinality: direction === 'INPUT' ? 'ONE' : 'MANY',
    labelKey: id,
  };
}

function expectedDataPort(
  id: string,
  direction: 'INPUT' | 'OUTPUT',
  schema: JsonObject,
  required: boolean,
  literalLabel = false,
): DataPortDefinition {
  return {
    id,
    direction,
    kind: 'DATA',
    cardinality: direction === 'INPUT' ? 'ONE' : 'MANY',
    required,
    schema,
    labelKey: id,
    ...(literalLabel ? { literalLabel: true } : {}),
  };
}

function portsMatchContract(actual: readonly PortDefinition[], expected: readonly PortDefinition[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((port, index) => {
      const target = expected[index];
      if (
        !target ||
        port.id !== target.id ||
        port.direction !== target.direction ||
        port.kind !== target.kind ||
        port.cardinality !== target.cardinality
      )
        return false;
      if (port.kind === 'CONTROL' || target.kind === 'CONTROL') return port.kind === target.kind;
      return port.required === target.required && schemasCanonicallyEqual(port.schema, target.schema);
    })
  );
}

function hasDirectedCycle(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  kind?: 'CONTROL' | 'DATA',
): boolean {
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map([...ids].map((id) => [id, new Set<string>()]));
  for (const edge of edges)
    if ((kind === undefined || edge.kind === kind) && ids.has(edge.source.nodeId) && ids.has(edge.target.nodeId))
      outgoing.get(edge.source.nodeId)!.add(edge.target.nodeId);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const target of outgoing.get(id)!) if (visit(target)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...ids].sort().some(visit);
}

function freezeSignature(signature: FlowSignature): FlowSignature {
  return {
    inputs: signature.inputs.map((port) => ({ ...port, schema: structuredClone(port.schema) })),
    outputs: signature.outputs.map((port) => ({ ...port, schema: structuredClone(port.schema) })),
  };
}

export function validateGraphPreset(value: unknown, registry: ReadonlyNodeRegistry): GraphValidationResult {
  const shape = parseGraphPresetShape(value);
  if (!shape.success)
    return {
      valid: false,
      diagnostics: shape.issues
        .map((issue) => errorDiagnostic('PRESET_SHAPE', `${issuePath(issue.path)} ${issue.message}`, agentLocation()))
        .sort(compareDiagnostics),
    };

  const preset = shape.value;
  const agent = preset.agent;
  const diagnostics: GraphDiagnostic[] = [];
  for (const [name, schema] of [
    ['configurationSchema', agent.configurationSchema],
    ['stateSchema', agent.stateSchema],
  ] as const) {
    for (const message of authoredSchemaErrors(schema, `agent.${name}`))
      diagnostics.push(errorDiagnostic('AGENT_SCHEMA', message, agentLocation(name)));
    if (schemaValueType(schema) !== 'OBJECT')
      diagnostics.push(errorDiagnostic('AGENT_SCHEMA_ROOT', `${name} must have object type`, agentLocation(name)));
  }
  if (!schemaAccepts(agent.configurationSchema, agent.configurationDefaults))
    diagnostics.push(
      errorDiagnostic(
        'CONFIGURATION_DEFAULTS',
        'Configuration defaults do not satisfy configurationSchema',
        agentLocation('configurationDefaults'),
      ),
    );
  if (!schemaAccepts(agent.stateSchema, agent.initialState))
    diagnostics.push(
      errorDiagnostic('INITIAL_STATE', 'Initial state does not satisfy stateSchema', agentLocation('initialState')),
    );
  agent.views.forEach((view, index) => {
    const checked = validateViewDefinition(view, `agent.views[${index}]`);
    if (!checked.valid)
      for (const message of checked.errors)
        diagnostics.push(errorDiagnostic('VIEW_INVALID', message, agentLocation(`views[${index}]`)));
  });

  const flowById = new Map<string, GraphFlow>();
  const allNodeIds = new Set<string>();
  for (const flow of agent.flows) {
    if (flowById.has(flow.id))
      diagnostics.push(errorDiagnostic('FLOW_ID_DUPLICATE', `Flow ID ${flow.id} is duplicated`, flowLocation(flow.id)));
    else flowById.set(flow.id, flow);
    for (const [kind, declarations] of [
      ['input', flow.inputs],
      ['output', flow.outputs],
    ] as const) {
      const ids = new Set<string>();
      for (const declaration of declarations) {
        if (ids.has(declaration.id))
          diagnostics.push(
            errorDiagnostic(
              'FLOW_PORT_DUPLICATE',
              `${kind} port ${declaration.id} is duplicated`,
              flowLocation(flow.id, `${kind}s`),
            ),
          );
        ids.add(declaration.id);
        for (const message of authoredSchemaErrors(declaration.schema, `${kind} ${declaration.id}.schema`))
          diagnostics.push(
            errorDiagnostic('FLOW_PORT_SCHEMA', message, flowLocation(flow.id, `${kind}s.${declaration.id}.schema`)),
          );
      }
    }
    if (flow.kind === 'TRIGGER' && (flow.inputs.length || flow.outputs.length))
      diagnostics.push(
        errorDiagnostic(
          'TRIGGER_SIGNATURE',
          'Trigger flows cannot declare callable inputs or outputs',
          flowLocation(flow.id),
        ),
      );
  }
  const signatures = new Map([...flowById].map(([id, flow]) => [id, freezeSignature(flow)]));
  const resolveSubflow = (flowId: string): Readonly<FlowSignature> | undefined => {
    const flow = flowById.get(flowId);
    return flow?.kind === 'SUBFLOW' ? signatures.get(flowId) : undefined;
  };

  const collectNodeIds = (graph: ScopeGraph, flowId: string): void => {
    for (const node of graph.nodes) {
      if (allNodeIds.has(node.id))
        diagnostics.push(
          errorDiagnostic(
            'NODE_ID_DUPLICATE',
            `Node ID ${node.id} is duplicated in the agent`,
            nodeLocation(flowId, node.id),
          ),
        );
      allNodeIds.add(node.id);
      const definition = registry.get(node.type);
      if (definition?.runtime.kind === 'FOR_EACH') {
        const body = scopeGraphSchema.safeParse(node.data.body);
        if (body.success) collectNodeIds(body.data, `${flowId}/${node.id}`);
      }
    }
  };
  for (const flow of sortedUnique(agent.flows, (item) => item.id)) collectNodeIds(flow, flow.id);

  const resolveScope = (options: ResolveScopeOptions): CompiledScopePlan => {
    const { id, flow, graph, signature, scopeSignatureKind, nested, edgeIds } = options;
    const edgeShapes = new Set<string>();
    for (const edge of sortedUnique(graph.edges, (item) => item.id)) {
      if (edgeIds.has(edge.id))
        diagnostics.push(
          errorDiagnostic('EDGE_ID_DUPLICATE', `Edge ID ${edge.id} is duplicated`, edgeLocation(id, edge.id)),
        );
      edgeIds.add(edge.id);
      const shapeKey = `${edge.kind}:${edge.source.nodeId}:${edge.source.portId}:${edge.target.nodeId}:${edge.target.portId}`;
      if (edgeShapes.has(shapeKey))
        diagnostics.push(
          errorDiagnostic('EDGE_DUPLICATE', 'Duplicate edge endpoints are not allowed', edgeLocation(id, edge.id)),
        );
      edgeShapes.add(shapeKey);
    }
    const controlCycle = hasDirectedCycle(graph.nodes, graph.edges, 'CONTROL');
    const dataCycle = hasDirectedCycle(graph.nodes, graph.edges, 'DATA');
    if (controlCycle)
      diagnostics.push(errorDiagnostic('CONTROL_CYCLE', 'Control edges must be acyclic', flowLocation(id)));
    if (!controlCycle && !dataCycle && hasDirectedCycle(graph.nodes, graph.edges))
      diagnostics.push(
        errorDiagnostic(
          'MIXED_DEPENDENCY_CYCLE',
          'Combined control and data dependencies must be acyclic',
          flowLocation(id),
        ),
      );

    const resolved = new Map<string, MutableResolvedNode>();
    const { ordered, cyclic } = dataDependencyOrder(graph.nodes, graph.edges);
    if (cyclic) diagnostics.push(errorDiagnostic('DATA_CYCLE', 'Data edges must be acyclic', flowLocation(id)));
    for (const node of ordered) {
      const definition = registry.get(node.type);
      if (!definition) {
        diagnostics.push(
          errorDiagnostic('NODE_TYPE_UNKNOWN', `Unknown node type ${node.type}`, nodeLocation(id, node.id)),
        );
        continue;
      }
      const parsedData = definition.dataSchema.safeParse(node.data);
      if (!parsedData.success) {
        diagnostics.push(
          errorDiagnostic('NODE_DATA_INVALID', zodMessage(parsedData.error), nodeLocation(id, node.id, 'data')),
        );
        continue;
      }
      const incomingFor = (portId: string): GraphEdge[] =>
        sortedUnique(
          graph.edges.filter(
            (edge) => edge.kind === 'DATA' && edge.target.nodeId === node.id && edge.target.portId === portId,
          ),
          (edge) => edge.id,
        );
      const resolveBinding = (portId: string): ResolvedInputBinding => {
        const incoming = incomingFor(portId);
        if (incoming.length) {
          const edge = incoming[0]!;
          const source = resolved
            .get(edge.source.nodeId)
            ?.outputs.find(
              (port): port is DataPortDefinition =>
                port.kind === 'DATA' && port.direction === 'OUTPUT' && port.id === edge.source.portId,
            );
          if (source) return { kind: 'EDGE', source };
        }
        if (Object.hasOwn(node.inputValues, portId)) return { kind: 'INLINE', value: node.inputValues[portId]! };
        return { kind: 'UNBOUND' };
      };
      const baseContext = (nestedReturnSources: ReadonlyMap<string, DataPortDefinition>): NodePortContext => ({
        agent,
        flow,
        nodeId: node.id,
        scopeSignature: signature,
        scopeSignatureKind,
        resolveSubflow,
        resolveInputBinding: resolveBinding,
        resolveNestedReturnSource: (returnPortId) => nestedReturnSources.get(returnPortId),
      });
      let bodyPlan: CompiledScopePlan | undefined;
      let nestedReturnSources = new Map<string, DataPortDefinition>();
      let ports: { inputs: PortDefinition[]; outputs: PortDefinition[] };
      try {
        ports = definition.ports(parsedData.data, baseContext(nestedReturnSources));
        if (definition.runtime.kind === 'FOR_EACH') {
          const bodyShape = scopeGraphSchema.safeParse(parsedData.data.body);
          if (!bodyShape.success) throw new Error(`FOR_EACH body is invalid: ${zodMessage(bodyShape.error)}`);
          const itemsBinding = resolveBinding('items');
          const itemsSchema =
            itemsBinding.kind === 'EDGE'
              ? itemsBinding.source.schema
              : itemsBinding.kind === 'INLINE'
                ? schemaFromConstant(itemsBinding.value)
                : {};
          const accumulatorBinding = resolveBinding('initialAccumulator');
          const accumulatorSchema =
            accumulatorBinding.kind === 'EDGE'
              ? accumulatorBinding.source.schema
              : accumulatorBinding.kind === 'INLINE'
                ? schemaFromConstant(accumulatorBinding.value)
                : {};
          const bodySignature = forEachBodySignature(
            itemsSchema,
            parsedData.data.accumulator === true ? accumulatorSchema : undefined,
          );
          bodyPlan = resolveScope({
            id: `${id}/${node.id}`,
            flow,
            graph: bodyShape.data,
            signature: bodySignature,
            scopeSignatureKind: 'FOR_EACH',
            nested: true,
            edgeIds,
          });
          const returnNode = bodyPlan.nodes.find((candidate) => candidate.definition.runtime.kind === 'SCOPE_RETURN');
          if (returnNode)
            for (const [portId, binding] of Object.entries(returnNode.inputBindings))
              if (binding.kind === 'EDGE') nestedReturnSources.set(portId, binding.source);
          ports = definition.ports(parsedData.data, baseContext(nestedReturnSources));
        }
      } catch (error) {
        diagnostics.push(
          errorDiagnostic(
            'PORT_RESOLUTION',
            error instanceof Error ? error.message : String(error),
            nodeLocation(id, node.id),
          ),
        );
        continue;
      }
      validateDefinitionPorts(id, node.id, ports, diagnostics);
      const bindings: Record<string, CompiledInputBinding> = {};
      for (const port of ports.inputs)
        if (port.kind === 'DATA') {
          const incoming = incomingFor(port.id);
          const inline = Object.hasOwn(node.inputValues, port.id);
          if (incoming.length) {
            const edge = incoming[0]!;
            const source = resolved
              .get(edge.source.nodeId)
              ?.outputs.find(
                (candidate): candidate is DataPortDefinition =>
                  candidate.kind === 'DATA' && candidate.direction === 'OUTPUT' && candidate.id === edge.source.portId,
              );
            bindings[port.id] = source
              ? { kind: 'EDGE', sourceNodeId: edge.source.nodeId, sourcePortId: edge.source.portId, source }
              : { kind: 'UNBOUND' };
          } else if (inline) bindings[port.id] = { kind: 'INLINE', value: node.inputValues[port.id]! };
          else bindings[port.id] = { kind: 'UNBOUND' };
        }
      resolved.set(node.id, {
        node: { ...node, data: parsedData.data },
        definition,
        inputs: ports.inputs,
        outputs: ports.outputs,
        bindings,
        ...(bodyPlan ? { bodyPlan } : {}),
        ...(definition.runtime.kind === 'RUN_SUBFLOW' && typeof parsedData.data.flowId === 'string'
          ? { targetFlowId: parsedData.data.flowId }
          : {}),
      });
    }

    const entryNodes = [...resolved.values()].filter((item) => item.definition.runtime.kind === 'SCOPE_ENTRY');
    const returnNodes = [...resolved.values()].filter((item) => item.definition.runtime.kind === 'SCOPE_RETURN');
    const triggerNodes = [...resolved.values()].filter((item) => item.definition.runtime.kind === 'TRIGGER');
    if (nested || flow.kind === 'SUBFLOW') {
      if (entryNodes.length !== 1)
        diagnostics.push(
          errorDiagnostic('SCOPE_ENTRY_COUNT', 'A reusable scope requires exactly one scope entry', flowLocation(id)),
        );
      if (returnNodes.length !== 1)
        diagnostics.push(
          errorDiagnostic('SCOPE_RETURN_COUNT', 'A reusable scope requires exactly one scope return', flowLocation(id)),
        );
      if (triggerNodes.length)
        diagnostics.push(
          errorDiagnostic('TRIGGER_IN_SCOPE', 'Reusable scopes cannot contain trigger nodes', flowLocation(id)),
        );
    } else {
      if (triggerNodes.length !== 1)
        diagnostics.push(
          errorDiagnostic('TRIGGER_COUNT', 'A trigger flow requires exactly one trigger node', flowLocation(id)),
        );
      if (entryNodes.length || returnNodes.length)
        diagnostics.push(
          errorDiagnostic('BOUNDARY_IN_TRIGGER', 'Scope boundaries are invalid in trigger flows', flowLocation(id)),
        );
    }

    const compiledEdges: CompiledGraphEdge[] = [];
    for (const edge of sortedUnique(graph.edges, (item) => item.id)) {
      const sourceNode = resolved.get(edge.source.nodeId);
      const targetNode = resolved.get(edge.target.nodeId);
      if (!sourceNode || !targetNode) {
        diagnostics.push(
          errorDiagnostic(
            'EDGE_DANGLING_NODE',
            'Edge endpoint references an unknown or invalid node',
            edgeLocation(id, edge.id),
          ),
        );
        continue;
      }
      const sourcePort = sourceNode.outputs.find((port) => port.id === edge.source.portId);
      const targetPort = targetNode.inputs.find((port) => port.id === edge.target.portId);
      if (!sourcePort || !targetPort) {
        diagnostics.push(
          errorDiagnostic('EDGE_DANGLING_PORT', 'Edge endpoint references an unknown port', edgeLocation(id, edge.id)),
        );
        continue;
      }
      if (sourcePort.kind !== edge.kind || targetPort.kind !== edge.kind) {
        diagnostics.push(
          errorDiagnostic(
            'EDGE_KIND',
            `A ${edge.kind} edge must connect matching ${edge.kind} ports`,
            edgeLocation(id, edge.id),
          ),
        );
        continue;
      }
      if (
        sourcePort.kind === 'DATA' &&
        targetPort.kind === 'DATA' &&
        !arePortSchemasAssignable(sourcePort.schema, targetPort.schema)
      )
        diagnostics.push(
          errorDiagnostic(
            'DATA_TYPE_INCOMPATIBLE',
            `Data type ${schemaValueType(sourcePort.schema)} is not assignable to ${schemaValueType(targetPort.schema)}`,
            edgeLocation(id, edge.id),
          ),
        );
      compiledEdges.push({
        id: edge.id,
        kind: edge.kind,
        sourceNodeId: edge.source.nodeId,
        sourcePortId: edge.source.portId,
        targetNodeId: edge.target.nodeId,
        targetPortId: edge.target.portId,
      });
    }

    for (const item of sortedUnique([...resolved.values()], (candidate) => candidate.node.id)) {
      const { node, definition, inputs, outputs, bindings } = item;
      if (definition.executionClass === 'PURE_DATA' && [...inputs, ...outputs].some((port) => port.kind === 'CONTROL'))
        diagnostics.push(
          errorDiagnostic(
            'PURE_DATA_CONTROL_PORT',
            'Pure data nodes cannot declare control ports',
            nodeLocation(id, node.id),
          ),
        );

      const expectedRuntime = reservedRuntimeByType.get(node.type);
      const runtimeReservedForAnotherType =
        structuralRuntimeKinds.has(definition.runtime.kind) && definition.runtime.kind !== expectedRuntime;
      if ((expectedRuntime && definition.runtime.kind !== expectedRuntime) || runtimeReservedForAnotherType)
        diagnostics.push(
          errorDiagnostic(
            'STRUCTURAL_RUNTIME_MAPPING',
            `Node type ${node.type} has invalid structural runtime ${definition.runtime.kind}`,
            nodeLocation(id, node.id),
          ),
        );
      if (expectedRuntime && (definition.executionClass !== 'CONTROLLED' || definition.category !== 'CONTROL'))
        diagnostics.push(
          errorDiagnostic(
            'STRUCTURAL_EXECUTION_MAPPING',
            `Node type ${node.type} must be a controlled structural node`,
            nodeLocation(id, node.id),
          ),
        );

      const expectedExecutionClass = reservedExecutionClassByType.get(node.type);
      const mergeClassReservedForAnotherType =
        (definition.executionClass === 'MERGE_ANY' || definition.executionClass === 'MERGE_ALL') &&
        definition.executionClass !== expectedExecutionClass;
      if (
        (expectedExecutionClass &&
          (definition.executionClass !== expectedExecutionClass ||
            definition.runtime.kind !== 'EXECUTOR' ||
            definition.category !== 'CONTROL')) ||
        mergeClassReservedForAnotherType
      )
        diagnostics.push(
          errorDiagnostic(
            'MERGE_EXECUTION_MAPPING',
            `Node type ${node.type} has invalid merge execution mapping`,
            nodeLocation(id, node.id),
          ),
        );

      const isTrigger = definition.runtime.kind === 'TRIGGER';
      if (
        (definition.category === 'TRIGGER') !== isTrigger ||
        (isTrigger && definition.executionClass !== 'CONTROLLED')
      )
        diagnostics.push(
          errorDiagnostic(
            'TRIGGER_RUNTIME_MAPPING',
            'Trigger category, runtime, and execution class must agree',
            nodeLocation(id, node.id),
          ),
        );
      if (!isTrigger && !expectedRuntime && !expectedExecutionClass && definition.runtime.kind !== 'EXECUTOR')
        diagnostics.push(
          errorDiagnostic(
            'EXECUTOR_RUNTIME_MAPPING',
            'Ordinary nodes must use the EXECUTOR runtime',
            nodeLocation(id, node.id),
          ),
        );

      let expectedInputs: PortDefinition[] | undefined;
      let expectedOutputs: PortDefinition[] | undefined;
      if (definition.runtime.kind === 'TRIGGER') {
        const eventPort = outputs.find(
          (port): port is DataPortDefinition => port.kind === 'DATA' && port.id === 'event',
        );
        const eventSchema =
          eventPort && schemaValueType(eventPort.schema) === 'OBJECT' ? eventPort.schema : { type: 'object' };
        expectedInputs = [];
        const builtinTriggerExtras: Readonly<Record<string, readonly string[]>> = {
          'trigger.after-user': ['message'],
          'trigger.before-generation': ['generationMode', 'targetMessage'],
          'trigger.generate-assistant': ['generationMode', 'targetMessage'],
          'trigger.after-generation': ['generationMode', 'message'],
          'trigger.manual': ['input'],
        };
        const extraIds = builtinTriggerExtras[node.type] ?? [];
        expectedOutputs = [
          expectedControlPort('out', 'OUTPUT'),
          expectedDataPort('event', 'OUTPUT', eventSchema, true),
          ...extraIds.map((portId) => {
            const port = outputs.find((candidate) => candidate.kind === 'DATA' && candidate.id === portId);
            return expectedDataPort(portId, 'OUTPUT', port && port.kind === 'DATA' ? port.schema : {}, true);
          }),
        ];
      } else if (node.type === 'scope.entry') {
        expectedInputs = [];
        expectedOutputs = [
          expectedControlPort('out', 'OUTPUT'),
          ...signature.inputs.map((port) =>
            expectedDataPort(port.id, 'OUTPUT', port.schema, port.required, scopeSignatureKind === 'AUTHORED'),
          ),
        ];
      } else if (node.type === 'scope.return') {
        expectedInputs = [
          expectedControlPort('in', 'INPUT'),
          ...signature.outputs.map((port) =>
            expectedDataPort(port.id, 'INPUT', port.schema, port.required, scopeSignatureKind === 'AUTHORED'),
          ),
        ];
        expectedOutputs = [];
      } else if (node.type === 'control.run-flow') {
        const target = typeof node.data.flowId === 'string' ? resolveSubflow(node.data.flowId) : undefined;
        expectedInputs = [
          expectedControlPort('in', 'INPUT'),
          ...(target?.inputs.map((port) => expectedDataPort(port.id, 'INPUT', port.schema, port.required, true)) ?? []),
        ];
        expectedOutputs = [
          expectedControlPort('out', 'OUTPUT'),
          ...(target?.outputs.map((port) => expectedDataPort(port.id, 'OUTPUT', port.schema, port.required, true)) ??
            []),
        ];
      } else if (node.type === 'control.for-each') {
        const accumulatorEnabled = node.data.accumulator === true;
        const accumulatorBinding = bindings.initialAccumulator;
        const accumulatorSchema =
          accumulatorBinding?.kind === 'EDGE'
            ? accumulatorBinding.source.schema
            : accumulatorBinding?.kind === 'INLINE'
              ? schemaFromConstant(accumulatorBinding.value)
              : {};
        const nestedReturn = item.bodyPlan?.nodes.find(
          (candidate) => candidate.definition.runtime.kind === 'SCOPE_RETURN',
        )?.inputBindings.value;
        const returnedSchema = nestedReturn?.kind === 'EDGE' ? nestedReturn.source.schema : {};
        expectedInputs = [
          expectedControlPort('in', 'INPUT'),
          expectedDataPort('items', 'INPUT', { type: 'array' }, true),
          ...(accumulatorEnabled ? [expectedDataPort('initialAccumulator', 'INPUT', {}, true)] : []),
        ];
        expectedOutputs = [
          expectedControlPort('out', 'OUTPUT'),
          expectedDataPort('items', 'OUTPUT', { type: 'array', items: returnedSchema }, true),
          ...(accumulatorEnabled ? [expectedDataPort('accumulator', 'OUTPUT', accumulatorSchema, true)] : []),
        ];
      } else if (node.type === 'control.stop') {
        expectedInputs = [expectedControlPort('in', 'INPUT')];
        expectedOutputs = [];
      }
      if (
        expectedInputs &&
        expectedOutputs &&
        (!portsMatchContract(inputs, expectedInputs) || !portsMatchContract(outputs, expectedOutputs))
      )
        diagnostics.push(
          errorDiagnostic(
            definition.runtime.kind === 'TRIGGER' ? 'TRIGGER_PORT_CONTRACT' : 'STRUCTURAL_PORT_CONTRACT',
            `Node type ${node.type} does not expose its exact structural ports`,
            nodeLocation(id, node.id),
          ),
        );

      const controlInputs = inputs.filter((port) => port.kind === 'CONTROL');
      if (definition.executionClass === 'CONTROLLED' && controlInputs.length > 1)
        diagnostics.push(
          errorDiagnostic(
            'CONTROL_FAN_IN_UNDECLARED',
            'Only MERGE_ANY and MERGE_ALL nodes may declare multiple control inputs',
            nodeLocation(id, node.id),
          ),
        );
      for (const key of Object.keys(node.inputValues).sort())
        if (!inputs.some((port) => port.kind === 'DATA' && port.id === key))
          diagnostics.push(
            errorDiagnostic(
              'INPUT_VALUE_STALE',
              `Inline value references unknown data input ${key}`,
              portLocation(id, node.id, key),
            ),
          );
      for (const port of inputs) {
        const incoming = compiledEdges.filter(
          (edge) => edge.targetNodeId === node.id && edge.targetPortId === port.id && edge.kind === port.kind,
        );
        if (incoming.length > 1)
          diagnostics.push(
            errorDiagnostic(
              'INPUT_FAN_IN',
              `Input ${port.id} accepts at most one edge`,
              portLocation(id, node.id, port.id),
            ),
          );
        if (port.kind === 'CONTROL') {
          if (!['TRIGGER', 'SCOPE_ENTRY'].includes(definition.runtime.kind) && incoming.length !== 1)
            diagnostics.push(
              errorDiagnostic(
                'CONTROL_INPUT_BINDING',
                `Control input ${port.id} requires exactly one edge`,
                portLocation(id, node.id, port.id),
              ),
            );
          continue;
        }
        const inline = Object.hasOwn(node.inputValues, port.id);
        if (inline && incoming.length)
          diagnostics.push(
            errorDiagnostic(
              'DATA_BINDING_CONFLICT',
              `Data input ${port.id} cannot have both an edge and inline value`,
              portLocation(id, node.id, port.id),
            ),
          );
        if (port.required && (inline ? 1 : 0) + incoming.length !== 1)
          diagnostics.push(
            errorDiagnostic(
              'DATA_BINDING_REQUIRED',
              `Required data input ${port.id} needs exactly one binding`,
              portLocation(id, node.id, port.id),
            ),
          );
        if (inline && !schemaAccepts(port.schema, node.inputValues[port.id]))
          diagnostics.push(
            errorDiagnostic(
              'INLINE_SCHEMA',
              `Inline value for ${port.id} does not satisfy its schema`,
              portLocation(id, node.id, port.id),
            ),
          );
        if (bindings[port.id]?.kind === 'UNBOUND' && incoming.length)
          diagnostics.push(
            errorDiagnostic(
              'SCHEMA_DEPENDENCY',
              `Source schema for ${port.id} could not be resolved`,
              portLocation(id, node.id, port.id),
            ),
          );
      }
      if (definition.runtime.kind === 'RUN_SUBFLOW') {
        if (!item.targetFlowId || !resolveSubflow(item.targetFlowId))
          diagnostics.push(
            errorDiagnostic(
              'SUBFLOW_TARGET',
              `Run Flow target ${item.targetFlowId ?? '(missing)'} is not a reusable subflow`,
              nodeLocation(id, node.id),
            ),
          );
      }
      if (definition.runtime.kind === 'STOP' && (nested || flow.kind === 'SUBFLOW'))
        diagnostics.push(
          errorDiagnostic('STOP_IN_SCOPE', 'Stop is invalid in reusable scopes', nodeLocation(id, node.id)),
        );
      if (definition.validate)
        diagnostics.push(
          ...definition.validate({ agent, flow, node, ports: { inputs, outputs }, edges: graph.edges, registry }),
        );
    }

    const startIds =
      nested || flow.kind === 'SUBFLOW'
        ? entryNodes.map((item) => item.node.id)
        : triggerNodes.map((item) => item.node.id);
    const controlOutgoing = new Map<string, string[]>(graph.nodes.map((node): [string, string[]] => [node.id, []]));
    for (const edge of compiledEdges)
      if (edge.kind === 'CONTROL') controlOutgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    const reachable = new Set<string>();
    const visit = (nodeId: string): void => {
      if (reachable.has(nodeId)) return;
      reachable.add(nodeId);
      for (const target of (controlOutgoing.get(nodeId) ?? []).sort()) visit(target);
    };
    startIds.forEach(visit);
    if ((nested || flow.kind === 'SUBFLOW') && returnNodes.length === 1) {
      const returnId = returnNodes[0]!.node.id;
      if (!reachable.has(returnId))
        diagnostics.push(
          errorDiagnostic(
            'SCOPE_RETURN_UNREACHABLE',
            'Scope return is not reachable from scope entry',
            nodeLocation(id, returnId),
          ),
        );
      for (const nodeId of [...reachable].sort()) {
        if (nodeId === returnId) continue;
        const item = resolved.get(nodeId);
        if (!item) continue;
        const controlOutputs = item.outputs.filter((port) => port.kind === 'CONTROL');
        if (controlOutputs.length === 0)
          diagnostics.push(
            errorDiagnostic(
              'SCOPE_PATH_NO_RETURN',
              'Reachable scope path terminates before the return',
              nodeLocation(id, nodeId),
            ),
          );
        for (const output of controlOutputs)
          if (
            !compiledEdges.some(
              (edge) => edge.kind === 'CONTROL' && edge.sourceNodeId === nodeId && edge.sourcePortId === output.id,
            )
          )
            diagnostics.push(
              errorDiagnostic(
                'SCOPE_PATH_NO_RETURN',
                `Reachable control output ${output.id} does not lead onward to the return`,
                portLocation(id, nodeId, output.id),
              ),
            );
      }
    }

    const compiledNodes: CompiledNodePlan[] = sortedUnique(
      [...resolved.values()],
      (candidate) => candidate.node.id,
    ).map((item) => {
      const incomingControl = compiledEdges.filter(
        (edge) => edge.kind === 'CONTROL' && edge.targetNodeId === item.node.id,
      );
      const outgoingRecord = (kind: 'CONTROL' | 'DATA'): Record<string, readonly CompiledGraphEdge[]> =>
        Object.fromEntries(
          item.outputs
            .filter((port) => port.kind === kind)
            .map((port) => [
              port.id,
              compiledEdges
                .filter(
                  (edge) => edge.kind === kind && edge.sourceNodeId === item.node.id && edge.sourcePortId === port.id,
                )
                .sort((a, b) => compareText(a.id, b.id)),
            ]),
        );
      return {
        id: item.node.id,
        type: item.node.type,
        data: structuredClone(item.node.data),
        definition: item.definition,
        inputs: item.inputs,
        outputs: item.outputs,
        inputBindings: item.bindings,
        incomingControl: incomingControl.sort((a, b) => compareText(a.id, b.id)),
        outgoingControl: outgoingRecord('CONTROL'),
        outgoingData: outgoingRecord('DATA'),
        ...(item.targetFlowId ? { targetFlowId: item.targetFlowId } : {}),
        ...(item.bodyPlan ? { bodyPlan: item.bodyPlan } : {}),
      };
    });
    return {
      id,
      signature: freezeSignature(signature),
      nodes: compiledNodes,
      edges: compiledEdges.sort((a, b) => compareText(a.id, b.id)),
      ...(entryNodes.length === 1 ? { entryNodeId: entryNodes[0]!.node.id } : {}),
      ...(returnNodes.length === 1 ? { returnNodeId: returnNodes[0]!.node.id } : {}),
    };
  };

  const resolvedFlows: CompiledFlowPlan[] = [];
  for (const flow of sortedUnique(agent.flows, (item) => item.id)) {
    const scope = resolveScope({
      id: flow.id,
      flow,
      graph: flow,
      signature: flow,
      scopeSignatureKind: 'AUTHORED',
      nested: false,
      edgeIds: new Set<string>(),
    });
    let trigger;
    const triggerNode = scope.nodes.find((node) => node.definition.runtime.kind === 'TRIGGER');
    if (flow.kind === 'TRIGGER' && triggerNode?.definition.runtime.kind === 'TRIGGER') {
      try {
        trigger = triggerNode.definition.runtime.getTriggerDeclaration(triggerNode.data);
      } catch (error) {
        diagnostics.push(
          errorDiagnostic(
            'TRIGGER_DECLARATION',
            error instanceof Error ? error.message : String(error),
            nodeLocation(flow.id, triggerNode.id),
          ),
        );
      }
    }
    resolvedFlows.push({ ...scope, name: flow.name, kind: flow.kind, ...(trigger ? { trigger } : {}) });
  }

  const manualFlowIds = new Set(
    resolvedFlows.filter((flow) => flow.kind === 'TRIGGER' && flow.trigger?.event === 'MANUAL').map((flow) => flow.id),
  );
  for (const message of validateViewReferences(agent.views, manualFlowIds))
    diagnostics.push(errorDiagnostic('VIEW_REFERENCE_INVALID', message, agentLocation('views')));

  const calls = new Map(resolvedFlows.map((flow) => [flow.id, new Set<string>()]));
  const collectCalls = (owner: string, scope: CompiledScopePlan): void => {
    for (const node of scope.nodes) {
      if (node.targetFlowId) calls.get(owner)?.add(node.targetFlowId);
      if (node.bodyPlan) collectCalls(owner, node.bodyPlan);
    }
  };
  resolvedFlows.forEach((flow) => collectCalls(flow.id, flow));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitCalls = (flowId: string): boolean => {
    if (visiting.has(flowId)) return true;
    if (visited.has(flowId)) return false;
    visiting.add(flowId);
    for (const target of [...(calls.get(flowId) ?? [])].sort())
      if (calls.has(target) && visitCalls(target)) return true;
    visiting.delete(flowId);
    visited.add(flowId);
    return false;
  };
  for (const flowId of [...calls.keys()].sort())
    if (visitCalls(flowId)) {
      diagnostics.push(
        errorDiagnostic('SUBFLOW_CALL_CYCLE', 'Subflow call graph must be acyclic', flowLocation(flowId)),
      );
      break;
    }

  diagnostics.sort(compareDiagnostics);
  return diagnostics.length
    ? { valid: false, diagnostics }
    : { valid: true, value: { preset, resolvedFlows }, diagnostics: [] };
}
