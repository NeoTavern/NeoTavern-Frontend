import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GraphEditorStore } from '../../src/extensions/built-in/custom-agents/editor/editor-store';
import type { GraphPreset } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';

const fixture = () =>
  JSON.parse(fs.readFileSync('test/fixtures/custom-agents/minimal-observer.flow.json', 'utf8')) as GraphPreset;

describe('transient graph run overlay', () => {
  it('bounds records and output/error inspection without changing drafts, apply, or exportable definitions', () => {
    const definition = fixture();
    const store = new GraphEditorStore({
      executable: definition,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'overlay-id' },
      apply: vi.fn(),
    });
    const before = structuredClone(store.draft.value);
    store.setRunOverlay(
      Object.fromEntries(
        Array.from({ length: 205 }, (_, index) => [
          `node-${index}`,
          index === 204
            ? {
                status: 'FAILED' as const,
                error: 'failure',
                invocations: [{ scopeInvocationId: 'main:205', status: 'FAILED' as const, error: 'failure' }],
              }
            : {
                status: 'COMPLETED' as const,
                output: { index },
                invocations: [
                  { scopeInvocationId: `main:${index + 1}`, status: 'COMPLETED' as const, output: { index } },
                ],
              },
        ]),
      ),
    );
    expect(Object.keys(store.runOverlay.value)).toHaveLength(200);
    expect(store.runOverlay.value['node-204']).toEqual({
      status: 'FAILED',
      error: 'failure',
      invocations: [{ scopeInvocationId: 'main:205', status: 'FAILED', error: 'failure' }],
    });
    expect(store.draft.value).toEqual(before);
    expect(store.executable.value).toEqual(definition);
    expect(JSON.stringify(store.executable.value)).not.toContain('runOverlay');
    store.clearRunOverlay();
    expect(store.runOverlay.value).toEqual({});
  });
});
