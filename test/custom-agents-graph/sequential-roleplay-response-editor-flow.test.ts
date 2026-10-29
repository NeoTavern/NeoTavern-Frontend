import { describe, expect, it, vi } from 'vitest';
import presetJson from '../../src/extensions/built-in/custom-agents/presets/sequential-roleplay-response-editor.flow.json';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import type { GraphPreset, JsonValue } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { parseGraphPresetShape } from '../../src/extensions/built-in/custom-agents/graph/schemas';
import type { CustomAgentsHostAPI } from '../../src/extensions/built-in/custom-agents/host/api';
import { GraphHostTemplateRenderer } from '../../src/extensions/built-in/custom-agents/host/prompt';
import type { GraphLlmRequest } from '../../src/extensions/built-in/custom-agents/registry/node-definition';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import { genericToolCatalog } from '../../src/extensions/built-in/custom-agents/registry/tools';
import { executeGraphPlan } from '../../src/extensions/built-in/custom-agents/runtime/execute-plan';
import { getGraphAgentTemplates } from '../../src/extensions/built-in/custom-agents/settings/catalog';
import { macroService } from '../../src/services/macro-service';

const preset = presetJson as GraphPreset;
const compiled = compileGraphPreset(preset, builtinNodeRegistry);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics, null, 2));

const passSpecs = [
  ['simulation-continuity', 'simulationPrompt'],
  ['character-behavior', 'characterPrompt'],
  ['repetition-prose', 'prosePrompt'],
  ['final-restraint', 'restraintPrompt'],
] as const;

const renderer = new GraphHostTemplateRenderer({
  macro: {
    process: (text, context, additionalMacros) => macroService.process(text, { ...context, additionalMacros }),
  },
} as unknown as CustomAgentsHostAPI);

describe('Sequential Roleplay Response Editor preset', () => {
  it('parses and compiles with every node connected', () => {
    const parsed = parseGraphPresetShape(preset);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.issues, null, 2)).toBe(true);
    expect(compiled.success).toBe(true);
    for (const flow of preset.agent.flows) {
      for (const node of flow.nodes) {
        expect(
          flow.edges.some((edge) => edge.source.nodeId === node.id || edge.target.nodeId === node.id),
          `${flow.id}/${node.id} is disconnected`,
        ).toBe(true);
      }
    }
  });

  it('renders each nested configurable prompt with the real host macro renderer', async () => {
    for (const [, promptKey] of passSpecs) {
      const rendered = await renderer.render({
        template: `{{{config.${promptKey}}}}`,
        variables: { currentResponse: `nested value for ${promptKey}` },
        event: { trigger: 'MANUAL', input: {} },
        configuration: preset.agent.configurationDefaults,
        state: {},
        promptContext: { chatHistory: [], currentCharacter: null, persona: null },
        signal: new AbortController().signal,
      });
      expect(rendered).toContain(`Current response to rewrite:\nnested value for ${promptKey}`);
      expect(rendered).not.toContain('{{{input.currentResponse}}}');
    }
  });

  it('executes sequentially with preceding outputs and emits only the fourth target replacement', async () => {
    const requests: GraphLlmRequest[] = [];
    const outputs = ['pass one', 'pass two', 'pass three', 'pass four'];
    const dispatch = vi.fn(async (request: GraphLlmRequest): Promise<JsonValue> => {
      requests.push(request);
      return { response: outputs[requests.length - 1]! };
    });
    const configuration = structuredClone(preset.agent.configurationDefaults);
    configuration.connectionProfileId = 'profile-editor';
    configuration.structuredFormat = 'XML';
    configuration.recentHistoryCount = 2;
    const targetMessage = { index: 3, role: 'ASSISTANT' as const, name: 'Assistant', content: 'original response' };
    const result = await executeGraphPlan({
      plan: compiled.plan,
      flowId: 'edit-response',
      event: {
        trigger: 'AFTER_ASSISTANT_MESSAGE',
        generationId: 'generation',
        generationMode: 'NEW',
        message: targetMessage,
      },
      configuration,
      state: {},
      signal: new AbortController().signal,
      random: { next: () => 0 },
      ids: { generate: () => `request-${requests.length + 1}` },
      tools: genericToolCatalog,
      llm: { dispatch },
      templates: renderer,
      promptContext: {
        chatHistory: [
          { index: 0, role: 'USER', name: 'User', content: 'old context' },
          { index: 1, role: 'ASSISTANT', name: 'Assistant', content: 'old answer' },
          { index: 2, role: 'USER', name: 'User', content: 'recent context' },
          targetMessage,
        ],
        targetMessage,
        currentCharacter: null,
        persona: null,
      },
    });
    expect(result.status, result.status === 'FAILED' ? result.error : '').toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    expect(requests.map((request) => request.variables.currentResponse)).toEqual([
      'original response',
      'pass one',
      'pass two',
      'pass three',
    ]);
    for (const request of requests) {
      expect(request).toMatchObject({
        connectionProfileId: 'profile-editor',
        structuredFormat: 'XML',
        assembly: {
          type: 'NORMAL_CHAT',
          history: 'RECENT_TARGET',
          placement: { type: 'AFTER_CONTEXT', role: 'SYSTEM' },
        },
      });
      expect(request.outputSchema).toMatchObject({ required: ['response'], additionalProperties: false });
      expect(request.promptContext.chatHistory).toHaveLength(2);
      expect(request.promptContext.targetMessage).toMatchObject({ index: 1, content: 'original response' });
    }
    expect(result.effects).toEqual([{ type: 'VISIBLE_MESSAGE', operation: 'REPLACE_TARGET', content: 'pass four' }]);
    expect(result.state).toEqual({});
  });

  it('returns independent editable template clones', () => {
    const template = (templates: ReturnType<typeof getGraphAgentTemplates>) =>
      templates.find((item) => item.agent.id === 'builtin-sequential-roleplay-response-editor')!;
    const first = template(getGraphAgentTemplates());
    const second = template(getGraphAgentTemplates());
    first.agent.name = 'changed';
    first.agent.configurationDefaults.simulationPrompt = 'changed';
    expect(second.agent.name).toBe('Sequential Roleplay Response Editor');
    expect(second.agent.configurationDefaults.simulationPrompt).not.toBe('changed');
  });
});
