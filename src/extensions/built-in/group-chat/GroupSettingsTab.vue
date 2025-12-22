<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  Button,
  Checkbox,
  CollapsibleSection,
  FormItem,
  Input,
  ListItem,
  Search,
  Select,
  Textarea,
} from '../../../components/UI';
import { ConnectionProfileSelector, DraggableList, EmptyState } from '../../../components/common';
import { useStrictI18n } from '../../../composables/useStrictI18n';
import type { Character, ExtensionAPI } from '../../../types';
import { getThumbnailUrl } from '../../../utils/character';
import type { GroupChatService } from './GroupChatService';
import { DEFAULT_DECISION_TEMPLATE } from './GroupChatService';
import { GroupGenerationHandlingMode, GroupReplyStrategy } from './types';

// Props are injected by the extension system usually, but since we mount it manually
// we might need a way to pass the service.
// For now, we assume the service is available globally or injected via provide/inject
// but since we are in `index.ts`, we can just import the singleton if we make one,
// OR pass it as a prop when mounting.
// The ExtensionAPI `registerChatSettingsTab` expects a Component.
// We will attach the API/Service to the component instance in `index.ts`.

const props = defineProps<{
  api: ExtensionAPI;
  service: GroupChatService;
}>();

const { t } = useStrictI18n();
const service = props.service;
const api = props.api;

onMounted(() => {
  service.init();
});

// Local state for UI
const addMemberSearchTerm = ref('');
const addMemberPage = ref(1);
const addMemberExpanded = ref(false);
const groupMembersExpanded = ref(true);
const groupConfigExpanded = ref(true);

const groupConfig = computed(() => service.groupConfig.value);

const isGroup = computed(() => service.isGroupChat);

// Members List
const groupMembers = computed(() => {
  const meta = api.chat.metadata.get();
  if (!meta) return [];
  const chars = api.character.getAll();
  return (meta.members || []).map((avatar) => {
    return chars.find((c) => c.avatar === avatar) || ({ name: avatar, avatar } as Character);
  });
});

// Available for adding
const availableCharactersFiltered = computed(() => {
  const meta = api.chat.metadata.get();
  if (!meta) return [];
  const currentMembers = new Set(meta.members || []);
  const chars = api.character.getAll();

  let list = chars.filter((c) => !currentMembers.has(c.avatar));
  if (addMemberSearchTerm.value) {
    const term = addMemberSearchTerm.value.toLowerCase();
    list = list.filter((c) => c.name.toLowerCase().includes(term));
  }
  return list;
});

const availableCharactersPaginated = computed(() => {
  const pageSize = 10;
  const start = (addMemberPage.value - 1) * pageSize;
  const end = start + pageSize;
  return availableCharactersFiltered.value.slice(start, end);
});

// Options
const replyStrategyOptions = computed(() => [
  { label: t('group.strategies.manual'), value: GroupReplyStrategy.MANUAL },
  { label: t('group.strategies.natural'), value: GroupReplyStrategy.NATURAL_ORDER },
  { label: t('group.strategies.list'), value: GroupReplyStrategy.LIST_ORDER },
  { label: t('group.strategies.pooled'), value: GroupReplyStrategy.POOLED_ORDER },
  { label: 'LLM Decision', value: GroupReplyStrategy.LLM_DECISION },
]);

const handlingModeOptions = computed(() => [
  { label: t('group.modes.swap'), value: GroupGenerationHandlingMode.SWAP },
  { label: t('group.modes.joinExclude'), value: GroupGenerationHandlingMode.JOIN_EXCLUDE_MUTED },
  { label: t('group.modes.joinInclude'), value: GroupGenerationHandlingMode.JOIN_INCLUDE_MUTED },
]);

// Actions
function updateMembersOrder(newMembers: Character[]) {
  const meta = api.chat.metadata.get();
  if (!meta) return;
  meta.members = newMembers.map((m) => m.avatar);
  api.chat.metadata.set(meta);
  api.settings.save();
}

function saveDebounced() {
  if (groupConfig.value) {
    service.saveConfig(groupConfig.value);
  }
}

function resetDecisionPrompt() {
  if (groupConfig.value) {
    groupConfig.value.config.decisionPromptTemplate = DEFAULT_DECISION_TEMPLATE;
    saveDebounced();
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function peekCharacter(_avatar: string) {
  // FIXME: Not exposed in API yet, skipping for now or use workaround
  // api.ui.openSidebar('character-details');
}

function forceTalk(avatar: string) {
  service.clearQueue();
  service.addToQueue([avatar]);
  service.processQueue();
}
</script>

<template>
  <div class="group-settings-tab">
    <!-- Queue Display -->
    <div v-if="service.generationQueue.value.length > 0 || service.isAnalyzing.value" class="queue-section">
      <div class="queue-header">
        <span v-if="service.isAnalyzing.value">Deciding next speaker...</span>
        <span v-else>{{ t('group.queue') }} ({{ service.generationQueue.value.length }})</span>
        <Button
          v-if="!service.isAnalyzing.value"
          icon="fa-trash"
          variant="ghost"
          :title="t('group.clearQueue')"
          @click="service.clearQueue"
        />
      </div>

      <div v-if="service.isAnalyzing.value" class="queue-analyzing">
        <div class="loading-dots">
          <div class="dot"></div>
          <div class="dot"></div>
          <div class="dot"></div>
        </div>
      </div>

      <div v-else class="queue-list">
        <div v-for="(avatar, idx) in service.generationQueue.value" :key="idx" class="queue-item">
          <div class="queue-avatar-wrapper">
            <img :src="getThumbnailUrl('avatar', avatar)" :title="avatar" />
            <div class="queue-order">{{ idx + 1 }}</div>
          </div>
          <i v-if="idx < service.generationQueue.value.length - 1" class="fa-solid fa-arrow-right separator"></i>
        </div>
      </div>
    </div>

    <!-- Current Members -->
    <CollapsibleSection v-model:is-open="groupMembersExpanded" :title="t('group.members')">
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
                <div v-if="service.generatingAvatar.value === member.avatar" class="typing-indicator-small">
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
                @click="service.toggleMemberMute(member.avatar)"
              />
              <Button
                icon="fa-trash-can"
                variant="danger"
                :title="t('common.remove')"
                @click="service.removeMember(member.avatar)"
              />
            </template>
          </ListItem>
        </template>
      </DraggableList>
    </CollapsibleSection>

    <!-- Add Member -->
    <CollapsibleSection v-model:is-open="addMemberExpanded" :title="t('group.addMember')">
      <div class="group-add-section">
        <Search v-model="addMemberSearchTerm" :placeholder="t('common.search')" @input="addMemberPage = 1" />

        <div class="add-member-list">
          <div v-for="char in availableCharactersPaginated" :key="char.avatar">
            <ListItem @click="service.addMember(char.avatar)">
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
      </div>
    </CollapsibleSection>

    <!-- Config -->
    <CollapsibleSection
      v-if="isGroup && groupConfig"
      v-model:is-open="groupConfigExpanded"
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

        <template v-if="groupConfig.config.replyStrategy === GroupReplyStrategy.LLM_DECISION">
          <FormItem label="Connection Profile">
            <ConnectionProfileSelector
              v-model="groupConfig.config.connectionProfile"
              @update:model-value="saveDebounced"
            />
          </FormItem>

          <FormItem label="Context Size (Messages)">
            <Input
              v-model="groupConfig.config.decisionContextSize"
              type="number"
              :min="1"
              @update:model-value="saveDebounced"
            />
          </FormItem>

          <FormItem label="Decision Prompt" description="Use handlebars {{...}} for variables.">
            <div class="textarea-container">
              <Textarea
                v-model="groupConfig.config.decisionPromptTemplate!"
                :rows="6"
                @update:model-value="saveDebounced"
              />
              <Button
                class="reset-prompt-btn"
                icon="fa-rotate-left"
                title="Reset to default"
                variant="ghost"
                @click="resetDecisionPrompt"
              />
            </div>
            <div style="font-size: 0.8em; opacity: 0.7; margin-top: 5px">
              Available macros: <code>{{ '{' + '{user}' + '}' }}</code
              >, <code>{{ '{' + '{memberNames}' + '}' }}</code
              >, <code>{{ '{' + '{recentMessages}' + '}' }}</code>
            </div>
          </FormItem>
        </template>

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
</template>

<style scoped lang="scss">
@use '../../../styles/mixins' as *;

.group-settings-tab {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  height: 100%;
}

.group-members-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  flex-grow: 1;
  overflow-y: auto;
  min-height: 100px;
  padding: var(--spacing-xs);
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);
  max-height: 300px;

  .list-item.muted {
    opacity: 0.6;
  }

  .line-through {
    text-decoration: line-through;
  }

  .group-member-content-wrapper {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-grow: 1;
    overflow: hidden;
  }

  .group-member-name {
    font-weight: bold;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-grow: 1;
  }

  .typing-indicator-small {
    display: flex;
    align-items: center;
    flex-shrink: 0;

    .dot {
      width: 5px;
      height: 5px;
      margin: 0 1.5px;
      background-color: var(--theme-text-color);
      border-radius: 50%;
      opacity: 0.8;
      animation: typing-dot-animation 1.4s infinite ease-in-out;
      animation-fill-mode: both;

      &:nth-child(1) {
        animation-delay: -0.32s;
      }
      &:nth-child(2) {
        animation-delay: -0.16s;
      }
    }
  }
}

.group-add-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  max-height: 40vh;
  min-height: 250px;
}

.add-member-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  flex-grow: 1;
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-xs);
}

.group-config-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-sm);
  overflow-y: auto;
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);

  hr {
    width: 100%;
    border: none;
    border-top: 1px solid var(--theme-border-color);
    margin: 0;
  }
}

.textarea-container {
  position: relative;
}

.reset-prompt-btn {
  position: absolute;
  top: 5px;
  right: 20px;
  opacity: 0.5;
  background-color: var(--black-50a);

  &:hover {
    opacity: 1;
  }
}

// Queue Styles
.queue-section {
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);
  padding: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
  border: 1px solid var(--theme-border-color);
  @include subtle-shadow();
}

.queue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-sm);
  font-weight: bold;
  font-size: 0.9em;
  opacity: 0.9;
}

.queue-list {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  overflow-x: auto;
  padding-bottom: var(--spacing-xs);
}

.queue-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}

.queue-avatar-wrapper {
  position: relative;
  width: 40px;
  height: 40px;

  img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--theme-border-color);
  }
}

.queue-order {
  position: absolute;
  bottom: -2px;
  right: -2px;
  background-color: var(--theme-emphasis-color);
  color: var(--black-100);
  font-size: 0.7em;
  font-weight: bold;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.queue-item .separator {
  opacity: 0.5;
  font-size: 0.8em;
}

.queue-analyzing {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  opacity: 0.8;
  font-style: italic;

  .loading-dots {
    display: flex;
    gap: 4px;

    .dot {
      width: 8px;
      height: 8px;
      background-color: var(--theme-text-color);
      border-radius: 50%;
      animation: typing-dot-animation 1.4s infinite ease-in-out;

      &:nth-child(1) {
        animation-delay: -0.32s;
      }
      &:nth-child(2) {
        animation-delay: -0.16s;
      }
    }
  }
}

@keyframes typing-dot-animation {
  0%,
  80%,
  100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

.animations-disabled {
  .typing-dot-animation {
    animation: none !important;
  }
}
</style>
