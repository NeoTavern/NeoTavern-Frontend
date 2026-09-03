// @vitest-environment jsdom

import { createApp, nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import ConfigurationPanel from '../../src/extensions/built-in/custom-agents/settings/ConfigurationPanel.vue';
import type { GraphPreset, JsonObject } from '../../src/extensions/built-in/custom-agents/graph/contracts';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function preset(): GraphPreset {
  return {
    format: 'NEOTAVERN_CUSTOM_AGENT_FLOW',
    agent: {
      id: 'configuration-test',
      name: 'Configuration test',
      enabled: true,
      priority: 1,
      configurationSchema: {
        type: 'object',
        properties: {
          probability: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['probability'],
        additionalProperties: false,
      },
      configurationDefaults: { probability: 0.2 },
      stateSchema: { type: 'object', properties: {}, additionalProperties: false },
      initialState: {},
      flows: [],
      views: [],
    },
  };
}

describe('Custom Agent configuration panel', () => {
  it('preserves an in-progress decimal while committing the completed number', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const updates: JsonObject[] = [];
    const app = createApp(ConfigurationPanel, {
      preset: preset(),
      t: (key: string) => key,
      onUpdate: (configuration: JsonObject) => updates.push(configuration),
    });
    app.mount(host);
    cleanup = () => {
      app.unmount();
      host.remove();
    };

    const input = host.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('0.2');

    input.value = '0.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(input.value).toBe('0.');

    input.value = '0.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(input.value).toBe('0.5');
    expect(updates.at(-1)).toEqual({ probability: 0.5 });
  });
});
