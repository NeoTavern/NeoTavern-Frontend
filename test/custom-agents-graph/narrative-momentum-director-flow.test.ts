import { describe, expect, it, vi } from 'vitest';
import presetJson from '../../src/extensions/built-in/custom-agents/presets/narrative-momentum-director.flow.json';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import { parseGraphPresetShape } from '../../src/extensions/built-in/custom-agents/graph/schemas';
import { GraphHostTemplateRenderer } from '../../src/extensions/built-in/custom-agents/host/prompt';
import type { GraphPreset, JsonObject, JsonValue } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import type { GraphLlmRequest } from '../../src/extensions/built-in/custom-agents/registry/node-definition';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import { genericToolCatalog } from '../../src/extensions/built-in/custom-agents/registry/tools';
import { executeGraphPlan } from '../../src/extensions/built-in/custom-agents/runtime/execute-plan';
import { getGraphAgentTemplates } from '../../src/extensions/built-in/custom-agents/settings/catalog';
import type { CustomAgentsHostAPI } from '../../src/extensions/built-in/custom-agents/host/api';
import { macroService } from '../../src/services/macro-service';

const preset = presetJson as GraphPreset;
const compiled = compileGraphPreset(preset, builtinNodeRegistry);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics, null, 2));

function run(
  flowId: string,
  state: JsonObject,
  llm: (request: GraphLlmRequest) => Promise<JsonValue> = async () => ({ action: 'NONE', direction: '' }),
  randomValue = 0,
  configuration: JsonObject = structuredClone(preset.agent.configurationDefaults),
) {
  const trigger =
    flowId === 'periodic-direction-audit'
      ? ({
          trigger: 'AFTER_ASSISTANT_MESSAGE',
          generationId: 'g',
          generationMode: 'NEW',
          message: { index: 0, role: 'ASSISTANT', name: '', content: 'Message' },
        } as const)
      : flowId === 'random-influence'
        ? ({ trigger: 'BEFORE_ASSISTANT_GENERATION', generationId: 'g', generationMode: 'NEW' } as const)
        : ({ trigger: 'MANUAL', input: {} } as const);
  return executeGraphPlan({
    plan: compiled.plan,
    flowId,
    event: trigger,
    configuration,
    state,
    signal: new AbortController().signal,
    random: { next: () => randomValue },
    ids: { generate: () => 'request-id' },
    tools: genericToolCatalog,
    llm: { dispatch: llm },
    templates: {
      render: async ({ template, variables }) =>
        Object.entries(variables).reduce(
          (text, [name, value]) => text.replaceAll(`{{{input.${name}}}}`, String(value)),
          template,
        ),
    },
    promptContext: { chatHistory: [], currentCharacter: null, persona: null },
  });
}

describe('Narrative Momentum Director preset', () => {
  it('parses and compiles through the production registry', () => {
    const parsed = parseGraphPresetShape(preset);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.issues, null, 2)).toBe(true);
    expect(compiled.success).toBe(true);
  });

  it('renders every template variable through the declared input macro namespace', async () => {
    const renderer = new GraphHostTemplateRenderer({
      macro: {
        process: (text, context, additionalMacros) => macroService.process(text, { ...context, additionalMacros }),
      },
    } as unknown as CustomAgentsHostAPI);
    const base = {
      event: { trigger: 'MANUAL' as const, input: {} },
      configuration: preset.agent.configurationDefaults,
      state: { direction: '' },
      promptContext: { chatHistory: [], currentCharacter: null, persona: null },
      signal: new AbortController().signal,
    };
    const randomTemplate = preset.agent.flows
      .find((flow) => flow.id === 'random-influence')!
      .nodes.find((node) => node.id === 'random-wording')!.data.template as string;
    const directionTemplate = preset.agent.flows
      .find((flow) => flow.id === 'audit-direction')!
      .nodes.find((node) => node.id === 'audit-direction-wording')!.data.template as string;

    await expect(
      renderer.render({ ...base, variables: { influence: 'Use a quiet callback.' }, template: randomTemplate }),
    ).resolves.toContain('Use a quiet callback.');
    await expect(
      renderer.render({
        ...base,
        variables: { direction: 'Let the unanswered letter matter.' },
        template: directionTemplate,
      }),
    ).resolves.toContain('Let the unanswered letter matter.');
    await expect(
      renderer.render({
        ...base,
        variables: { currentDirection: 'Watch the door.' },
        template: '{{{config.auditPrompt}}}',
      }),
    ).resolves.toContain('Current direction: Watch the door.');
  });

  it.each(['CREATE', 'REPLACE'] as const)(
    'stores then injects a %s direction through the shared path',
    async (action) => {
      const llm = vi.fn(async () => ({ action, direction: 'Let the unanswered letter quietly matter.' }));
      const result = await run('force-direction-audit', { direction: action === 'CREATE' ? '' : 'Old direction' }, llm);
      expect(result.status).toBe('COMPLETED');
      if (result.status !== 'COMPLETED') return;
      expect(result.state).toEqual({ direction: 'Let the unanswered letter quietly matter.' });
      expect(result.effects.map((effect) => effect.type)).toEqual(['STATE_SET', 'INJECTION_SET']);
      expect(result.effects[1]).toMatchObject({
        type: 'INJECTION_SET',
        injectionId: 'narrative-momentum-direction',
        placement: 'in-chat',
        depth: 0,
        lifetime: { type: 'UNTIL_REMOVED' },
        activation: { type: 'ALWAYS' },
      });
      expect(JSON.stringify(result.effects[1])).toContain('guidance only');
    },
  );

  it.each(['NONE', 'KEEP'] as const)('%s has no effects', async (action) => {
    const result = await run('force-direction-audit', { direction: 'Still useful' }, async () => ({
      action,
      direction: '',
    }));
    expect(result).toMatchObject({ status: 'COMPLETED', state: { direction: 'Still useful' }, effects: [] });
  });

  it('removes the persistent injection before clearing direction', async () => {
    const result = await run('force-direction-audit', { direction: 'Completed goal' }, async () => ({
      action: 'REMOVE',
      direction: '',
    }));
    expect(result.status).toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    expect(result.state).toEqual({ direction: '' });
    expect(result.effects).toEqual([
      { type: 'INJECTION_REMOVE', injectionId: 'narrative-momentum-direction' },
      { type: 'STATE_SET', path: 'direction', value: '' },
    ]);
  });

  it('manual clear removes the persistent injection before emptying state', async () => {
    const result = await run('clear-direction', { direction: 'Active' });
    expect(result.status).toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    expect(result.effects.map((effect) => effect.type)).toEqual(['INJECTION_REMOVE', 'STATE_SET']);
    expect(result.state).toEqual({ direction: '' });
  });

  it('selects configured random influence and emits one stable probabilistic ONCE injection', async () => {
    const configuration = structuredClone(preset.agent.configurationDefaults);
    configuration.influences = ['first', 'second', 'third'];
    configuration.randomInfluenceProbability = 0.37;
    const result = await run('random-influence', { direction: '' }, undefined, 0.5, configuration);
    expect(result.status).toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({
      type: 'INJECTION_SET',
      injectionId: 'narrative-momentum-random-influence',
      placement: 'in-chat',
      depth: 0,
      lifetime: { type: 'ONCE' },
      activation: { type: 'PROBABILITY', probability: 0.37 },
    });
    const effect = JSON.stringify(result.effects[0]);
    expect(effect).toContain('second');
    expect(effect).toContain('For this generation, incorporate the following narrative direction:');
    expect(effect).not.toContain('gently consider');
    expect(effect).not.toContain('optional narrative influence');
  });

  it('passes configured audit settings, current direction, and bounded current history to the LLM', async () => {
    const llm = vi.fn(async () => ({ action: 'NONE', direction: '' }));
    const configuration = structuredClone(preset.agent.configurationDefaults);
    configuration.connectionProfileId = 'profile-a';
    configuration.structuredFormat = 'JSON';
    configuration.recentHistoryCount = 7;
    await run('periodic-direction-audit', { direction: 'Watch the door' }, llm, 0, configuration);
    expect(llm).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionProfileId: 'profile-a',
        structuredFormat: 'JSON',
        variables: { currentDirection: 'Watch the door' },
        assembly: expect.objectContaining({ history: 'RECENT_CURRENT' }),
        outputSchema: expect.objectContaining({ required: ['action', 'direction'], additionalProperties: false }),
      }),
    );
  });

  it('returns independent editable template clones', () => {
    const template = (templates: ReturnType<typeof getGraphAgentTemplates>) =>
      templates.find((item) => item.agent.id === 'builtin-narrative-momentum-director')!;
    const first = template(getGraphAgentTemplates());
    const second = template(getGraphAgentTemplates());
    first.agent.name = 'changed';
    (first.agent.configurationDefaults.influences as JsonValue[])[0] = 'changed';
    expect(second.agent.name).toBe('Narrative Momentum Director');
    expect((second.agent.configurationDefaults.influences as JsonValue[])[0]).not.toBe('changed');
  });
});
