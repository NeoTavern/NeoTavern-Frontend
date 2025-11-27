import { defineStore } from 'pinia';
import { computed } from 'vue';
import { GroupGenerationHandlingMode, GroupReplyStrategy } from '../constants';
import { useChatStore } from './chat.store';

export const useGroupChatStore = defineStore('group-chat', () => {
  const chatStore = useChatStore();

  const isGroupChat = computed(() => {
    return chatStore.activeChat && (chatStore.activeChat.metadata.members?.length ?? 0) > 1;
  });

  const groupConfig = computed(() => {
    if (!chatStore.activeChat) return null;

    // Initialize defaults if missing
    if (!chatStore.activeChat.metadata.group) {
      chatStore.activeChat.metadata.group = {
        config: {
          replyStrategy: GroupReplyStrategy.NATURAL_ORDER,
          handlingMode: GroupGenerationHandlingMode.SWAP,
          allowSelfResponses: false,
          autoMode: 0,
        },
        members: {},
      };
      // Sync members list status
      chatStore.activeChat.metadata.members?.forEach((avatar) => {
        if (chatStore.activeChat!.metadata.group) {
          chatStore.activeChat!.metadata.group.members[avatar] = { muted: false };
        }
      });
    }
    return chatStore.activeChat.metadata.group;
  });

  function toggleMemberMute(avatar: string) {
    if (!chatStore.activeChat?.metadata.group) return;
    const member = chatStore.activeChat.metadata.group.members[avatar];
    if (member) {
      member.muted = !member.muted;
      chatStore.triggerSave();
    }
  }

  function addMember(avatar: string) {
    if (!chatStore.activeChat) return;
    if (chatStore.activeChat.metadata.members?.includes(avatar)) return;

    chatStore.activeChat.metadata.members?.push(avatar);

    if (!chatStore.activeChat.metadata.group) {
      chatStore.activeChat.metadata.group = {
        config: {
          replyStrategy: GroupReplyStrategy.NATURAL_ORDER,
          handlingMode: GroupGenerationHandlingMode.SWAP,
          allowSelfResponses: false,
          autoMode: 0,
        },
        members: {},
      };
    }
    if (!chatStore.activeChat.metadata.group.members[avatar]) {
      chatStore.activeChat.metadata.group.members[avatar] = { muted: false };
    }

    chatStore.triggerSave();
  }

  function removeMember(avatar: string) {
    if (!chatStore.activeChat) return;
    const index = chatStore.activeChat.metadata.members?.indexOf(avatar) ?? -1;
    if (index > -1) {
      chatStore.activeChat.metadata.members?.splice(index, 1);
      if (chatStore.activeChat.metadata.group?.members[avatar]) {
        delete chatStore.activeChat.metadata.group.members[avatar];
      }
      chatStore.triggerSave();
    }
  }

  return {
    isGroupChat,
    groupConfig,
    toggleMemberMute,
    addMember,
    removeMember,
  };
});
