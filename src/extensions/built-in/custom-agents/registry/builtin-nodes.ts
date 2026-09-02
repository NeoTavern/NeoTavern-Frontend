import { NodeRegistry } from './node-registry';
import type { RegisteredNodeDefinition } from './node-definition';
import { toolNodeDefinitions } from './tool-node-adapter';
import { afterUserNodeDefinition } from '../nodes/triggers/after-user';
import { beforeGenerationNodeDefinition } from '../nodes/triggers/before-generation';
import { generateAssistantNodeDefinition } from '../nodes/triggers/generate-assistant';
import { afterGenerationNodeDefinition } from '../nodes/triggers/after-generation';
import { manualNodeDefinition } from '../nodes/triggers/manual';
import { branchNodeDefinition } from '../nodes/control/branch';
import { forEachNodeDefinition } from '../nodes/control/for-each';
import { runFlowNodeDefinition } from '../nodes/control/run-flow';
import { mergeAnyNodeDefinition } from '../nodes/control/merge-any';
import { mergeAllNodeDefinition } from '../nodes/control/merge-all';
import { stopNodeDefinition } from '../nodes/control/stop';
import { scopeEntryNodeDefinition } from '../nodes/boundary/scope-entry';
import { scopeReturnNodeDefinition } from '../nodes/boundary/scope-return';
import { constantNodeDefinition } from '../nodes/data/constant';
import { configurationNodeDefinition } from '../nodes/data/configuration';
import { stateNodeDefinition } from '../nodes/data/state';
import { eventNodeDefinition } from '../nodes/data/event';
import { getNodeDefinition } from '../nodes/data/get';
import { assertNodeDefinition } from '../nodes/data/assert';
import { unpackObjectNodeDefinition } from '../nodes/data/unpack-object';
import { objectNodeDefinition } from '../nodes/data/object';
import { arrayNodeDefinition } from '../nodes/data/array';
import { templateNodeDefinition } from '../nodes/data/template';
import { allNodeDefinition } from '../nodes/logic/all';
import { anyNodeDefinition } from '../nodes/logic/any';
import { notNodeDefinition } from '../nodes/logic/not';
import { existsNodeDefinition } from '../nodes/logic/exists';
import { inNodeDefinition } from '../nodes/logic/in';
import { llmRequestNodeDefinition } from '../nodes/llm/request';
import { setStateNodeDefinition } from '../nodes/effects/set-state';
import { removeStateNodeDefinition } from '../nodes/effects/remove-state';
import { setInjectionNodeDefinition } from '../nodes/effects/set-injection';
import { removeInjectionNodeDefinition } from '../nodes/effects/remove-injection';
import { visibleMessageNodeDefinition } from '../nodes/effects/visible-message';
import { generationResponseNodeDefinition } from '../nodes/effects/generation-response';

export const handwrittenNodeDefinitions: readonly RegisteredNodeDefinition[] = Object.freeze([
  afterUserNodeDefinition,
  beforeGenerationNodeDefinition,
  generateAssistantNodeDefinition,
  afterGenerationNodeDefinition,
  manualNodeDefinition,
  branchNodeDefinition,
  forEachNodeDefinition,
  runFlowNodeDefinition,
  mergeAnyNodeDefinition,
  mergeAllNodeDefinition,
  stopNodeDefinition,
  scopeEntryNodeDefinition,
  scopeReturnNodeDefinition,
  constantNodeDefinition,
  configurationNodeDefinition,
  stateNodeDefinition,
  eventNodeDefinition,
  getNodeDefinition,
  assertNodeDefinition,
  unpackObjectNodeDefinition,
  objectNodeDefinition,
  arrayNodeDefinition,
  templateNodeDefinition,
  allNodeDefinition,
  anyNodeDefinition,
  notNodeDefinition,
  existsNodeDefinition,
  inNodeDefinition,
  llmRequestNodeDefinition,
  setStateNodeDefinition,
  removeStateNodeDefinition,
  setInjectionNodeDefinition,
  removeInjectionNodeDefinition,
  visibleMessageNodeDefinition,
  generationResponseNodeDefinition,
]);
export const builtinNodeDefinitions: readonly RegisteredNodeDefinition[] = Object.freeze([
  ...handwrittenNodeDefinitions,
  ...toolNodeDefinitions,
]);
export function createBuiltinNodeRegistry(): NodeRegistry {
  return new NodeRegistry(builtinNodeDefinitions);
}
export const builtinNodeRegistry = createBuiltinNodeRegistry();
