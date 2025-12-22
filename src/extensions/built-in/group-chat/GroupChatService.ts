import { ref } from 'vue';
import type { ApiChatMessage, Character, ChatMessage, ExtensionAPI } from '../../../types';
import { GroupGenerationHandlingMode, GroupReplyStrategy, type GroupChatConfig } from './types';
import { determineNextSpeaker } from './utils';

// TODO: i18n

export const DEFAULT_DECISION_TEMPLATE = `You are an AI assistant orchestrating a roleplay group chat.
Your task is to determine who should speak next based on the recent conversation context.

[Active Members]
{{memberNames}}
{{user}} (The User)

[Recent Conversation]
{{recentMessages}}

[Instructions]
1. Analyze the conversation flow to decide who should reply.
2. If it is {{user}}'s turn to speak, output "{{user}}".
3. If a character should speak, output their exact name.
4. Output only the name inside a code block. Do not output anything else.

Example Response:
\`\`\`
{{firstCharName}}
\`\`\``;

export class GroupChatService {
  private api: ExtensionAPI;

  public generationQueue = ref<string[]>([]);
  public generatingAvatar = ref<string | null>(null);
  public autoModeTimer: ReturnType<typeof setTimeout> | null = null;
  public isAnalyzing = ref(false);
  public wasAborted = false;

  // We mirror the current config to a reactive object for the UI
  public groupConfig = ref<GroupChatConfig | null>(null);

  constructor(api: ExtensionAPI) {
    this.api = api;
  }

  public get isGroupChat(): boolean {
    const chat = this.api.chat.getChatInfo();
    return !!chat && (chat.chat_metadata.members?.length ?? 0) > 1;
  }

  public init() {
    this.loadConfig();
    this.generationQueue.value = [];
    this.generatingAvatar.value = null;
    this.isAnalyzing.value = false;
    this.wasAborted = false;
    this.stopAutoModeTimer();
  }

  public abort() {
    this.wasAborted = true;
    this.clearQueue();
    this.stopAutoModeTimer();
    this.isAnalyzing.value = false;
    this.generatingAvatar.value = null;
  }

  public loadConfig() {
    const meta = this.api.chat.metadata.get();
    if (!meta) {
      this.groupConfig.value = null;
      return;
    }

    // Try to load from extra first (new way), or fallback to old way if legacy
    let loadedConfig = meta.extra?.group as GroupChatConfig | undefined;

    // Initialize if missing
    if (!loadedConfig) {
      loadedConfig = {
        config: {
          replyStrategy: GroupReplyStrategy.NATURAL_ORDER,
          handlingMode: GroupGenerationHandlingMode.SWAP,
          allowSelfResponses: false,
          autoMode: 0,
          decisionPromptTemplate: DEFAULT_DECISION_TEMPLATE,
          decisionContextSize: 15,
          connectionProfile: undefined,
        },
        members: {},
      };

      // Sync initial members
      meta.members?.forEach((avatar) => {
        if (loadedConfig) loadedConfig.members[avatar] = { muted: false };
      });

      this.saveConfig(loadedConfig);
    } else {
      let dirty = false;
      if (!loadedConfig.config.decisionPromptTemplate) {
        loadedConfig.config.decisionPromptTemplate = DEFAULT_DECISION_TEMPLATE;
        dirty = true;
      }
      if (loadedConfig.config.decisionContextSize === undefined) {
        loadedConfig.config.decisionContextSize = 15;
        dirty = true;
      }
      if (dirty) {
        this.saveConfig(loadedConfig);
      }
    }

    this.groupConfig.value = loadedConfig;
  }

  public saveConfig(config: GroupChatConfig) {
    const meta = this.api.chat.metadata.get();
    if (!meta) return;

    if (!meta.extra) meta.extra = {};
    meta.extra.group = config;

    this.api.chat.metadata.set(meta);
    this.groupConfig.value = config;
  }

  // --- Actions ---

  public toggleMemberMute(avatar: string) {
    if (!this.groupConfig.value) return;
    const member = this.groupConfig.value.members[avatar];
    if (member) {
      member.muted = !member.muted;
      this.saveConfig(this.groupConfig.value);
    }
  }

  public async addMember(avatar: string) {
    const meta = this.api.chat.metadata.get();
    if (!meta) return;

    if (!meta.members) meta.members = [];
    if (meta.members.includes(avatar)) return;

    meta.members.push(avatar);

    // Update config map
    if (this.groupConfig.value) {
      this.groupConfig.value.members[avatar] = { muted: false };
      this.saveConfig(this.groupConfig.value);
    } else {
      // Re-init if missing
      this.loadConfig();
    }

    this.api.chat.metadata.set(meta);
  }

  public async removeMember(avatar: string) {
    const meta = this.api.chat.metadata.get();
    if (!meta || !meta.members) return;

    const idx = meta.members.indexOf(avatar);
    if (idx > -1) {
      meta.members.splice(idx, 1);
      if (this.groupConfig.value?.members[avatar]) {
        delete this.groupConfig.value.members[avatar];
        this.saveConfig(this.groupConfig.value);
      }
      this.api.chat.metadata.set(meta);
    }
  }

  // --- Queue Management ---

  public clearQueue() {
    this.generationQueue.value = [];
  }

  public addToQueue(avatars: string[]) {
    this.generationQueue.value.push(...avatars);
  }

  public popFromQueue() {
    return this.generationQueue.value.shift();
  }

  // --- Logic ---

  public async prepareGenerationQueue(signal?: AbortSignal) {
    if (this.generationQueue.value.length > 0) return;
    this.wasAborted = false;
    const meta = this.api.chat.metadata.get();
    const activeMembers = meta?.members ?? [];

    // Single Chat / Fallback
    if (!this.isGroupChat || !this.groupConfig.value) {
      // Core handles single chat defaults usually, but we can enforce it if we want
      return;
    }

    const membersMap = this.groupConfig.value.members;
    const validMembers = activeMembers.filter((avatar) => !membersMap[avatar]?.muted);

    if (validMembers.length === 0) return;

    const activeChars = this.api.character.getActives().filter((c) => validMembers.includes(c.avatar));
    const history = this.api.chat.getHistory();

    // LLM Decision Strategy
    if (this.groupConfig.value.config.replyStrategy === GroupReplyStrategy.LLM_DECISION) {
      this.isAnalyzing.value = true;
      try {
        const nextSpeaker = await this.determineSpeakerViaLLM(activeChars, history, signal);
        if (signal?.aborted) return;

        if (nextSpeaker) {
          this.addToQueue([nextSpeaker.avatar]);
        }
      } catch (e) {
        if (signal?.aborted) {
          console.log('[GroupChat] LLM Decision aborted.');
          return;
        }
        console.error('[GroupChat] LLM Decision error:', e);
      } finally {
        this.isAnalyzing.value = false;
      }
      return;
    }

    // Standard Strategies (Sync)
    const nextSpeakers = determineNextSpeaker(activeChars, this.groupConfig.value, [...history]);

    if (nextSpeakers.length > 0) {
      this.addToQueue(nextSpeakers.map((c) => c.avatar));
    }
  }

  private async determineSpeakerViaLLM(
    activeChars: Character[],
    history: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<Character | null> {
    const persona = this.api.persona.getActive();
    const playerName = persona?.name || 'User';

    const config = this.groupConfig.value?.config;
    const template = config?.decisionPromptTemplate || DEFAULT_DECISION_TEMPLATE;
    const contextSize = config?.decisionContextSize ?? 15;
    const connectionProfile = config?.connectionProfile;

    // Context Construction
    const recentMessages = history.slice(-contextSize);
    const recentMessagesStr = recentMessages.map((m) => `${m.name}: ${m.mes}`).join('\n');
    const memberNames = activeChars.map((c) => c.name).join(', ');
    const firstCharName = activeChars[0]?.name || 'CharacterName';

    // Process Template
    const prompt = this.api.macro.process(template, undefined, {
      memberNames,
      recentMessages: recentMessagesStr,
      firstCharName,
    });

    const messages: ApiChatMessage[] = [
      {
        role: 'system',
        content: prompt,
        name: 'System',
      },
    ];

    try {
      const response = await this.api.llm.generate(messages, {
        connectionProfileName: connectionProfile,
        signal,
      });

      let content = '';
      if (typeof response === 'function') {
        const gen = response();
        for await (const chunk of gen) {
          content += chunk.delta;
        }
      } else {
        content = response.content;
      }

      // Extract Name from Code Block
      const codeBlockRegex = /```(?:[\w]*\n)?([\s\S]*?)```/i;
      const match = content.match(codeBlockRegex);
      const extractedName = match ? match[1].trim() : content.trim();

      // Check if it matches a character
      const character = activeChars.find((c) => c.name.trim().toLowerCase() === extractedName.toLowerCase());

      if (character) {
        return character;
      }

      // If it matches player, we return null (no queue -> user input)
      if (extractedName.toLowerCase() === playerName.toLowerCase()) {
        this.stopAutoModeTimer();
        return null;
      }

      // Fallback
      console.warn('[GroupChat] LLM suggested unknown speaker:', extractedName);
      return null;
    } catch (e) {
      if (signal?.aborted) throw e;
      console.error('[GroupChat] Failed to determine speaker via LLM', e);
      return null;
    }
  }

  public async processQueue() {
    if (this.generatingAvatar.value) return;

    const nextAvatar = this.generationQueue.value.shift();
    if (!nextAvatar) return;

    this.generatingAvatar.value = nextAvatar;

    try {
      await this.api.chat.generateResponse({
        forceSpeakerAvatar: nextAvatar,
      });
    } catch (e) {
      console.error(e);
      this.generatingAvatar.value = null;
    }
  }

  // --- Auto Mode ---

  public startAutoModeTimer() {
    this.stopAutoModeTimer();
    const duration = this.groupConfig.value?.config.autoMode ?? 0;
    if (duration > 0) {
      this.autoModeTimer = setTimeout(() => {
        // Auto-mode triggers a generic generation, which will fill queue
        this.prepareGenerationQueue().then(() => {
          this.processQueue();
        });
      }, duration * 1000);
    }
  }

  public stopAutoModeTimer() {
    if (this.autoModeTimer) {
      clearTimeout(this.autoModeTimer);
      this.autoModeTimer = null;
    }
  }
}
