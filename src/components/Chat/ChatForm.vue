<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { isCapabilitySupported } from '../../api/provider-definitions';
import { useChatMedia } from '../../composables/useChatMedia';
import { useMobile } from '../../composables/useMobile';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { CustomPromptPostProcessing, GenerationMode } from '../../constants';
import { useApiStore } from '../../stores/api.store';
import { useChatSelectionStore } from '../../stores/chat-selection.store';
import { useChatUiStore } from '../../stores/chat-ui.store';
import { useChatStore } from '../../stores/chat.store';
import { usePromptStore } from '../../stores/prompt.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useToolStore } from '../../stores/tool.store';
import { Button, Checkbox, Textarea } from '../UI';

const props = defineProps<{
  userInput: string;
}>();

const emit = defineEmits<{
  (e: 'update:userInput', value: string): void;
}>();

const chatStore = useChatStore();
const chatUiStore = useChatUiStore();
const settingsStore = useSettingsStore();
const chatSelectionStore = useChatSelectionStore();
const promptStore = usePromptStore();
const toolStore = useToolStore();
const apiStore = useApiStore();
const { isDeviceMobile } = useMobile();
const { t } = useStrictI18n();

const chatInput = ref<InstanceType<typeof Textarea> | null>(null);

const {
  fileInput,
  attachedMedia,
  isUploading,
  acceptedFileTypes,
  isMediaAttachDisabled,
  mediaAttachTitle,
  processFiles,
  handleFileSelect,
  handlePaste,
  triggerFileUpload,
  removeAttachedMedia,
} = useChatMedia();

// Dummy log to avoid unused variable warning
console.debug(fileInput);

// --- Options Menu ---
const isOptionsMenuVisible = ref(false);
const optionsButtonRef = ref<HTMLElement | null>(null);
const optionsMenuRef = ref<HTMLElement | null>(null);

const { floatingStyles: optionsMenuStyles } = useFloating(optionsButtonRef, optionsMenuRef, {
  placement: 'top-start',
  open: isOptionsMenuVisible,
  whileElementsMounted: autoUpdate,
  middleware: [offset(8), flip(), shift({ padding: 10 })],
});

// --- Tools Menu ---
const isToolsMenuVisible = ref(false);
const toolsMenuRef = ref<HTMLElement | null>(null);

const { floatingStyles: toolsMenuStyles } = useFloating(optionsButtonRef, toolsMenuRef, {
  placement: 'top-start',
  open: isToolsMenuVisible,
  whileElementsMounted: autoUpdate,
  middleware: [offset(8), flip(), shift({ padding: 10 })],
});

const toolsWarning = computed<string | null>(() => {
  // 1. Check if tools are enabled in settings
  if (!settingsStore.settings.api.toolsEnabled) {
    return t('chat.tools.disabled.setting');
  }

  // 2. Check Custom Prompt Post Processing compatibility
  const currentPostProcessing = settingsStore.settings.api.customPromptPostProcessing;
  const allowedPostProcessing = [
    CustomPromptPostProcessing.NONE,
    CustomPromptPostProcessing.MERGE_TOOLS,
    CustomPromptPostProcessing.SEMI_TOOLS,
    CustomPromptPostProcessing.STRICT_TOOLS,
  ];

  if (!allowedPostProcessing.includes(currentPostProcessing)) {
    return t('chat.tools.disabled.postProcessing');
  }

  // 3. Check Capabilities (Provider/Model support)
  const provider = settingsStore.settings.api.provider;
  const model = settingsStore.settings.api.selectedProviderModels
    ? settingsStore.settings.api.selectedProviderModels[provider]
    : null;

  if (provider && model && !isCapabilitySupported('tools', provider, model, apiStore.modelList)) {
    return t('chat.tools.disabled.model');
  }

  return null;
});

async function submitMessage() {
  if ((!props.userInput.trim() && attachedMedia.value.length === 0) || isUploading.value) {
    if (!props.userInput.trim() && attachedMedia.value.length === 0) {
      generate();
    }
    return;
  }
  chatStore.sendMessage(props.userInput, { media: attachedMedia.value });
  emit('update:userInput', '');
  attachedMedia.value = [];

  nextTick(() => {
    chatInput.value?.focus();
  });

  if (chatStore.activeChatFile) {
    promptStore.clearUserTyping(chatStore.activeChatFile);
  }
}

function generate() {
  chatStore.generateResponse(GenerationMode.NEW);
  isOptionsMenuVisible.value = false;
}

function regenerate() {
  const isLastMessageUser = chatStore.activeChat?.messages.slice(-1)[0]?.is_user;
  if (isLastMessageUser) {
    chatStore.generateResponse(GenerationMode.NEW);
  } else {
    chatStore.generateResponse(GenerationMode.REGENERATE);
  }
  isOptionsMenuVisible.value = false;
}

function continueGeneration() {
  chatStore.generateResponse(GenerationMode.CONTINUE);
  isOptionsMenuVisible.value = false;
}

function toggleSelectionMode() {
  chatSelectionStore.toggleSelectionMode();
  isOptionsMenuVisible.value = false;
}

function openToolsMenu() {
  isToolsMenuVisible.value = true;
  isOptionsMenuVisible.value = false;
}

function handleAttachMedia() {
  if (!isMediaAttachDisabled.value) {
    triggerFileUpload();
    isOptionsMenuVisible.value = false;
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && settingsStore.shouldSendOnEnter) {
    event.preventDefault();
    submitMessage();
  }
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as Node;

  // Options Menu
  const isOutsideOptionsMenu = optionsMenuRef.value && !optionsMenuRef.value.contains(target);
  const isOutsideOptionsButton = optionsButtonRef.value && !optionsButtonRef.value.contains(target);

  if (isOutsideOptionsMenu && isOutsideOptionsButton) {
    isOptionsMenuVisible.value = false;
  }

  // Tools Menu
  const isOutsideToolsMenu = toolsMenuRef.value && !toolsMenuRef.value.contains(target);
  const isOutsideToolsButton = optionsButtonRef.value && !optionsButtonRef.value.contains(target);

  if (isOutsideToolsMenu && isOutsideToolsButton) {
    isToolsMenuVisible.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  nextTick().then(() => {
    if (!isDeviceMobile.value) {
      chatInput.value?.focus();
    }

    const el = document.getElementById('chat-input');
    if (el) {
      const textarea = el.tagName === 'TEXTAREA' ? (el as HTMLTextAreaElement) : el.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        chatUiStore.setChatInputElement(textarea);
      }
    }
  });
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  chatUiStore.setChatInputElement(null);
});

watch(
  () => props.userInput,
  (newInput) => {
    if (chatStore.activeChatFile) {
      promptStore.saveUserTyping(chatStore.activeChatFile, newInput);
    }
  },
  { flush: 'post' },
);

watch(
  () => chatStore.activeChatFile,
  async (newFile, oldFile) => {
    if (oldFile) {
      await promptStore.clearUserTyping(oldFile);
    }

    if (newFile) {
      const savedInput = await promptStore.loadUserTyping(newFile);
      emit('update:userInput', savedInput);
      attachedMedia.value = [];

      if (!isDeviceMobile.value) {
        await nextTick();
        chatInput.value?.focus();
      }
    } else {
      emit('update:userInput', '');
      attachedMedia.value = [];
    }
  },
);

// Expose focus method for parent
defineExpose({
  focus: () => chatInput.value?.focus(),
  processFiles,
});
</script>

<template>
  <div id="chat-form" class="chat-form">
    <div v-if="attachedMedia.length > 0" class="chat-form-media-previews">
      <div v-for="(media, index) in attachedMedia" :key="index" class="media-preview-item">
        <img :src="media.url" :alt="media.title" />
        <button class="remove-media-btn" :aria-label="`Remove ${media.title}`" @click="removeAttachedMedia(index)">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>

    <div class="chat-form-inner">
      <div class="chat-form-actions-left">
        <!-- Options Menu Button -->
        <div ref="optionsButtonRef" class="chat-form-action-wrapper">
          <Button
            id="chat-options-button"
            class="chat-form-button"
            variant="ghost"
            icon="fa-bars"
            :title="t('chat.options')"
            aria-haspopup="menu"
            :aria-expanded="isOptionsMenuVisible"
            @click.stop="isOptionsMenuVisible = !isOptionsMenuVisible"
          />
        </div>
        <input ref="fileInput" type="file" hidden multiple :accept="acceptedFileTypes" @change="handleFileSelect" />
      </div>

      <Textarea
        id="chat-input"
        ref="chatInput"
        :model-value="userInput"
        :placeholder="t('chat.inputPlaceholder')"
        autocomplete="off"
        :disabled="chatStore.isGenerating || isUploading"
        :allow-maximize="false"
        identifier="chat.input"
        @update:model-value="emit('update:userInput', $event)"
        @keydown="handleKeydown"
        @paste="handlePaste"
      />

      <div class="chat-form-actions-right">
        <Button
          v-show="chatStore.isGenerating"
          class="chat-form-button"
          variant="ghost"
          icon="fa-stop"
          :title="t('chat.abort')"
          @click="chatStore.abortGeneration"
        />
        <div v-show="!chatStore.isGenerating" style="display: contents">
          <Button
            class="chat-form-button"
            icon="fa-paper-plane"
            variant="ghost"
            :title="t('chat.send')"
            :disabled="chatStore.isGenerating || isUploading"
            @click="submitMessage"
          />
        </div>
      </div>
    </div>

    <!-- Options Menu Popover -->
    <div
      v-show="isOptionsMenuVisible"
      ref="optionsMenuRef"
      class="options-menu"
      :style="optionsMenuStyles"
      role="menu"
      aria-labelledby="chat-options-button"
    >
      <a
        class="options-menu-item"
        role="menuitem"
        tabindex="0"
        @click="regenerate"
        @keydown.enter.prevent="regenerate"
        @keydown.space.prevent="regenerate"
      >
        <i class="fa-solid fa-repeat"></i>
        <span>{{ t('chat.optionsMenu.regenerate') }}</span>
      </a>
      <a
        class="options-menu-item"
        role="menuitem"
        tabindex="0"
        @click="continueGeneration"
        @keydown.enter.prevent="continueGeneration"
        @keydown.space.prevent="continueGeneration"
      >
        <i class="fa-solid fa-arrow-right"></i>
        <span>{{ t('chat.optionsMenu.continue') }}</span>
      </a>
      <hr role="separator" />
      <a
        class="options-menu-item"
        role="menuitem"
        tabindex="0"
        @click="toggleSelectionMode"
        @keydown.enter.prevent="toggleSelectionMode"
        @keydown.space.prevent="toggleSelectionMode"
      >
        <i class="fa-solid fa-check-double"></i>
        <span>{{ t('chat.optionsMenu.selectMessages') }}</span>
      </a>
      <hr role="separator" />
      <a
        class="options-menu-item"
        role="menuitem"
        tabindex="0"
        :disabled="isMediaAttachDisabled"
        :title="mediaAttachTitle"
        @click="handleAttachMedia"
        @keydown.enter.prevent="handleAttachMedia"
        @keydown.space.prevent="handleAttachMedia"
      >
        <i class="fa-solid fa-paperclip"></i>
        <span>{{ t('chat.media.attach') }}</span>
      </a>
      <a
        class="options-menu-item"
        role="menuitem"
        tabindex="0"
        @click.stop="openToolsMenu"
        @keydown.enter.prevent="openToolsMenu"
        @keydown.space.prevent="openToolsMenu"
      >
        <i class="fa-solid fa-screwdriver-wrench"></i>
        <span>{{ t('chat.tools.title') }}</span>
      </a>
    </div>

    <!-- Tools Menu Popover -->
    <div
      v-show="isToolsMenuVisible"
      ref="toolsMenuRef"
      class="tools-menu"
      :style="toolsMenuStyles"
      role="dialog"
      :aria-label="t('chat.tools.title')"
    >
      <div v-if="toolsWarning" class="tools-warning">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>{{ toolsWarning }}</span>
      </div>

      <div v-if="toolStore.toolList.length === 0" class="empty-state">
        {{ t('chat.tools.noTools') }}
      </div>
      <div v-else class="tools-list">
        <div
          v-for="tool in toolStore.toolList"
          :key="tool.name"
          class="tool-item"
          role="button"
          tabindex="0"
          :aria-pressed="!toolStore.isToolDisabled(tool.name)"
          @click="toolStore.toggleTool(tool.name)"
          @keydown.enter.prevent="toolStore.toggleTool(tool.name)"
          @keydown.space.prevent="toolStore.toggleTool(tool.name)"
        >
          <div class="tool-item-checkbox">
            <Checkbox :model-value="!toolStore.isToolDisabled(tool.name)" label="" />
          </div>
          <div class="tool-item-content">
            <div class="tool-item-header">
              <i v-if="tool.icon" :class="['tool-item-icon', tool.icon]"></i>
              <span class="tool-item-title">{{ tool.displayName || tool.name }}</span>
            </div>
            <div class="tool-item-description">
              {{ tool.description }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
