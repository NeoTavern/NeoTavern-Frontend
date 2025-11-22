import { defineStore } from 'pinia';
import { computed, nextTick, ref, watch } from 'vue';
import { debounce } from 'lodash-es';
import {
  type ChatMessage,
  type ChatMetadata,
  type SwipeInfo,
  type GenerationContext,
  type GenerationResponse,
  type StreamedChunk,
  type ItemizedPrompt,
  type PromptTokenBreakdown,
  type FullChat,
  type ChatHeader,
  type ChatInfo,
  type Character,
  type WorldInfoBook,
  POPUP_TYPE,
  POPUP_RESULT,
} from '../types';
import { usePromptStore } from './prompt.store';
import { useCharacterStore } from './character.store';
import { useUiStore } from './ui.store';
import { useApiStore } from './api.store';
import { fetchChat, saveChat as apiSaveChat, saveChat } from '../api/chat';
import { getMessageTimeStamp } from '../utils/date';
import { uuidv4 } from '../utils/common';
import { getFirstMessage } from '../utils/chat';
import { toast } from '../composables/useToast';
import { useStrictI18n } from '../composables/useStrictI18n';
import { PromptBuilder } from '../utils/prompt-builder';
import { buildChatCompletionPayload, ChatCompletionService } from '../api/generation';
import { getThumbnailUrl } from '../utils/image';
import {
  default_user_avatar,
  DEFAULT_SAVE_EDIT_TIMEOUT,
  GenerationMode,
  GroupGenerationHandlingMode,
  GroupReplyStrategy,
  talkativeness_default,
} from '../constants';
import { useSettingsStore } from './settings.store';
import { usePersonaStore } from './persona.store';
import { eventEmitter } from '../utils/event-emitter';
import { ApiTokenizer } from '../api/tokenizer';
import { getCharactersForContext } from '../utils/group-chat';
import { useWorldInfoStore } from './world-info.store';
import { usePopupStore } from './popup.store';
import { convertCharacterBookToWorldInfoBook } from '../utils/world-info-conversion';
import * as apiWorldInfo from '../api/world-info';

export type ChatStoreState = {
  messages: ChatMessage[];
  metadata: ChatMetadata;
};

export type ChatMessageEditState = {
  index: number;
  originalContent: string;
};

export const useChatStore = defineStore('chat', () => {
  const { t } = useStrictI18n();
  const activeChat = ref<ChatStoreState | null>(null);
  const activeChatFile = ref<string | null>(null);
  const activeMessageEditState = ref<ChatMessageEditState | null>(null);

  const isGenerating = ref(false);
  const generationController = ref<AbortController | null>(null);
  const isChatLoading = ref(false);
  const chatInfos = ref<ChatInfo[]>([]);
  const recentChats = ref<ChatInfo[]>([]);

  const autoModeTimer = ref<ReturnType<typeof setTimeout> | null>(null);

  const uiStore = useUiStore();
  const personaStore = usePersonaStore();
  const characterStore = useCharacterStore();
  const promptStore = usePromptStore();
  const settingsStore = useSettingsStore();
  const worldInfoStore = useWorldInfoStore();
  const popupStore = usePopupStore();

  const chatsMetadataByCharacterAvatars = computed(() => {
    const mapping: Record<string, ChatInfo[]> = {};
    for (const chatInfo of chatInfos.value) {
      for (const memberAvatar of chatInfo.chat_metadata.members || []) {
        if (!mapping[memberAvatar]) {
          mapping[memberAvatar] = [];
        }
        mapping[memberAvatar].push(chatInfo);
      }
    }
    return mapping;
  });

  const isGroupChat = computed(() => {
    return activeChat.value && (activeChat.value.metadata.members?.length ?? 0) > 1;
  });

  const groupConfig = computed(() => {
    if (!activeChat.value) return null;

    // Initialize defaults if missing
    if (!activeChat.value.metadata.group) {
      activeChat.value.metadata.group = {
        config: {
          replyStrategy: GroupReplyStrategy.NATURAL_ORDER,
          handlingMode: GroupGenerationHandlingMode.SWAP,
          allowSelfResponses: false,
          autoMode: 0,
        },
        members: {},
      };
      // Sync members list status
      activeChat.value.metadata.members?.forEach((avatar) => {
        activeChat.value!.metadata.group!.members[avatar] = { muted: false };
      });
    }
    return activeChat.value.metadata.group;
  });

  const saveChatDebounced = debounce(async () => {
    if (!activeChat.value || !activeChatFile.value) {
      console.error('Debounced save failed: No active character or chat file.');
      return;
    }

    try {
      uiStore.isChatSaving = true;
      const chatToSave: FullChat = [
        {
          chat_metadata: activeChat.value.metadata,
        },
        ...activeChat.value.messages,
      ];
      await apiSaveChat(activeChatFile.value, chatToSave);

      await promptStore.saveItemizedPrompts(activeChatFile.value);
      const chatInfo = chatInfos.value.find((c) => c.file_name === activeChatFile.value)?.chat_metadata;
      if (chatInfo) {
        chatInfo.chat_metadata = activeChat.value.metadata;
      }
      const recentChatInfo = recentChats.value.find((c) => c.file_name === activeChatFile.value)?.chat_metadata;
      if (recentChatInfo) {
        recentChatInfo.chat_metadata = activeChat.value.metadata;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('Failed to save chat:', error);
      toast.error(error.message || 'An unknown error occurred while saving the chat.');
    } finally {
      uiStore.isChatSaving = false;
    }
  }, DEFAULT_SAVE_EDIT_TIMEOUT);

  watch(
    [activeChat],
    () => {
      nextTick(async () => {
        await eventEmitter.emit('chat:updated', activeChatFile.value as string);
      });

      if (!isChatLoading.value && activeChat.value) {
        saveChatDebounced();
      }
    },
    { deep: true },
  );

  watch(
    () => isGenerating.value,
    (generating) => {
      if (!generating && groupConfig.value?.config.autoMode && groupConfig.value.config.autoMode > 0) {
        startAutoModeTimer();
      } else {
        stopAutoModeTimer();
      }
    },
  );

  function startAutoModeTimer() {
    stopAutoModeTimer();
    if (!groupConfig.value?.config.autoMode) return;

    autoModeTimer.value = setTimeout(() => {
      generateResponse(GenerationMode.NEW);
    }, groupConfig.value.config.autoMode * 1000);
  }

  function stopAutoModeTimer() {
    if (autoModeTimer.value) {
      clearTimeout(autoModeTimer.value);
      autoModeTimer.value = null;
    }
  }

  function determineNextSpeaker(characters: Character[], lastMessage: ChatMessage | null): Character | null {
    if (!groupConfig.value) return characters[0];
    const strategy = groupConfig.value.config.replyStrategy;
    const activeMembers = characters.filter((c) => !groupConfig.value!.members[c.avatar]?.muted);

    if (activeMembers.length === 0) return null; // Everyone muted

    if (strategy === GroupReplyStrategy.LIST_ORDER) {
      if (!lastMessage || lastMessage.is_user) return activeMembers[0];
      const lastIndex = activeMembers.findIndex((c) => c.avatar === lastMessage.original_avatar);
      const nextIndex = (lastIndex + 1) % activeMembers.length;
      return activeMembers[nextIndex];
    }

    if (strategy === GroupReplyStrategy.POOLED_ORDER) {
      // Check who hasn't spoken since last user message
      let lastUserIndex = -1;
      const messages = activeChat.value?.messages || [];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].is_user) {
          lastUserIndex = i;
          break;
        }
      }

      const speakersSinceUser = new Set<string>();
      if (lastUserIndex > -1) {
        for (let i = lastUserIndex + 1; i < messages.length; i++) {
          if (!messages[i].is_user) speakersSinceUser.add(messages[i].name);
        }
      }

      const available = activeMembers.filter((c) => !speakersSinceUser.has(c.name));
      if (available.length > 0) {
        return available[Math.floor(Math.random() * available.length)];
      }
      // All spoke? Pick random.
      return activeMembers[Math.floor(Math.random() * activeMembers.length)];
    }

    if (strategy === GroupReplyStrategy.NATURAL_ORDER) {
      if (!lastMessage) return activeMembers[Math.floor(Math.random() * activeMembers.length)];

      const textToCheck = lastMessage.mes.toLowerCase();
      const mentions: Character[] = [];

      // 1. Check mentions
      for (const char of activeMembers) {
        if (!groupConfig.value.config.allowSelfResponses && lastMessage.original_avatar === char.avatar) continue;

        // Simple name matching
        const nameParts = char.name.toLowerCase().split(' ');
        for (const part of nameParts) {
          if (part.length > 2 && new RegExp(`\\b${part}\\b`).test(textToCheck)) {
            mentions.push(char);
            break;
          }
        }
      }

      if (mentions.length > 0) {
        return mentions[0]; // TODO: Queue not implemented fully, pick first mention
      }

      // 2. Talkativeness RNG
      const candidates: Character[] = [];
      for (const char of activeMembers) {
        if (!groupConfig.value.config.allowSelfResponses && lastMessage.original_avatar === char.avatar) continue;

        const chance = (char.talkativeness ?? talkativeness_default) * 100;
        if (Math.random() * 100 < chance) {
          candidates.push(char);
        }
      }

      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }

      // 3. Fallback
      return activeMembers[Math.floor(Math.random() * activeMembers.length)];
    }

    // Manual/Default
    return null;
  }

  async function clearChat(recreateFirstMessage = false) {
    if (!activeChat.value) return;
    isChatLoading.value = true;

    saveChatDebounced.cancel();
    activeChat.value.messages = [];

    if (!recreateFirstMessage) {
      activeChatFile.value = null;
    }

    promptStore.extensionPrompts = {};
    if (activeChatFile.value) {
      await promptStore.saveItemizedPrompts(activeChatFile.value);
    }
    promptStore.itemizedPrompts = [];

    await nextTick();
    await eventEmitter.emit('chat:cleared');

    if (recreateFirstMessage && characterStore.activeCharacters.length > 0) {
      // Group chat? Recreate first message for the *primary* character (first in list)
      const activeCharacter = characterStore.activeCharacters[0];
      if (activeCharacter) {
        const firstMessage = getFirstMessage(activeCharacter);
        if (firstMessage?.mes) {
          activeChat.value.messages.push(firstMessage);
          await nextTick();
          await eventEmitter.emit('message:created', firstMessage);
        }
      }
    }

    isChatLoading.value = false;

    // Manually trigger a save if a new first message was created.
    if (recreateFirstMessage && activeChat.value.messages.length > 0) {
      saveChatDebounced();
    }
  }

  async function setActiveChatFile(chatFile: string) {
    if (activeChatFile.value === chatFile) return;
    await clearChat(false);

    // TODO: unshallow character logic if needed
    isChatLoading.value = true;

    try {
      const response = await fetchChat(chatFile);
      if (response.length > 0) {
        const metadataItem = response.shift() as ChatHeader;
        activeChatFile.value = chatFile;
        activeChat.value = {
          metadata: metadataItem.chat_metadata,
          messages: response as ChatMessage[],
        };
      }

      if (activeChatFile.value) {
        for (const character of characterStore.activeCharacters) {
          const changes = characterStore.getDifferences(character, { ...character, chat: activeChatFile.value });
          if (changes) {
            await characterStore.updateAndSaveCharacter(character.avatar, changes);
          }
        }

        // Check for embedded lorebooks in characters
        for (const character of characterStore.activeCharacters) {
          if (character.data?.character_book) {
            const bookName = character.data.character_book.name || character.name;
            // Check if book exists globally
            const exists = await worldInfoStore.getBookFromCache(bookName, true);
            if (!exists) {
              // Ask to import
              const { result } = await popupStore.show({
                title: t('worldInfo.popup.importEmbeddedTitle'),
                content: t('worldInfo.popup.importEmbeddedContent', { name: bookName }),
                type: POPUP_TYPE.CONFIRM,
              });

              if (result === POPUP_RESULT.AFFIRMATIVE) {
                const wiBook = convertCharacterBookToWorldInfoBook(character.data.character_book);
                wiBook.name = bookName;
                await apiWorldInfo.saveWorldInfoBook(bookName, wiBook);
                await worldInfoStore.refresh();
                toast.success(t('worldInfo.importSuccess', { name: bookName }));
              }
            }
          }
        }

        await promptStore.loadItemizedPrompts(activeChatFile.value);

        // Persona Switching Logic
        const meta = activeChat.value!.metadata;
        if (meta.active_persona) {
          // Chat specific lock
          await personaStore.setActivePersona(meta.active_persona);
        } else if (activeChat.value!.metadata.members?.length === 1) {
          // Single character lock check
          const charAvatar = activeChat.value!.metadata.members[0];
          const linkedPersona = personaStore.getLinkedPersona(charAvatar);
          if (linkedPersona) {
            await personaStore.setActivePersona(linkedPersona.avatarId);
          } else if (settingsStore.settings.persona.defaultPersonaId) {
            // Fallback to default
            await personaStore.setActivePersona(settingsStore.settings.persona.defaultPersonaId);
          }
        } else if (settingsStore.settings.persona.defaultPersonaId) {
          // Fallback to default for Groups (if no explicit chat lock)
          await personaStore.setActivePersona(settingsStore.settings.persona.defaultPersonaId);
        }

        await nextTick();
        await eventEmitter.emit('chat:entered', activeChatFile.value as string);
      }
    } catch (error) {
      console.error('Failed to refresh chat:', error);
      toast.error(t('chat.loadError'));
    } finally {
      isChatLoading.value = false;
    }
  }

  async function createNewChatForCharacter(avatar: string, chatName: string) {
    const character = characterStore.characters.find((c) => c.avatar === avatar);
    if (!character) {
      throw new Error('Character not found for creating new chat.');
    }

    try {
      isChatLoading.value = true;

      const filename = uuidv4();
      const fullFilename = `${filename}.jsonl`;

      const firstMessage = getFirstMessage(character);
      activeChat.value = {
        metadata: {
          members: [character.avatar],
          integrity: uuidv4(),
          promptOverrides: { scenario: '' },
          name: chatName,
        },
        messages: firstMessage && firstMessage.mes ? [firstMessage] : [],
      };
      const fullChat: FullChat = [{ chat_metadata: activeChat.value.metadata }, ...activeChat.value.messages];
      await saveChat(filename, fullChat);
      characterStore.updateAndSaveCharacter(character.avatar, { chat: filename });

      activeChatFile.value = filename;
      const cInfo: ChatInfo = {
        chat_metadata: activeChat.value.metadata,
        chat_items: activeChat.value.messages.length,
        file_id: filename,
        file_name: fullFilename,
        file_size: JSON.stringify(fullChat).length,
        last_mes: Date.now(),
        mes: firstMessage?.mes || '',
      };
      chatInfos.value.push(cInfo);
      recentChats.value.push(cInfo);

      await nextTick();
      await eventEmitter.emit('chat:entered', filename);
      if (firstMessage?.mes) {
        await eventEmitter.emit('message:created', firstMessage);
      }
    } catch (error) {
      console.error('Failed to create new chat:', error);
      toast.error(t('chat.createError'));
    } finally {
      isChatLoading.value = false;
    }
  }

  async function updateChatName(fileId: string, newName: string) {
    const chatInfo = chatInfos.value.find((c) => c.file_id === fileId);
    if (!chatInfo) return;

    // If active chat, update local state and save
    if (activeChatFile.value === fileId && activeChat.value) {
      activeChat.value.metadata.name = newName;
      chatInfo.chat_metadata.name = newName;
      saveChatDebounced();
    } else {
      // If not active, we need to load it briefly or rely on API if it supports metadata patch
      // Assuming we need to load full chat to update metadata safely
      try {
        const response = await fetchChat(fileId);
        if (response.length > 0) {
          const metadataItem = response[0] as ChatHeader;
          metadataItem.chat_metadata.name = newName;
          await saveChat(fileId, response as FullChat);
          chatInfo.chat_metadata.name = newName; // Update cache
        }
      } catch (error) {
        console.error('Failed to update chat name', error);
        toast.error(t('chat.renameError'));
      }
    }
  }

  async function toggleChatPersona(personaId: string) {
    if (!activeChat.value) return;

    if (activeChat.value.metadata.active_persona === personaId) {
      delete activeChat.value.metadata.active_persona;
      toast.info(t('personaManagement.connections.chatRemoved'));
    } else {
      activeChat.value.metadata.active_persona = personaId;
      toast.success(t('personaManagement.connections.chatAdded'));
    }
    saveChatDebounced();
  }

  async function syncPersonaName(personaId: string, newName: string) {
    if (!activeChat.value) return;

    let updatedCount = 0;
    const messages = activeChat.value.messages;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.original_avatar === personaId && msg.name !== newName) {
        msg.name = newName;
        updatedCount++;
        await eventEmitter.emit('message:updated', i, msg);
      }
    }

    if (updatedCount > 0) {
      saveChatDebounced();
      toast.success(t('personaManagement.syncName.success', { count: updatedCount }));
    } else {
      toast.info(t('personaManagement.syncName.noChanges'));
    }
  }

  function abortGeneration() {
    if (generationController.value) {
      generationController.value.abort();
      isGenerating.value = false;
      generationController.value = null;
    }
  }

  // Optional: forceSpeaker allows bypassing logic to force specific char
  async function generateResponse(mode: GenerationMode, forceSpeakerAvatar?: string) {
    if (isGenerating.value) return;

    const startController = new AbortController();
    await eventEmitter.emit('generation:started', startController);
    if (startController.signal.aborted) {
      console.log(`Generation aborted by extension (generation:started). Reason: ${startController.signal.reason}`);
      return;
    }

    if (generationController.value) {
      generationController.value.abort();
    }
    generationController.value = new AbortController();

    const characterStore = useCharacterStore();
    const apiStore = useApiStore();
    const settingsStore = useSettingsStore();
    const promptStore = usePromptStore();

    let activeCharacter: Character | null = null;

    if (forceSpeakerAvatar) {
      activeCharacter = characterStore.activeCharacters.find((c) => c.avatar === forceSpeakerAvatar) || null;
    }

    if (!activeCharacter) {
      if (characterStore.activeCharacters.length === 1) {
        activeCharacter = characterStore.activeCharacters[0];
      } else {
        const lastMessage = activeChat.value?.messages.length
          ? activeChat.value.messages[activeChat.value.messages.length - 1]
          : null;
        activeCharacter = determineNextSpeaker(characterStore.activeCharacters, lastMessage);
      }
    }

    if (!activeCharacter) {
      toast.info(t('chat.generate.noSpeaker'));
      isGenerating.value = false;
      return;
    }

    let generatedMessage: ChatMessage | null = null;
    let generationError: Error | undefined;

    const activeChatMessages = activeChat.value?.messages || [];
    try {
      isGenerating.value = true;
      const genStarted = new Date().toISOString();
      let lastMessage = activeChatMessages.length > 0 ? activeChatMessages[activeChatMessages.length - 1] : null;
      const chatHistoryForPrompt = [...activeChatMessages];

      if (mode === GenerationMode.REGENERATE) {
        if (lastMessage && !lastMessage.is_user) {
          chatHistoryForPrompt.pop();
          activeChatMessages.pop();
          lastMessage = activeChatMessages.length > 0 ? activeChatMessages[activeChatMessages.length - 1] : null;
        }
      } else if (mode === GenerationMode.ADD_SWIPE) {
        if (!lastMessage || lastMessage.is_user) return;
        chatHistoryForPrompt.pop();
      } else if (mode === GenerationMode.CONTINUE) {
        if (!lastMessage || lastMessage.is_user) return;
      }

      const activePersona = personaStore.activePersona;
      if (!activePersona) {
        throw new Error(t('chat.generate.noPersonaError'));
      }

      const settings = settingsStore.settings;
      const activeModel = apiStore.activeModel;
      if (!activeModel) {
        throw new Error(t('chat.generate.noModelError'));
      }

      const tokenizer = new ApiTokenizer({ tokenizerType: settings.api.tokenizer, model: activeModel });

      const handlingMode = groupConfig.value?.config.handlingMode ?? GroupGenerationHandlingMode.SWAP;

      // Construct list of characters for prompt context
      const charactersForContext = getCharactersForContext(
        characterStore.activeCharacters,
        activeCharacter,
        handlingMode !== GroupGenerationHandlingMode.SWAP,
        handlingMode === GroupGenerationHandlingMode.JOIN_INCLUDE_MUTED,
        groupConfig.value?.members
          ? Object.fromEntries(Object.entries(groupConfig.value.members).map(([k, v]) => [k, v.muted]))
          : {},
      );

      const context: GenerationContext = {
        mode,
        characters: charactersForContext,
        chatMetadata: activeChat.value!.metadata,
        history: chatHistoryForPrompt,
        persona: activePersona,
        settings: {
          sampler: settings.api.samplers,
          source: settings.api.chatCompletionSource,
          model: activeModel,
          providerSpecific: settings.api.providerSpecific,
        },
        playerName: uiStore.activePlayerName || 'User',
        controller: new AbortController(),
        tokenizer: tokenizer,
      };

      await eventEmitter.emit('process:generation-context', context);
      if (context.controller.signal.aborted) {
        console.log(
          `Generation aborted by extension (process:generation-context). Reason: ${context.controller.signal.reason}`,
        );
        return;
      }

      const promptBuilder = new PromptBuilder({
        characters: context.characters,
        chatMetadata: context.chatMetadata,
        chatHistory: context.history,
        persona: context.persona,
        samplerSettings: context.settings.sampler,
        tokenizer: context.tokenizer,
        books: (
          await Promise.all(
            worldInfoStore.activeBookNames.map(async (name) => await worldInfoStore.getBookFromCache(name, true)),
          )
        ).filter((book): book is WorldInfoBook => book !== undefined),
        worldInfo: settingsStore.settings.worldInfo,
      });
      const messages = await promptBuilder.build();

      if (messages.length === 0) {
        throw new Error(t('chat.generate.noPrompts'));
      }

      const processedWorldInfo = promptBuilder.processedWorldInfo;

      const maxContext = context.settings.sampler.max_context;
      const maxResponse = context.settings.sampler.max_tokens;
      let promptTotal = 0;
      for (const m of messages) {
        promptTotal += await tokenizer.getTokenCount(m.content);
      }

      let wiTokens = 0;
      if (processedWorldInfo) {
        const parts = [
          processedWorldInfo.worldInfoBefore,
          processedWorldInfo.worldInfoAfter,
          ...processedWorldInfo.anBefore,
          ...processedWorldInfo.anAfter,
          ...processedWorldInfo.emBefore,
          ...processedWorldInfo.emAfter,
          ...processedWorldInfo.depthEntries.flatMap((d) => d.entries),
          ...Object.values(processedWorldInfo.outletEntries).flat(),
        ];
        const fullWiText = parts.filter(Boolean).join('\n');
        if (fullWiText) {
          wiTokens = await tokenizer.getTokenCount(fullWiText);
        }
      }

      // TODO: With group chats, we need to track per-character prompts
      const breakdown: PromptTokenBreakdown = {
        systemTotal: 0,
        // TODO: Use primary character for estimates, or sum all? Just estimating active char for now.
        description: await tokenizer.getTokenCount(activeCharacter.description || ''),
        personality: await tokenizer.getTokenCount(activeCharacter.personality || ''),
        scenario: await tokenizer.getTokenCount(activeCharacter.scenario || ''),
        examples: await tokenizer.getTokenCount(activeCharacter.mes_example || ''),
        persona: await tokenizer.getTokenCount(activePersona.description || ''),
        worldInfo: wiTokens,
        chatHistory: 0,
        extensions: 0,
        bias: 0,
        promptTotal: promptTotal,
        maxContext: maxContext,
        padding: maxContext - promptTotal - maxResponse,
      };

      // Estimate System vs History from final messages
      for (const m of messages) {
        const count = await tokenizer.getTokenCount(m.content);
        if (m.role === 'system') {
          breakdown.systemTotal += count;
        } else {
          breakdown.chatHistory += count;
        }
      }

      const targetMessageIndex =
        mode === GenerationMode.CONTINUE ? activeChatMessages.length - 1 : activeChatMessages.length;

      const itemizedPrompt: ItemizedPrompt = {
        messageIndex: targetMessageIndex,
        model: context.settings.model,
        api: context.settings.source,
        tokenizer: settings.api.tokenizer,
        presetName: settings.api.selectedSampler || 'Default',
        messages: messages,
        breakdown: breakdown,
        timestamp: Date.now(),
        worldInfoEntries: processedWorldInfo?.triggeredEntries ?? {},
      };
      promptStore.addItemizedPrompt(itemizedPrompt);

      const payload = buildChatCompletionPayload({
        messages,
        model: context.settings.model,
        samplerSettings: context.settings.sampler,
        source: context.settings.source,
        providerSpecific: context.settings.providerSpecific,
        playerName: context.playerName,
        modelList: apiStore.modelList,
      });

      const payloadController = new AbortController();
      await eventEmitter.emit('process:request-payload', payload, payloadController);
      if (payloadController.signal.aborted) {
        console.log(
          `Generation aborted by extension (process:request-payload). Reason: ${payloadController.signal.reason}`,
        );
        return;
      }

      const handleGenerationResult = async (content: string, reasoning?: string) => {
        const genFinished = new Date().toISOString();
        const token_count = await tokenizer.getTokenCount(content);
        const swipeInfo: SwipeInfo = {
          send_date: getMessageTimeStamp(),
          gen_started: genStarted,
          gen_finished: genFinished,
          extra: { reasoning, token_count },
        };

        if (mode === GenerationMode.CONTINUE && lastMessage) {
          lastMessage.mes += content;
          lastMessage.gen_finished = genFinished;
          lastMessage.extra!.token_count = await tokenizer.getTokenCount(lastMessage.mes);
          generatedMessage = lastMessage;
          await nextTick();
          await eventEmitter.emit('message:updated', activeChatMessages.length - 1, lastMessage);
        } else if (mode === GenerationMode.ADD_SWIPE && lastMessage) {
          if (!Array.isArray(lastMessage.swipes)) lastMessage.swipes = [lastMessage.mes];
          if (!Array.isArray(lastMessage.swipe_info)) lastMessage.swipe_info = [];
          lastMessage.swipes.push(content);
          lastMessage.swipe_info.push(swipeInfo);
          await syncSwipeToMes(activeChatMessages.length - 1, lastMessage.swipes.length - 1);
          generatedMessage = lastMessage;
        } else {
          const botMessage: ChatMessage = {
            name: activeCharacter.name,
            is_user: false,
            mes: content,
            send_date: swipeInfo.send_date,
            gen_started: genStarted,
            gen_finished: genFinished,
            is_system: false,
            swipes: [content],
            swipe_info: [swipeInfo],
            swipe_id: 0,
            extra: { reasoning, token_count },
            original_avatar: activeCharacter.avatar,
          };

          const createController = new AbortController();
          await eventEmitter.emit('generation:before-message-create', botMessage, createController);
          if (createController.signal.aborted) {
            console.log(
              `Generation aborted by extension (generation:before-message-create). Reason: ${createController.signal.reason}`,
            );
            return;
          }

          activeChatMessages.push(botMessage);
          generatedMessage = botMessage;
          await nextTick();
          await eventEmitter.emit('message:created', botMessage);
        }
      };

      if (!payload.stream) {
        const response = (await ChatCompletionService.generate(
          payload,
          generationController.value.signal,
        )) as GenerationResponse;

        const responseController = new AbortController();
        await eventEmitter.emit('process:response', response, payload, responseController);
        if (responseController.signal.aborted) {
          console.log(
            `Generation aborted by extension (process:response). Reason: ${responseController.signal.reason}`,
          );
          return;
        }

        await handleGenerationResult(response.content, response.reasoning);
      } else {
        const streamGenerator = (await ChatCompletionService.generate(
          payload,
          generationController.value.signal,
        )) as unknown as () => AsyncGenerator<StreamedChunk>;

        let streamedReasoning = '';
        let targetMessageIndex = -1;

        if (mode === GenerationMode.NEW || mode === GenerationMode.REGENERATE) {
          const botMessage: ChatMessage = {
            name: activeCharacter.name,
            is_user: false,
            mes: '',
            send_date: getMessageTimeStamp(),
            gen_started: genStarted,
            is_system: false,
            swipes: [''],
            swipe_id: 0,
            swipe_info: [],
            extra: { reasoning: '' },
            original_avatar: activeCharacter.avatar,
          };

          const createController = new AbortController();
          await eventEmitter.emit('generation:before-message-create', botMessage, createController);
          if (createController.signal.aborted) {
            console.log(
              `Generation aborted by extension (generation:before-message-create). Reason: ${createController.signal.reason}`,
            );
            return;
          }

          activeChatMessages.push(botMessage);
          generatedMessage = botMessage;
          targetMessageIndex = activeChatMessages.length - 1;
          await nextTick();
          await eventEmitter.emit('message:created', botMessage);
        } else if (mode === GenerationMode.ADD_SWIPE && lastMessage) {
          targetMessageIndex = activeChatMessages.length - 1;
          // ... setup swipe
          if (!Array.isArray(lastMessage.swipes)) lastMessage.swipes = [lastMessage.mes];
          lastMessage.swipes.push('');
          lastMessage.swipe_id = lastMessage.swipes.length - 1;
          lastMessage.mes = '';
        } else {
          // Continue
          targetMessageIndex = activeChatMessages.length - 1;
        }

        try {
          for await (const chunk of streamGenerator()) {
            const chunkController = new AbortController();
            await eventEmitter.emit('process:stream-chunk', chunk, payload, chunkController);
            if (chunkController.signal.aborted) {
              console.log(
                `Generation aborted by extension (process:stream-chunk). Reason: ${chunkController.signal.reason}`,
              );
              generationController.value?.abort();
              break;
            }
            if (chunk.reasoning) streamedReasoning += chunk.reasoning;

            const targetMessage = activeChatMessages[targetMessageIndex];
            if (
              mode === GenerationMode.ADD_SWIPE ||
              mode === GenerationMode.NEW ||
              mode === GenerationMode.REGENERATE
            ) {
              targetMessage.swipes![targetMessage.swipe_id!] += chunk.delta;
              targetMessage.mes = targetMessage.swipes![targetMessage.swipe_id!];
            } else {
              targetMessage.mes += chunk.delta;
            }
            if (chunk.reasoning) targetMessage.extra!.reasoning = streamedReasoning;
          }
        } finally {
          const finalMessage = activeChatMessages[targetMessageIndex];
          if (finalMessage) {
            finalMessage.gen_finished = new Date().toISOString();
            finalMessage.extra!.token_count = await tokenizer.getTokenCount(finalMessage.mes);
            // Add swipe info
            const swipeInfo: SwipeInfo = {
              send_date: finalMessage.send_date!,
              gen_started: genStarted,
              gen_finished: finalMessage.gen_finished,
              extra: { ...finalMessage.extra },
            };
            if (!finalMessage.swipe_info) finalMessage.swipe_info = [];

            if (mode === GenerationMode.NEW || mode === GenerationMode.REGENERATE) {
              finalMessage.swipe_info = [swipeInfo];
            } else if (mode === GenerationMode.ADD_SWIPE) {
              finalMessage.swipe_info.push(swipeInfo);
            }
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      generationError = error;
      if (error.name === 'AbortError') {
        toast.info('Generation aborted.');
      } else {
        console.error('Failed to generate response:', error);
        toast.error(error.message || t('chat.generate.errorFallback'));
      }
    } finally {
      isGenerating.value = false;
      generationController.value = null;
      await nextTick();
      await eventEmitter.emit('generation:finished', generatedMessage, generationError);
    }
  }

  async function sendMessage(messageText: string, triggerGeneration = true) {
    if (!messageText.trim() || isGenerating.value || activeChat.value === null || !personaStore.activePersona) {
      return;
    }

    stopAutoModeTimer();

    const userMessage: ChatMessage = {
      name: uiStore.activePlayerName || 'User',
      is_user: true,
      mes: messageText.trim(),
      send_date: getMessageTimeStamp(),
      force_avatar: getThumbnailUrl('persona', uiStore.activePlayerAvatar || default_user_avatar),
      original_avatar: personaStore.activePersona.avatarId,
      is_system: false,
      extra: {},
      swipe_id: 0,
      swipes: [messageText.trim()],
      swipe_info: [
        {
          send_date: getMessageTimeStamp(),
          extra: {},
        },
      ],
    };

    const createController = new AbortController();
    await eventEmitter.emit('chat:before-message-create', userMessage, createController);
    if (createController.signal.aborted) {
      console.log(
        `Message creation aborted by extension (chat:before-message-create). Reason: ${createController.signal.reason}`,
      );
      return;
    }
    activeChat.value.messages.push(userMessage);
    await nextTick();
    await eventEmitter.emit('message:created', userMessage);

    if (triggerGeneration) {
      await generateResponse(GenerationMode.NEW);
    }
  }

  // Toggles mute status in metadata
  function toggleMemberMute(avatar: string) {
    if (!activeChat.value?.metadata.group) return;
    const member = activeChat.value.metadata.group.members[avatar];
    if (member) {
      member.muted = !member.muted;
      saveChatDebounced();
    }
  }

  async function addMember(avatar: string) {
    if (!activeChat.value) return;
    if (activeChat.value.metadata.members?.includes(avatar)) return;

    activeChat.value.metadata.members?.push(avatar);

    // Initialize group config if needed
    if (!activeChat.value.metadata.group) {
      activeChat.value.metadata.group = {
        config: {
          replyStrategy: GroupReplyStrategy.NATURAL_ORDER,
          handlingMode: GroupGenerationHandlingMode.SWAP,
          allowSelfResponses: false,
          autoMode: 0,
        },
        members: {},
      };
    }
    // Initialize member status
    if (!activeChat.value.metadata.group.members[avatar]) {
      activeChat.value.metadata.group.members[avatar] = { muted: false };
    }

    saveChatDebounced();
  }

  async function removeMember(avatar: string) {
    if (!activeChat.value) return;
    const index = activeChat.value.metadata.members?.indexOf(avatar) ?? -1;
    if (index > -1) {
      activeChat.value.metadata.members?.splice(index, 1);
      if (activeChat.value.metadata.group?.members[avatar]) {
        delete activeChat.value.metadata.group.members[avatar];
      }
      saveChatDebounced();
    }
  }

  function startEditing(index: number) {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) return;
    activeMessageEditState.value = {
      index,
      originalContent: activeChat.value.messages[index].mes,
    };
  }

  function cancelEditing() {
    activeMessageEditState.value = null;
  }

  async function saveMessageEdit(newContent: string, newReasoning?: string) {
    if (activeMessageEditState.value !== null && activeChat.value) {
      const index = activeMessageEditState.value.index;
      const message = activeChat.value.messages[index];
      message.mes = newContent;
      if (message.extra) {
        delete message.extra.display_text;
        delete message.extra.reasoning_display_text;
      }

      if (typeof newReasoning === 'string' && newReasoning.trim() !== '') {
        if (!message.extra) message.extra = {};
        message.extra.reasoning = newReasoning;
      } else {
        if (message.extra) {
          delete message.extra.reasoning;
        }
      }

      if (message.swipes && typeof message.swipe_id === 'number' && message.swipes[message.swipe_id] !== undefined) {
        message.swipes[message.swipe_id] = newContent;
      }

      const swipeInfo = message.swipe_info?.[message.swipe_id ?? 0];
      if (swipeInfo) {
        if (!swipeInfo.extra) swipeInfo.extra = {};
        if (typeof newReasoning === 'string' && newReasoning.trim() !== '') {
          swipeInfo.extra.reasoning = newReasoning;
        } else {
          delete swipeInfo.extra.reasoning;
        }
      }

      cancelEditing();
      await nextTick();
      await eventEmitter.emit('message:updated', index, message);
    }
  }

  async function updateMessageObject(index: number, updates: Partial<ChatMessage>): Promise<void> {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) {
      console.warn(`[ChatStore] updateMessageObject: index ${index} out of bounds.`);
      return;
    }
    const message = activeChat.value.messages[index];
    Object.assign(message, updates);

    if (updates.mes !== undefined) {
      if (message.swipes && typeof message.swipe_id === 'number' && message.swipes[message.swipe_id] !== undefined) {
        message.swipes[message.swipe_id] = updates.mes;
      }
    }

    await nextTick();
    await eventEmitter.emit('message:updated', index, message);
  }

  async function syncSwipeToMes(messageIndex: number, swipeIndex: number) {
    if (!activeChat.value || messageIndex < 0 || messageIndex >= activeChat.value.messages.length) return;

    const message = activeChat.value.messages[messageIndex];
    if (!message || !Array.isArray(message.swipes) || swipeIndex < 0 || swipeIndex >= message.swipes.length) {
      return;
    }

    message.swipe_id = swipeIndex;
    message.mes = message.swipes[swipeIndex];

    const swipeInfo = message.swipe_info?.[swipeIndex];
    if (swipeInfo) {
      message.send_date = swipeInfo.send_date;
      message.gen_started = swipeInfo.gen_started;
      message.gen_finished = swipeInfo.gen_finished;
      message.extra = { ...swipeInfo.extra };
    }

    if (message.extra) {
      delete message.extra.display_text;
      delete message.extra.reasoning_display_text;
    }
    await nextTick();
    await eventEmitter.emit('message:updated', messageIndex, message);
  }

  async function swipeMessage(messageIndex: number, direction: 'left' | 'right') {
    if (!activeChat.value || messageIndex < 0 || messageIndex >= activeChat.value.messages.length) return;
    const message = activeChat.value.messages[messageIndex];
    if (!message || !Array.isArray(message.swipes)) return;

    let currentSwipeId = message.swipe_id ?? 0;
    const swipeCount = message.swipes.length;

    if (direction === 'left') {
      currentSwipeId = (currentSwipeId - 1 + swipeCount) % swipeCount;
      await syncSwipeToMes(messageIndex, currentSwipeId);
    } else {
      if (currentSwipeId < swipeCount - 1) {
        currentSwipeId++;
        await syncSwipeToMes(messageIndex, currentSwipeId);
      } else {
        await generateResponse(GenerationMode.ADD_SWIPE);
      }
    }
  }

  async function deleteMessage(index: number) {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) return;
    activeChat.value.messages.splice(index, 1);
    if (activeMessageEditState.value?.index === index) {
      cancelEditing();
    }
    await nextTick();
    await eventEmitter.emit('message:deleted', index);
  }

  async function deleteSwipe(messageIndex: number, swipeIndex: number) {
    if (!activeChat.value || messageIndex < 0 || messageIndex >= activeChat.value.messages.length) return;
    const message = activeChat.value.messages[messageIndex];
    if (
      !message ||
      !Array.isArray(message.swipes) ||
      message.swipes.length <= 1 ||
      swipeIndex < 0 ||
      swipeIndex >= message.swipes.length
    ) {
      toast.error(t('chat.delete.lastSwipeError'));
      return;
    }

    message.swipes.splice(swipeIndex, 1);
    if (Array.isArray(message.swipe_info)) {
      message.swipe_info.splice(swipeIndex, 1);
    }

    const newSwipeId = Math.min(swipeIndex, message.swipes.length - 1);
    await syncSwipeToMes(messageIndex, newSwipeId);
  }

  function moveMessage(index: number, direction: 'up' | 'down') {
    if (!activeChat.value || index < 0 || index >= activeChat.value.messages.length) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= activeChat.value.messages.length) return;

    [activeChat.value.messages[index], activeChat.value.messages[newIndex]] = [
      activeChat.value.messages[newIndex],
      activeChat.value.messages[index],
    ];

    if (activeMessageEditState.value) {
      if (activeMessageEditState.value.index === index) {
        activeMessageEditState.value.index = newIndex;
      } else if (activeMessageEditState.value.index === newIndex) {
        activeMessageEditState.value.index = index;
      }
    }
  }

  return {
    activeChat,
    chatInfos,
    recentChats,
    activeMessageEditState,
    isGenerating,
    activeChatFile,
    isGroupChat,
    groupConfig,
    chatsMetadataByCharacterAvatars,
    clearChat,
    sendMessage,
    generateResponse,
    abortGeneration,
    startEditing,
    cancelEditing,
    saveMessageEdit,
    updateMessageObject,
    deleteMessage,
    deleteSwipe,
    swipeMessage,
    moveMessage,
    setActiveChatFile,
    createNewChatForCharacter,
    toggleMemberMute,
    addMember,
    removeMember,
    toggleChatPersona,
    syncPersonaName,
    updateChatName,
  };
});
