<script setup lang="ts">
import { debounce } from 'lodash-es';
import { computed, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { DebounceTimeout, GenerationMode, GroupGenerationHandlingMode, GroupReplyStrategy } from '../../constants';
import { chatService } from '../../services/chat.service';
import { useCharacterUiStore } from '../../stores/character-ui.store';
import { useCharacterStore } from '../../stores/character.store';
import { useChatStore } from '../../stores/chat.store';
import { useGroupChatStore } from '../../stores/group-chat.store';
import { useLayoutStore } from '../../stores/layout.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { POPUP_RESULT, POPUP_TYPE, type Character, type ChatInfo } from '../../types';
import { getThumbnailUrl } from '../../utils/character';
import { formatTimeStamp, humanizedDateTime } from '../../utils/commons';
import { ConnectionProfileSelector, DraggableList, EmptyState, Pagination } from '../common';
import {
  Button,
  Checkbox,
  CollapsibleSection,
  FileInput,
  FormItem,
  Input,
  ListItem,
  Search,
  Select,
  Tabs,
  Textarea,
} from '../UI';

const { t } = useStrictI18n();
const chatStore = useChatStore();
const groupChatStore = useGroupChatStore();
const characterStore = useCharacterStore();
const characterUiStore = useCharacterUiStore();
const popupStore = usePopupStore();
const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
const worldInfoStore = useWorldInfoStore();

const activeTab = ref<'config' | 'members' | 'chats'>('config');
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
  allChats = allChats.filter((chat, index, self) => index === self.findIndex((c) => c.file_id === chat.file_id));

  if (chatSearchTerm.value) {
    const lower = chatSearchTerm.value.toLowerCase();
    allChats = allChats.filter(
      (c) =>
        c.file_id.toLowerCase().includes(lower) ||
        (c.chat_metadata.name && c.chat_metadata.name.toLowerCase().includes(lower)),
    );
  }

  allChats.sort((a, b) => b.last_mes - a.last_mes);
  return allChats;
});

async function selectChat(chatFile: string) {
  try {
    await chatStore.setActiveChatFile(chatFile);
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
      chatStore.recentChats = chatStore.recentChats.filter((chat) => chat.file_id !== chatFile);
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
const isGroup = computed(() => groupChatStore.isGroupChat);

// Options for Select
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

function toggleMute(avatar: string) {
  groupChatStore.toggleMemberMute(avatar);
}

function forceTalk(avatar: string) {
  chatStore.generateResponse(GenerationMode.NEW, { forceSpeakerAvatar: avatar });
}

function updateMembersOrder(newMembers: Character[]) {
  if (!chatStore.activeChat) return;
  const newMemberIds = newMembers.map((m) => m.avatar);

  if (chatStore.activeChat.metadata) {
    chatStore.activeChat.metadata.members = newMemberIds;
    chatStore.triggerSave();
  }
}

function peekCharacter(avatar: string) {
  characterUiStore.selectCharacterByAvatar(avatar);
  layoutStore.activeDrawer = 'character';
}

function getCharName(avatar: string) {
  return characterStore.characters.find((c) => c.avatar === avatar)?.name || avatar;
}
</script>

<template>
  <div class="popup-body chat-management">
    <div class="chat-management-header">
      <Tabs
        v-model="activeTab"
        style="border-bottom: none; margin-bottom: 0"
        :options="[
          { label: t('chatManagement.tabs.config'), value: 'config' },
          { label: t('chatManagement.tabs.group'), value: 'members' },
          { label: t('chatManagement.tabs.chats'), value: 'chats' },
        ]"
      />
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

      <!-- Tab: Members / Group Config -->
      <div v-show="activeTab === 'members' && chatStore.activeChatFile" class="chat-management-tab-content">
        <!-- Queue Display -->
        <div v-if="groupChatStore.generationQueue.length > 0" class="queue-section">
          <div class="queue-header">
            <span>{{ t('group.queue') }} ({{ groupChatStore.generationQueue.length }})</span>
            <Button icon="fa-trash" variant="ghost" :title="t('group.clearQueue')" @click="groupChatStore.clearQueue" />
          </div>
          <div class="queue-list">
            <div v-for="(avatar, idx) in groupChatStore.generationQueue" :key="idx" class="queue-item">
              <div class="queue-avatar-wrapper">
                <img :src="getThumbnailUrl('avatar', avatar)" :title="getCharName(avatar)" />
                <div class="queue-order">{{ idx + 1 }}</div>
              </div>
              <i v-if="idx < groupChatStore.generationQueue.length - 1" class="fa-solid fa-arrow-right separator"></i>
            </div>
          </div>
        </div>

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
              <ListItem :class="{ muted: groupConfig?.members[member.avatar]?.muted }" style="margin-bottom: 2px">
                <template #start>
                  <div
                    class="menu-button fa-solid fa-grip-lines group-member-handle"
                    style="cursor: grab; opacity: 0.5; margin-right: 5px"
                  ></div>
                  <img
                    :src="getThumbnailUrl('avatar', member.avatar)"
                    style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover"
                  />
                </template>
                <template #default>
                  <div class="group-member-content-wrapper">
                    <span
                      class="group-member-name"
                      :class="{ 'line-through': groupConfig?.members[member.avatar]?.muted }"
                      >{{ member.name }}</span
                    >
                    <div v-if="groupChatStore.generatingAvatar === member.avatar" class="typing-indicator-small">
                      <div class="dot" />
                      <div class="dot" />
                      <div class="dot" />
                    </div>
                  </div>
                </template>
                <template #end>
                  <Button
                    v-if="isGroup"
                    variant="ghost"
                    icon="fa-address-card"
                    :title="t('group.peek')"
                    @click="peekCharacter(member.avatar)"
                  />
                  <Button
                    v-if="isGroup"
                    variant="ghost"
                    icon="fa-comment-dots"
                    :title="t('group.forceTalk')"
                    @click="forceTalk(member.avatar)"
                  />
                  <Button
                    v-if="isGroup"
                    variant="ghost"
                    :icon="groupConfig?.members[member.avatar]?.muted ? 'fa-comment-slash' : 'fa-comment'"
                    :title="t('group.mute')"
                    @click="toggleMute(member.avatar)"
                  />
                  <Button
                    icon="fa-trash-can"
                    variant="danger"
                    :title="t('common.remove')"
                    @click="groupChatStore.removeMember(member.avatar)"
                  />
                </template>
              </ListItem>
            </template>
          </DraggableList>
        </CollapsibleSection>

        <!-- Add Member Section -->
        <CollapsibleSection
          v-model:is-open="settingsStore.settings.account.addMemberExpanded"
          :title="t('group.addMember')"
        >
          <div class="group-add-section">
            <Search v-model="addMemberSearchTerm" :placeholder="t('common.search')" @input="addMemberPage = 1" />

            <div class="add-member-list">
              <div v-for="char in availableCharactersPaginated" :key="char.avatar">
                <ListItem @click="groupChatStore.addMember(char.avatar)">
                  <template #start>
                    <img
                      :src="getThumbnailUrl('avatar', char.avatar)"
                      style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover"
                    />
                  </template>
                  <template #default>{{ char.name }}</template>
                  <template #end><i class="fa-solid fa-plus"></i></template>
                </ListItem>
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
            <FormItem :label="t('group.replyStrategy')">
              <Select
                v-model="groupConfig.config.replyStrategy"
                :options="replyStrategyOptions"
                @update:model-value="saveDebounced"
              />
            </FormItem>

            <FormItem :label="t('group.handlingMode')">
              <Select
                v-model="groupConfig.config.handlingMode"
                :options="handlingModeOptions"
                @update:model-value="saveDebounced"
              />
            </FormItem>

            <Checkbox
              v-model="groupConfig.config.allowSelfResponses"
              :label="t('group.allowSelfResponses')"
              @update:model-value="saveDebounced"
            />

            <FormItem :label="t('group.autoMode')" :description="t('group.autoModeHint')">
              <Input
                v-model="groupConfig.config.autoMode"
                type="number"
                :min="0"
                :placeholder="t('common.seconds')"
                @update:model-value="saveDebounced"
              />
            </FormItem>
          </div>
        </CollapsibleSection>
      </div>

      <!-- Tab: Config -->
      <div v-show="activeTab === 'config'" class="chat-management-config-tab">
        <div v-if="chatStore.activeChat?.metadata.promptOverrides">
          <FormItem :label="t('chatManagement.scenarioOverride')">
            <Textarea
              v-model="chatStore.activeChat.metadata.promptOverrides.scenario!"
              :rows="6"
              :placeholder="t('chatManagement.scenarioOverridePlaceholder')"
              @update:model-value="saveDebounced"
            />
          </FormItem>

          <hr />

          <FormItem :label="t('chatManagement.connectionProfile')">
            <ConnectionProfileSelector v-model="activeChatConnectionProfile" />
          </FormItem>

          <hr />

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
      </div>
    </div>
  </div>
</template>
