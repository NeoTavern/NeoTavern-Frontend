// @vitest-environment jsdom

import fs from 'node:fs';
import { createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentManager from '../../src/extensions/built-in/custom-agents/settings/AgentManager.vue';
import ViewsPanel from '../../src/extensions/built-in/custom-agents/views/ViewsPanel.vue';
import { createGraphPreset } from '../../src/extensions/built-in/custom-agents/settings/management';
import {
  compileGraphAgents,
  type GraphCustomAgentsRuntime,
} from '../../src/extensions/built-in/custom-agents/host/runtime';
import type { CustomAgentsHostAPI } from '../../src/extensions/built-in/custom-agents/host/api';
import type { GraphPreset } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import { executeGraphPlan } from '../../src/extensions/built-in/custom-agents/runtime/execute-plan';
import { prepareInstalledGraphAgentsSettings } from '../../src/extensions/built-in/custom-agents/settings/store';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
HTMLElement.prototype.scrollIntoView = vi.fn();
Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });

const english = JSON.parse(fs.readFileSync('locales/en.json', 'utf8')) as Record<string, unknown>;
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function mount(component: object, props: Record<string, unknown>): HTMLElement {
  if (component === AgentManager && !props.prepared) {
    const api = props.api as CustomAgentsHostAPI;
    props = { ...props, prepared: prepareInstalledGraphAgentsSettings(api.settings.get()) };
  }
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(component, props);
  app.use(createPinia());
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en: english } }));
  app.mount(host);
  cleanups.push(() => {
    app.unmount();
    host.remove();
  });
  return host;
}

function runtimeFor(preset = createGraphPreset('mounted-agent', 'Mounted agent')): GraphCustomAgentsRuntime {
  let agents = compileGraphAgents([preset]);
  const listeners = new Set<() => void>();
  return {
    getAgents: () => agents,
    execute: vi.fn(),
    getSelectedAgentContext: vi.fn(() => undefined),
    getDiagnostics: () => [],
    clearDiagnostics: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate: () => listeners.forEach((listener) => listener()),
    replacePrepared: vi.fn((prepared) => {
      agents = prepared.agents;
      listeners.forEach((listener) => listener());
    }),
    setGenerationInjections: vi.fn(),
    beginManual: vi.fn(() => new AbortController().signal),
    finishManual: vi.fn(),
    abortManual: vi.fn(() => false),
    dispose: vi.fn(),
  } as GraphCustomAgentsRuntime;
}

function apiFor(settingsValue: unknown): CustomAgentsHostAPI {
  let value = structuredClone(settingsValue);
  return {
    uuid: () => '00000000-0000-4000-8000-000000000000',
    settings: {
      get: () => structuredClone(value),
      set: (_path: undefined, next: unknown) => (value = structuredClone(next)),
      save: vi.fn(),
    },
    i18n: { t: ((key: string) => key) as CustomAgentsHostAPI['i18n']['t'] },
  } as unknown as CustomAgentsHostAPI;
}

describe('graph management and views components', () => {
  it('mounts settings with nullable selected-branch state and an empty graph editor without an active chat', async () => {
    const preset = createGraphPreset('mounted-agent', 'Mounted agent');
    const host = mount(AgentManager, {
      api: apiFor({ presets: [preset] }),
      runtime: runtimeFor(preset),
    });
    await nextTick();
    expect(host.textContent).toContain('extensionsBuiltin.customAgents.noActiveChat');
    expect(host.querySelector('.custom-agent-flow')).not.toBeNull();
    expect(host.querySelector('[aria-label="Node palette"]')).not.toBeNull();
  });

  it('updates local settings before replacement notifications when deleting the selected agent', async () => {
    const preset = createGraphPreset('mounted-agent', 'Mounted agent');
    const api = apiFor({ presets: [preset] });
    const runtime = runtimeFor(preset);
    vi.mocked(runtime.getSelectedAgentContext).mockImplementation((agentId) => {
      if (!runtime.getAgents().some((agent) => agent.definition.id === agentId))
        throw new Error(`Unknown agent ${agentId}`);
      return undefined;
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const host = mount(AgentManager, { api, runtime });

    const deleteButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'common.delete',
    );
    expect(deleteButton).toBeDefined();
    deleteButton!.click();
    await nextTick();

    expect(api.settings.get()).toEqual({ presets: [] });
    expect(runtime.replacePrepared).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('extensionsBuiltin.customAgents.noAgents');
  });

  it('projects runtime branch skips and cancellation distinctly through the mounted production overlay', async () => {
    const preset = createGraphPreset('branch-agent', 'Branch agent');
    const flow: GraphPreset['agent']['flows'][number] = {
      id: 'manual-branch',
      name: 'Manual branch',
      kind: 'TRIGGER',
      inputs: [],
      outputs: [],
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.manual',
          position: { x: 0, y: 0 },
          data: { inputSchema: { type: 'object', additionalProperties: true } },
          inputValues: {},
        },
        {
          id: 'branch',
          type: 'control.branch',
          position: { x: 200, y: 0 },
          data: { cases: [{ id: 'chosen', label: 'Chosen' }] },
          inputValues: { 'condition.chosen': true },
        },
        {
          id: 'selected',
          type: 'control.stop',
          position: { x: 400, y: 0 },
          data: {},
          inputValues: {},
        },
        {
          id: 'not-selected',
          type: 'control.stop',
          position: { x: 400, y: 180 },
          data: {},
          inputValues: {},
        },
        {
          id: 'unused-pure',
          type: 'data.constant',
          position: { x: 200, y: 240 },
          data: { value: 'unused' },
          inputValues: {},
        },
      ],
      edges: [
        {
          id: 'trigger-branch',
          kind: 'CONTROL',
          source: { nodeId: 'trigger', portId: 'out' },
          target: { nodeId: 'branch', portId: 'in' },
        },
        {
          id: 'chosen-selected',
          kind: 'CONTROL',
          source: { nodeId: 'branch', portId: 'case.chosen' },
          target: { nodeId: 'selected', portId: 'in' },
        },
        {
          id: 'else-not-selected',
          kind: 'CONTROL',
          source: { nodeId: 'branch', portId: 'else' },
          target: { nodeId: 'not-selected', portId: 'in' },
        },
      ],
    };
    preset.agent.flows.push(flow);
    const compiled = compileGraphPreset(preset, builtinNodeRegistry);
    expect(compiled.success).toBe(true);
    if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
    const execution = await executeGraphPlan({
      plan: compiled.plan,
      flowId: flow.id,
      event: { trigger: 'MANUAL', input: {} },
      configuration: {},
      state: {},
      signal: new AbortController().signal,
      random: { next: () => 0.5 },
      ids: { generate: () => 'runtime-id' },
      tools: { dispatch: async () => ({}) },
      llm: { dispatch: async () => ({}) },
      templates: { render: async ({ template }) => template },
      promptContext: { chatHistory: [], currentCharacter: null, persona: null },
    });
    expect(execution.status).toBe('COMPLETED');
    const runtime = runtimeFor(preset);
    runtime.getDiagnostics = () => [
      { agentId: preset.agent.id, flowId: flow.id, diagnostics: execution.diagnostics },
      {
        agentId: preset.agent.id,
        flowId: flow.id,
        diagnostics: [
          {
            scopeInvocationId: `${flow.id}:2`,
            flowId: flow.id,
            nodeId: 'selected',
            status: 'CANCELLED',
            error: 'cancelled test run',
          },
        ],
      },
    ];
    const host = mount(AgentManager, { api: apiFor({ presets: [preset] }), runtime });
    await nextTick();
    await nextTick();
    expect(host.querySelector('[data-node-id="not-selected"] .custom-agent-flow__run.is-skipped')).not.toBeNull();
    expect(host.querySelector('[data-node-id="unused-pure"] .custom-agent-flow__run.is-skipped')).not.toBeNull();
    expect(host.querySelector('[data-node-id="selected"] .custom-agent-flow__run.is-cancelled')).not.toBeNull();
    expect(host.querySelector('[data-node-id="selected"] .custom-agent-flow__run.is-failed')).toBeNull();
    const cancelled = host.querySelector<HTMLElement>(
      `[data-node-id="selected"] [data-scope-invocation-id="${flow.id}:2"]`,
    );
    expect(cancelled?.textContent).toContain('Cancelled');
    expect(cancelled?.textContent).toContain('cancelled test run');
  });

  it('keeps every real repeated subflow and For Each invocation inspectable in the mounted production overlay', async () => {
    const preset = JSON.parse(
      fs.readFileSync('test/fixtures/custom-agents/nested-subflow.flow.json', 'utf8'),
    ) as GraphPreset;
    const compiled = compileGraphPreset(preset, builtinNodeRegistry);
    expect(compiled.success).toBe(true);
    if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
    const execution = await executeGraphPlan({
      plan: compiled.plan,
      flowId: 'manual-main',
      event: { trigger: 'MANUAL', input: { numbers: [2, 3, 5] } },
      configuration: {},
      state: {},
      signal: new AbortController().signal,
      random: { next: () => 0.5 },
      ids: { generate: () => 'runtime-id' },
      tools: {
        dispatch: async (tool, input) => {
          if (tool !== 'number.add' || input === null || typeof input !== 'object' || Array.isArray(input)) return {};
          return { value: Number(input.value) + Number(input.amount) };
        },
      },
      llm: { dispatch: async () => ({}) },
      templates: { render: async ({ template }) => template },
      promptContext: { chatHistory: [], currentCharacter: null, persona: null },
    });
    expect(execution.status).toBe('COMPLETED');
    const repeated = execution.diagnostics.filter((diagnostic) => diagnostic.nodeId === 'add');
    expect(repeated).toHaveLength(3);
    const runtime = runtimeFor(preset);
    runtime.getDiagnostics = () => [
      { agentId: preset.agent.id, flowId: 'manual-main', diagnostics: execution.diagnostics },
    ];
    const host = mount(AgentManager, { api: apiFor({ presets: [preset] }), runtime });
    await nextTick();
    [...host.querySelectorAll<HTMLButtonElement>('.custom-agent-flow__tabs button')]
      .find((button) => button.textContent?.includes('Accumulate'))!
      .click();
    await nextTick();
    host.querySelector<HTMLButtonElement>('[data-node-id="loop"] button')!.click();
    await nextTick();
    const invocationSections = [
      ...host.querySelectorAll<HTMLElement>('[data-node-id="add"] [data-scope-invocation-id]'),
    ];
    expect(invocationSections.map((section) => section.dataset.scopeInvocationId)).toEqual(
      repeated.map((diagnostic) => diagnostic.scopeInvocationId),
    );
    for (const diagnostic of repeated) {
      const section = invocationSections.find(
        (candidate) => candidate.dataset.scopeInvocationId === diagnostic.scopeInvocationId,
      );
      expect(section?.textContent).toContain(JSON.stringify(diagnostic.output, null, 2));
      expect(section?.textContent).toContain('Completed');
    }
  });

  it('retains an invalid draft when switching installed definitions and never applies it implicitly', async () => {
    const first = JSON.parse(
      fs.readFileSync('test/fixtures/custom-agents/minimal-observer.flow.json', 'utf8'),
    ) as GraphPreset;
    const second = structuredClone(first);
    second.agent.id = 'second-agent';
    second.agent.name = 'Second agent';
    const host = mount(AgentManager, {
      api: apiFor({ presets: [first, second] }),
      runtime: runtimeFor(first),
    });
    await nextTick();
    const invalidNode = [...host.querySelectorAll<HTMLButtonElement>('.custom-agent-flow__palette button')].find(
      (button) => button.textContent?.trim() === 'Run Flow',
    )!;
    invalidNode.click();
    await nextTick();
    expect(host.querySelector('.custom-agent-flow__diagnostics')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[title="Apply valid draft"]')?.disabled).toBe(true);

    const selectAgent = async (name: string) => {
      host.querySelector<HTMLElement>('[role="combobox"]')!.click();
      await nextTick();
      [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((option) => option.textContent?.trim() === name)!
        .click();
      await nextTick();
    };
    await selectAgent('Second agent');
    expect(host.textContent).toContain('Second agent');
    await selectAgent(first.agent.name);
    expect(host.querySelector<HTMLButtonElement>('button[title="Apply valid draft"]')?.disabled).toBe(true);
    expect(host.querySelector('.custom-agent-flow__diagnostics')).not.toBeNull();
  });

  it('mounts enabled declarative views without an active chat and reports nullable context normally', async () => {
    const preset = createGraphPreset('view-agent', 'View agent');
    preset.agent.enabled = true;
    preset.agent.views = [
      {
        id: 'summary',
        title: 'Summary',
        root: { id: 'summary-root', component: 'SECTION', title: 'Summary', components: [] },
      },
    ];
    const runtime = runtimeFor(preset);
    const host = mount(ViewsPanel, { api: apiFor({ presets: [preset] }), runtime });
    await nextTick();
    expect(host.textContent).toContain('extensionsBuiltin.customAgents.noActiveChat');
    expect(runtime.getSelectedAgentContext).toBeDefined();
  });
});
