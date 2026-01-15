<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useChatSelectionStore } from '../../stores/chat-selection.store';
import { useChatStore } from '../../stores/chat.store';
import { Button } from '../UI';

const chatSelectionStore = useChatSelectionStore();
const chatStore = useChatStore();
const { t } = useStrictI18n();

function toggleSelectionType() {
  const newType = chatSelectionStore.selectionModeType === 'free' ? 'range' : 'free';
  chatSelectionStore.setSelectionType(newType);
}

const selectionModeIcon = computed(() =>
  chatSelectionStore.selectionModeType === 'free' ? 'fa-hand-pointer' : 'fa-arrow-down-long',
);

const selectionModeTitle = computed(() =>
  chatSelectionStore.selectionModeType === 'free' ? t('chat.selection.modeFree') : t('chat.selection.modeRange'),
);
</script>

<template>
  <div class="selection-toolbar" role="toolbar" :aria-label="t('chat.selection.toolbar')">
    <div class="selection-info">
      <span
        >{{ chatSelectionStore.selectedMessageIndices.size }} {{ t('common.selected') }} ({{
          t('chat.delete.plusOne')
        }})
      </span>
    </div>
    <div class="selection-actions">
      <!-- Selection Mode Toggle -->
      <Button
        :icon="selectionModeIcon"
        variant="ghost"
        :title="selectionModeTitle"
        active
        @click="toggleSelectionType"
      />

      <div class="separator-vertical"></div>

      <Button
        variant="ghost"
        :title="t('common.selectAll')"
        @click="chatSelectionStore.selectAll(chatStore.activeChat?.messages.length ?? 0)"
      >
        {{ t('common.selectAll') }}
      </Button>
      <Button variant="ghost" :title="t('common.none')" @click="chatSelectionStore.deselectAll">
        {{ t('common.none') }}
      </Button>
      <Button variant="danger" icon="fa-trash" @click="chatStore.deleteSelectedMessages">
        {{ t('common.delete') }}
      </Button>
      <Button variant="ghost" icon="fa-xmark" @click="chatSelectionStore.toggleSelectionMode">
        {{ t('common.cancel') }}
      </Button>
    </div>
  </div>
</template>
