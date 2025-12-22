import { ref } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import { GroupGenerationHandlingMode, GroupReplyStrategy, type GroupChatConfig } from './types';
import { determineNextSpeaker } from './utils';

// TODO: i18n

export class GroupChatService {
  private api: ExtensionAPI;

  public generationQueue = ref<string[]>([]);
  public generatingAvatar = ref<string | null>(null);
  public autoModeTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.stopAutoModeTimer();
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
        },
        members: {},
      };

      // Sync initial members
      meta.members?.forEach((avatar) => {
        if (loadedConfig) loadedConfig.members[avatar] = { muted: false };
      });

      this.saveConfig(loadedConfig);
    }

    this.groupConfig.value = loadedConfig;
  }

  public saveConfig(config: GroupChatConfig) {
    const meta = this.api.chat.metadata.get();
    if (!meta) return;

    if (!meta.extra) meta.extra = {};
    meta.extra.group = config;

    // Need to trigger save on core side
    this.api.chat.metadata.set(meta);
    this.api.settings.save();
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
    this.api.settings.save();
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
      this.api.settings.save();
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

  public prepareGenerationQueue() {
    if (this.generationQueue.value.length > 0) return;
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

    const nextSpeakers = determineNextSpeaker(activeChars, this.groupConfig.value, [
      ...this.api.chat.getHistory(),
    ] as ChatMessage[]);

    if (nextSpeakers.length > 0) {
      this.addToQueue(nextSpeakers.map((c) => c.avatar));
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
        this.prepareGenerationQueue();
        this.processQueue();
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
