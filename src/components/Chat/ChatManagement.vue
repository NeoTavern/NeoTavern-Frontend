<script setup lang="ts">
import { computed, ref } from 'vue';
import { useChatStore } from '../../stores/chat.store';
import { useCharacterStore } from '../../stores/character.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import { POPUP_RESULT, POPUP_TYPE, type ChatInfo, type Character } from '../../types';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { formatTimeStamp, humanizedDateTime } from '../../utils/date';
import * as api from '../../api/chat';
import { toast } from '../../composables/useToast';
import { GenerationMode, GroupGenerationHandlingMode, GroupReplyStrategy } from '../../constants';
import { getThumbnailUrl } from '../../utils/image';
import Pagination from '../Common/Pagination.vue';
import DraggableList from '../Common/DraggableList.vue';
import { useUiStore } from '@/stores/ui.store';
import { AppButton, AppIconButton, AppInput, AppSelect, AppTextarea, AppCheckbox } from '../UI';
import CollapsibleSection from '../UI/CollapsibleSection.vue';
import EmptyState from '../Common/EmptyState.vue';

const { t } = useStrictI18n();
const chatStore = useChatStore();
const characterStore = useCharacterStore();
const popupStore = usePopupStore();
const settingsStore = useSettingsStore();
const uiStore = useUiStore();

const activeTab = ref<'chats' | 'members' | 'prompts'>('chats');
const chatSearchTerm = ref('');

const addMemberSearchTerm = ref('');
const addMemberPage = ref(1);

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
  // Remove duplicates
  allChats = allChats.filter((chat, index, self) => index === self.findIndex((c) => c.file_id === chat.file_id));

  // Filter by search
  if (chatSearchTerm.value) {
    const lower = chatSearchTerm.value.toLowerCase();
    allChats = allChats.filter((c) => c.file_id.toLowerCase().includes(lower));
  }

  allChats.sort((a, b) => b.last_mes - a.last_mes);
  return allChats;
});

async function selectChat(chatFile: string) {
  await chatStore.setActiveChatFile(chatFile);
}

async function createNewChat(askConfirmation = true) {
  if (!characterStore.activeCharacters) return;
  const firstCharacter = characterStore.activeCharacters[0];
  let result: POPUP_RESULT = POPUP_RESULT.AFFIRMATIVE;
  let value = `${firstCharacter?.avatar} - ${humanizedDateTime()}`;
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

async function renameChat(oldFile: string) {
  const { result, value: newName } = await popupStore.show({
    title: t('chatManagement.actions.rename'),
    content: t('chatManagement.renamePrompt'),
    type: POPUP_TYPE.INPUT,
    inputValue: oldFile,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && newName) {
    let newFileName = newName.trim();
    try {
      const info = chats.value.find((c) => c.file_id === oldFile);
      const isGroup = (info?.chat_metadata.members?.length ?? 0) > 1;
      newFileName = (await api.renameChat(oldFile, newFileName, isGroup)).newFileName;
      if (chatStore.activeChatFile === oldFile) {
        chatStore.activeChatFile = newFileName;
      }
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
      await api.deleteChat(chatFile);
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
      chatStore.recentChats = chatStore.recentChats.filter((chat) => chat.file_id !== chatFile);
    } catch {
      toast.error(t('chatManagement.errors.delete'));
    }
  }
}

// --- Group / Members Logic ---
const groupMembers = computed(() => {
  if (!chatStore.activeChat) return [];
  return (
    chatStore.activeChat.metadata.members?.map((avatar) => {
      return characterStore.characters.find((c) => c.avatar === avatar) || ({ name: avatar, avatar } as Character);
    }) || []
  );
});

const availableCharactersFiltered = computed(() => {
  if (!chatStore.activeChat) return [];
  const currentMembers = new Set(chatStore.activeChat.metadata.members || []);

  let list = characterStore.characters.filter((c) => !currentMembers.has(c.avatar));

  if (addMemberSearchTerm.value) {
    const term = addMemberSearchTerm.value.toLowerCase();
    list = list.filter((c) => c.name.toLowerCase().includes(term));
  }

  return list;
});

const availableCharactersPaginated = computed(() => {
  const start = (addMemberPage.value - 1) * settingsStore.settings.account.addMemberPageSize;
  const end = start + settingsStore.settings.account.addMemberPageSize;
  return availableCharactersFiltered.value.slice(start, end);
});

const groupConfig = computed(() => chatStore.groupConfig);
const isGroup = computed(() => chatStore.isGroupChat);

// Options for AppSelect
const replyStrategyOptions = computed(() => [
  { label: t('group.strategies.manual'), value: GroupReplyStrategy.MANUAL },
  { label: t('group.strategies.natural'), value: GroupReplyStrategy.NATURAL_ORDER },
  { label: t('group.strategies.list'), value: GroupReplyStrategy.LIST_ORDER },
  { label: t('group.strategies.pooled'), value: GroupReplyStrategy.POOLED_ORDER },
]);

const handlingModeOptions = computed(() => [
  { label: t('group.modes.swap'), value: GroupGenerationHandlingMode.SWAP },
  { label: t('group.modes.joinExclude'), value: GroupGenerationHandlingMode.JOIN_EXCLUDE_MUTED },
  { label: t('group.modes.joinInclude'), value: GroupGenerationHandlingMode.JOIN_INCLUDE_MUTED },
]);

function toggleMute(avatar: string) {
  chatStore.toggleMemberMute(avatar);
}

function forceTalk(avatar: string) {
  chatStore.generateResponse(GenerationMode.NEW, avatar);
}

function updateMembersOrder(newMembers: Character[]) {
  if (!chatStore.activeChat) return;
  const newMemberIds = newMembers.map((m) => m.avatar);

  if (chatStore.activeChat.metadata) {
    chatStore.activeChat.metadata.members = newMemberIds;
  }
}

function peekCharacter(avatar: string) {
  characterStore.selectCharacterByAvatar(avatar);
  uiStore.activeDrawer = 'character';
}

async function addMember(avatar: string) {
  await chatStore.addMember(avatar);
}

async function removeMember(avatar: string) {
  await chatStore.removeMember(avatar);
}
</script>

<template>
  <div class="popup-body chat-management">
    <div class="chat-management-header">
      <AppButton :class="{ active: activeTab === 'chats' }" @click="activeTab = 'chats'">
        {{ t('chatManagement.tabs.chats') }}
      </AppButton>
      <AppButton :class="{ active: activeTab === 'members' }" @click="activeTab = 'members'">
        {{ t('chatManagement.tabs.group') }}
      </AppButton>
      <AppButton :class="{ active: activeTab === 'prompts' }" @click="activeTab = 'prompts'">
        {{ t('chatManagement.tabs.prompts') }}
      </AppButton>
    </div>

    <div class="chat-management-content">
      <!-- Tab: Chats -->
      <div v-show="activeTab === 'chats'" class="chat-management-tab-content">
        <div class="chat-management-actions">
          <AppButton v-show="characterStore.activeCharacters.length > 0" icon="fa-plus" @click="createNewChat()">
            {{ t('chatManagement.newChat') }}
          </AppButton>
          <AppInput
            v-model="chatSearchTerm"
            type="search"
            class="chat-management-search-input"
            :placeholder="t('common.search')"
          />
        </div>

        <div class="chat-management-list">
          <div
            v-for="file in chats"
            :key="file.file_id"
            class="chat-management-item"
            :class="{ active: chatStore.activeChatFile === file.file_id }"
            @click="selectChat(file.file_id)"
          >
            <div class="chat-management-item-icon">
              <i class="fa-solid fa-comments"></i>
            </div>
            <div class="chat-management-item-info">
              <div class="chat-management-item-name" :title="file.file_id">
                {{ file.file_id }}
              </div>
              <div class="chat-management-item-meta">
                <span>{{ formatTimeStamp(file.last_mes) }}</span>
                <span>{{ file.chat_items }} msgs</span>
              </div>
            </div>
            <div class="chat-management-item-actions">
              <AppIconButton
                icon="fa-pencil"
                :title="t('chatManagement.actions.rename')"
                @click.stop="renameChat(file.file_id)"
              />
              <AppIconButton
                icon="fa-trash-can"
                variant="danger"
                :title="t('chatManagement.actions.delete')"
                @click.stop="deleteChat(file.file_id)"
              />
            </div>
          </div>
          <EmptyState v-if="chats.length === 0" :description="t('chatManagement.noChatsFound')" />
        </div>
      </div>

      <!-- Tab: Members / Group Config -->
      <div v-show="activeTab === 'members' && chatStore.activeChatFile" class="chat-management-tab-content">
        <!-- Current Members -->
        <CollapsibleSection
          v-model:is-open="settingsStore.settings.account.groupMembersExpanded"
          :title="t('group.members')"
        >
          <DraggableList
            :items="groupMembers"
            item-key="avatar"
            class="group-members-list"
            handle-class="group-member-handle"
            @update:items="updateMembersOrder"
          >
            <template #default="{ item: member }">
              <div class="group-member-item" :class="{ muted: groupConfig?.members[member.avatar]?.muted }">
                <div
                  class="menu-button-icon fa-solid fa-grip-lines group-member-handle"
                  style="cursor: grab; opacity: 0.5"
                  :title="t('common.dragToReorder')"
                ></div>

                <img :src="getThumbnailUrl('avatar', member.avatar)" />
                <span class="group-member-name" :title="member.name">{{ member.name }}</span>

                <div class="member-actions">
                  <AppIconButton
                    v-if="isGroup"
                    icon="fa-address-card"
                    :title="t('group.peek')"
                    @click="peekCharacter(member.avatar)"
                  />
                  <AppIconButton
                    v-if="isGroup"
                    icon="fa-comment-dots"
                    :title="t('group.forceTalk')"
                    @click="forceTalk(member.avatar)"
                  />
                  <AppIconButton
                    v-if="isGroup"
                    :icon="groupConfig?.members[member.avatar]?.muted ? 'fa-comment-slash' : 'fa-comment'"
                    :title="t('group.mute')"
                    @click="toggleMute(member.avatar)"
                  />
                  <AppIconButton
                    icon="fa-trash-can"
                    variant="danger"
                    :title="t('common.remove')"
                    @click="removeMember(member.avatar)"
                  />
                </div>
              </div>
            </template>
          </DraggableList>
        </CollapsibleSection>

        <!-- Add Member Section -->
        <CollapsibleSection
          v-model:is-open="settingsStore.settings.account.addMemberExpanded"
          :title="t('group.addMember')"
        >
          <div class="group-add-section">
            <h4>{{ t('group.addMember') }}</h4>
            <AppInput
              v-model="addMemberSearchTerm"
              type="search"
              class="add-member-search"
              :placeholder="t('common.search')"
              @input="addMemberPage = 1"
            />
            <div class="add-member-list">
              <div
                v-for="char in availableCharactersPaginated"
                :key="char.avatar"
                class="add-member-card"
                @click="addMember(char.avatar)"
              >
                <img :src="getThumbnailUrl('avatar', char.avatar)" />
                <span>{{ char.name }}</span>
                <i class="fa-solid fa-plus"></i>
              </div>
              <EmptyState v-if="availableCharactersPaginated.length === 0" :description="t('common.noResults')" />
            </div>
            <Pagination
              v-if="availableCharactersFiltered.length > settingsStore.settings.account.addMemberPageSize"
              v-model:current-page="addMemberPage"
              v-model:items-per-page="settingsStore.settings.account.addMemberPageSize"
              :total-items="availableCharactersFiltered.length"
              :items-per-page-options="[10, 25, 50, 100]"
            />
          </div>
        </CollapsibleSection>

        <!-- Group Config: Only show if actual group -->
        <CollapsibleSection
          v-if="isGroup && groupConfig"
          v-model:is-open="settingsStore.settings.account.groupConfigExpanded"
          :title="t('group.configuration')"
        >
          <div class="group-config-section">
            <hr />
            <AppSelect
              v-model="groupConfig.config.replyStrategy"
              :label="t('group.replyStrategy')"
              :options="replyStrategyOptions"
            />

            <AppSelect
              v-model="groupConfig.config.handlingMode"
              :label="t('group.handlingMode')"
              :options="handlingModeOptions"
            />

            <AppCheckbox v-model="groupConfig.config.allowSelfResponses" :label="t('group.allowSelfResponses')" />

            <AppInput
              v-model="groupConfig.config.autoMode"
              type="number"
              :label="t('group.autoMode') + ' (' + t('common.seconds') + ')'"
              :min="0"
            />
            <small>{{ t('group.autoModeHint') }}</small>
          </div>
        </CollapsibleSection>
      </div>

      <!-- Tab: Prompt Overrides -->
      <div v-show="activeTab === 'prompts'" class="chat-management-prompt-tab">
        <div v-if="chatStore.activeChat?.metadata.promptOverrides">
          <AppTextarea
            v-model="chatStore.activeChat.metadata.promptOverrides.scenario!"
            :label="t('chatManagement.scenarioOverride')"
            :rows="6"
            :placeholder="t('chatManagement.scenarioOverridePlaceholder')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
