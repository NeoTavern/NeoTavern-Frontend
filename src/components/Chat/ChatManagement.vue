<script setup lang="ts">
import { debounce } from 'lodash-es';
import { computed, nextTick, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { DebounceTimeout } from '../../constants';
import { chatService } from '../../services/chat.service';
import { useCharacterStore } from '../../stores/character.store';
import { useChatStore } from '../../stores/chat.store';
import { useComponentRegistryStore } from '../../stores/component-registry.store';
import { useLayoutStore } from '../../stores/layout.store';
import { usePopupStore } from '../../stores/popup.store';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { POPUP_RESULT, POPUP_TYPE, type ChatInfo } from '../../types';
import { formatTimeStamp, humanizedDateTime } from '../../utils/commons';
import { eventEmitter } from '../../utils/extensions';
import { ConnectionProfileSelector, EmptyState } from '../common';
import { Button, FileInput, FormItem, ListItem, Search, Select, Tabs, Textarea } from '../UI';

const { t } = useStrictI18n();
const chatStore = useChatStore();
const characterStore = useCharacterStore();
const popupStore = usePopupStore();
const layoutStore = useLayoutStore();
const worldInfoStore = useWorldInfoStore();
const componentRegistry = useComponentRegistryStore();

const activeTab = ref<string>('config');
const chatSearchTerm = ref('');

// --- Chat List Logic ---
const chats = computed<ChatInfo[]>(() => {
  if (!characterStore.activeCharacters) return [];
  const avatars = characterStore.activeCharacterAvatars;
  let allChats: ChatInfo[] = [];
  for (const avatar of avatars) {
    const chatsForAvatar = chatStore.chatsMetadataByCharacterAvatars[avatar];
    if (chatsForAvatar) {
      allChats.push(...chatsForAvatar);
    }
  }
  allChats = allChats.filter((chat, index, self) => index === self.findIndex((c) => c.file_id === chat.file_id));

  if (chatSearchTerm.value) {
    const lower = chatSearchTerm.value.toLowerCase();
    allChats = allChats.filter(
      (c) =>
        c.file_id.toLowerCase().includes(lower) ||
        (c.chat_metadata.name && c.chat_metadata.name.toLowerCase().includes(lower)),
    );
  }

  allChats.sort((a, b) => b.last_mes.localeCompare(a.last_mes));
  return allChats;
});

async function selectChat(chatFile: string) {
  try {
    chatStore.setActiveChatFile(chatFile);
    layoutStore.autoCloseSidebarsOnMobile();
  } catch {
    toast.error(t('chat.loadError'));
  }
}

async function createNewChat(askConfirmation = true) {
  if (!characterStore.activeCharacters) return;
  const firstCharacter = characterStore.activeCharacters[0];
  let result: POPUP_RESULT = POPUP_RESULT.AFFIRMATIVE;
  let value = `${firstCharacter?.name} - ${humanizedDateTime()}`;
  if (askConfirmation) {
    ({ result, value } = await popupStore.show({
      title: t('chatManagement.newChat'),
      content: t('chatManagement.createPrompt'),
      type: POPUP_TYPE.INPUT,
      inputValue: value,
    }));
  }

  if (result === POPUP_RESULT.AFFIRMATIVE && value) {
    try {
      await chatStore.createNewChatForCharacter(firstCharacter.avatar, value.trim());
    } catch {
      toast.error(t('chatManagement.errors.create'));
    }
  }
}

async function renameChat(fileId: string, currentName?: string) {
  const { result, value: newName } = await popupStore.show<string>({
    title: t('chatManagement.actions.rename'),
    content: t('chatManagement.renamePrompt'),
    type: POPUP_TYPE.INPUT,
    inputValue: currentName || fileId,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && newName) {
    try {
      await chatStore.updateChatName(fileId, newName.trim());
    } catch {
      toast.error(t('chatManagement.errors.rename'));
    }
  }
}

async function deleteChat(chatFile: string) {
  const { result } = await popupStore.show({
    title: t('chatManagement.deleteConfirmTitle'),
    content: t('chatManagement.deleteConfirmContent', { chatFile }),
    type: POPUP_TYPE.CONFIRM,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    try {
      await chatService.delete(chatFile);
      const index = chats.value.findIndex((chat) => chat.file_id === chatFile);
      const isActiveChat = chatStore.activeChatFile === chatFile;
      if (isActiveChat) {
        if (chats.value.length > 1) {
          const newIndex = index === 0 ? 1 : index - 1;
          const newChatFile = chats.value[newIndex].file_id;
          await selectChat(newChatFile);
        } else {
          await createNewChat(false);
        }
      }
      chatStore.chatInfos = chatStore.chatInfos.filter((chat) => chat.file_id !== chatFile);
      nextTick().then(() => {
        eventEmitter.emit('chat:deleted', chatFile);
      });
    } catch {
      toast.error(t('chatManagement.errors.delete'));
    }
  }
}

async function exportChat() {
  try {
    await chatStore.exportActiveChat('jsonl');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    toast.error(error.message || t('chatManagement.errors.export'));
    console.error('Error exporting chat:', error);
  }
}

async function handleImportFiles(files: File[]) {
  const file = files[0];
  if (!file) return;

  const ext = file.name.split('.').pop()?.toLowerCase();
  const fileType = ext === 'json' ? 'json' : 'jsonl';

  try {
    const result = await chatStore.importChats(fileType, file);
    toast.success(t('chatManagement.import.success', { count: result.fileNames.length }));
  } catch (error: unknown) {
    toast.error((error as Error).message || t('chatManagement.import.error'));
  }
}

const availableLorebooks = computed(() => {
  return worldInfoStore.bookInfos.map((info) => ({ label: info.name, value: info.file_id }));
});

const saveDebounced = debounce(() => {
  chatStore.triggerSave();
}, DebounceTimeout.RELAXED);

const activeChatLorebooks = computed({
  get: () => chatStore.activeChat?.metadata.chat_lorebooks || [],
  set: (val) => {
    if (chatStore.activeChat) {
      chatStore.activeChat.metadata.chat_lorebooks = val;
      saveDebounced();
    }
  },
});

const activeChatConnectionProfile = computed({
  get: () => chatStore.activeChat?.metadata.connection_profile,
  set: (val) => {
    if (chatStore.activeChat) {
      chatStore.activeChat.metadata.connection_profile = val;
      saveDebounced();
    }
  },
});

const tabs = computed(() => {
  const baseTabs = [
    { label: t('chatManagement.tabs.config'), value: 'config' },
    { label: t('chatManagement.tabs.chats'), value: 'chats' },
  ];
  const dynamicTabs = Array.from(componentRegistry.chatSettingsTabRegistry.values()).map((tab) => ({
    label: tab.title,
    value: tab.id,
  }));
  return [...baseTabs, ...dynamicTabs];
});
</script>

<template>
  <div class="popup-body chat-management">
    <div class="chat-management-header">
      <Tabs v-model="activeTab" style="border-bottom: none; margin-bottom: 0" :options="tabs" />
    </div>

    <div class="chat-management-content">
      <!-- Tab: Chats -->
      <div v-show="activeTab === 'chats'" class="chat-management-tab-content">
        <div class="chat-management-actions">
          <Search v-model="chatSearchTerm" :placeholder="t('common.search')" style="margin-top: 5px">
            <template #actions>
              <Button
                :active="!!chatStore.activeChatFile"
                icon="fa-file-export"
                variant="ghost"
                :title="t('chatManagement.actions.export')"
                style="margin-right: 5px; opacity: 0.7"
                @click="exportChat()"
              />
              <FileInput
                accept=".jsonl"
                icon="fa-file-import"
                :label="t('chatManagement.actions.import')"
                style="margin-right: 5px"
                @change="handleImportFiles"
              />
              <Button v-show="characterStore.activeCharacters.length > 0" icon="fa-plus" @click="createNewChat()">
                {{ t('chatManagement.newChat') }}
              </Button>
            </template>
          </Search>
        </div>

        <div class="chat-management-list">
          <div v-for="file in chats" :key="file.file_id">
            <ListItem :active="chatStore.activeChatFile === file.file_id" @click="selectChat(file.file_id)">
              <template #start>
                <div class="chat-management-item-icon">
                  <i class="fa-solid fa-comments"></i>
                </div>
              </template>
              <template #default>
                <div
                  class="font-bold"
                  :title="file.chat_metadata.name || file.file_id"
                  style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis"
                >
                  {{ file.chat_metadata.name || file.file_id }}
                </div>
                <div style="font-size: 0.85em; opacity: 0.7; display: flex; gap: 12px">
                  <span>{{ formatTimeStamp(file.last_mes) }}</span>
                  <span>{{ file.chat_items }} msgs</span>
                </div>
              </template>
              <template #end>
                <Button
                  icon="fa-pencil"
                  variant="ghost"
                  :title="t('chatManagement.actions.rename')"
                  @click.stop="renameChat(file.file_id, file.chat_metadata.name)"
                />
                <Button
                  icon="fa-trash-can"
                  variant="danger"
                  :title="t('chatManagement.actions.delete')"
                  @click.stop="deleteChat(file.file_id)"
                />
              </template>
            </ListItem>
          </div>
          <EmptyState v-if="chats.length === 0" :description="t('chatManagement.noChatsFound')" />
        </div>
      </div>

      <!-- Tab: Config -->
      <div v-show="activeTab === 'config'" class="chat-management-config-tab">
        <FormItem v-if="chatStore.activeChat?.metadata.promptOverrides" :label="t('chatManagement.scenarioOverride')">
          <Textarea
            v-model="chatStore.activeChat.metadata.promptOverrides.scenario!"
            :rows="6"
            :placeholder="t('chatManagement.scenarioOverridePlaceholder')"
            @update:model-value="saveDebounced"
          />
        </FormItem>

        <FormItem :label="t('chatManagement.connectionProfile')">
          <ConnectionProfileSelector v-model="activeChatConnectionProfile" />
        </FormItem>

        <FormItem :label="t('chatManagement.chatLorebooks')">
          <Select
            v-model="activeChatLorebooks"
            :options="availableLorebooks"
            multiple
            searchable
            :placeholder="t('chatManagement.selectLorebooks')"
          />
        </FormItem>
      </div>

      <!-- Registered Tabs -->
      <template v-for="tab in componentRegistry.chatSettingsTabRegistry.values()" :key="tab.id">
        <div v-show="activeTab === tab.id" class="chat-management-tab-content">
          <component :is="tab.component" />
        </div>
      </template>
    </div>
  </div>
</template>
