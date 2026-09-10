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

function dataEdges(flow: GraphPreset['agent']['flows'][number]) {
  return flow.edges.filter((edge) => edge.kind === 'DATA');
}

function controlPath(flow: GraphPreset['agent']['flows'][number], first: string): string[] {
  const path = [first];
  while (true) {
    const next = flow.edges.find(
      (edge) => edge.kind === 'CONTROL' && edge.source.nodeId === path[path.length - 1] && edge.source.portId === 'out',
    );
    if (!next) return path;
    path.push(next.target.nodeId);
  }
}

describe('Sequential Roleplay Response Editor preset', () => {
  it('strictly parses and compiles as a stateless observer-only generic graph', () => {
    const parsed = parseGraphPresetShape(preset);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.issues, null, 2)).toBe(true);
    expect(compiled.success).toBe(true);
    expect(preset.agent.stateSchema).toEqual({ type: 'object', additionalProperties: false });
    expect(preset.agent.initialState).toEqual({});
    expect(preset.agent.views).toEqual([]);
    expect(preset.agent.flows).toHaveLength(5);

    const types = preset.agent.flows.flatMap((flow) => flow.nodes.map((node) => node.type));
    expect(types.every((type) => builtinNodeRegistry.get(type) !== undefined)).toBe(true);
    expect(types).not.toContain('trigger.generate-assistant');
    expect(types).not.toContain('effect.generation-response');
    expect(types.some((type) => type.startsWith('effect.set-state') || type === 'effect.remove-state')).toBe(false);
    expect(types.filter((type) => type.startsWith('trigger.'))).toEqual(['trigger.after-generation']);
    for (const flow of preset.agent.flows) {
      for (const node of flow.nodes) {
        expect(
          flow.edges.some((edge) => edge.source.nodeId === node.id || edge.target.nodeId === node.id),
          `${flow.id}/${node.id} is disconnected`,
        ).toBe(true);
      }
    }
  });

  it('wires the trigger content through the exact four-pass order into one target replacement', () => {
    const flow = preset.agent.flows[0]!;
    expect(flow.kind).toBe('TRIGGER');
    expect(flow.nodes.find((node) => node.id === 'after-generation')?.data).toEqual({
      generationModes: ['NEW', 'REGENERATE', 'ADD_SWIPE'],
      schedule: { type: 'ALWAYS' },
    });
    expect(controlPath(flow, 'after-generation')).toEqual([
      'after-generation',
      'run-simulation',
      'run-character',
      'run-prose',
      'run-restraint',
      'replace-target',
    ]);
    expect(flow.nodes.filter((node) => node.type === 'control.run-flow').map((node) => node.data.flowId)).toEqual(
      passSpecs.map(([flowId]) => flowId),
    );
    expect(flow.nodes.find((node) => node.id === 'replace-target')?.data).toEqual({ operation: 'REPLACE_TARGET' });
    expect(
      dataEdges(flow).map((edge) => [edge.source.nodeId, edge.source.portId, edge.target.nodeId, edge.target.portId]),
    ).toEqual([
      ['after-generation', 'message', 'message-content', 'value'],
      ['message-content', 'value', 'run-simulation', 'response'],
      ['run-simulation', 'response', 'run-character', 'response'],
      ['run-character', 'response', 'run-prose', 'response'],
      ['run-prose', 'response', 'run-restraint', 'response'],
      ['run-restraint', 'response', 'replace-target', 'content'],
    ]);
  });

  it('defines four focused subflow signatures and identically assembled strict requests', () => {
    for (const [flowId, promptKey] of passSpecs) {
      const flow = preset.agent.flows.find((candidate) => candidate.id === flowId)!;
      expect(flow.kind).toBe('SUBFLOW');
      expect(flow.inputs).toEqual([
        {
          id: 'response',
          label: 'Response',
          required: true,
          cardinality: 'ONE',
          schema: { type: 'string', minLength: 1 },
        },
      ]);
      expect(flow.outputs).toEqual(flow.inputs);
      expect(flow.nodes.filter((node) => node.type === 'data.configuration').map((node) => node.data.path)).toEqual([
        'connectionProfileId',
        'structuredFormat',
        'recentHistoryCount',
      ]);
      const request = flow.nodes.find((node) => node.type === 'llm.request')!;
      expect(request.data).toEqual({
        prompt: `{{{config.${promptKey}}}}`,
        variables: [{ id: 'current-response', name: 'currentResponse' }],
        assembly: {
          type: 'NORMAL_CHAT',
          history: 'RECENT_TARGET',
          placement: { type: 'AFTER_CONTEXT', role: 'SYSTEM' },
        },
        outputSchema: {
          type: 'object',
          properties: { response: { type: 'string', minLength: 1 } },
          required: ['response'],
          additionalProperties: false,
        },
      });
      const entry = flow.nodes.find((node) => node.type === 'scope.entry')!;
      const returnNode = flow.nodes.find((node) => node.type === 'scope.return')!;
      expect(dataEdges(flow)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: { nodeId: entry.id, portId: 'response' },
            target: { nodeId: request.id, portId: 'variable.current-response' },
          }),
          expect.objectContaining({
            source: { nodeId: request.id, portId: 'property/response' },
            target: { nodeId: returnNode.id, portId: 'response' },
          }),
        ]),
      );
    }
  });

  it('keeps the shared configuration strict and preserves all supplied prompt requirements', () => {
    expect(preset.agent.configurationSchema).toMatchObject({
      type: 'object',
      required: ['connectionProfileId', 'structuredFormat', 'recentHistoryCount', ...passSpecs.map(([, key]) => key)],
      additionalProperties: false,
      properties: {
        connectionProfileId: { type: 'string' },
        structuredFormat: { type: 'string', enum: ['NATIVE', 'JSON', 'XML'] },
        recentHistoryCount: { type: 'integer', minimum: 1 },
        simulationPrompt: { type: 'string', minLength: 1 },
        characterPrompt: { type: 'string', minLength: 1 },
        prosePrompt: { type: 'string', minLength: 1 },
        restraintPrompt: { type: 'string', minLength: 1 },
      },
    });
    expect(preset.agent.configurationDefaults).toMatchObject({
      connectionProfileId: '',
      structuredFormat: 'NATIVE',
      recentHistoryCount: 20,
    });
    const coverage = {
      simulationPrompt: [
        'messages are authoritative',
        'invented facts',
        'unsupported causal conclusions',
        'NPC knowledge',
        'Do not alter established user-authored facts',
        'Do not improve prose style',
      ],
      characterPrompt: [
        'statements are canonical',
        'hidden desire',
        'Do not accelerate trust',
        'Preserve resistance',
        'dominant trope',
        'player character',
      ],
      prosePrompt: [
        'recognizably AI-generated narration',
        'jaw tightening',
        'environmental details only when',
        'redundant narration',
        'dialogue conversational',
        'Not every beat needs emotional significance',
      ],
      restraintPrompt: [
        'duplicated information',
        'unnecessary escalation',
        'Do not introduce new events',
        'more romantic, sexual, hostile, dramatic',
        'Preserve ambiguity',
        'internal-thought section',
      ],
    } as const;
    for (const [key, phrases] of Object.entries(coverage)) {
      const prompt = preset.agent.configurationDefaults[key] as string;
      for (const phrase of phrases) expect(prompt).toContain(phrase);
      expect(prompt).toContain('\n\nCurrent response to rewrite:\n{{{input.currentResponse}}}');
      expect(prompt.trimEnd().endsWith('{{{input.currentResponse}}}')).toBe(true);
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

  it('is registered third and returns independent editable clones', () => {
    const first = getGraphAgentTemplates();
    const second = getGraphAgentTemplates();
    expect(first.map((item) => item.agent.id)).toEqual([
      'builtin-mythic',
      'builtin-narrative-momentum-director',
      'builtin-sequential-roleplay-response-editor',
    ]);
    first[2]!.agent.name = 'changed';
    first[2]!.agent.configurationDefaults.simulationPrompt = 'changed';
    expect(second[2]!.agent.name).toBe('Sequential Roleplay Response Editor');
    expect(second[2]!.agent.configurationDefaults.simulationPrompt).not.toBe('changed');
  });
});
