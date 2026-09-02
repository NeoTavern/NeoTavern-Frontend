// @vitest-environment jsdom

import fs from 'node:fs';
import { createPinia } from 'pinia';
import { createApp, nextTick, type App } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomAgentsHostAPI } from '../../src/extensions/built-in/custom-agents/host/api';
import type {
  GraphCustomAgentsRuntime,
  GraphSelectedAgentContext,
} from '../../src/extensions/built-in/custom-agents/host/runtime';
import type { GraphFlow, GraphPreset, JsonObject } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { createGraphPreset } from '../../src/extensions/built-in/custom-agents/settings/management';
import { validateInstalledPreset } from '../../src/extensions/built-in/custom-agents/settings/store';
import type { ViewComponent } from '../../src/extensions/built-in/custom-agents/views/contracts';
import ViewComponentRenderer from '../../src/extensions/built-in/custom-agents/views/ViewComponentRenderer.vue';
import ViewsPanel from '../../src/extensions/built-in/custom-agents/views/ViewsPanel.vue';

const mocked = vi.hoisted(() => ({
  action: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('../../src/extensions/built-in/custom-agents/views/actions', () => ({ runGraphViewAction: mocked.action }));
vi.mock('../../src/extensions/built-in/custom-agents/host/generation', () => ({
  resetSelectedGraphAgent: mocked.reset,
}));

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn(() => ({ matches: false })),
});
HTMLElement.prototype.scrollIntoView = vi.fn();
const english = JSON.parse(fs.readFileSync('locales/en.json', 'utf8')) as Record<string, unknown>;
const cleanups: Array<() => void> = [];

afterEach(() => {
  mocked.action.mockReset();
  mocked.reset.mockReset();
  while (cleanups.length) cleanups.pop()!();
});

function mount(component: object, props: Record<string, unknown>): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const app: App = createApp(component, props);
  app.use(createPinia());
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en: english } }));
  app.mount(host);
  cleanups.push(() => {
    app.unmount();
    host.remove();
  });
  return host;
}

function button(root: ParentNode, text: string): HTMLButtonElement {
  const selected = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!selected) throw new Error(`Missing button ${text}`);
  return selected;
}

function combobox(root: ParentNode, label?: string): HTMLElement {
  if (!label) return root.querySelector<HTMLElement>('[role="combobox"]')!;
  const wrapper = [...root.querySelectorAll<HTMLElement>('.select-wrapper')].find(
    (candidate) => candidate.querySelector('.select-label')?.textContent?.trim() === label,
  );
  if (!wrapper) throw new Error(`Missing select ${label}`);
  return wrapper.querySelector<HTMLElement>('[role="combobox"]')!;
}

async function select(root: ParentNode, label: string, option: string): Promise<void> {
  const target = combobox(root, label);
  target.click();
  await nextTick();
  const selected = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === option,
  );
  if (!selected) throw new Error(`Missing option ${option}`);
  selected.click();
  await nextTick();
}

function manualFlow(id: string): GraphFlow {
  return {
    id,
    name: id,
    kind: 'TRIGGER',
    inputs: [],
    outputs: [],
    nodes: [
      {
        id: `${id}-trigger`,
        type: 'trigger.manual',
        position: { x: 0, y: 0 },
        data: { inputSchema: { type: 'object', additionalProperties: true } },
        inputValues: {},
      },
      {
        id: `${id}-stop`,
        type: 'control.stop',
        position: { x: 200, y: 0 },
        data: {},
        inputValues: {},
      },
    ],
    edges: [
      {
        id: `${id}-edge`,
        kind: 'CONTROL',
        source: { nodeId: `${id}-trigger`, portId: 'out' },
        target: { nodeId: `${id}-stop`, portId: 'in' },
      },
    ],
  };
}

function strictPreset(id: string, root: ViewComponent, flowIds: string[] = []): GraphPreset {
  const preset = createGraphPreset(id, id);
  preset.agent.enabled = true;
  preset.agent.flows = flowIds.map(manualFlow);
  preset.agent.views = [{ id: 'view', title: 'View', root }];
  return validateInstalledPreset(preset);
}

function api(): CustomAgentsHostAPI {
  return { i18n: { t: ((key: string) => key) as CustomAgentsHostAPI['i18n']['t'] } } as CustomAgentsHostAPI;
}

function runtime(agents: GraphPreset['agent'][], context?: GraphSelectedAgentContext): GraphCustomAgentsRuntime {
  const compiled = agents.map((definition) => ({ definition, plan: { agent: definition, flows: [] } }));
  return {
    getAgents: () => compiled,
    getSelectedAgentContext: () => context,
    subscribe: () => vi.fn(),
    invalidate: vi.fn(),
  } as unknown as GraphCustomAgentsRuntime;
}

describe('mounted graph-native runtime views', () => {
  it('switches unrelated tabbed views with the first tab initialized and follows no-chat transitions', async () => {
    const first = strictPreset('first', {
      id: 'first-tabs',
      component: 'TABS',
      tabs: [
        {
          id: 'first-tab',
          label: 'First tab',
          components: [{ id: 'first-content', component: 'SECTION', title: 'First content', components: [] }],
        },
      ],
    });
    const second = strictPreset('second', {
      id: 'second-tabs',
      component: 'TABS',
      tabs: [
        {
          id: 'second-tab',
          label: 'Second tab',
          components: [{ id: 'second-content', component: 'SECTION', title: 'Second content', components: [] }],
        },
      ],
    });
    let selectedContext: GraphSelectedAgentContext | undefined;
    let refresh: (() => void) | undefined;
    const viewRuntime = runtime([first.agent, second.agent]);
    viewRuntime.getSelectedAgentContext = () => selectedContext;
    viewRuntime.subscribe = (listener) => {
      refresh = listener;
      return vi.fn();
    };
    const host = mount(ViewsPanel, { api: api(), runtime: viewRuntime });
    expect(host.textContent).toContain('extensionsBuiltin.customAgents.noActiveChat');

    selectedContext = { state: {}, config: {}, injections: [], selectionKey: 'opened' };
    refresh?.();
    await nextTick();
    expect(host.textContent).toContain('First content');
    const viewSelect = combobox(host);
    viewSelect.click();
    await nextTick();
    [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.includes('second — View'))!
      .click();
    await nextTick();
    expect(host.textContent).toContain('Second tab');
    expect(host.textContent).toContain('Second content');
    expect(host.textContent).not.toContain('First content');

    selectedContext = undefined;
    refresh?.();
    await nextTick();
    expect(host.textContent).toContain('extensionsBuiltin.customAgents.noActiveChat');
    expect(host.textContent).not.toContain('Second content');
  });

  it('reinitializes selected-swipe forms and submits exact object and array SELECT values', async () => {
    const form: ViewComponent = {
      id: 'choices-form',
      component: 'FORM',
      label: 'Save choices',
      workflowId: 'choose',
      fields: [
        {
          name: 'objectChoice',
          label: 'Object choice',
          control: 'SELECT',
          initial: { $ref: 'state.objectChoice' },
          options: { $ref: 'config.options' },
          optionLabelPath: 'label',
          optionValuePath: 'value',
        },
        {
          name: 'arrayChoice',
          label: 'Array choice',
          control: 'SELECT',
          initial: { $ref: 'state.arrayChoice' },
          options: { $ref: 'config.arrayOptions' },
          optionLabelPath: 'label',
          optionValuePath: 'value',
        },
      ],
    };
    const preset = strictPreset('forms', form, ['choose']);
    const config: JsonObject = {
      options: [
        { label: 'One', value: { id: 'one', rank: 1 } },
        { label: 'Two', value: { id: 'two', rank: 2 } },
      ],
      arrayOptions: [
        { label: 'First array', value: [1] },
        { label: 'Second array', value: [2] },
      ],
    };
    let context: GraphSelectedAgentContext = {
      state: { objectChoice: { rank: 1, id: 'one' }, arrayChoice: [1] },
      config,
      injections: [],
      selectionKey: 'swipe-0',
    };
    let refresh: (() => void) | undefined;
    const viewRuntime = runtime([preset.agent]);
    viewRuntime.getSelectedAgentContext = () => context;
    viewRuntime.subscribe = (listener) => {
      refresh = listener;
      return vi.fn();
    };
    const host = mount(ViewsPanel, { api: api(), runtime: viewRuntime });
    await nextTick();
    expect(combobox(host, 'Object choice').querySelector('.selected-text')?.textContent).toBe('One');
    await select(host, 'Object choice', 'Two');
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(mocked.action).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'forms', 'choose', {
      objectChoice: { id: 'two', rank: 2 },
      arrayChoice: [1],
    });

    context = {
      state: { objectChoice: { rank: 1, id: 'one' }, arrayChoice: [2] },
      config,
      injections: [],
      selectionKey: 'swipe-1',
    };
    refresh?.();
    await nextTick();
    expect(combobox(host, 'Object choice').querySelector('.selected-text')?.textContent).toBe('One');
    expect(combobox(host, 'Array choice').querySelector('.selected-text')?.textContent).toBe('Second array');
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(mocked.action).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'forms', 'choose', {
      objectChoice: { rank: 1, id: 'one' },
      arrayChoice: [2],
    });
  });

  it('operates tabs, pagination, row actions/forms, ordinary forms, and surfaces manual failures', async () => {
    const node: ViewComponent = {
      id: 'interactive-tabs',
      component: 'TABS',
      tabs: [
        {
          id: 'summary',
          label: 'Summary',
          components: [{ id: 'summary-content', component: 'SECTION', title: 'Summary content', components: [] }],
        },
        {
          id: 'operations',
          label: 'Operations',
          components: [
            {
              id: 'rows',
              component: 'TABLE',
              label: 'Rows',
              binding: { $ref: 'state.rows' },
              columns: [{ label: 'Label', path: 'label' }],
              order: 'ASC',
              pageSize: 1,
              rowActions: [
                { label: 'Run row', workflowId: 'run-row', input: { id: { $ref: 'row.id' } }, confirm: false },
                {
                  label: 'Edit row',
                  workflowId: 'edit-row',
                  fields: [{ name: 'label', label: 'Row label', control: 'TEXT', initial: { $ref: 'row.label' } }],
                },
              ],
            },
            {
              id: 'ordinary-form',
              component: 'FORM',
              label: 'Submit form',
              workflowId: 'submit',
              fields: [
                { name: 'text', label: 'Text', control: 'TEXT' },
                { name: 'area', label: 'Area', control: 'TEXTAREA' },
                { name: 'number', label: 'Number', control: 'NUMBER' },
                { name: 'check', label: 'Check', control: 'CHECKBOX' },
                {
                  name: 'choice',
                  label: 'Choice',
                  control: 'SELECT',
                  initial: { $ref: 'config.initialChoice' },
                  options: { $ref: 'config.options' },
                  optionLabelPath: 'label',
                  optionValuePath: 'value',
                },
              ],
            },
            {
              id: 'injection-failure',
              component: 'BUTTON',
              label: 'Save injection',
              action: { label: 'Save injection', workflowId: 'inject', input: {}, confirm: false },
            },
          ],
        },
      ],
    };
    const preset = strictPreset('interactive', node, ['run-row', 'edit-row', 'submit', 'inject']);
    const host = mount(ViewComponentRenderer, {
      api: api(),
      runtime: runtime([preset.agent]),
      agent: preset.agent,
      node,
      context: {
        state: {
          rows: [
            { id: 'one', label: 'One' },
            { id: 'two', label: 'Two' },
          ],
        },
        config: {
          options: [{ label: 'Object', value: { b: 2, a: 1 } }],
          initialChoice: { a: 1, b: 2 },
        },
        injections: [],
        selectionKey: 'root',
      },
    });
    expect(host.textContent).toContain('Summary content');
    button(host, 'Operations').click();
    await nextTick();
    expect(host.textContent).toContain('One');
    const pagination = host.querySelector('nav')!;
    button(pagination, 'pagination.next').click();
    await nextTick();
    expect(pagination.textContent).toContain('2 / 2');
    expect(host.textContent).toContain('Two');
    button(pagination, 'pagination.previous').click();
    await nextTick();

    button(host, 'Run row').click();
    await nextTick();
    expect(mocked.action).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'interactive', 'run-row', {
      id: 'one',
    });
    const forms = [...host.querySelectorAll('form')];
    const rowForm = forms.find((candidate) => candidate.textContent?.includes('Row label'))!;
    const rowInput = rowForm.querySelector('input')!;
    rowInput.value = 'Edited';
    rowInput.dispatchEvent(new Event('input', { bubbles: true }));
    rowForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(mocked.action).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'interactive', 'edit-row', {
      label: 'Edited',
    });

    const ordinary = forms.find((candidate) => candidate.textContent?.includes('Text'))!;
    const inputs = ordinary.querySelectorAll<HTMLInputElement>('input');
    inputs[0]!.value = 'plain';
    inputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    ordinary.querySelector<HTMLTextAreaElement>('textarea')!.value = 'long';
    ordinary.querySelector<HTMLTextAreaElement>('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1]!.value = '7';
    inputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    ordinary.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    ordinary.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(mocked.action).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'interactive', 'submit', {
      text: 'plain',
      area: 'long',
      number: 7,
      check: true,
      choice: { a: 1, b: 2 },
    });

    mocked.action.mockRejectedValueOnce(new Error('injection save failed'));
    button(host, 'Save injection').click();
    await nextTick();
    await nextTick();
    expect(host.textContent).toContain('injection save failed');
  });

  it.each([
    ['succeeds', undefined],
    ['surfaces save rejection', new Error('reset save rejected')],
  ])('RESET_SELECTED_AGENT %s', async (_case, failure) => {
    const node: ViewComponent = {
      id: 'reset',
      component: 'BUTTON',
      label: 'Reset now',
      action: { label: 'Reset now', command: 'RESET_SELECTED_AGENT', confirm: false },
    };
    const preset = strictPreset('reset', node);
    if (failure) mocked.reset.mockRejectedValueOnce(failure);
    const viewRuntime = runtime([preset.agent]);
    const host = mount(ViewComponentRenderer, {
      api: api(),
      runtime: viewRuntime,
      agent: preset.agent,
      node,
      context: { state: {}, config: {}, injections: [], selectionKey: 'root' },
    });
    button(host, 'Reset now').click();
    await nextTick();
    await nextTick();
    expect(mocked.reset).toHaveBeenCalledOnce();
    expect(viewRuntime.invalidate).toHaveBeenCalledTimes(failure ? 0 : 1);
    if (failure) expect(host.textContent).toContain('reset save rejected');
    else expect(host.textContent).not.toContain('reset save rejected');
  });
});
