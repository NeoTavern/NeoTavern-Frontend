import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { ApiChatMessage } from '../../../types/generation';
import CommentaryBubble from './CommentaryBubble.vue';
import { Commentator } from './commentator';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import type { LiveCommentarySettings } from './types';

export { manifest };

interface BubbleInstance {
  id: string;
  unmount: () => void;
  mountPoint: HTMLElement;
}

export function activate(api: ExtensionAPI<LiveCommentarySettings>) {
  const commentator = new Commentator(api);
  let settingsApp: { unmount: () => void } | null = null;
  const activeBubbles = new Map<string, BubbleInstance>(); // characterAvatar -> BubbleInstance
  let askController: AbortController | null = null;

  // State tracking for visibility
  let isChatLayoutActive = true;
  let isLeftSidebarOpen = false;
  let isRightSidebarOpen = false;

  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const showAllBubbles = () => {
    activeBubbles.forEach((bubble) => {
      bubble.mountPoint.style.display = '';
    });
  };

  const hideAllBubbles = () => {
    activeBubbles.forEach((bubble) => {
      bubble.mountPoint.style.display = 'none';
    });
  };

  const updateBubbleVisibility = () => {
    // Bubbles should be visible if we are in the chat layout AND either:
    // 1. We are on a desktop view.
    // 2. We are on a mobile view AND no sidebars are open.
    const shouldBeVisible = isChatLayoutActive && (!api.ui.isMobile() || (!isLeftSidebarOpen && !isRightSidebarOpen));

    if (shouldBeVisible) {
      showAllBubbles();
    } else {
      hideAllBubbles();
    }
  };

  const destroyAllBubbles = () => {
    activeBubbles.forEach((bubble) => bubble.unmount());
    activeBubbles.clear();
  };

  const handleInputChange = (value: string) => {
    commentator.trigger(value);
  };

  // Subscribe to chat input change events
  const unsubscribeInputChange = api.events.on('chat:input-changed', handleInputChange);

  const showCommentaryBubble = (characterAvatar: string, thought: string) => {
    const settings = api.settings.get();
    if (!settings?.enabled) return;

    // Remove existing bubble for this character
    if (activeBubbles.has(characterAvatar)) {
      activeBubbles.get(characterAvatar)?.unmount();
    }

    const messageElements = document.querySelectorAll('.message');
    let targetAvatarElement: HTMLElement | null = null;

    for (let i = messageElements.length - 1; i >= 0; i--) {
      const el = messageElements[i] as HTMLElement;
      const char = api.chat.getHistory()[parseInt(el.dataset.messageIndex ?? '-1', 10)];
      if (char && !char.is_user && char.original_avatar === characterAvatar) {
        targetAvatarElement = el.querySelector('.message-avatar');
        break;
      }
    }

    if (!targetAvatarElement) {
      const headerAvatars = document.querySelectorAll('.chat-header-avatars .avatar');
      for (const avatar of Array.from(headerAvatars)) {
        if ((avatar as HTMLElement).dataset.avatarId === characterAvatar) {
          targetAvatarElement = avatar as HTMLElement;
          break;
        }
      }
    }

    if (targetAvatarElement) {
      // Create a mount point in the body to avoid overflow clipping and z-index issues
      const mountPoint = document.createElement('div');
      document.body.appendChild(mountPoint);

      const shouldBeVisible = isChatLayoutActive && (!api.ui.isMobile() || (!isLeftSidebarOpen && !isRightSidebarOpen));
      if (!shouldBeVisible) {
        mountPoint.style.display = 'none';
      }

      // Mark character as busy immediately when starting to show bubble
      commentator.setCharacterTyping(characterAvatar, true);

      const bubbleId = api.uuid();
      const bubbleInstance = api.ui.mount(mountPoint, CommentaryBubble, {
        text: thought,
        displayDurationMs: settings.displayDurationMs ?? 5000,
        referenceElement: targetAvatarElement,
        onClose: () => {
          if (activeBubbles.get(characterAvatar)?.id === bubbleId) {
            activeBubbles.get(characterAvatar)?.unmount();
          }
        },
        onTypingComplete: () => {
          commentator.setCharacterTyping(characterAvatar, false);
        },
      });

      const originalUnmount = bubbleInstance.unmount;
      const augmentedUnmount = () => {
        originalUnmount();
        mountPoint.remove();
        activeBubbles.delete(characterAvatar);
        commentator.setCharacterTyping(characterAvatar, false);
      };

      activeBubbles.set(characterAvatar, { id: bubbleId, unmount: augmentedUnmount, mountPoint });
    }
  };

  const handleMessageCreated = (message: ChatMessage) => {
    if (message.is_user) {
      // When user sends a message, preserve context for injection but clear typing session
      commentator.resetContext();
    }
  };

  const resetStateAndBubbles = () => {
    commentator.cancel();
    askController?.abort();
    askController = null;
    destroyAllBubbles();
  };

  const askCurrentInput = async () => {
    if (askController) {
      api.ui.showToast(api.i18n.t('extensionsBuiltin.liveCommentary.askAlreadyRunning'), 'warning');
      return;
    }

    const input = api.chat.getChatInput();
    const question = input?.value.trim() ?? '';
    if (!question) {
      api.ui.showToast(api.i18n.t('extensionsBuiltin.liveCommentary.askNeedsQuestion'), 'warning');
      api.chat.focusChatInput();
      return;
    }

    if (!api.chat.getChatInfo()) {
      api.ui.showToast(api.i18n.t('extensionsBuiltin.liveCommentary.askNeedsChat'), 'warning');
      return;
    }

    const activeCharacter = api.character.getActives()[0];
    if (!activeCharacter) {
      api.ui.showToast(api.i18n.t('extensionsBuiltin.liveCommentary.askNeedsCharacter'), 'warning');
      return;
    }

    commentator.cancel();
    destroyAllBubbles();

    const controller = new AbortController();
    askController = controller;
    showCommentaryBubble(activeCharacter.avatar, '...');

    try {
      const answer = await commentator.askQuestion(question, controller.signal);
      if (controller.signal.aborted || askController !== controller) {
        return;
      }
      showCommentaryBubble(
        activeCharacter.avatar,
        answer || api.i18n.t('extensionsBuiltin.liveCommentary.askEmptyAnswer'),
      );
    } catch (error) {
      if (controller.signal.aborted || askController !== controller) {
        return;
      }
      console.error('Live Commentary ask failed', error);
      api.ui.showToast(api.i18n.t('extensionsBuiltin.liveCommentary.askFailed'), 'error');
    } finally {
      if (askController === controller) {
        askController = null;
        api.chat.focusChatInput();
      }
    }
  };

  const registerAskQuickAction = () => {
    api.ui.registerChatQuickAction('core.context-ai', '', {
      id: 'live-commentary-ask',
      icon: 'fa-solid fa-circle-question',
      label: api.i18n.t('extensionsBuiltin.liveCommentary.askAction'),
      title: api.i18n.t('extensionsBuiltin.liveCommentary.askActionTitle'),
      disabled: api.chat.getChatInfo() === null,
      onClick: askCurrentInput,
    });
  };

  const unbinds: Array<() => void> = [];

  unbinds.push(unsubscribeInputChange);
  registerAskQuickAction();

  unbinds.push(
    api.events.on('chat:entered', () => {
      registerAskQuickAction();
      resetStateAndBubbles();
    }),
  );

  unbinds.push(
    api.events.on('chat:cleared', () => {
      registerAskQuickAction();
      resetStateAndBubbles();
    }),
  );

  unbinds.push(
    api.events.on('layout:main-layout-changed', (layoutId: string) => {
      isChatLayoutActive = layoutId === 'chat';
      updateBubbleVisibility();
    }),
  );

  unbinds.push(
    api.events.on('layout:left-sidebar-changed', (isOpen: boolean) => {
      isLeftSidebarOpen = isOpen;
      updateBubbleVisibility();
    }),
  );

  unbinds.push(
    api.events.on('layout:right-sidebar-changed', (isOpen: boolean) => {
      isRightSidebarOpen = isOpen;
      updateBubbleVisibility();
    }),
  );

  unbinds.push(
    // @ts-expect-error custom event
    api.events.on('commentary:generated', (characterAvatar: string, thought: string) => {
      showCommentaryBubble(characterAvatar, thought);
    }),
  );

  unbinds.push(api.events.on('message:created', handleMessageCreated));

  unbinds.push(
    api.events.on('message:deleted', (indices: number[]) => {
      commentator.incrementDeletedMessageCount(indices.length);
    }),
  );

  unbinds.push(
    api.events.on('message:updated', (index: number, message: ChatMessage) => {
      if (!message.is_user) {
        commentator.markMessageAsEdited(index);
      }
    }),
  );

  // Injection Logic
  unbinds.push(
    api.events.on('generation:started', (context) => {
      if (context.activeCharacter) {
        commentator.setActiveGenerationCharacter(context.activeCharacter.avatar);
      } else {
        commentator.setActiveGenerationCharacter(undefined);
      }
    }),
  );

  unbinds.push(
    api.events.on('prompt:built', (messages: ApiChatMessage[]) => {
      const newMessages = commentator.injectThoughts(messages);

      if (newMessages !== messages) {
        messages.length = 0;
        messages.push(...newMessages);
      }
    }),
  );

  unbinds.push(
    api.events.on('generation:finished', () => {
      commentator.onGenerationFinished();
    }),
  );

  return () => {
    settingsApp?.unmount();
    unbinds.forEach((u) => u());
    resetStateAndBubbles();
    api.ui.unregisterChatQuickAction('core.context-ai', 'live-commentary-ask');
  };
}
