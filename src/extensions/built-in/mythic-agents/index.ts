import { GenerationMode } from '../../../constants';
import type { ExtensionAPI } from '../../../types';
import { DEFAULT_EVENT_GENERATION_DATA, DEFAULT_FATE_CHART_DATA, DEFAULT_UNE_SETTINGS } from './defaults';
import { analyzeUserAction, generateNarration } from './llm';
import { manifest } from './manifest';
import MythicPanel from './MythicPanel.vue';
import { askOracle } from './oracle';
import { ANALYSIS_PROMPT, INITIAL_SCENE_PROMPT, NARRATION_PROMPT, SCENE_UPDATE_PROMPT } from './prompts';
import { generateInitialScene } from './scene-manager';
import SettingsPanel from './SettingsPanel.vue';
import type {
  MythicCharacter,
  MythicChatExtra,
  MythicChatExtraData,
  MythicMessageExtra,
  MythicSettings,
} from './types';

type MythicExtensionAPI = ExtensionAPI<MythicSettings, MythicChatExtra, MythicMessageExtra>;

const DEFAULT_SETTINGS: MythicSettings = {
  enabled: true,
  autoAnalyze: true,
  chaos: 5,
  connectionProfileId: '',
  language: 'English',
  prompts: {
    analysis: ANALYSIS_PROMPT,
    initialScene: INITIAL_SCENE_PROMPT,
    sceneUpdate: SCENE_UPDATE_PROMPT,
    narration: NARRATION_PROMPT,
  },
  fateChart: DEFAULT_FATE_CHART_DATA,
  eventGeneration: DEFAULT_EVENT_GENERATION_DATA,
  une: DEFAULT_UNE_SETTINGS,
  characterTypes: ['NPC', 'PC'],
};

export function activate(api: MythicExtensionAPI) {
  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  // Register the sidebar
  api.ui.registerSidebar('mythic-panel', MythicPanel, 'right', {
    icon: 'fa-dice-d20',
    title: 'Mythic Agents',
    props: { api },
  });

  // Register navbar item
  api.ui.registerNavBarItem('mythic', {
    icon: 'fa-dice-d20',
    title: 'Mythic Agents (GME)',
    layoutComponent: MythicPanel,
    layoutProps: { api },
    onClick() {
      api.ui.openSidebar('mythic-panel');
    },
  });

  // Hooks
  api.events.on('chat:entered', async () => {
    const settings = { ...DEFAULT_SETTINGS, ...api.settings.get() };
    if (!settings.enabled || !settings.autoAnalyze) return;

    // Load or generate initial scene
    const chatInfo = api.chat.getChatInfo();
    const extra = chatInfo?.chat_metadata.extra?.['core.mythic-agents'] as MythicChatExtraData | undefined;
    if (!extra?.scene) {
      // Generate initial scene
      const scene = await generateInitialScene(api, undefined);
      const settings = { ...DEFAULT_SETTINGS, ...api.settings.get() };
      const chaos = settings.chaos;
      api.chat.metadata.update({
        extra: { 'core.mythic-agents': { scene: { ...scene, chaos_rank: chaos }, chaos, actionHistory: [] } },
      });
    }
  });

  api.events.on('chat:generation-requested', async (payload, context) => {
    const settings = { ...DEFAULT_SETTINGS, ...api.settings.get() };
    if (!settings.enabled || !settings.autoAnalyze) return;

    if (![GenerationMode.NEW].includes(payload.mode)) {
      throw new Error('Mythic Agents extension only supports NEW generation mode');
    }

    const chatInfo = api.chat.getChatInfo();
    const extra = chatInfo?.chat_metadata.extra?.['core.mythic-agents'] as MythicChatExtraData | undefined;
    if (!extra || !extra.scene) return;

    // Get the last user message
    const lastMessage = api.chat.getLastMessage();
    if (!lastMessage || !lastMessage.is_user) return;

    // Analyze
    let analysis;
    try {
      analysis = await analyzeUserAction(api, extra.scene, context?.controller.signal);
      if (context?.controller.signal.aborted) return;
    } catch (error) {
      console.error('Mythic Agents analysis error:', error);
      return;
    }

    // Set handled
    payload.handled = true;

    // Set generating state
    api.chat.setGeneratingState(true);
    const activeCharacter = api.character.getActives()[0];

    // Run in background
    (async () => {
      try {
        if (context?.controller.signal.aborted) return;

        let fateRollResult:
          | {
              roll: number;
              chaosDie: number;
              outcome: 'Yes' | 'No' | 'Exceptional Yes' | 'Exceptional No';
              exceptional: boolean;
            }
          | undefined;
        let randomEvent: { focus: string; action: string; subject: string; new_npcs?: MythicCharacter[] } | undefined;
        let anal = analysis;

        if (analysis.requires_fate_roll) {
          const result = await askOracle(
            analysis,
            extra.chaos,
            settings.fateChart,
            extra.scene!,
            settings.eventGeneration,
            settings.une,
          );
          if (context?.controller.signal.aborted) return;
          anal = result.analysis;
          fateRollResult = result.fateRollResult;
          randomEvent = result.randomEvent;
        }

        // Generate narration
        const narration = await generateNarration(
          api,
          extra.scene!,
          anal,
          fateRollResult,
          randomEvent,
          context?.controller.signal,
        );
        if (context?.controller.signal.aborted) return;

        // Update scene with new NPCs if any
        if (randomEvent?.new_npcs) {
          const updatedScene = {
            ...extra.scene!,
            characters: [...extra.scene!.characters, ...randomEvent.new_npcs],
          };
          api.chat.metadata.update({
            extra: {
              'core.mythic-agents': {
                scene: updatedScene,
              },
            },
          });
          extra.scene = updatedScene;
        }

        // Create assistant message
        const assistantMsg = api.chat.createMessage({
          role: 'assistant',
          content: narration,
          name: activeCharacter.name,
        });
        assistantMsg.extra = { 'core.mythic-agents': { action: { analysis: anal, fateRollResult, randomEvent } } };

        // Update action history
        const currentExtra = api.chat.getChatInfo()?.chat_metadata.extra?.['core.mythic-agents'] as
          | MythicChatExtraData
          | undefined;
        api.chat.metadata.update({
          extra: {
            'core.mythic-agents': {
              actionHistory: [...(currentExtra?.actionHistory ?? []), { analysis: anal, fateRollResult, randomEvent }],
            },
          },
        });
      } catch (error) {
        console.error('Mythic Agents error:', error);
        api.ui.showToast('Mythic Agents encountered an error. Check console for details.', 'error');
      } finally {
        api.chat.setGeneratingState(false);
      }
    })();
  });

  api.events.on('generation:aborted', () => {
    // The AbortController will handle aborting the async operations
  });
}

export { manifest };
