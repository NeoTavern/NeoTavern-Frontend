<script setup lang="ts">
import { ref, watch } from 'vue';
import { useMobile } from '../../composables/useMobile';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { toast } from '../../composables/useToast';
import { convertCharacterBookToWorldInfoBook } from '../../services/world-info';
import { useCharacterStore } from '../../stores/character.store';
import { useChatSelectionStore } from '../../stores/chat-selection.store';
import { useChatStore } from '../../stores/chat.store';
import { useLayoutStore } from '../../stores/layout.store';
import { usePopupStore } from '../../stores/popup.store';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';
import ChatForm from './ChatForm.vue';
import ChatMessages from './ChatMessages.vue';
import ChatSelectionToolbar from './ChatSelectionToolbar.vue';

const chatStore = useChatStore();
const characterStore = useCharacterStore();
const chatSelectionStore = useChatSelectionStore();
const worldInfoStore = useWorldInfoStore();
const popupStore = usePopupStore();
const { isViewportMobile } = useMobile();
const layoutStore = useLayoutStore();
const { t } = useStrictI18n();

const userInput = ref('');
const isDragging = ref(false);
const dragEnterCounter = ref(0);
const chatFormRef = ref<InstanceType<typeof ChatForm> | null>(null);

// --- Drag and Drop Logic ---
function handleDragEnter(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) {
    dragEnterCounter.value++;
    isDragging.value = true;
  }
}

function handleDragLeave() {
  dragEnterCounter.value--;
  if (dragEnterCounter.value === 0) {
    isDragging.value = false;
  }
}

function handleDragOver(event: DragEvent) {
  // This is necessary to allow dropping
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault();
  }
}

async function handleDrop(event: DragEvent) {
  event.preventDefault();
  dragEnterCounter.value = 0;
  isDragging.value = false;

  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    chatFormRef.value?.processFiles(files);
  }
}

// --- Character Book Import ---
async function checkAndImportCharacterBooks() {
  const members = chatStore.activeChat?.metadata.members || [];
  for (const member of members) {
    const character = characterStore.characters.find((c) => c.avatar === member);
    if (character?.data?.character_book?.name) {
      const bookName = character.data.character_book.name;
      const exists = worldInfoStore.bookInfos.find((b) => b.name === bookName);
      if (!exists) {
        const { result } = await popupStore.show({
          title: t('worldInfo.popup.importEmbeddedTitle'),
          content: t('worldInfo.popup.importEmbeddedContent', { name: bookName }),
          type: POPUP_TYPE.CONFIRM,
        });

        if (result === POPUP_RESULT.AFFIRMATIVE) {
          const book = convertCharacterBookToWorldInfoBook(character.data.character_book);
          await worldInfoStore.createBook(book.name, book);
          toast.success(t('worldInfo.importSuccess', { name: bookName }));
        }
      }
    }
  }
}

watch(
  () => chatStore.activeChatFile,
  (newFile) => {
    if (newFile) {
      checkAndImportCharacterBooks();
    }
  },
);
</script>

<template>
  <div
    class="chat-interface"
    @dragenter.prevent="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop="handleDrop"
  >
    <div v-show="chatStore.isChatLoading" class="chat-loading-overlay" role="alert" aria-busy="true">
      <div class="loading-spinner">
        <i class="fa-solid fa-circle-notch fa-spin"></i>
        <span>{{ t('common.loading') }}</span>
      </div>
    </div>

    <div v-show="isDragging" class="chat-dropzone-overlay" :class="{ active: isDragging }">
      <div class="chat-dropzone-overlay-content">
        <div class="icon"><i class="fa-solid fa-upload"></i></div>
        <div class="text">{{ t('chat.media.dropFiles') }}</div>
      </div>
    </div>

    <ChatMessages />

    <div class="chat-interface-form-container">
      <ChatSelectionToolbar v-if="chatSelectionStore.isSelectionMode" />
      <ChatForm
        v-else-if="isViewportMobile ? !layoutStore.isLeftSidebarOpen && !layoutStore.isRightSidebarOpen : true"
        ref="chatFormRef"
        v-model:user-input="userInput"
      />
    </div>
  </div>
</template>
