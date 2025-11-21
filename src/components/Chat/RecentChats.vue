<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { useChatStore } from '../../stores/chat.store';
import { useSettingsStore } from '../../stores/settings.store';
import { usePopupStore } from '../../stores/popup.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { formatTimeStamp } from '../../utils/date';
import { getThumbnailUrl } from '../../utils/image';
import { POPUP_TYPE, POPUP_RESULT, type ChatInfo } from '../../types';
import { listRecentChats, deleteChat } from '../../api/chat';
import { toast } from '../../composables/useToast';
import Pagination from '../Common/Pagination.vue';
import { AppIconButton, AppButton } from '../UI';
import SmartAvatar from '../Common/SmartAvatar.vue';
import EmptyState from '../Common/EmptyState.vue';
import DrawerHeader from '../Common/DrawerHeader.vue';

const { t } = useStrictI18n();
const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();

// Persistence for page size

const currentPage = ref(1);
const itemsPerPage = ref(settingsStore.settings.account.recentChatsPageSize ?? 10);

// Selection Mode
const isSelectionMode = ref(false);
const selectedChats = ref<Set<string>>(new Set());

watch(itemsPerPage, (newVal) => {
  settingsStore.settings.account.recentChatsPageSize = newVal;
  currentPage.value = 1;
});

const recentChats = computed(() => chatStore.recentChats);

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
  const members = chat.chat_metadata.members || [];
  if (members.length === 0) return [];
  return members.slice(0, 4).map((m) => getThumbnailUrl('avatar', m));
}

async function onItemClick(chat: ChatInfo) {
  if (isSelectionMode.value) {
    toggleSelection(chat.file_id);
  } else {
    await chatStore.setActiveChatFile(chat.file_id);
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
        await deleteChat(id);
      }
      // Update store
      chatStore.recentChats = chatStore.recentChats.filter((c) => !selectedChats.value.has(c.file_id));
      // If active chat was deleted, clear it
      if (chatStore.activeChatFile && selectedChats.value.has(chatStore.activeChatFile)) {
        chatStore.activeChatFile = null;
        await chatStore.clearChat(false);
      }
      selectedChats.value.clear();
      isSelectionMode.value = false;
      toast.success(t('chatManagement.deleteSuccess', { count }));
    } catch (error) {
      console.error(error);
      toast.error(t('chatManagement.errors.delete'));
    }
  }
}

async function refresh() {
  try {
    chatStore.recentChats = await listRecentChats();
  } catch (err) {
    console.error(err);
    toast.error(t('chat.loadError'));
  }
}

onMounted(() => {
  if (chatStore.recentChats.length === 0) {
    refresh();
  }
});
</script>

<template>
  <div class="recent-chats">
    <DrawerHeader :title="t('navbar.recentChats')">
      <template #actions>
        <AppIconButton
          :icon="isSelectionMode ? 'fa-xmark' : 'fa-check-to-slot'"
          :title="isSelectionMode ? t('common.cancel') : t('common.select')"
          @click="toggleSelectionMode"
        />
        <AppIconButton icon="fa-rotate-right" :title="t('common.refresh')" @click="refresh" />
      </template>
    </DrawerHeader>

    <div v-show="isSelectionMode" class="recent-chats-selection-bar">
      <div class="selection-info">{{ selectedChats.size }} {{ t('common.selected') }}</div>
      <div class="selection-actions">
        <AppButton class="small" @click="selectAllVisible">
          {{ t('common.selectAll') }}
        </AppButton>
        <AppButton variant="danger" class="small" :disabled="selectedChats.size === 0" @click="deleteSelected">
          <i class="fa-solid fa-trash"></i>
        </AppButton>
      </div>
    </div>

    <div class="recent-chats-content">
      <div
        v-for="chat in paginatedRecentChats"
        :key="chat.file_id"
        class="recent-chat-item"
        :class="{
          active: chatStore.activeChatFile === chat.file_id,
          selected: selectedChats.has(chat.file_id),
          'selection-mode': isSelectionMode,
        }"
        @click="onItemClick(chat)"
      >
        <div class="recent-chat-item-avatar">
          <SmartAvatar :urls="getChatAvatars(chat)" />

          <div v-show="isSelectionMode" class="selection-checkbox">
            <i v-if="selectedChats.has(chat.file_id)" class="fa-solid fa-check"></i>
          </div>
        </div>

        <div class="recent-chat-item-details">
          <div class="recent-chat-item-name" :title="chat.file_name">
            {{ chat.file_name.replace('.jsonl', '') }}
          </div>
          <div class="recent-chat-item-preview">
            {{ chat.mes || t('chat.emptyLog') }}
          </div>
          <div class="recent-chat-item-meta">
            <span>{{ formatTimeStamp(chat.last_mes) }}</span>
            <span>{{ chat.chat_items }} {{ t('common.messages').toLowerCase() }}</span>
          </div>
        </div>
      </div>

      <EmptyState v-if="recentChats.length === 0" icon="fa-comments" :description="t('chatManagement.noRecentChats')" />
    </div>

    <div class="recent-chats-pagination">
      <Pagination
        v-if="recentChats.length > 0"
        v-model:current-page="currentPage"
        v-model:items-per-page="itemsPerPage"
        :total-items="recentChats.length"
        :items-per-page-options="[10, 20, 50]"
      />
    </div>
  </div>
</template>
