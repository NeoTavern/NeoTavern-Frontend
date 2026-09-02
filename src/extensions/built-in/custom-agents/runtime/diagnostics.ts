import type { JsonObject } from '../graph/contracts';

export type RunDiagnosticStatus = 'RUNNING' | 'COMPLETED' | 'SKIPPED' | 'FAILED' | 'CANCELLED';

export type RunDiagnostic = {
  scopeInvocationId: string;
  flowId: string;
  nodeId: string;
  status: RunDiagnosticStatus;
  output?: JsonObject;
  error?: string;
};

export type DiagnosticsObserver = (snapshot: readonly Readonly<RunDiagnostic>[]) => void;

const DIAGNOSTIC_LIMIT = 200;
const OUTPUT_LIMIT = 8_192;

function immutableSnapshot(records: RunDiagnostic[]): readonly Readonly<RunDiagnostic>[] {
  const snapshot = structuredClone(records);
  const freeze = (value: unknown, seen = new WeakSet<object>()): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  };
  freeze(snapshot);
  return snapshot;
}

function boundedOutput(value: JsonObject): JsonObject | undefined {
  const serialized = JSON.stringify(value);
  if (serialized.length > OUTPUT_LIMIT) return undefined;
  return structuredClone(value);
}

/** Invocation-local live diagnostics. They are never added to a compiled plan or graph effects. */
export class BoundedRunDiagnostics {
  readonly #records: RunDiagnostic[] = [];
  readonly #observer?: DiagnosticsObserver;

  constructor(observer?: DiagnosticsObserver) {
    this.#observer = observer;
  }

  upsert(record: RunDiagnostic): void {
    const { output, ...summary } = record;
    const bounded = output ? boundedOutput(output) : undefined;
    const retained = { ...summary, ...(bounded ? { output: bounded } : {}) };
    const existingIndex = this.#records.findIndex(
      (candidate) => candidate.scopeInvocationId === record.scopeInvocationId && candidate.nodeId === record.nodeId,
    );
    if (existingIndex !== -1) this.#records.splice(existingIndex, 1);
    this.#records.push(retained);
    if (this.#records.length > DIAGNOSTIC_LIMIT) this.#records.shift();
    this.#observer?.(this.snapshot());
  }

  snapshot(): readonly Readonly<RunDiagnostic>[] {
    return immutableSnapshot(this.#records);
  }
}
