import { describe, expect, it, vi } from 'vitest';
import mythic from '../../src/extensions/built-in/custom-agents/presets/mythic.flow.json';
import { compileGraphPreset } from '../../src/extensions/built-in/custom-agents/graph/compile';
import { parseGraphPresetShape } from '../../src/extensions/built-in/custom-agents/graph/schemas';
import { builtinNodeRegistry } from '../../src/extensions/built-in/custom-agents/registry/builtin-nodes';
import { executeGraphPlan } from '../../src/extensions/built-in/custom-agents/runtime/execute-plan';
import { genericToolCatalog } from '../../src/extensions/built-in/custom-agents/registry/tools';
import { GraphHostLlmDispatcher } from '../../src/extensions/built-in/custom-agents/host/prompt';
import { macroService } from '../../src/services/macro-service';
import type { CustomAgentsHostAPI } from '../../src/extensions/built-in/custom-agents/host/api';
import type { GraphLlmRequest } from '../../src/extensions/built-in/custom-agents/registry/node-definition';
import type { ApiChatMessage } from '../../src/types';
import type { GraphPreset, JsonObject, JsonValue } from '../../src/extensions/built-in/custom-agents/graph/contracts';

const preset = mythic as GraphPreset;
const initializedState = (): JsonObject => ({
  initialized: true,
  scene: {
    chaosRank: 5,
    characters: [
      {
        id: 'npc-a',
        name: 'Alice',
        type: 'NPC',
        uneProfile: { modifier: 'Bold', noun: 'Guard', motivationVerb: 'Seek', motivationNoun: 'Truth' },
      },
      {
        id: 'npc-b',
        name: 'Bob',
        type: 'NPC',
        uneProfile: { modifier: 'Calm', noun: 'Guide', motivationVerb: 'Protect', motivationNoun: 'Home' },
      },
    ],
    threads: ['Find the key', 'Escape'],
  },
  resolvedThreads: [],
  actionLog: [],
});
class SequenceRandom {
  constructor(private values: number[]) {}
  next() {
    const value = this.values.shift();
    if (value === undefined) throw new Error('Random sequence exhausted');
    return value;
  }
}
class SequenceIds {
  private index = 0;
  generate() {
    return `generated-${++this.index}`;
  }
}
let cachedPlan: ReturnType<typeof plan> | undefined;
function plan() {
  if (cachedPlan) return cachedPlan;
  const compiled = compileGraphPreset(preset, builtinNodeRegistry);
  if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
  cachedPlan = compiled.plan;
  return cachedPlan;
}
async function run(
  flowId: string,
  state: JsonObject,
  llm: (request: GraphLlmRequest) => Promise<JsonValue>,
  random: number[] = [],
  input: JsonValue = {},
  configuration: JsonObject = structuredClone(preset.agent.configurationDefaults),
) {
  return executeGraphPlan({
    plan: plan(),
    flowId,
    event:
      flowId === 'generate-assistant'
        ? { trigger: 'ASSISTANT_GENERATION', generationId: 'g', generationMode: 'NEW' }
        : { trigger: 'MANUAL', input },
    configuration,
    state,
    signal: new AbortController().signal,
    random: new SequenceRandom(random),
    ids: new SequenceIds(),
    tools: genericToolCatalog,
    llm: { dispatch: llm },
    templates: { render: async ({ template }) => template },
    promptContext: { chatHistory: [], currentCharacter: null, persona: null },
  });
}

describe('Mythic graph preset', () => {
  it('parses and compiles through the closed production registry', () => {
    const parsed = parseGraphPresetShape(preset);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.issues, null, 2)).toBe(true);
    if (!parsed.success) return;
    const compiled = compileGraphPreset(parsed.value, builtinNodeRegistry);
    expect(compiled.success, compiled.success ? '' : JSON.stringify(compiled.diagnostics, null, 2)).toBe(true);
    if (!compiled.success) return;
    const fateFlow = compiled.plan.agent.flows.find((flow) => flow.id === 'question-resolution-fate')!;
    const body = fateFlow.nodes.find((node) => node.id === 'question-resolution-loop')!.bodyPlan!;
    const chaos = body.nodes.find((node) => node.id === 'question-chaos-lookup')!;
    const odds = body.nodes.find((node) => node.id === 'question-odds-lookup')!;
    expect(chaos.outputs.find((port) => port.id === 'property/value')).toMatchObject({
      kind: 'DATA',
      schema: { type: 'object' },
    });
    expect(odds.outputs.find((port) => port.id === 'property/value')).toMatchObject({
      kind: 'DATA',
      schema: { type: 'object', required: ['chance', 'exceptional_yes', 'exceptional_no'] },
    });
    expect(odds.inputBindings.table).toMatchObject({
      kind: 'EDGE',
      sourceNodeId: 'question-chaos-lookup',
      sourcePortId: 'property/value',
    });
    cachedPlan = compiled.plan;
  }, 20_000);

  it('renders configured prompt overrides through GraphHost and reuses initialization for reinitialization', async () => {
    const configuration = structuredClone(preset.agent.configurationDefaults);
    const prompts = configuration.prompts as JsonObject;
    prompts.analysis = 'ANALYSIS_OVERRIDE';
    prompts.initialScene = 'INITIAL_OVERRIDE types={{{input.characterTypes}}}';
    prompts.narration =
      'NARRATION_OVERRIDE questions={{{input.resolvedQuestions}}} events={{{input.events}}} types={{{input.characterTypes}}}';

    const generate = vi.fn(async (messages: ApiChatMessage[], options) => {
      const rendered = messages.at(-1)?.content ?? '';
      const structured_content = rendered.startsWith('INITIAL_OVERRIDE')
        ? { characters: [], threads: [], justification: 'configured initialization' }
        : rendered === 'ANALYSIS_OVERRIDE'
          ? { justification: 'configured analysis', questions: [] }
          : { narration: 'Configured narration.', sceneUpdate: null };
      options?.onCompletion?.({ outputTokens: 1, duration: 1, structured_content });
      return { content: '' };
    });
    const host = {
      macro: {
        process: (text, context, additionalMacros) => macroService.process(text, { ...context, additionalMacros }),
      },
      character: { getActives: () => [] },
      persona: { getActive: () => null },
      chat: { buildPrompt: async () => ({ messages: [] as ApiChatMessage[], includedPromptInjectionIds: [] }) },
      llm: { generate },
    } as unknown as CustomAgentsHostAPI;
    const dispatcher = new GraphHostLlmDispatcher(host);
    const requests: GraphLlmRequest[] = [];
    const llm = async (request: GraphLlmRequest) => {
      requests.push(request);
      return dispatcher.dispatch(request);
    };

    const initialized = await run(
      'generate-assistant',
      structuredClone(preset.agent.initialState),
      llm,
      [],
      {},
      configuration,
    );
    expect(initialized, initialized.status === 'FAILED' ? initialized.error : '').toMatchObject({
      status: 'COMPLETED',
      generationResponse: 'Configured narration.',
    });
    if (initialized.status !== 'COMPLETED') return;
    const reinitialized = await run('reinitialize-scene', initialized.state, llm, [], {}, configuration);
    expect(reinitialized, reinitialized.status === 'FAILED' ? reinitialized.error : '').toMatchObject({
      status: 'COMPLETED',
    });

    expect(requests.map(({ nodeId, prompt }) => [nodeId, prompt])).toEqual([
      ['initialization-extract-scene', '{{{config.prompts.initialScene}}}'],
      ['generate-assistant-analysis', '{{{config.prompts.analysis}}}'],
      ['narration-request', '{{{config.prompts.narration}}}'],
      ['initialization-extract-scene', '{{{config.prompts.initialScene}}}'],
    ]);
    const initializationRequests = requests.filter(({ nodeId }) => nodeId === 'initialization-extract-scene');
    expect(initializationRequests).toHaveLength(2);
    expect(initializationRequests[0]!.variables).toEqual({ characterTypes: expect.any(Array) });
    expect(initializationRequests[1]!.variables).toEqual(initializationRequests[0]!.variables);
    expect(requests.find(({ nodeId }) => nodeId === 'generate-assistant-analysis')!.variables).toEqual({});
    expect(requests.find(({ nodeId }) => nodeId === 'narration-request')!.variables).toEqual({
      resolvedQuestions: [],
      events: [],
      characterTypes: initializationRequests[0]!.variables.characterTypes,
    });

    const renderedPrompts = generate.mock.calls.map(([messages]) => messages.at(-1)?.content);
    expect(renderedPrompts).toEqual([
      expect.stringMatching(/^INITIAL_OVERRIDE types=(?!.*\{\{).*NPC/),
      'ANALYSIS_OVERRIDE',
      expect.stringMatching(/^NARRATION_OVERRIDE questions= events= types=(?!.*\{\{).*NPC/),
      renderedPrompts[0],
    ]);
  });

  it('resolves all four Fate outcomes deterministically and wires exact narration variables', async () => {
    const questions = [10, 91, 50, 51].map((value) => ({
      extracted_question: `Question ${value}?`,
      odds: '50/50',
      justification: `why ${value}`,
    }));
    let narrationVariables: Readonly<Record<string, JsonValue>> | undefined;
    const result = await run(
      'generate-assistant',
      initializedState(),
      async (request) => {
        if (request.nodeId === 'generate-assistant-analysis') return { justification: 'four questions', questions };
        narrationVariables = request.variables;
        return { narration: 'Resolved.', sceneUpdate: null };
      },
      [0.09, 0.9, 0.9, 0.9, 0.49, 0.9, 0.5, 0.9],
    );
    expect(result, result.status === 'FAILED' ? result.error : '').toMatchObject({
      status: 'COMPLETED',
      generationResponse: 'Resolved.',
    });
    if (result.status !== 'COMPLETED') return;
    const resolved = (result.state.actionLog as JsonObject[])[0]!.resolvedQuestions as JsonObject[];
    expect(resolved.map((item) => (item.fate as JsonObject).outcome)).toEqual([
      'EXCEPTIONAL_YES',
      'EXCEPTIONAL_NO',
      'YES',
      'NO',
    ]);
    expect(narrationVariables).toEqual({ resolvedQuestions: resolved, events: [], characterTypes: expect.any(Array) });
  }, 20_000);

  it('initializes from history with configured chaos and stable generated character identity', async () => {
    const configuration = structuredClone(preset.agent.configurationDefaults);
    configuration.initialChaos = 7;
    const result = await run(
      'generate-assistant',
      structuredClone(preset.agent.initialState),
      async (request) => {
        if (request.nodeId === 'initialization-extract-scene')
          return { characters: [{ name: 'Guide', type: 'NPC' }], threads: ['Begin'], justification: 'history' };
        if (request.nodeId === 'generate-assistant-analysis') return { justification: 'start', questions: [] };
        return { narration: 'Begun.', sceneUpdate: null };
      },
      [0, 0, 0, 0],
      {},
      configuration,
    );
    expect(result, result.status === 'FAILED' ? result.error : '').toMatchObject({
      status: 'COMPLETED',
      state: {
        initialized: true,
        scene: { chaosRank: 7, characters: [{ id: 'generated-2', name: 'Guide', type: 'NPC' }], threads: ['Begin'] },
      },
    });
  });

  it('constructs ordered compound random events without replacing character or thread pools', async () => {
    const configuration = structuredClone(preset.agent.configurationDefaults);
    const collection = (configuration.tableCollections as JsonObject).Default as JsonObject;
    collection.eventFocuses = [
      {
        min: 1,
        max: 100,
        focus: 'Compound',
        operations: [
          { operation: 'SELECT_CHARACTER', selector: 'NPC' },
          { operation: 'CREATE_CHARACTER', characterType: 'npc' },
          { operation: 'SELECT_CHARACTER', selector: 'NPC' },
          { operation: 'SELECT_THREAD' },
          { operation: 'SELECT_THREAD' },
        ],
      },
    ];
    let events: JsonValue | undefined;
    const result = await run(
      'generate-assistant',
      initializedState(),
      async (request) => {
        if (request.nodeId === 'generate-assistant-analysis')
          return {
            justification: 'event',
            questions: [{ extracted_question: 'Does it happen?', odds: '50/50', justification: 'uncertain' }],
          };
        events = request.variables.events;
        return { narration: 'Event.', sceneUpdate: null };
      },
      [0.49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      {},
      configuration,
    );
    expect(result, result.status === 'FAILED' ? result.error : '').toMatchObject({ status: 'COMPLETED' });
    const event = (events as JsonObject[])[0]!;
    expect((event.characters as JsonObject[]).map((character) => character.id)).toEqual(['npc-a', 'npc-b']);
    expect(event.threads).toEqual(['Find the key', 'Escape']);
    expect(event.newCharacters).toMatchObject([{ id: 'generated-2', type: 'npc' }]);
  });

  it('executes every manual action through generic graph nodes with strict state', async () => {
    let state = initializedState();
    const invoke = async (flowId: string, input: JsonValue, random: number[] = []) => {
      const result = await run(
        flowId,
        state,
        async () => {
          throw new Error('Unexpected LLM');
        },
        random,
        input,
      );
      expect(result, result.status === 'FAILED' ? result.error : '').toMatchObject({ status: 'COMPLETED' });
      if (result.status === 'COMPLETED') state = result.state;
    };
    await invoke('set-chaos', { chaos: 7 });
    await invoke('add-random-npc', {}, [0, 0, 0, 0]);
    const added = ((state.scene as JsonObject).characters as JsonObject[]).at(-1)!;
    await invoke('edit-npc', {
      id: added.id,
      name: 'Edited',
      type: 'NPC',
      modifier: '',
      noun: '',
      motivationVerb: '',
      motivationNoun: '',
    });
    await invoke('regenerate-npc-une', { id: added.id }, [0, 0, 0, 0]);
    await invoke('remove-npc', { id: added.id });
    await invoke('add-thread', { thread: '  New mystery  ' });
    await invoke('resolve-thread', { thread: 'New mystery' });
    await invoke('reopen-thread', { thread: 'New mystery' });
    await invoke('remove-thread', { thread: 'New mystery' });
    expect(state).toMatchObject({
      scene: { chaosRank: 7, characters: expect.any(Array), threads: ['Find the key', 'Escape'] },
      resolvedThreads: [],
    });
  });

  it('reconciles scene characters and clamps chaos through the scene-update subflow', async () => {
    const state = initializedState();
    (state.scene as JsonObject).chaosRank = 9;
    const result = await run(
      'generate-assistant',
      state,
      async (request) =>
        request.nodeId === 'generate-assistant-analysis'
          ? { justification: 'scene', questions: [] }
          : {
              narration: 'Changed.',
              sceneUpdate: {
                characters: [
                  { name: 'alice', type: 'Changed' },
                  { name: 'Cara', type: 'NPC' },
                ],
                threads: ['New thread'],
                sceneOutcome: 'CHAOTIC',
                justification: 'updated',
              },
            },
      [0, 0, 0, 0],
    );
    expect(result, result.status === 'FAILED' ? result.error : '').toMatchObject({
      status: 'COMPLETED',
      state: {
        scene: {
          chaosRank: 9,
          characters: [
            { id: 'npc-a', name: 'Alice' },
            { id: 'generated-3', name: 'Cara' },
          ],
          threads: ['New thread'],
        },
      },
    });
  });
});
