import { describe, expect, it, vi } from 'vitest';
import presetJson from '../../src/extensions/built-in/custom-agents/presets/scored-roleplay-quality-gate.flow.json';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import type { GraphPreset, JsonObject, JsonValue } from '../../src/extensions/built-in/custom-agents/graph/contracts';
import { parseGraphPresetShape } from '../../src/extensions/built-in/custom-agents/graph/schemas';
import type { GraphLlmRequest } from '../../src/extensions/built-in/custom-agents/registry/node-definition';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import { genericToolCatalog } from '../../src/extensions/built-in/custom-agents/registry/tools';
import { executeGraphPlan } from '../../src/extensions/built-in/custom-agents/runtime/execute-plan';
import { getGraphAgentTemplates } from '../../src/extensions/built-in/custom-agents/settings/catalog';
import { macroService } from '../../src/services/macro-service';

const preset = presetJson as GraphPreset;
const compiled = compileGraphPreset(preset, builtinNodeRegistry);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics, null, 2));

const checkNames = [
  'user_agency_violation',
  'role_or_format_leak',
  'continuity_contradiction',
  'knowledge_boundary_violation',
  'response_contract_violation',
] as const;
const scoreNames = [
  'character_relationship_continuity',
  'progression_causality',
  'prose_freshness_subtext',
  'pacing_interactivity',
] as const;

function evaluation(scores: Partial<Record<(typeof scoreNames)[number], number>> = {}): JsonObject {
  const values = Object.fromEntries(
    scoreNames.map((name) => {
      const score = scores[name] ?? 3;
      return [
        name,
        {
          score,
          candidate_evidence: score <= 2 ? 'Repeated beat.' : null,
          history_evidence: score <= 2 ? 'The prior response used the same beat.' : null,
          reason: score <= 2 ? 'Noticeable repetition.' : 'Acceptable execution.',
          repair: score <= 2 ? 'Advance the scene.' : null,
        },
      ];
    }),
  );
  const weak = Object.values(scores).some((score) => score !== undefined && score <= 2);
  return {
    checks: Object.fromEntries(checkNames.map((name) => [name, { violated: false, evidence: null, reason: null }])),
    scores: values,
    preserve: weak ? ['Keep Hazel at the door.'] : [],
    revision_guidance: weak ? 'Remove the repeated beat and advance once.' : null,
  };
}

async function run(
  dispatch: (request: GraphLlmRequest) => Promise<JsonValue>,
  candidate = 'Draft response.',
  renderedHistory = '\u001euser\u001fContinue.\u001eassistant\u001fDraft response.\u001eassistant\u001fDraft response.\u001eassistant\u001fDraft response.',
) {
  const targetMessage = { index: 2, role: 'ASSISTANT' as const, name: 'Assistant', content: candidate };
  return executeGraphPlan({
    plan: compiled.plan,
    flowId: 'quality-gate',
    event: {
      trigger: 'AFTER_ASSISTANT_MESSAGE',
      generationId: 'generation',
      generationMode: 'NEW',
      message: targetMessage,
    },
    configuration: preset.agent.configurationDefaults,
    state: {},
    signal: new AbortController().signal,
    random: { next: () => 0 },
    ids: { generate: () => 'request-id' },
    tools: genericToolCatalog,
    llm: { dispatch },
    templates: {
      render: async ({ template }) => (template.includes('{{#each chatHistory}}') ? renderedHistory : template),
    },
    promptContext: {
      chatHistory: [
        { index: 0, role: 'USER', name: 'User', content: 'Continue.' },
        { index: 1, role: 'ASSISTANT', name: 'Assistant', content: 'Earlier response.' },
        targetMessage,
      ],
      targetMessage,
      currentCharacter: null,
      persona: null,
    },
  });
}

describe('Scored Roleplay Quality Gate preset', () => {
  it('strictly parses and compiles as one stateless after-generation flow', () => {
    const parsed = parseGraphPresetShape(preset);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.issues, null, 2)).toBe(true);
    expect(compiled.success).toBe(true);
    expect(preset.agent.stateSchema).toEqual({ type: 'object', additionalProperties: false });
    expect(preset.agent.initialState).toEqual({});
    expect(preset.agent.flows).toHaveLength(1);
    expect(preset.agent.flows[0]!.nodes.filter((node) => node.type === 'trigger.after-generation')).toHaveLength(1);
    const loop = preset.agent.flows[0]!.nodes.find((node) => node.id === 'quality-attempts')!;
    const bodyNodes = (loop.data.body as { nodes: GraphPreset['agent']['flows'][number]['nodes'] }).nodes;
    expect(preset.agent.flows[0]!.nodes.filter((node) => node.type === 'control.for-each')).toHaveLength(1);
    expect(bodyNodes.filter((node) => node.type === 'llm.request')).toHaveLength(2);
    expect(bodyNodes.filter((node) => node.type === 'data.template')).toHaveLength(1);
    expect(bodyNodes.filter((node) => node.type === 'data.javascript')).toHaveLength(5);
  });

  it('renders chat history into a deterministic JavaScript input transcript', () => {
    const loop = preset.agent.flows[0]!.nodes.find((node) => node.id === 'quality-attempts')!;
    const bodyNodes = (loop.data.body as { nodes: GraphPreset['agent']['flows'][number]['nodes'] }).nodes;
    const historyNode = bodyNodes.find((node) => node.id === 'history-transcript')!;
    const rendered = macroService.process(historyNode.data.template as string, {
      characters: [],
      chatHistory: [
        { is_user: true, is_system: false, mes: 'User text.' } as never,
        { is_user: false, is_system: false, mes: 'Assistant text.' } as never,
      ],
    });
    expect(rendered).toBe('\u001euser\u001fUser text.\u001eassistant\u001fAssistant text.');
  });

  it('keeps only the longest overlapping repeated n-gram for one candidate occurrence', async () => {
    let report: { items: Array<{ kind: string; text?: string }> } | undefined;
    const candidate = 'She pulled the towel aside.';
    const history =
      '\u001eassistant\u001fShe pulled the towel aside.\u001eassistant\u001fShe pulled the towel aside.\u001eassistant\u001fShe pulled the towel aside.';
    const result = await run(
      async (request) => {
        report = JSON.parse(request.variables.repetitionReport as string) as typeof report;
        return evaluation();
      },
      candidate,
      history,
    );
    expect(result.status).toBe('COMPLETED');
    const phrases = report!.items.filter((item) => item.kind === 'phrase').map((item) => item.text);
    expect(phrases).toContain('she pulled the towel aside');
    expect(phrases).not.toContain('she pulled');
    expect(phrases).not.toContain('she pulled the');
    expect(phrases).not.toContain('pulled the towel aside');
  });

  it('leaves an accepted response untouched', async () => {
    const dispatch = vi.fn(async () => evaluation());
    const result = await run(dispatch);
    expect(result.status, result.status === 'FAILED' ? result.error : '').toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result.effects).toEqual([]);
  });

  it('computes the compound retry rule and replaces the target once', async () => {
    const requests: GraphLlmRequest[] = [];
    const dispatch = vi.fn(async (request: GraphLlmRequest): Promise<JsonValue> => {
      requests.push(request);
      if (request.nodeId.startsWith('evaluate-'))
        return requests.length === 1
          ? evaluation({ character_relationship_continuity: 2, prose_freshness_subtext: 2 })
          : evaluation();
      return { response: 'Repaired response.' };
    });
    const result = await run(dispatch);
    expect(result.status, result.status === 'FAILED' ? result.error : '').toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    expect(requests).toHaveLength(3);
    expect(requests[0]!.variables.currentResponse).toBe('Draft response.');
    const repetitionReport = JSON.parse(requests[0]!.variables.repetitionReport as string) as {
      note?: string;
      history_assistant_turn_count: number;
      recent_assistant_turns_examined: number;
      items: Array<Record<string, unknown>>;
    };
    expect(repetitionReport).toMatchObject({
      history_assistant_turn_count: 2,
      recent_assistant_turns_examined: 2,
      items: expect.arrayContaining([expect.objectContaining({ kind: 'phrase', text: 'draft response' })]),
    });
    expect(repetitionReport.note).toBeUndefined();
    expect(repetitionReport.items.every((item) => item.history_assistant_turns === undefined)).toBe(true);
    expect(requests[1]!.variables).toMatchObject({
      currentResponse: 'Draft response.',
      revisionGuidance: 'Remove the repeated beat and advance once.',
      preserveJson: '["Keep Hazel at the door."]',
    });
    expect(requests[2]!.variables.currentResponse).toBe('Repaired response.');
    expect(result.effects).toEqual([
      { type: 'VISIBLE_MESSAGE', operation: 'REPLACE_TARGET', content: 'Repaired response.' },
    ]);
  });

  it('evaluates all four candidates and accepts the third revision', async () => {
    let revision = 0;
    let evaluationCount = 0;
    const requests: GraphLlmRequest[] = [];
    const result = await run(async (request) => {
      requests.push(request);
      if (request.nodeId === 'evaluate-candidate') {
        evaluationCount += 1;
        return evaluationCount === 4
          ? evaluation()
          : evaluation({ progression_causality: 2, prose_freshness_subtext: 2 });
      }
      revision += 1;
      return { response: `Revision ${revision}.` };
    });
    expect(result.status, result.status === 'FAILED' ? result.error : '').toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    expect(requests).toHaveLength(7);
    expect(requests.map((request) => request.nodeId)).toEqual([
      'evaluate-candidate',
      'revise-candidate',
      'evaluate-candidate',
      'revise-candidate',
      'evaluate-candidate',
      'revise-candidate',
      'evaluate-candidate',
    ]);
    expect(result.effects).toEqual([{ type: 'VISIBLE_MESSAGE', operation: 'REPLACE_TARGET', content: 'Revision 3.' }]);
  });

  it('does not accept any revision when all four candidates fail', async () => {
    let revision = 0;
    const dispatch = vi.fn(async (request: GraphLlmRequest): Promise<JsonValue> => {
      if (request.nodeId.startsWith('evaluate-'))
        return evaluation({ progression_causality: 1, prose_freshness_subtext: 2 });
      revision += 1;
      return { response: `Rejected revision ${revision}.` };
    });
    const result = await run(dispatch);
    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(dispatch).toHaveBeenCalledTimes(7);
    expect(result.error).toContain('rejected the original response and all three revisions');
  });

  it('keeps the evaluator responsible only for evidence and registers the template fourth', () => {
    const defaults = preset.agent.configurationDefaults;
    expect(defaults.recentHistoryCount).toBe(30);
    expect(defaults.evaluatorPrompt).toContain('Do not decide whether the benchmark retries');
    expect(defaults.evaluatorPrompt).toContain('Merely avoiding a defect earns at most 3');
    expect(defaults.revisionPrompt).toContain('Make only the minimum changes needed');
    expect(getGraphAgentTemplates().map((item) => item.agent.id)).toEqual([
      'builtin-mythic',
      'builtin-narrative-momentum-director',
      'builtin-sequential-roleplay-response-editor',
      'builtin-scored-roleplay-quality-gate',
    ]);
  });
});
