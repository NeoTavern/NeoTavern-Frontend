// @vitest-environment jsdom

import fs from 'node:fs';
import { createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { useVueFlow } from '@vue-flow/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FlowEditor from '../../src/extensions/built-in/custom-agents/editor/FlowEditor.vue';
import { GraphEditorStore } from '../../src/extensions/built-in/custom-agents/editor/editor-store';
import type { GraphPreset } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
vi.stubGlobal(
  'DOMMatrixReadOnly',
  class DOMMatrixReadOnlyStub {
    readonly m22 = 1;
  },
);
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn(() => ({ matches: false })),
});
HTMLElement.prototype.scrollIntoView = vi.fn();
let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.restoreAllMocks();
});

const english = JSON.parse(fs.readFileSync('locales/en.json', 'utf8')) as Record<string, unknown>;
const fixture = (name = 'minimal-observer') =>
  JSON.parse(
    fs.readFileSync(
      name === 'mythic'
        ? 'src/extensions/built-in/custom-agents/presets/mythic.flow.json'
        : `test/fixtures/custom-agents/${name}.flow.json`,
      'utf8',
    ),
  ) as GraphPreset;

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

async function mountEditor(store: GraphEditorStore, locale = 'en', localeMessages: Record<string, unknown> = english) {
  const host = document.createElement('div');
  Object.defineProperties(host, {
    clientWidth: { value: 1200 },
    clientHeight: { value: 700 },
  });
  document.body.append(host);
  const app = createApp(FlowEditor, { store, registry: builtinNodeRegistry });
  app.use(createPinia());
  app.use(
    createI18n({
      legacy: false,
      locale,
      fallbackLocale: 'en',
      messages: {
        en: english,
        ...(locale === 'en' ? {} : { [locale]: localeMessages }),
      },
    }),
  );
  app.mount(host);
  cleanup = () => {
    app.unmount();
    host.remove();
  };
  await nextTick();
  return host;
}

describe('FlowEditor component', () => {
  it('mounts the Vue-native shell and wires palette, inline node details, selection, and diagnostics', async () => {
    let sequence = 0;
    const store = new GraphEditorStore({
      executable: fixture(),
      registry: builtinNodeRegistry,
      ids: { generate: () => `ui${++sequence}` },
      apply: vi.fn(),
    });
    const host = await mountEditor(store);

    expect(host.querySelector('[aria-label="Node palette"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Flow editor actions"]')).not.toBeNull();
    const constant = [...host.querySelectorAll<HTMLButtonElement>('.custom-agent-flow__palette button')].find(
      (button) => button.textContent?.trim() === 'Constant',
    )!;
    constant.click();
    await nextTick();
    expect(store.currentGraph?.nodes.some((node) => node.id === 'ui1' && node.type === 'data.constant')).toBe(true);
    const addedNode = host.querySelector('[data-node-id="ui1"]')!;
    expect(host.querySelector('.custom-agent-flow__inspector')).toBeNull();
    expect(addedNode.querySelector('header')?.textContent?.trim()).toBe('Constant');
    expect(addedNode.textContent).toContain('Constant node.');
    expect(addedNode.textContent).toContain('Value');
    expect(addedNode.textContent).not.toContain('extensionsBuiltin.customAgents.nodes.constant');
    expect(host.querySelector('[data-node-id="ui1"] .vue-flow__handle')?.getAttribute('title')).toBe('Value (JSON)');
    store.selectedNodeIds.value = [];
    host.querySelector<HTMLElement>('[data-node-id="ui1"]')!.click();
    await nextTick();
    expect(store.selectedNodeIds.value).toEqual(['ui1']);

    const amount = host.querySelector<HTMLInputElement>('[data-node-id="increment"] input[type="number"]')!;
    amount.value = '2';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.inputValues.amount).toBe(2);

    store.selectedNodeIds.value = ['increment'];
    const inlineButton = [...host.querySelectorAll<HTMLButtonElement>('[data-node-id="increment"] button')].find(
      (button) => button.textContent?.trim() === 'Clear',
    )!;
    inlineButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(store.currentGraph?.nodes.some((node) => node.id === 'increment')).toBe(true);
    store.selectedNodeIds.value = ['read-count'];
    host
      .querySelector<HTMLElement>('[data-node-id="read-count"] [role="combobox"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(store.currentGraph?.nodes.some((node) => node.id === 'read-count')).toBe(true);

    store.updateNodeData('save-count', 'path', '');
    await nextTick();
    const diagnostic = host.querySelector<HTMLButtonElement>('.custom-agent-flow__diagnostics button');
    expect(diagnostic).not.toBeNull();
    diagnostic!.click();
    expect(store.selectedNodeIds.value).toEqual(['save-count']);
  });

  it('collapses and reopens the mounted palette and expands categories independently', async () => {
    const store = new GraphEditorStore({
      executable: fixture(),
      registry: builtinNodeRegistry,
      ids: { generate: () => 'palette-id' },
      apply: vi.fn(),
    });
    const host = await mountEditor(store);
    const palette = host.querySelector<HTMLElement>('[aria-label="Node palette"]')!;
    const dataToggle = [...palette.querySelectorAll<HTMLButtonElement>('.custom-agent-flow__category-toggle')].find(
      (button) => button.textContent?.trim() === 'Data',
    )!;
    dataToggle.click();
    await nextTick();
    expect(dataToggle.getAttribute('aria-expanded')).toBe('false');
    expect(palette.textContent).not.toContain('Constant');
    expect(palette.textContent).toContain('For Each');

    palette.querySelector<HTMLButtonElement>('button[title="Collapse Sidebar"]')!.click();
    await nextTick();
    expect(store.paletteOpen.value).toBe(false);
    expect(host.querySelector('[aria-label="Node palette"]')).toBe(palette);
    expect(host.querySelector('.custom-agent-flow__workspace')?.classList).toContain('is-palette-collapsed');
    palette.querySelector<HTMLButtonElement>('button[title="Expand Sidebar"]')!.click();
    await nextTick();
    expect(store.paletteOpen.value).toBe(true);
    expect(dataToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('spreads tall-node handles and keeps parallel edge geometry distinct through resize, selection, and layout', async () => {
    const preset = fixture();
    const ports = ['first', 'second', 'third', 'fourth'].map((id) => ({
      id,
      label: id,
      required: true,
      cardinality: 'ONE' as const,
      schema: {},
    }));
    preset.agent.flows.push({
      id: 'tall-parallel-ports',
      name: 'Tall parallel ports',
      kind: 'SUBFLOW',
      inputs: structuredClone(ports),
      outputs: structuredClone(ports),
      nodes: [
        {
          id: 'tall-source',
          type: 'scope.entry',
          position: { x: 0, y: 0 },
          size: { width: 420, height: 400 },
          data: {},
          inputValues: {},
        },
        {
          id: 'tall-target',
          type: 'scope.return',
          position: { x: 650, y: 0 },
          size: { width: 420, height: 400 },
          data: {},
          inputValues: {},
        },
      ],
      edges: [
        {
          id: 'tall-control',
          kind: 'CONTROL',
          source: { nodeId: 'tall-source', portId: 'out' },
          target: { nodeId: 'tall-target', portId: 'in' },
        },
        ...ports.map((port) => ({
          id: `tall-${port.id}`,
          kind: 'DATA' as const,
          source: { nodeId: 'tall-source', portId: port.id },
          target: { nodeId: 'tall-target', portId: port.id },
        })),
      ],
    });
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'tall-port-id' },
      apply: vi.fn(),
    });
    store.selectFlow('tall-parallel-ports');
    store.selectedNodeIds.value = ['tall-source'];
    const flowApi = useVueFlow(store.currentScopeKey);
    const updateNodeInternals = vi.spyOn(flowApi, 'updateNodeInternals');
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      if (this.classList.contains('vue-flow__handle')) return 10;
      return this.classList.contains('vue-flow__node') ? Number.parseFloat(this.style.width) || 420 : 0;
    });
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      if (this.classList.contains('vue-flow__handle')) return 10;
      return this.classList.contains('vue-flow__node') ? Number.parseFloat(this.style.height) || 400 : 0;
    });
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const renderedNode = this.classList.contains('vue-flow__node')
        ? this
        : this.closest<HTMLElement>('.vue-flow__node');
      if (!renderedNode) return new DOMRect(0, 0, 1200, 700);
      const nodeId = renderedNode.querySelector<HTMLElement>('[data-node-id]')?.dataset.nodeId;
      const nodeX = nodeId === 'tall-target' ? 650 : 0;
      const nodeHeight = Number.parseFloat(renderedNode.style.height) || 400;
      if (this.classList.contains('vue-flow__handle')) {
        const top = (Number.parseFloat(this.style.top) / 100) * nodeHeight;
        return new DOMRect(nodeX + (this.classList.contains('source') ? 420 : 0), top, 10, 10);
      }
      return new DOMRect(nodeX, 0, 420, nodeHeight);
    });
    const host = await mountEditor(store);
    flowApi.updateNodeInternals(['tall-source', 'tall-target']);
    await nextTick();
    await nextTick();

    const handleTops = (nodeId: string) =>
      [...host.querySelectorAll<HTMLElement>(`[data-node-id="${nodeId}"] .vue-flow__handle`)].map((handle) =>
        Number.parseFloat(handle.style.top),
      );
    const expectDistributed = (nodeId: string) => {
      const tops = handleTops(nodeId);
      expect(tops).toHaveLength(5);
      tops.forEach((top, index) => expect(top).toBeCloseTo(((index + 1) / 6) * 100));
    };
    expectDistributed('tall-source');
    expectDistributed('tall-target');
    const edgePaths = () =>
      [...host.querySelectorAll<SVGPathElement>('.vue-flow__edge-path')].map((path) => path.getAttribute('d'));
    expect(new Set(edgePaths()).size).toBe(5);

    const edgesBeforeSelection = [...host.querySelectorAll('.vue-flow__edge')];
    host.querySelector<HTMLElement>('[data-node-id="tall-target"]')!.click();
    await nextTick();
    await nextTick();
    expect([...host.querySelectorAll('.vue-flow__edge')]).toEqual(edgesBeforeSelection);

    store.selectedNodeIds.value = ['tall-source'];
    await flowApi.setViewport({ x: 0, y: 0, zoom: 1 });
    await nextTick();
    const grip = host.querySelector<HTMLElement>('[data-node-id="tall-source"] .custom-agent-flow__resize-grip')!;
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, clientX: 0, clientY: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientX: 0, clientY: 100 }));
    await nextTick();
    expectDistributed('tall-source');
    const resizedTops = handleTops('tall-source');
    expect(500 * ((resizedTops.at(-1)! - resizedTops[0]!) / 100)).toBeCloseTo(500 * (4 / 6));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3 }));
    await nextTick();
    expect(store.currentGraph?.nodes.find((node) => node.id === 'tall-source')?.size?.height).toBe(500);
    expect(updateNodeInternals).toHaveBeenCalledWith(['tall-source']);

    host.querySelector<HTMLButtonElement>('button[title="Smart layout"]')!.click();
    await vi.waitFor(() => expect(store.currentGraph?.nodes[1]?.position.x).toBe(516));
    expect(host.querySelectorAll('.vue-flow__edge')).toHaveLength(5);
    expect(new Set(edgePaths()).size).toBe(5);
    width.mockRestore();
    height.mockRestore();
    bounds.mockRestore();
    updateNodeInternals.mockRestore();
  });

  it('keeps existing edges visible when node selection revalidates the canvas', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new GraphEditorStore({
      executable: fixture(),
      registry: builtinNodeRegistry,
      ids: { generate: () => 'selection-id' },
      apply: vi.fn(),
    });
    const host = await mountEditor(store);
    const initialEdgeCount = host.querySelectorAll('.vue-flow__edge').length;
    expect(initialEdgeCount).toBeGreaterThan(0);

    host.querySelector<HTMLElement>('[data-node-id="read-count"]')!.click();
    await nextTick();
    await nextTick();

    expect(host.querySelectorAll('.vue-flow__edge')).toHaveLength(initialEdgeCount);
    expect(warn.mock.calls.some(([message]) => String(message).includes('An edge needs a source and a target'))).toBe(
      false,
    );
    warn.mockRestore();
  });

  it('preserves untouched Mythic NodeDetails DOM and edges across unrelated selection', async () => {
    const preset = fixture('mythic');
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'mythic-selection-id' },
      apply: vi.fn(),
    });
    const flow = preset.agent.flows[0]!;
    store.selectFlow(flow.id);
    const host = await mountEditor(store);
    const selectedId = flow.nodes[0]!.id;
    const untouchedId = flow.nodes[1]!.id;
    const untouchedDetails = host.querySelector(`[data-node-id="${untouchedId}"] .custom-agent-flow__node-details`);
    const edges = [...host.querySelectorAll('.vue-flow__edge')];
    expect(untouchedDetails).not.toBeNull();
    expect(edges.length).toBeGreaterThan(0);

    host.querySelector<HTMLElement>(`[data-node-id="${selectedId}"]`)!.click();
    await nextTick();
    await nextTick();

    expect(host.querySelector(`[data-node-id="${untouchedId}"] .custom-agent-flow__node-details`)).toBe(
      untouchedDetails,
    );
    expect([...host.querySelectorAll('.vue-flow__edge')]).toEqual(edges);
  }, 20_000);

  it('previews graph-space resize at non-unit zoom, refreshes endpoints, and cancels without history', async () => {
    const preset = fixture();
    preset.agent.flows[0]!.id = 'mounted-resize-cancel';
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'mounted-resize-cancel-id' },
      apply: vi.fn(),
    });
    store.selectedNodeIds.value = ['increment'];
    const before = structuredClone(store.draft.value);
    const flowApi = useVueFlow(store.currentScopeKey);
    const updateNodeInternals = vi.spyOn(flowApi, 'updateNodeInternals');
    const host = await mountEditor(store);
    await flowApi.setViewport({ x: 0, y: 0, zoom: 0.5 });
    await nextTick();

    expect(host.querySelector('.vue-flow__transformationpane')?.getAttribute('style')).toContain('scale(0.5)');
    expect(host.querySelectorAll('.custom-agent-flow__resize-grip')).toHaveLength(1);
    const grip = host.querySelector<HTMLElement>('[data-node-id="increment"] .custom-agent-flow__resize-grip')!;
    expect(grip.tagName).toBe('BUTTON');
    const renderedNode = grip.closest<HTMLElement>('.vue-flow__node')!;
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 180, clientY: 140 }));
    await nextTick();
    await nextTick();

    expect(renderedNode.style.width).toBe('480px');
    expect(renderedNode.style.height).toBe('176px');
    expect(grip.closest('.custom-agent-flow__node')?.classList).toContain('is-height-constrained');
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.size).toBeUndefined();
    expect(store.canUndo).toBe(false);
    expect(updateNodeInternals).toHaveBeenCalledWith(['increment']);

    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    await nextTick();
    await nextTick();
    expect(grip.closest('.custom-agent-flow__node')?.classList).not.toContain('is-height-constrained');
    expect(store.draft.value).toEqual(before);
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.size).toBeUndefined();
    expect(store.canUndo).toBe(false);
    updateNodeInternals.mockRestore();
  });

  it('commits one resize after pointerup and undo restores the prior authored size', async () => {
    const preset = fixture();
    preset.agent.flows[0]!.id = 'mounted-resize-commit';
    preset.agent.flows[0]!.nodes.find((node) => node.id === 'increment')!.size = { width: 400, height: 140 };
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'mounted-resize-commit-id' },
      apply: vi.fn(),
    });
    store.selectedNodeIds.value = ['increment'];
    const before = structuredClone(store.draft.value);
    const flowApi = useVueFlow(store.currentScopeKey);
    const host = await mountEditor(store);
    await flowApi.setViewport({ x: 0, y: 0, zoom: 0.5 });
    await nextTick();

    const grip = host.querySelector<HTMLElement>('[data-node-id="increment"] .custom-agent-flow__resize-grip')!;
    const renderedNode = grip.closest<HTMLElement>('.vue-flow__node')!;
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 40, clientY: 30 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 90, clientY: 60 }));
    await nextTick();
    expect(renderedNode.style.width).toBe('500px');
    expect(renderedNode.style.height).toBe('200px');
    expect(store.draft.value).toEqual(before);
    expect(store.canUndo).toBe(false);

    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: 90, clientY: 60 }));
    await nextTick();
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.size).toEqual({
      width: 500,
      height: 200,
    });
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(store.draft.value).toEqual(before);
    expect(store.currentGraph?.nodes.find((node) => node.id === 'increment')?.size).toEqual({
      width: 400,
      height: 140,
    });
    expect(store.canUndo).toBe(false);
  });

  it('keeps authored reusable signature collisions byte-exact while translating fixed labels', async () => {
    const preset = fixture();
    preset.agent.flows.push({
      id: 'collision-flow',
      name: 'Collision flow',
      kind: 'SUBFLOW',
      inputs: [{ id: 'authored-value', label: 'value', required: true, cardinality: 'ONE', schema: {} }],
      outputs: [{ id: 'authored-input', label: 'input', required: true, cardinality: 'ONE', schema: {} }],
      nodes: [
        { id: 'collision-entry', type: 'scope.entry', position: { x: 0, y: 0 }, data: {}, inputValues: {} },
        {
          id: 'fixed-value',
          type: 'data.constant',
          position: { x: 180, y: 120 },
          data: { value: null },
          inputValues: {},
        },
        { id: 'collision-return', type: 'scope.return', position: { x: 360, y: 0 }, data: {}, inputValues: {} },
      ],
      edges: [
        {
          id: 'collision-control',
          kind: 'CONTROL',
          source: { nodeId: 'collision-entry', portId: 'out' },
          target: { nodeId: 'collision-return', portId: 'in' },
        },
      ],
    });
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'collision-id' },
      apply: vi.fn(),
    });
    store.selectFlow('collision-flow');
    const host = await mountEditor(store);
    const titles = (nodeId: string) =>
      [...host.querySelectorAll(`[data-node-id="${nodeId}"] .vue-flow__handle`)].map((handle) =>
        handle.getAttribute('title'),
      );
    expect(titles('collision-entry')).toContain('value (JSON)');
    expect(titles('collision-return')).toContain('input (JSON)');
    expect(titles('fixed-value')).toContain('Value (JSON)');
  });

  it('mounts an opened For Each body with typed handles and refreshes them in place', async () => {
    const store = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: { generate: () => 'mounted-id' },
      apply: vi.fn(),
    });
    store.selectFlow('accumulate');
    store.openBody('loop');
    const host = await mountEditor(store);
    const handleTitles = (nodeId: string) =>
      [...host.querySelectorAll(`[data-node-id="${nodeId}"] .vue-flow__handle`)].map((handle) =>
        handle.getAttribute('title'),
      );
    expect(handleTitles('body-entry')).toEqual(
      expect.arrayContaining(['Out (Control)', 'Item (Number)', 'Index (Number)', 'Accumulator (Number)']),
    );
    expect(handleTitles('body-return')).toEqual(
      expect.arrayContaining(['In (Control)', 'Value (JSON)', 'Accumulator (Number)']),
    );
    store.updateFlowPort('inputs', 'numbers', 'schema', { type: 'array', items: { type: 'string' } });
    await nextTick();
    expect(handleTitles('body-entry')).toEqual(
      expect.arrayContaining(['Out (Control)', 'Item (String)', 'Index (Number)', 'Accumulator (Number)']),
    );
    expect(store.scopePath.value).toEqual(['loop']);
  });

  it('renders visible stale handles with a translated prefix and byte-exact original port id', async () => {
    const preset = fixture();
    const flow = preset.agent.flows[0]!;
    flow.edges.find((edge) => edge.id === 'data-count-increment')!.source.portId = 'legacy/value';
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'stale-id' },
      apply: vi.fn(),
    });
    const host = await mountEditor(store, 'translated', {
      extensionsBuiltin: { customAgents: { editor: { stalePort: 'Obsolète : {label}' } } },
    });
    const titles = [...host.querySelectorAll('[data-node-id="read-count"] .vue-flow__handle')].map((handle) =>
      handle.getAttribute('title'),
    );
    expect(titles).toContain('Obsolète : legacy/value (JSON)');
  });

  it('keeps manual EVENT schema paths known inside a mounted For Each body', async () => {
    const preset = fixture('nested-subflow');
    const flow = preset.agent.flows.find((candidate) => candidate.id === 'manual-main')!;
    flow.nodes.push({
      id: 'nested-loop',
      type: 'control.for-each',
      position: { x: 700, y: 0 },
      data: {
        accumulator: false,
        body: {
          nodes: [
            { id: 'nested-entry', type: 'scope.entry', position: { x: 0, y: 0 }, data: {}, inputValues: {} },
            {
              id: 'nested-event',
              type: 'data.event',
              position: { x: 180, y: 100 },
              data: { path: 'input.numbers' },
              inputValues: {},
            },
            { id: 'nested-return', type: 'scope.return', position: { x: 360, y: 0 }, data: {}, inputValues: {} },
          ],
          edges: [
            {
              id: 'nested-control',
              kind: 'CONTROL',
              source: { nodeId: 'nested-entry', portId: 'out' },
              target: { nodeId: 'nested-return', portId: 'in' },
            },
          ],
        },
      },
      inputValues: { items: [1] },
    });
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'nested-path-id' },
      apply: vi.fn(),
    });
    store.openBody('nested-loop');
    store.selectedNodeIds.value = ['nested-event'];
    const host = await mountEditor(store);
    const nestedEvent = host.querySelector<HTMLElement>('[data-node-id="nested-event"]')!;
    const selector = nestedEvent.querySelector<HTMLElement>('[data-path-editor="select"]');
    expect(selector).not.toBeNull();
    expect(nestedEvent.querySelector('[data-path-editor="advanced"]')).toBeNull();
    selector!.querySelector<HTMLElement>('[role="combobox"]')!.click();
    await nextTick();
    expect(document.body.textContent).toContain('input.numbers');
  });

  it('mounts reusable signature controls and updates boundary handles while invalid schema text is retained', async () => {
    let sequence = 0;
    const store = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: { generate: () => `signature${++sequence}` },
      apply: vi.fn(),
    });
    store.selectFlow('accumulate');
    const host = await mountEditor(store);
    expect(host.querySelector('[aria-label="Subflow signature"]')).not.toBeNull();
    const id = store.addFlowPort('inputs')!;
    await nextTick();
    expect(host.querySelector(`[data-node-id="sub-entry"] [data-handleid="${id}"]`)).not.toBeNull();
    expect(store.updateFlowPortSchemaText('inputs', id, '{broken')).toBe(false);
    await nextTick();
    const port = host.querySelector(`[data-port-id="${id}"]`)!;
    expect(port.querySelector('textarea')?.value).toBe('{broken');
    expect(store.selectedFlow?.inputs.find((candidate) => candidate.id === id)?.schema).toEqual({});
  });

  it('mounts exact schema path selectors and Advanced fallbacks for every source mode', async () => {
    const preset = fixture();
    preset.agent.configurationSchema = {
      type: 'object',
      properties: {
        object: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        rows: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      },
      required: ['object', 'rows'],
      additionalProperties: false,
    };
    const flow = preset.agent.flows[0]!;
    flow.nodes.push(
      {
        id: 'config-object',
        type: 'data.configuration',
        position: { x: 0, y: 400 },
        data: { path: 'object' },
        inputValues: {},
      },
      {
        id: 'config-rows',
        type: 'data.configuration',
        position: { x: 0, y: 500 },
        data: { path: 'rows' },
        inputValues: {},
      },
      { id: 'event-read', type: 'data.event', position: { x: 0, y: 600 }, data: { path: 'message' }, inputValues: {} },
      { id: 'get-object', type: 'data.get', position: { x: 250, y: 400 }, data: { path: 'name' }, inputValues: {} },
      { id: 'get-array', type: 'data.get', position: { x: 250, y: 500 }, data: { path: '0.name' }, inputValues: {} },
      {
        id: 'extract',
        type: 'tool.collection.extract',
        position: { x: 500, y: 500 },
        data: {},
        inputValues: { path: 'name' },
      },
      { id: 'unknown', type: 'data.constant', position: { x: 0, y: 700 }, data: { value: {} }, inputValues: {} },
      { id: 'get-unknown', type: 'data.get', position: { x: 250, y: 700 }, data: { path: 'name' }, inputValues: {} },
    );
    flow.edges.push(
      {
        id: 'object-get',
        kind: 'DATA',
        source: { nodeId: 'config-object', portId: 'value' },
        target: { nodeId: 'get-object', portId: 'value' },
      },
      {
        id: 'array-get',
        kind: 'DATA',
        source: { nodeId: 'config-rows', portId: 'value' },
        target: { nodeId: 'get-array', portId: 'value' },
      },
      {
        id: 'array-extract',
        kind: 'DATA',
        source: { nodeId: 'config-rows', portId: 'value' },
        target: { nodeId: 'extract', portId: 'items' },
      },
      {
        id: 'unknown-get',
        kind: 'DATA',
        source: { nodeId: 'unknown', portId: 'value' },
        target: { nodeId: 'get-unknown', portId: 'value' },
      },
    );
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'path-id' },
      apply: vi.fn(),
    });
    const host = await mountEditor(store);
    const editorFor = async (nodeId: string) => {
      store.selectedNodeIds.value = [nodeId];
      await nextTick();
      return host.querySelector(`[data-node-id="${nodeId}"] [data-path-editor]`)?.getAttribute('data-path-editor');
    };
    expect(await editorFor('config-object')).toBe('select');
    expect(await editorFor('read-count')).toBe('select');
    expect(await editorFor('event-read')).toBe('select');
    expect(await editorFor('get-object')).toBe('select');
    expect(await editorFor('extract')).toBe('select');
    expect(await editorFor('get-array')).toBe('advanced');
    expect(await editorFor('get-unknown')).toBe('advanced');
  });

  it('keeps mounted offscreen canvas nodes stable across an unrelated field edit', async () => {
    const performancePreset = fixture('mythic');
    const performanceFlow = performancePreset.agent.flows[0]!;
    performanceFlow.nodes.at(-1)!.position = { x: 100_000, y: 100_000 };
    const store = new GraphEditorStore({
      executable: performancePreset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'performance-id' },
      apply: vi.fn(),
    });
    store.selectFlow(performanceFlow.id);
    const host = await mountEditor(store);
    const stableId = performanceFlow.nodes.at(-1)!.id;
    const stable = host.querySelector<HTMLElement>(`[data-node-id="${stableId}"]`)!;
    expect(stable).not.toBeNull();
    const changed = store.currentGraph!.nodes.find((node) => node.id === 'generate-assistant-analysis')!;
    store.updateNodeData(changed.id, 'prompt', `${String(changed.data.prompt)}\n`);
    await nextTick();
    expect(host.querySelector(`[data-node-id="${stableId}"]`)).toBe(stable);
  }, 20_000);

  it('lays out the mounted nested scope from measured dimensions as one command, updates internals, and fits', async () => {
    const store = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: { generate: () => 'smart-layout-id' },
      apply: vi.fn(),
    });
    store.selectFlow('accumulate');
    const rootPositionsBefore = structuredClone(
      store.currentGraph?.nodes.map(({ id, position, size }) => ({ id, position, size })),
    );
    store.openBody('loop');
    const bodyBefore = structuredClone(store.currentGraph);
    const flowApi = useVueFlow(store.currentScopeKey);
    const fitView = vi.spyOn(flowApi, 'fitView');
    const updateNodeInternals = vi.spyOn(flowApi, 'updateNodeInternals');
    const host = await mountEditor(store);
    fitView.mockClear();
    const measuredWidth = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      const nodeId = this.querySelector<HTMLElement>('[data-node-id]')?.dataset.nodeId;
      return this.classList.contains('vue-flow__node') ? (nodeId === 'body-entry' ? 720 : 320) : 0;
    });
    const measuredHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      const nodeId = this.querySelector<HTMLElement>('[data-node-id]')?.dataset.nodeId;
      return this.classList.contains('vue-flow__node') ? (nodeId === 'body-entry' ? 210 : 96) : 0;
    });

    const layoutButton = host.querySelector<HTMLButtonElement>('button[title="Smart layout"]')!;
    expect(layoutButton.disabled).toBe(false);
    layoutButton.click();
    await vi.waitFor(() => expect(fitView).toHaveBeenCalledWith({ padding: 0.15 }));

    expect(store.currentGraph?.nodes.find((node) => node.id === 'add')?.position.x).toBe(816);
    expect(store.currentGraph?.nodes.find((node) => node.id === 'body-entry')?.size).toBeUndefined();
    expect(updateNodeInternals).toHaveBeenCalledWith(['body-entry', 'add', 'body-return']);
    const arranged = structuredClone(store.currentGraph);
    layoutButton.click();
    await vi.waitFor(() => expect(fitView).toHaveBeenCalledTimes(2));
    expect(store.currentGraph).toEqual(arranged);
    store.closeBody();
    expect(store.currentGraph?.nodes.map(({ id, position, size }) => ({ id, position, size }))).toEqual(
      rootPositionsBefore,
    );
    store.openBody('loop');
    store.undo();
    expect(store.currentGraph).toEqual(bodyBefore);
    expect(store.canUndo).toBe(false);
    fitView.mockRestore();
    updateNodeInternals.mockRestore();
    measuredWidth.mockRestore();
    measuredHeight.mockRestore();
  });

  it('smart layouts every flow and nested scope as one undoable command', async () => {
    const preset = fixture('nested-subflow');
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'all-layout-id' },
      apply: vi.fn(),
    });
    store.selectFlow('accumulate');
    store.selectedNodeIds.value = ['loop'];
    const before = structuredClone(store.draft.value);
    const selectedFlowBefore = store.selectedFlowId.value;
    const scopePathBefore = [...store.scopePath.value];
    const selectedNodesBefore = [...store.selectedNodeIds.value];
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      return this.hasAttribute('data-layout-node') ? 320 : 0;
    });
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      return this.hasAttribute('data-layout-node') ? 140 : 0;
    });
    const host = await mountEditor(store);

    const layoutAllButton = host.querySelector<HTMLButtonElement>('button[title="Smart layout all flows"]')!;
    const revalidate = vi.spyOn(store, 'revalidate');
    const completeClone = vi.spyOn(globalThis, 'structuredClone');
    expect(layoutAllButton.disabled).toBe(false);
    layoutAllButton.click();
    await vi.waitFor(() => expect(store.canUndo).toBe(true));
    await vi.waitFor(() => expect(layoutAllButton.disabled).toBe(false));

    expect(store.draft.value).not.toEqual(before);
    expect(store.selectedFlowId.value).toBe(selectedFlowBefore);
    expect(store.scopePath.value).toEqual(scopePathBefore);
    expect(store.selectedNodeIds.value).toEqual(selectedNodesBefore);
    expect(revalidate).not.toHaveBeenCalled();
    expect(
      completeClone.mock.calls.some(
        ([value]) =>
          value === store.draft.value ||
          value === store.draft.value.agent ||
          (typeof value === 'object' &&
            value !== null &&
            (Object.hasOwn(value, 'agent') || Object.hasOwn(value, 'flows'))),
      ),
    ).toBe(false);
    store.undo();
    expect(store.draft.value).toEqual(before);
    expect(store.canUndo).toBe(false);
    width.mockRestore();
    height.mockRestore();
  });

  it('rejects all-scope layout results after a concurrent semantic draft replacement', async () => {
    const store = new GraphEditorStore({
      executable: fixture('nested-subflow'),
      registry: builtinNodeRegistry,
      ids: { generate: () => 'concurrent-layout-id' },
      apply: vi.fn(),
    });
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      return this.hasAttribute('data-layout-node') ? 320 : 0;
    });
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      return this.hasAttribute('data-layout-node') ? 140 : 0;
    });
    const host = await mountEditor(store);
    const replacement = structuredClone(store.draft.value);
    const replacementPositions = replacement.agent.flows.map((flow) =>
      flow.nodes.map((node) => ({ ...node.position })),
    );

    host.querySelector<HTMLButtonElement>('button[title="Smart layout all flows"]')!.click();
    store.draft.value = replacement;

    await vi.waitFor(() =>
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        'Smart layout all flows is unavailable for this agent',
      ),
    );
    expect(store.canUndo).toBe(false);
    expect(store.draft.value.agent.flows.map((flow) => flow.nodes.map((node) => node.position))).toEqual(
      replacementPositions,
    );
    width.mockRestore();
    height.mockRestore();
  });

  it('measures every offscreen Mythic generate-assistant node before layout and restores visible-only rendering', async () => {
    const preset = fixture('mythic');
    const generateAssistant = preset.agent.flows.find((candidate) => candidate.id === 'generate-assistant')!;
    for (const item of generateAssistant.nodes.filter((candidate) => candidate.type === 'data.unpack-object')) {
      item.position = { x: 100_000, y: 100_000 };
    }
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'mythic-layout-id' },
      apply: vi.fn(),
    });
    store.selectFlow(generateAssistant.id);
    const flowApi = useVueFlow(store.currentScopeKey);
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      return this.classList.contains('vue-flow__node') ? 360 : 0;
    });
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      const nodeId = this.querySelector<HTMLElement>('[data-node-id]')?.dataset.nodeId;
      const item = generateAssistant.nodes.find((candidate) => candidate.id === nodeId);
      return this.classList.contains('vue-flow__node') ? (item?.type === 'data.unpack-object' ? 720 : 140) : 0;
    });
    const renderAllStates: Array<string | undefined> = [];
    let canvas: HTMLElement | undefined;
    const originalUpdateInternals = flowApi.updateNodeInternals;
    const updateNodeInternals = vi.spyOn(flowApi, 'updateNodeInternals').mockImplementation((ids) => {
      renderAllStates.push(canvas?.dataset.renderAllNodes);
      return originalUpdateInternals(ids);
    });
    const host = await mountEditor(store);
    canvas = host.querySelector<HTMLElement>('.custom-agent-flow__canvas')!;
    await flowApi.setViewport({ x: 0, y: 0, zoom: 1 });
    await nextTick();
    await nextTick();
    for (const item of generateAssistant.nodes) {
      Object.assign(flowApi.findNode(item.id)!.dimensions, { width: 0, height: 0 });
    }
    expect(
      generateAssistant.nodes
        .filter((item) => item.type === 'data.unpack-object')
        .every(
          (item) =>
            item.position.x === 100_000 &&
            flowApi.findNode(item.id)!.dimensions.width === 0 &&
            flowApi.findNode(item.id)!.dimensions.height === 0,
        ),
    ).toBe(true);

    const layoutButton = host.querySelector<HTMLButtonElement>('button[title="Smart layout"]')!;
    layoutButton.click();
    await nextTick();
    expect(layoutButton.disabled).toBe(true);
    expect(layoutButton.getAttribute('aria-busy')).toBe('true');
    layoutButton.click();
    await vi.waitFor(() => expect(canvas!.dataset.renderAllNodes).toBeUndefined());
    await vi.waitFor(() => expect(store.canUndo).toBe(true));

    expect(renderAllStates[0]).toBe('true');
    expect(updateNodeInternals).toHaveBeenCalledTimes(2);
    const rectangles = store.currentGraph!.nodes.map((item) => {
      const measured = flowApi.findNode(item.id)!.dimensions;
      return { ...item.position, width: measured.width, height: measured.height };
    });
    expect(
      store
        .currentGraph!.nodes.filter((item) => item.type === 'data.unpack-object')
        .every((item) => flowApi.findNode(item.id)!.dimensions.height === 720),
    ).toBe(true);
    for (let left = 0; left < rectangles.length; left++) {
      for (let right = left + 1; right < rectangles.length; right++) {
        expect(overlaps(rectangles[left]!, rectangles[right]!)).toBe(false);
      }
    }
    expect(host.querySelector('[role="status"]')).toBeNull();
    updateNodeInternals.mockRestore();
    width.mockRestore();
    height.mockRestore();
  }, 20_000);

  it('restores visible-only rendering and preserves history when mounted measurement is unavailable', async () => {
    const store = new GraphEditorStore({
      executable: fixture(),
      registry: builtinNodeRegistry,
      ids: { generate: () => 'failed-layout-id' },
      apply: vi.fn(),
    });
    const before = structuredClone(store.draft.value);
    const flowApi = useVueFlow(store.currentScopeKey);
    const host = await mountEditor(store);
    for (const item of store.currentGraph!.nodes) {
      Object.assign(flowApi.findNode(item.id)!.dimensions, { width: 640, height: 480 });
    }
    const canvas = host.querySelector<HTMLElement>('.custom-agent-flow__canvas')!;
    host.querySelector<HTMLButtonElement>('button[title="Smart layout"]')!.click();
    await vi.waitFor(() =>
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        'Smart layout could not measure every node in the active scope',
      ),
    );

    expect(canvas.dataset.renderAllNodes).toBeUndefined();
    expect(store.draft.value).toEqual(before);
    expect(store.canUndo).toBe(false);
  });

  it('disables Smart layout with an accessible cyclic-scope reason', async () => {
    const preset = fixture();
    const flow = preset.agent.flows[0]!;
    flow.edges.push({
      id: 'cycle-save-trigger',
      kind: 'DATA',
      source: { nodeId: 'save-count', portId: 'value' },
      target: { nodeId: 'trigger', portId: 'input' },
    });
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'cyclic-layout-id' },
      apply: vi.fn(),
    });
    const host = await mountEditor(store);
    const reason = 'Smart layout is unavailable because the active scope contains a cycle';
    const layoutButton = host.querySelector<HTMLButtonElement>(`button[title="${reason}"]`)!;
    expect(layoutButton.disabled).toBe(true);
    expect(layoutButton.getAttribute('aria-label')).toBe(reason);
  });

  it('retains invalid JSON text, omits optional conditions, canonicalizes modes, and drives Vue Flow deletion/fit', async () => {
    const preset = fixture('generation-agent');
    const apply = vi.fn();
    const store = new GraphEditorStore({
      executable: preset,
      registry: builtinNodeRegistry,
      ids: { generate: () => 'interaction-id' },
      apply,
    });
    const trigger = store.currentGraph!.nodes.find((node) => node.type === 'trigger.generate-assistant')!;
    store.selectedNodeIds.value = [trigger.id];
    store.updateNodeData(trigger.id, 'condition', { op: 'exists', reference: { $ref: 'event.generationId' } });
    expect(store.apply()).toBe(true);
    apply.mockClear();
    const host = await mountEditor(store);
    const condition = host.querySelector<HTMLTextAreaElement>(`[data-node-id="${trigger.id}"] textarea`)!;
    condition.value = '{';
    condition.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(condition.value).toBe('{');
    expect(store.currentGraph?.nodes.find((node) => node.id === trigger.id)?.data.condition).toEqual({
      op: 'exists',
      reference: { $ref: 'event.generationId' },
    });
    expect(store.isDirty.value).toBe(true);
    expect(store.canApply.value).toBe(false);
    const applyButton = host.querySelector<HTMLButtonElement>('button[title="Apply valid draft"]')!;
    expect(applyButton.disabled).toBe(true);
    applyButton.click();
    expect(apply).not.toHaveBeenCalled();

    const otherNode = store.currentGraph!.nodes.find((candidate) => candidate.id !== trigger.id)!;
    store.selectedNodeIds.value = [otherNode.id];
    await nextTick();
    store.selectedNodeIds.value = [trigger.id];
    await nextTick();
    const restoredCondition = host.querySelector<HTMLTextAreaElement>(`[data-node-id="${trigger.id}"] textarea`)!;
    expect(restoredCondition.value).toBe('{');
    restoredCondition.value = '{"op":"exists","reference":{"$ref":"event.message"}}';
    restoredCondition.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(store.canApply.value).toBe(true);
    expect(applyButton.disabled).toBe(false);
    applyButton.click();
    await nextTick();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(
      store.executable.value.agent.flows[0]!.nodes.find((candidate) => candidate.id === trigger.id)?.data.condition,
    ).toEqual({ op: 'exists', reference: { $ref: 'event.message' } });

    store.updateNodeData(trigger.id, 'condition', { op: 'exists', reference: { $ref: 'event.generationId' } });
    await nextTick();
    host.querySelector<HTMLButtonElement>('button[title="Omit optional value"]')!.click();
    await nextTick();
    expect(store.currentGraph?.nodes.find((node) => node.id === trigger.id)?.data).not.toHaveProperty('condition');

    const checkbox = (label: string) =>
      [...host.querySelectorAll<HTMLLabelElement>('.checkbox-label')]
        .find((candidate) => candidate.textContent?.trim() === label)!
        .querySelector<HTMLInputElement>('input')!;
    checkbox('New').checked = false;
    checkbox('New').dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    checkbox('New').checked = true;
    checkbox('New').dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(store.currentGraph?.nodes.find((node) => node.id === trigger.id)?.data.generationModes).toEqual([
      'NEW',
      'REGENERATE',
      'ADD_SWIPE',
    ]);

    const canvas = host.querySelector<HTMLElement>('.custom-agent-flow__canvas')!;
    const added = store.addNode('data.constant')!;
    await nextTick();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await nextTick();
    expect(store.currentGraph?.nodes.some((node) => node.id === added)).toBe(false);
    host.querySelector<HTMLButtonElement>('button[title="Fit to view"]')!.click();
  });
});
