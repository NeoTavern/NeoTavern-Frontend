import type { JsonValue } from '../graph/contracts';
import { runGraphManualFlow } from '../host/generation';
import type { GraphCustomAgentsRuntime } from '../host/runtime';
import type { CustomAgentsHostAPI } from '../host/api';

export async function runGraphViewAction(
  api: CustomAgentsHostAPI,
  runtime: GraphCustomAgentsRuntime,
  agentId: string,
  flowId: string,
  input: JsonValue,
): Promise<void> {
  const signal = runtime.beginManual(agentId);
  try {
    await runGraphManualFlow(api, runtime, agentId, flowId, input, signal);
    runtime.invalidate();
  } finally {
    runtime.finishManual(agentId, signal);
  }
}
