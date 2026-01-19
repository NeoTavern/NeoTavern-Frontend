import { ref } from 'vue';
import type { ApiChatMessage, Character, ChatMessage, ExtensionAPI } from '../../../types';
import {
  GroupGenerationHandlingMode,
  GroupReplyStrategy,
  type GroupChatConfig,
  type GroupExtensionSettings,
} from './types';
import { determineNextSpeaker } from './utils';

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

export const DEFAULT_SUMMARY_TEMPLATE = `Summarize the following character in 2-3 sentences. Focus on their personality and role to help other characters interact with them.

Name: {{name}}
Description: {{description}}
Personality: {{personality}}`;

export const DEFAULT_SUMMARY_INJECTION_TEMPLATE = `{{description}}

[Other Group Members]
{{summaries}}`;

export class GroupChatService {
  private api: ExtensionAPI<GroupExtensionSettings>;

  public generationQueue = ref<string[]>([]);
  public generatingAvatar = ref<string | null>(null);
  public autoModeTimer: ReturnType<typeof setTimeout> | null = null;
  public isAnalyzing = ref(false);
  public isGeneratingSummary = ref(false);
  public wasAborted = false;
  t: typeof this.api.i18n.t;

  // We mirror the current config to a reactive object for the UI
  public groupConfig = ref<GroupChatConfig | null>(null);

  constructor(api: ExtensionAPI<GroupExtensionSettings>) {
    this.api = api;
    this.t = this.api.i18n.t;
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
    this.isGeneratingSummary.value = false;
    this.generatingAvatar.value = null;
  }

  public loadConfig() {
    const meta = this.api.chat.metadata.get();
    if (!meta) {
      this.groupConfig.value = null;
      return;
    }

    // Validate and clean up member list
    this.validateMembers();

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
          decisionContextSize: 15,
        },
        members: {},
      };

      // Sync initial members
      meta.members?.forEach((avatar) => {
        if (loadedConfig) loadedConfig.members[avatar] = { muted: false, summary: '' };
      });

      this.saveConfig(loadedConfig);
    } else {
      // Ensure decisionContextSize has a default
      if (loadedConfig.config.decisionContextSize === undefined) {
        loadedConfig.config.decisionContextSize = 15;
      }

      // Sync members: add missing, remove stale
      const currentMembers = new Set(meta.members || []);
      const configMemberKeys = Object.keys(loadedConfig.members);

      // Add new members not in config
      meta.members?.forEach((avatar) => {
        if (!loadedConfig!.members[avatar]) {
          loadedConfig!.members[avatar] = { muted: false, summary: '' };
        }
      });

      // Remove stale members from config
      configMemberKeys.forEach((avatar) => {
        if (!currentMembers.has(avatar)) {
          delete loadedConfig!.members[avatar];
        }
      });

      this.saveConfig(loadedConfig);
    }

    this.groupConfig.value = loadedConfig;
  }

  /**
   * Validates that all members in metadata exist as actual characters.
   * Removes any stale references.
   */
  private validateMembers() {
    const meta = this.api.chat.metadata.get();
    if (!meta || !meta.members) return;

    const allChars = this.api.character.getAll();
    const validAvatars = new Set(allChars.map((c) => c.avatar));

    const validMembers = meta.members.filter((avatar) => validAvatars.has(avatar));

    // Update if members were removed
    if (validMembers.length !== meta.members.length) {
      meta.members = validMembers;
      this.api.chat.metadata.set(meta);
    }
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

  public updateMemberSummary(avatar: string, summary: string) {
    if (!this.groupConfig.value) return;
    const member = this.groupConfig.value.members[avatar];
    if (member) {
      member.summary = summary;
      this.saveConfig(this.groupConfig.value);
    }
  }

  public async generateMemberSummary(avatar: string) {
    if (!this.groupConfig.value) return;
    const char = this.api.character.get(avatar);
    if (!char) return;

    const extensionSettings = this.api.settings.get();
    const template = extensionSettings?.defaultSummaryPromptTemplate || DEFAULT_SUMMARY_TEMPLATE;
    const connectionProfile = extensionSettings?.defaultConnectionProfile;

    const prompt = this.api.macro.process(template, { activeCharacter: char });

    const messages: ApiChatMessage[] = [
      {
        role: 'system',
        content: prompt,
        name: 'System',
      },
    ];

    this.isGeneratingSummary.value = true;
    try {
      const response = await this.api.llm.generate(messages, {
        connectionProfile,
      });

      let content = '';
      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
          content += chunk.delta;
        }
      } else {
        content = response.content;
      }

      this.updateMemberSummary(avatar, content.trim());
    } catch (e) {
      console.error('[GroupChat] Failed to generate summary', e);
      this.api.ui.showToast(this.t('extensionsBuiltin.groupChat.errors.summaryFailed'), 'error');
    } finally {
      this.isGeneratingSummary.value = false;
    }
  }

  public async addMember(avatar: string) {
    const meta = this.api.chat.metadata.get();
    if (!meta) return;

    // Verify character exists
    const char = this.api.character.get(avatar);
    if (!char) {
      console.warn('[GroupChat] Cannot add member: character does not exist', avatar);
      return;
    }

    if (!meta.members) meta.members = [];
    if (meta.members.includes(avatar)) return;

    meta.members.push(avatar);

    // Update config map
    if (this.groupConfig.value) {
      this.groupConfig.value.members[avatar] = { muted: false, summary: '' };
      this.saveConfig(this.groupConfig.value);
    }

    this.api.chat.metadata.set(meta);

    // Reload config without resetting generation state
    this.loadConfig();
  }

  public async removeMember(avatar: string) {
    const meta = this.api.chat.metadata.get();
    if (!meta || !meta.members) return;

    const idx = meta.members.indexOf(avatar);
    if (idx > -1) {
      meta.members.splice(idx, 1);

      // Remove from config map
      if (this.groupConfig.value?.members[avatar]) {
        delete this.groupConfig.value.members[avatar];
        this.saveConfig(this.groupConfig.value);
      }

      this.api.chat.metadata.set(meta);

      // Reload config without resetting generation state
      this.loadConfig();
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

    // Warn if missing summaries in SWAP_INCLUDE_SUMMARIES mode
    if (this.groupConfig.value?.config.handlingMode === GroupGenerationHandlingMode.SWAP_INCLUDE_SUMMARIES) {
      const membersMap = this.groupConfig.value.members;
      const missingCount = activeMembers.filter(
        (avatar) => !membersMap[avatar]?.muted && !membersMap[avatar]?.summary,
      ).length;

      if (missingCount > 0) {
        const plural = missingCount > 1 ? 's' : '';
        const summaryPlural = missingCount > 1 ? 'summaries' : 'summary';
        this.api.ui.showToast(
          this.t('extensionsBuiltin.groupChat.warnings.missingSummaries', {
            count: missingCount,
            plural,
            summaryPlural,
          }),
          'warning',
        );
      }
    }

    // Single Chat / Fallback
    if (!this.isGroupChat || !this.groupConfig.value) {
      // Core handles single chat defaults usually, but we can enforce it if we want
      return;
    }

    const membersMap = this.groupConfig.value.members;
    const allChars = this.api.character.getAll();
    const validAvatars = new Set(allChars.map((c) => c.avatar));

    // Filter out non-existent and muted members
    const validMembers = activeMembers.filter((avatar) => validAvatars.has(avatar) && !membersMap[avatar]?.muted);

    if (validMembers.length === 0) return;

    const activeChars = allChars.filter((c) => validMembers.includes(c.avatar));
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
    const extensionSettings = this.api.settings.get();
    const template = extensionSettings?.defaultDecisionPromptTemplate || DEFAULT_DECISION_TEMPLATE;
    const contextSize = config?.decisionContextSize ?? 15;
    const connectionProfile = extensionSettings?.defaultConnectionProfile;

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
        connectionProfile,
        signal,
      });

      let content = '';
      if (Symbol.asyncIterator in response) {
        for await (const chunk of response) {
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
