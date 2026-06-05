import { type ChatInfo, type ChatMetadata, type FullChat } from '../../../types';
import { MountableComponent } from '../../../types/ExtensionAPI';
import BranchTree from './BranchTree.vue';
import { manifest } from './manifest';
import type { ChatBranchingAPI } from './types';

export { manifest };

export function activate(api: ChatBranchingAPI) {
  const { ui, chat, events, character, settings, i18n } = api;

  const t = i18n.t;

  const initSettings = () => {
    const s = settings.get();
    if (!s || !s.graph) {
      settings.set(undefined, { graph: {} });
    }
  };

  initSettings();

  const registerCurrentChatAsRootIfMissing = (filename: string) => {
    const s = settings.get();
    if (!s.graph[filename]) {
      s.graph[filename] = {
        id: filename,
        parentId: null,
        children: [],
        branchPointIndex: 0,
        timestamp: Date.now(),
      };
      settings.set('graph', s.graph);
    }
  };

  const branchChat = async (messageIndex: number) => {
    const history = chat.getHistory();
    const metadata = chat.metadata.get();
    const currentChatInfo = chat.getChatInfo();

    if (!metadata || messageIndex < 0 || messageIndex >= history.length || !currentChatInfo) return;

    const currentFilename = currentChatInfo.file_id;
    registerCurrentChatAsRootIfMissing(currentFilename);

    try {
      // 1. Prepare new metadata
      const newMetadata = structuredClone(metadata) as ChatMetadata;
      newMetadata.name = newMetadata.name
        ? `${newMetadata.name} (${t('extensionsBuiltin.chatBranching.branchName')})`
        : t('extensionsBuiltin.chatBranching.branchName');
      // Generate new integrity using UUID
      newMetadata.integrity = api.uuid();

      // 2. Slice messages
      const newMessages = history.slice(0, messageIndex + 1);

      // 3. Create FullChat object
      const fullChat: FullChat = [{ chat_metadata: newMetadata }, ...newMessages];

      // 4. Create chat via API
      const newFilename = await chat.create(fullChat);

      // 5. Update character links (if members exist)
      if (newMetadata.members) {
        for (const avatar of newMetadata.members) {
          await character.update(avatar, { chat: newFilename });
        }
      }

      const s = settings.get();
      s.graph[newFilename] = {
        id: newFilename,
        parentId: currentFilename,
        children: [],
        branchPointIndex: messageIndex,
        timestamp: Date.now(),
      };
      // Link parent
      if (s.graph[currentFilename]) {
        s.graph[currentFilename].children.push(newFilename);
      }
      settings.set('graph', s.graph);

      // Update navbar item since we now have branches
      updateNavBarItem();

      // 6. Load new chat
      await chat.load(newFilename);
    } catch (error) {
      console.error('Branching failed', error);
      ui.showToast(t('extensionsBuiltin.chatBranching.branchCreationFailed'), 'error');
    }
  };

  const injectButton = async (messageElement: HTMLElement, messageIndex: number) => {
    const buttonsContainer = messageElement.querySelector('.message-buttons');
    if (!buttonsContainer || buttonsContainer.querySelector('.branch-button-wrapper')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'branch-button-wrapper';
    wrapper.style.display = 'inline-flex';

    // Append to the buttons container
    buttonsContainer.appendChild(wrapper);

    await ui.mountComponent(wrapper, MountableComponent.Button, {
      icon: 'fa-code-branch',
      title: t('extensionsBuiltin.chatBranching.branchButtonTitle', 'Branch from this message'),
      variant: 'ghost',
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        branchChat(messageIndex);
      },
    });
  };

  const processMessages = () => {
    const messages = document.querySelectorAll('.message');
    messages.forEach((el) => {
      const indexAttr = el.getAttribute('data-message-index');
      if (indexAttr === null) return;
      const index = parseInt(indexAttr, 10);
      if (!isNaN(index)) {
        injectButton(el as HTMLElement, index);
      }
    });
  };

  const showTree = async () => {
    const currentChatInfo = chat.getChatInfo();
    if (!currentChatInfo) {
      ui.showToast(t('extensionsBuiltin.chatBranching.noChatLoaded'), 'warning');
      return;
    }

    // Ensure current chat is in the graph so it shows up
    if (currentChatInfo) {
      const meta = chat.metadata.get();
      if (meta) {
        registerCurrentChatAsRootIfMissing(currentChatInfo.file_id);
      }
    }

    const s = settings.get();

    await ui.showPopup({
      title: t('extensionsBuiltin.chatBranching.branchTreeTitle'),
      component: BranchTree,
      componentProps: {
        graph: s.graph,
        activeId: currentChatInfo.file_id,
        chatInfoMap: chat.getAllChatInfos().reduce(
          (acc, curr) => {
            acc[curr.file_id] = curr;
            return acc;
          },
          {} as Record<string, ChatInfo>,
        ),
        onSelect: async (id: string) => {
          try {
            await chat.load(id);
          } catch (error) {
            console.error('Failed to load selected chat', error);
            ui.showToast(t('extensionsBuiltin.chatBranching.loadChatFailed'), 'error');
          }
        },
      },
      wide: true,
      large: true,
      okButton: 'common.close',
    });
  };

  const removeChatFromGraph = (filename: string) => {
    const s = settings.get();
    const node = s.graph[filename];
    if (!node) return;

    // Remove from parent's children
    if (node.parentId && s.graph[node.parentId]) {
      s.graph[node.parentId].children = s.graph[node.parentId].children.filter((id) => id !== filename);
    }

    // Reassign children's parent to null (making them roots)
    for (const childId of node.children) {
      if (s.graph[childId]) {
        s.graph[childId].parentId = null;
      }
    }

    // Delete the node
    delete s.graph[filename];
    settings.set('graph', s.graph);
  };

  const unbinds: (() => void)[] = [];

  const updateNavBarItem = () => {
    const currentChatInfo = chat.getChatInfo();
    if (!currentChatInfo) {
      api.ui.unregisterNavBarItem('branch-tree-view');
      return;
    }

    registerCurrentChatAsRootIfMissing(currentChatInfo.file_id);
    const s = settings.get();

    // Eliminate non-existent chats from the graph
    const existingChatIds = new Set(chat.getAllChatInfos().map((info) => info.file_id));

    for (const filename in s.graph) {
      if (!existingChatIds.has(filename)) {
        removeChatFromGraph(filename);
      }
    }

    const currentNode = s.graph[currentChatInfo.file_id];

    // Show navbar item if chat has branches (either has parent or children)
    if (currentNode && (currentNode.parentId !== null || currentNode.children.length > 0)) {
      api.ui.registerNavBarItem('branch-tree-view', {
        icon: 'fa-sitemap',
        title: t('extensionsBuiltin.chatBranching.chatTreeTitle'),
        onClick: () => {
          showTree();
        },
      });
    } else {
      api.ui.unregisterNavBarItem('branch-tree-view');
    }
  };

  unbinds.push(
    events.on('chat:entered', () => {
      updateNavBarItem();
      processMessages();
    }),
  );

  unbinds.push(
    events.on('message:created', () => {
      processMessages();
    }),
  );

  unbinds.push(
    events.on('chat:deleted', (filename: string) => {
      updateNavBarItem();
      removeChatFromGraph(filename);
    }),
  );

  unbinds.push(
    events.on('chat:messages-loaded-more', () => {
      processMessages();
    }),
  );

  // Initial injection
  processMessages();

  // Initial navbar item setup
  updateNavBarItem();

  return () => {
    unbinds.forEach((u) => u());
    document.querySelectorAll('.branch-button-wrapper').forEach((el) => el.remove());
    api.ui.unregisterNavBarItem('branch-tree-view');
  };
}
