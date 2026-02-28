import { GenerationMode } from '../../../constants';
import type { TypedChatMessage } from '../../../types/ExtensionAPI';
import { uuidv4 } from '../../../utils/commons';
import { eventEmitter } from '../../../utils/extensions';
import { DEFAULT_BASE_SETTINGS } from './defaults';
import { analyzeUserAction, generateNarration, generateNarrationAndSceneUpdate } from './llm';
import { manifest } from './manifest';
import MythicPanel from './MythicPanel.vue';
import { askOracle } from './oracle';
import { generateInitialScene } from './scene-manager';
import SettingsPanel from './SettingsPanel.vue';
import type {
  MythicCharacter,
  MythicExtensionAPI,
  MythicMessageExtra,
  MythicMessageExtraData,
  MythicSettings,
} from './types';
import { genUNENpc } from './une';

function getCurrentMythicData(api: MythicExtensionAPI): MythicMessageExtraData | undefined {
  const history = api.chat.getHistory();
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.extra?.['core.mythic-agents']) {
      return msg.extra['core.mythic-agents'] as MythicMessageExtraData;
    }
  }
  return undefined;
}

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

  api.events.on('chat:generation-requested', async (payload, context) => {
    const settings = { ...DEFAULT_SETTINGS, ...api.settings.get() };
    if (!settings.enabled || !settings.autoAnalyze) return;

    if (![GenerationMode.NEW, GenerationMode.REGENERATE, GenerationMode.ADD_SWIPE].includes(payload.mode)) {
      throw new Error('Mythic Agents extension only supports NEW, REGENERATE, and ADD_SWIPE generation modes');
    }

    let currentMythicData: MythicMessageExtraData | undefined = getCurrentMythicData(api);

    payload.handled = true;
    const lastMessage = api.chat.getLastMessage();
    if (!lastMessage) return;

    let userMessage: TypedChatMessage<MythicMessageExtra> | null = lastMessage;
    let isSwipe = false;

    if (payload.mode === GenerationMode.REGENERATE) {
      if (lastMessage.is_user || lastMessage.is_system) return; // can't regenerate
      // Delete the last message
      await api.chat.deleteMessage(api.chat.getHistoryLength() - 1);
      // Now last message should be user
      userMessage = api.chat.getLastMessage();
      if (!userMessage || !userMessage.is_user) return;
    } else if (payload.mode === GenerationMode.ADD_SWIPE) {
      if (lastMessage.is_user || lastMessage.is_system) return; // can't add swipe
      isSwipe = true;
      // Find last user message
      const history = api.chat.getHistory();
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].is_user) {
          userMessage = history[i];
          break;
        }
      }
      if (!userMessage) return;
    }

    if (!userMessage.is_user) return;

    const currentPreset = settings.presets.find((p) => p.name === settings.selectedPreset) || settings.presets[0];
    if (!currentPreset) {
      throw new Error('No valid preset found for Mythic Agents');
    }

    // Set generating state
    api.chat.setGeneratingState(true);
    const activeCharacter = api.character.getActives()[0];

    // Run in background
    (async () => {
      try {
        if (context?.controller.signal.aborted) return;

        if (!currentMythicData?.scene) {
          const scene = await generateInitialScene(api, undefined);
          const chaos = settings.chaos;
          currentMythicData = {
            scene: { ...scene, chaos_rank: chaos },
            chaos,
          };
          api.chat.metadata.update({
            extra: {
              actionHistory: [],
              resolved_threads: [],
            },
          });
        }

        // Analyze
        let analysis;
        try {
          analysis = await analyzeUserAction(
            api,
            currentMythicData.scene!,
            isSwipe ? api.chat.getHistory().slice(0, -1) : undefined,
            context?.controller.signal,
          );
          if (context?.controller.signal.aborted) return;
        } catch (error) {
          console.error('Mythic Agents analysis error:', error);
          return;
        }

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
            currentMythicData.chaos ?? 5,
            currentPreset.data.fateChart,
            currentMythicData.scene!,
            currentPreset.data.eventGeneration,
            currentPreset.data.une,
          );
          if (context?.controller.signal.aborted) return;
          anal = result.analysis;
          fateRollResult = result.fateRollResult;
          randomEvent = result.randomEvent;
        }

        // Update scene with new NPCs if any
        let updatedScene = { ...currentMythicData.scene! };
        if (randomEvent?.new_npcs) {
          updatedScene.characters = [...updatedScene.characters, ...randomEvent.new_npcs];
        }

        let messageIndex: number;
        let swipeId: number = 0;
        if (isSwipe) {
          messageIndex = api.chat.getHistoryLength() - 1;
          swipeId = lastMessage.swipes.length;
        } else {
          messageIndex = api.chat.getHistoryLength();
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
            messageIndex,
            swipeId,
            isSwipe ? api.chat.getHistory().slice(0, -1) : undefined,
            context?.controller.signal,
          );
          if (context?.controller.signal.aborted) return;
          narration = narr;

          // Apply scene update
          const existingChars = new Map<string, MythicCharacter>(
            updatedScene.characters.map((c: MythicCharacter) => [c.name.toLowerCase(), c]),
          );
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
                une_profile: genUNENpc(
                  currentPreset.data.une.modifiers,
                  currentPreset.data.une.nouns,
                  currentPreset.data.une.motivation_verbs,
                  currentPreset.data.une.motivation_nouns,
                ),
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
            messageIndex,
            swipeId,
            isSwipe ? api.chat.getHistory().slice(0, -1) : undefined,
            context?.controller.signal,
          );
          if (context?.controller.signal.aborted) return;
        }

        // Create assistant message object
        const genStarted = new Date().toISOString();
        const genFinished = new Date().toISOString();
        const actionData = { analysis: anal, fateRollResult, randomEvent };

        const currentActionHistory = api.chat.metadata.get()?.extra?.actionHistory ?? [];
        api.chat.metadata.update({
          extra: {
            actionHistory: [...currentActionHistory, actionData],
          },
        });

        if (isSwipe) {
          // Update the last message (which is assistant) to add swipe
          const history = api.chat.getHistory();
          const lastMsgIndex = messageIndex;
          const lastMsg = history[lastMsgIndex];
          if (!Array.isArray(lastMsg.swipes)) {
            lastMsg.swipes = [lastMsg.mes];
          }
          if (!Array.isArray(lastMsg.swipe_info)) {
            lastMsg.swipe_info = [];
          }
          const newSwipes = [...lastMsg.swipes, narration];
          const newSwipeInfo = [
            ...lastMsg.swipe_info,
            {
              send_date: genStarted,
              gen_started: genStarted,
              gen_finished: genFinished,
              generation_id: payload.generationId,
              extra: {
                'core.mythic-agents': {
                  action: actionData,
                  scene: updatedScene,
                  chaos: updatedScene.chaos_rank,
                },
              },
            },
          ];
          await api.chat.updateMessageObject(lastMsgIndex, {
            mes: narration,
            swipes: newSwipes,
            swipe_info: newSwipeInfo,
            swipe_id: newSwipes.length - 1,
            extra: {
              ...lastMsg.extra,
              'core.mythic-agents': {
                action: actionData,
                scene: updatedScene,
                chaos: updatedScene.chaos_rank,
              },
            },
          });
          await eventEmitter.emit('message:swipe-changed', lastMsgIndex, lastMsg.swipe_id);
        } else {
          const assistantMsg = await api.chat.createMessage({
            role: 'assistant',
            content: narration,
            name: activeCharacter.name,
          });
          assistantMsg.gen_started = genStarted;
          assistantMsg.gen_finished = genFinished;

          assistantMsg.extra = {
            'core.mythic-agents': {
              action: actionData,
              scene: updatedScene,
              chaos: updatedScene.chaos_rank,
            },
          };
          if (assistantMsg.swipe_info && assistantMsg.swipe_info[0]) {
            assistantMsg.swipe_info[0].extra = {
              ...assistantMsg.swipe_info[0].extra,
              'core.mythic-agents': {
                action: actionData,
                scene: updatedScene,
                chaos: updatedScene.chaos_rank,
              },
            };
          }

          await api.chat.updateMessageObject(api.chat.getHistoryLength() - 1, { extra: assistantMsg.extra });
        }
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
