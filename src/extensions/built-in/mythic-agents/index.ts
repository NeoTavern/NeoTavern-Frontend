import { GenerationMode } from '../../../constants';
import type { ExtensionAPI } from '../../../types';
import { uuidv4 } from '../../../utils/commons';
import { DEFAULT_BASE_SETTINGS } from './defaults';
import { analyzeUserAction, generateNarration, generateNarrationAndSceneUpdate } from './llm';
import { manifest } from './manifest';
import MythicPanel from './MythicPanel.vue';
import { askOracle } from './oracle';
import { generateInitialScene } from './scene-manager';
import SettingsPanel from './SettingsPanel.vue';
import type {
  MythicCharacter,
  MythicChatExtra,
  MythicChatExtraData,
  MythicMessageExtra,
  MythicSettings,
} from './types';
import { genUNENpc } from './une';

type MythicExtensionAPI = ExtensionAPI<MythicSettings, MythicChatExtra, MythicMessageExtra>;

const DEFAULT_SETTINGS: MythicSettings = { ...DEFAULT_BASE_SETTINGS };

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

    const currentPreset = settings.presets.find((p) => p.name === settings.selectedPreset) || settings.presets[0];
    if (!currentPreset) {
      throw new Error('No valid preset found for Mythic Agents');
    }

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
            currentPreset.data.fateChart,
            extra.scene!,
            currentPreset.data.eventGeneration,
            currentPreset.data.une,
          );
          if (context?.controller.signal.aborted) return;
          anal = result.analysis;
          fateRollResult = result.fateRollResult;
          randomEvent = result.randomEvent;
        }

        // Update scene with new NPCs if any
        let updatedScene = { ...extra.scene! };
        if (randomEvent?.new_npcs) {
          updatedScene.characters = [...updatedScene.characters, ...randomEvent.new_npcs];
        }

        let narration: string;
        // Generate narration and optionally update scene
        if (settings.autoSceneUpdate) {
          const { narration: narr, sceneUpdate } = await generateNarrationAndSceneUpdate(
            api,
            updatedScene,
            anal,
            fateRollResult,
            randomEvent,
            context?.controller.signal,
          );
          if (context?.controller.signal.aborted) return;
          narration = narr;

          // Apply scene update
          const existingChars = new Map(updatedScene.characters.map((c) => [c.name.toLowerCase(), c]));
          const newCharacters: MythicCharacter[] = [];
          for (const char of sceneUpdate.characters) {
            const key = char.name.toLowerCase();
            if (existingChars.has(key)) {
              newCharacters.push(existingChars.get(key)!);
            } else {
              // New character, generate UNE
              newCharacters.push({
                id: uuidv4(),
                name: char.name,
                type: char.type,
                une_profile: genUNENpc(),
              });
            }
          }
          let newChaos = updatedScene.chaos_rank;
          if (sceneUpdate.scene_outcome === 'chaotic') {
            newChaos = Math.min(9, newChaos + 1);
          } else if (sceneUpdate.scene_outcome === 'player_in_control') {
            newChaos = Math.max(1, newChaos - 1);
          }
          updatedScene = {
            chaos_rank: newChaos,
            characters: newCharacters,
            threads: sceneUpdate.threads,
          };
        } else {
          narration = await generateNarration(
            api,
            updatedScene,
            anal,
            fateRollResult,
            randomEvent,
            context?.controller.signal,
          );
          if (context?.controller.signal.aborted) return;
        }

        // Update metadata
        api.chat.metadata.update({
          extra: {
            'core.mythic-agents': {
              scene: updatedScene,
            },
          },
        });
        extra.scene = updatedScene;

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
