<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { chatService } from '../../services/chat.service';
import { useChatStore } from '../../stores/chat.store';
import { useLayoutStore } from '../../stores/layout.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import { POPUP_RESULT, POPUP_TYPE, type ChatInfo } from '../../types';
import { getThumbnailUrl } from '../../utils/character';
import { formatTimeStamp } from '../../utils/commons';
import { eventEmitter } from '../../utils/extensions';
import { EmptyState, Pagination, SidebarHeader, SmartAvatar } from '../common';
import { Button, ListItem } from '../UI';

const { t } = useStrictI18n();
const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();
const layoutStore = useLayoutStore();

const currentPage = ref(1);
const itemsPerPage = ref(settingsStore.settings.account.recentChatsPageSize ?? 10);

// Selection Mode
const isSelectionMode = ref(false);
const selectedChats = ref<Set<string>>(new Set());

watch(itemsPerPage, (newVal) => {
  settingsStore.settings.account.recentChatsPageSize = newVal;
  currentPage.value = 1;
});

const recentChats = computed(() => chatStore.chatInfos);

const paginatedRecentChats = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  const end = start + itemsPerPage.value;
  return recentChats.value.slice(start, end);
});

// Reset to page 1 if the list is refreshed or emptied
watch(
  () => recentChats.value.length,
  () => {
    if ((currentPage.value - 1) * itemsPerPage.value >= recentChats.value.length) {
      currentPage.value = Math.max(1, Math.ceil(recentChats.value.length / itemsPerPage.value));
    }
  },
);

function getChatAvatars(chat: ChatInfo): string[] {
  // If it's a group chat, get members from group config
  const groupMembers = chat.chat_metadata.members;
  if (groupMembers) {
    return groupMembers.slice(0, 4).map((m) => getThumbnailUrl('avatar', m));
  }

  // Fallback / Standard chat members
  const members = chat.chat_metadata.members || [];
  if (members.length > 0) {
    return members.slice(0, 4).map((m) => getThumbnailUrl('avatar', m));
  }

  // Fallback to default if no members found but it is a valid chat
  return [];
}

function isGroupChat(chat: ChatInfo): boolean {
  return getMemberCount(chat) > 1;
}

function getMemberCount(chat: ChatInfo): number {
  if (chat.chat_metadata.members) {
    return chat.chat_metadata.members.length;
  }
  return 0;
}

async function onItemClick(chat: ChatInfo) {
  if (isSelectionMode.value) {
    toggleSelection(chat.file_id);
  } else {
    chatStore.setActiveChatFile(chat.file_id);
    layoutStore.autoCloseSidebarsOnMobile();
  }
}

function toggleSelectionMode() {
  isSelectionMode.value = !isSelectionMode.value;
  selectedChats.value.clear();
}

function toggleSelection(fileId: string) {
  if (selectedChats.value.has(fileId)) {
    selectedChats.value.delete(fileId);
  } else {
    selectedChats.value.add(fileId);
  }
}

function selectAllVisible() {
  const allSelected = paginatedRecentChats.value.every((c) => selectedChats.value.has(c.file_id));
  if (allSelected) {
    // Deselect visible
    paginatedRecentChats.value.forEach((c) => selectedChats.value.delete(c.file_id));
  } else {
    // Select visible
    paginatedRecentChats.value.forEach((c) => selectedChats.value.add(c.file_id));
  }
}

async function deleteSelected() {
  if (selectedChats.value.size === 0) return;

  const count = selectedChats.value.size;
  const { result } = await popupStore.show({
    title: t('chatManagement.deleteConfirmTitle'),
    content: t('chatManagement.deleteSelectedConfirmContent', { count }),
    type: POPUP_TYPE.CONFIRM,
    okButton: 'common.delete',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    try {
      const idsToDelete = Array.from(selectedChats.value);
      for (const id of idsToDelete) {
        await chatService.delete(id);
      }
      chatStore.chatInfos = chatStore.chatInfos.filter((c) => !selectedChats.value.has(c.file_id));
      if (chatStore.activeChatFile && selectedChats.value.has(chatStore.activeChatFile)) {
        chatStore.activeChatFile = null;
        await chatStore.clearChat(false);
      }
      selectedChats.value.clear();
      isSelectionMode.value = false;
      nextTick().then(() => {
        for (const id of idsToDelete) {
          eventEmitter.emit('chat:deleted', id);
        }
      });
    } catch (error) {
      console.error(error);
      toast.error(t('chatManagement.errors.delete'));
    }
  }
}

async function refresh() {
  try {
    await chatStore.refreshChats();
  } catch (err) {
    console.error(err);
    toast.error(t('chat.loadError'));
  }
}
</script>

<template>
  <div class="recent-chats">
    <SidebarHeader :title="t('navbar.recentChats')">
      <template #actions>
        <Button
          variant="ghost"
          :icon="isSelectionMode ? 'fa-xmark' : 'fa-check-to-slot'"
          :title="isSelectionMode ? t('common.cancel') : t('common.select')"
          @click="toggleSelectionMode"
        />
        <Button variant="ghost" icon="fa-rotate-right" :title="t('common.refresh')" @click="refresh" />
      </template>
    </SidebarHeader>

    <div class="recent-chats-pagination">
      <Pagination
        v-if="recentChats.length > 0"
        v-model:current-page="currentPage"
        v-model:items-per-page="itemsPerPage"
        :total-items="recentChats.length"
        :items-per-page-options="[10, 20, 50]"
      />
    </div>

    <div v-show="isSelectionMode" class="recent-chats-selection-bar">
      <div class="selection-info">{{ selectedChats.size }} {{ t('common.selected') }}</div>
      <div class="selection-actions">
        <Button class="small" @click="selectAllVisible">
          {{ t('common.selectAll') }}
        </Button>
        <Button variant="danger" class="small" :disabled="selectedChats.size === 0" @click="deleteSelected">
          <i class="fa-solid fa-trash"></i>
        </Button>
      </div>
    </div>

    <div class="recent-chats-content">
      <ListItem
        v-for="chat in paginatedRecentChats"
        :key="chat.file_id"
        :active="chatStore.activeChatFile === chat.file_id"
        :selected="selectedChats.has(chat.file_id)"
        @click="onItemClick(chat)"
      >
        <template #start>
          <div class="recent-chat-avatar">
            <SmartAvatar :urls="getChatAvatars(chat)" />

            <!-- Group Chat Indicator / Member Count -->
            <div v-if="isGroupChat(chat)" class="recent-chat-group-badge" :title="t('chat.groupChat')">
              <i class="fa-solid fa-users"></i>
              <span v-if="getMemberCount(chat) > 0" class="count">{{ getMemberCount(chat) }}</span>
            </div>

            <!-- Selection Checkbox -->
            <div v-show="isSelectionMode" class="recent-chat-selection-indicator">
              <i v-if="selectedChats.has(chat.file_id)" class="fa-solid fa-check"></i>
            </div>
          </div>
        </template>

        <template #default>
          <div class="recent-chat-info">
            <div class="recent-chat-name" :title="chat.chat_metadata.name || chat.file_id">
              {{ chat.chat_metadata.name || chat.file_id }}
            </div>
            <div class="recent-chat-preview">
              {{ chat.mes || t('chat.emptyLog') }}
            </div>
            <div class="recent-chat-meta">
              <span>{{ formatTimeStamp(chat.last_mes) }}</span>
              <span>{{ chat.chat_items }} {{ t('common.messages').toLowerCase() }}</span>
            </div>
          </div>
        </template>
      </ListItem>

      <EmptyState v-if="recentChats.length === 0" icon="fa-comments" :description="t('chatManagement.noRecentChats')" />
    </div>
  </div>
</template>
