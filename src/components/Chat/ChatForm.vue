<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating, type Placement } from '@floating-ui/vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { isCapabilitySupported } from '../../api/provider-definitions';
import { useChatMedia } from '../../composables/useChatMedia';
import { useMobile } from '../../composables/useMobile';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { CustomPromptPostProcessing, GenerationMode } from '../../constants';
import { useApiStore } from '../../stores/api.store';
import { useChatSelectionStore } from '../../stores/chat-selection.store';
import { useChatUiStore } from '../../stores/chat-ui.store';
import { useChatStore } from '../../stores/chat.store';
import { useComponentRegistryStore } from '../../stores/component-registry.store';
import { usePromptStore } from '../../stores/prompt.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useToolStore } from '../../stores/tool.store';
import type { ChatFormOptionsMenuItemDefinition } from '../../types/ExtensionAPI';
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
const componentRegistryStore = useComponentRegistryStore();
const { isDeviceMobile } = useMobile();
const { t } = useStrictI18n();

const chatInput = ref<InstanceType<typeof Textarea> | null>(null);
const chatFormContainerRef = ref<HTMLElement | null>(null);
const chatFormInnerRef = ref<HTMLElement | null>(null);
console.debug(chatFormContainerRef); // Dummy log to avoid unused variable warning

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
const toolsMenuTriggerEl = ref<HTMLElement | null>(null); // The real element that triggered the menu
const toolsMenuPlacement = ref<Placement>('top');

// Virtual anchor for positioning, based on a snapshot of the trigger's rect
const toolsMenuAnchor = ref({
  getBoundingClientRect: () => new DOMRect(),
});

const { floatingStyles: toolsMenuStyles } = useFloating(toolsMenuAnchor, toolsMenuRef, {
  placement: toolsMenuPlacement,
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

function openToolsMenu(event: Event) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;

  // If clicking the same element that opened the menu, close it.
  if (isToolsMenuVisible.value && toolsMenuTriggerEl.value === target) {
    isToolsMenuVisible.value = false;
    toolsMenuTriggerEl.value = null;
    return;
  }

  // Determine the anchor element and placement for positioning.
  const clickedFromOptionsMenu = optionsMenuRef.value?.contains(target);
  const anchorElement = clickedFromOptionsMenu ? chatFormInnerRef.value : target;

  if (anchorElement) {
    // Set placement based on context
    toolsMenuPlacement.value = clickedFromOptionsMenu ? 'top-start' : 'top';

    // Set up the virtual anchor based on the chosen element's position.
    toolsMenuAnchor.value = {
      getBoundingClientRect: () => anchorElement.getBoundingClientRect(),
    };
    toolsMenuTriggerEl.value = target; // Still track original trigger for closing logic.
    isToolsMenuVisible.value = true;
  }
}

function handleAttachMedia() {
  if (!isMediaAttachDisabled.value) {
    triggerFileUpload();
    isOptionsMenuVisible.value = false;
  }
}

// --- Menu Item Definitions ---

const allPossibleCoreActions = computed<ChatFormOptionsMenuItemDefinition[]>(() => {
  const hasMessages = (chatStore.activeChat?.messages.length ?? 0) > 0;
  return [
    {
      id: 'core.regenerate',
      icon: 'fa-solid fa-repeat',
      label: t('chat.optionsMenu.regenerate'),
      onClick: regenerate,
      visible: hasMessages,
    },
    {
      id: 'core.continue',
      icon: 'fa-solid fa-arrow-right',
      label: t('chat.optionsMenu.continue'),
      onClick: continueGeneration,
      separator: 'after',
      visible: hasMessages,
    },
    {
      id: 'core.select',
      icon: 'fa-solid fa-check-double',
      label: t('chat.optionsMenu.selectMessages'),
      onClick: toggleSelectionMode,
      separator: 'after',
      visible: hasMessages,
    },
    {
      id: 'core.attach',
      icon: 'fa-solid fa-paperclip',
      label: t('chat.media.attach'),
      onClick: handleAttachMedia,
      disabled: isMediaAttachDisabled.value,
      title: mediaAttachTitle.value,
      visible: hasMessages,
    },
    {
      id: 'core.tools',
      icon: 'fa-solid fa-screwdriver-wrench',
      label: t('chat.tools.title'),
      onClick: openToolsMenu,
      visible: true,
      opensPopover: 'tools',
    },
  ];
});

const builtInMenuItems = computed(() => {
  const visibleItems = allPossibleCoreActions.value.filter((item) => item.visible ?? true);

  if (componentRegistryStore.chatFormOptionsMenuRegistry.size === 0 || visibleItems.length === 0) {
    return visibleItems;
  }

  // Create copies to avoid mutating computed properties
  const itemsWithSeparator = visibleItems.map((item) => ({ ...item }));
  const lastItem = itemsWithSeparator[itemsWithSeparator.length - 1];

  // Add a separator before any extension items
  if (lastItem.separator !== 'after') {
    lastItem.separator = 'after';
  }

  return itemsWithSeparator;
});

const allMenuItems = computed(() =>
  [...builtInMenuItems.value, ...Array.from(componentRegistryStore.chatFormOptionsMenuRegistry.values())].filter(
    (item) => item.visible ?? true,
  ),
);

function shouldShowSeparatorBefore(item: ChatFormOptionsMenuItemDefinition, index: number): boolean {
  if (index === 0) return false; // Never before the first item
  const prevItem = allMenuItems.value[index - 1];
  return item.separator === 'before' || prevItem.separator === 'after';
}

function handleMenuItemClick(item: ChatFormOptionsMenuItemDefinition, event: Event) {
  item.onClick(event);
  if (!item.opensPopover) {
    isOptionsMenuVisible.value = false;
  } else {
    // Give the new popover a moment to open before closing the parent
    nextTick(() => {
      isOptionsMenuVisible.value = false;
    });
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && settingsStore.shouldSendOnEnter) {
    event.preventDefault();
    submitMessage();
  }
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement;

  // Close Options Menu
  const isInsideOptionsMenu = optionsMenuRef.value?.contains(target);
  const isInsideOptionsButton = optionsButtonRef.value?.contains(target);
  if (!isInsideOptionsMenu && !isInsideOptionsButton) {
    isOptionsMenuVisible.value = false;
  }

  // Close Tools Menu
  if (isToolsMenuVisible.value) {
    const isInsideToolsMenu = toolsMenuRef.value?.contains(target);
    const isInsideAnchor = toolsMenuTriggerEl.value?.contains(target);

    if (!isInsideToolsMenu && !isInsideAnchor) {
      isToolsMenuVisible.value = false;
      toolsMenuTriggerEl.value = null;
    }
  }
}

// --- Quick Action Registration ---
const quickActionGroups = computed(() => [
  {
    id: 'core.generation',
    label: t('chat.quickActions.group.generation'),
    actionIds: ['core.regenerate', 'core.continue'],
  },
  {
    id: 'core.input-message',
    label: t('chat.quickActions.group.inputMessage'),
    actionIds: ['core.select', 'core.attach'],
  },
  {
    id: 'core.context-ai',
    label: t('chat.quickActions.group.contextAI'),
    actionIds: ['core.tools'],
  },
]);

watchEffect(() => {
  const actionsById = new Map(allPossibleCoreActions.value.map((action) => [action.id, action]));

  for (const group of quickActionGroups.value) {
    for (const actionId of group.actionIds) {
      const action = actionsById.get(actionId);
      if (action) {
        componentRegistryStore.registerChatQuickAction(group.id, group.label, {
          id: action.id,
          icon: action.icon,
          title: action.title ?? action.label,
          label: action.label,
          onClick: action.onClick,
          disabled: action.disabled,
          visible: action.visible,
          opensPopover: action.opensPopover,
        });
      }
    }
  }
});

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

  for (const group of quickActionGroups.value) {
    for (const actionId of group.actionIds) {
      componentRegistryStore.unregisterChatQuickAction(group.id, actionId);
    }
  }
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
  <div id="chat-form" ref="chatFormContainerRef" class="chat-form">
    <div v-if="attachedMedia.length > 0" class="chat-form-media-previews">
      <div v-for="(media, index) in attachedMedia" :key="index" class="media-preview-item">
        <img :src="media.url" :alt="media.title" />
        <button class="remove-media-btn" :aria-label="`Remove ${media.title}`" @click="removeAttachedMedia(index)">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>

    <div ref="chatFormInnerRef" class="chat-form-inner">
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
        :disabled="isUploading"
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
      <template v-for="(item, index) in allMenuItems" :key="item.id">
        <hr v-if="shouldShowSeparatorBefore(item, index)" role="separator" />
        <a
          class="options-menu-item"
          role="menuitem"
          tabindex="0"
          :disabled="item.disabled"
          :title="item.title"
          :data-opens-popover="item.opensPopover"
          @click="handleMenuItemClick(item, $event)"
          @keydown.enter.prevent="handleMenuItemClick(item, $event)"
          @keydown.space.prevent="handleMenuItemClick(item, $event)"
        >
          <i :class="item.icon"></i>
          <span>{{ item.label }}</span>
        </a>
      </template>
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
