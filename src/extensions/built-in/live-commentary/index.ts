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
  let chatInputElement: HTMLTextAreaElement | null = null;
  const activeBubbles = new Map<string, BubbleInstance>(); // characterAvatar -> BubbleInstance

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

  const handleInput = (event: Event) => {
    const target = event.target as HTMLTextAreaElement;
    commentator.trigger(target.value);
  };

  const attachInputListener = () => {
    const inputEl = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    if (inputEl) {
      if (inputEl && inputEl !== chatInputElement) {
        chatInputElement?.removeEventListener('input', handleInput);
        chatInputElement = inputEl;
        chatInputElement.addEventListener('input', handleInput);
      }
    }
  };

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
    destroyAllBubbles();
  };

  const unbinds: Array<() => void> = [];

  unbinds.push(
    api.events.on('chat:entered', () => {
      resetStateAndBubbles();
      attachInputListener();
    }),
  );

  unbinds.push(
    api.events.on('chat:cleared', () => {
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

  attachInputListener();

  const observer = new MutationObserver(() => {
    attachInputListener();
  });
  const chatInterface = document.querySelector('.chat-interface');
  if (chatInterface) {
    observer.observe(chatInterface, { childList: true, subtree: true });
  }

  return () => {
    settingsApp?.unmount();
    unbinds.forEach((u) => u());
    chatInputElement?.removeEventListener('input', handleInput);
    observer.disconnect();
    resetStateAndBubbles();
  };
}
