import { describe, expect, it, vi } from 'vitest';
import type { GraphCustomAgentsRuntime } from '../../src/extensions/built-in/custom-agents/host/runtime';
import type { CustomAgentsHostAPI } from '../../src/extensions/built-in/custom-agents/host/api';
import { runGraphViewAction } from '../../src/extensions/built-in/custom-agents/views/actions';
import { runGraphManualFlow } from '../../src/extensions/built-in/custom-agents/host/generation';

vi.mock('../../src/extensions/built-in/custom-agents/host/generation', () => ({
  runGraphManualFlow: vi.fn(),
}));

describe('graph runtime view actions', () => {
  it('invokes only declared manual trigger flows and always releases the active signal', async () => {
    const signal = new AbortController().signal;
    const runtime = {
      beginManual: vi.fn(() => signal),
      finishManual: vi.fn(),
      invalidate: vi.fn(),
    } as unknown as GraphCustomAgentsRuntime;
    const api = {} as CustomAgentsHostAPI;
    await runGraphViewAction(api, runtime, 'agent', 'manual-flow', { selected: { id: 3 } });
    expect(runGraphManualFlow).toHaveBeenCalledWith(
      api,
      runtime,
      'agent',
      'manual-flow',
      { selected: { id: 3 } },
      signal,
    );
    expect(runtime.invalidate).toHaveBeenCalledOnce();
    expect(runtime.finishManual).toHaveBeenCalledWith('agent', signal);
  });

  it('releases the manual run after failures', async () => {
    vi.mocked(runGraphManualFlow).mockRejectedValueOnce(new Error('manual failed'));
    const signal = new AbortController().signal;
    const runtime = {
      beginManual: vi.fn(() => signal),
      finishManual: vi.fn(),
      invalidate: vi.fn(),
    } as unknown as GraphCustomAgentsRuntime;
    await expect(runGraphViewAction({} as CustomAgentsHostAPI, runtime, 'agent', 'manual-flow', null)).rejects.toThrow(
      'manual failed',
    );
    expect(runtime.finishManual).toHaveBeenCalledWith('agent', signal);
    expect(runtime.invalidate).not.toHaveBeenCalled();
  });
});
