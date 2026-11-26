import { markRaw } from 'vue';
import type { ExtensionAPI } from '../../../types';
import MessageQuickEditButton from './components/MessageQuickEditButton.vue';
import { manifest } from './manifest';
import { createInputTarget, findChatInputAnchor, openQuickEditPopover } from './quick-edit-ui';
import type { AssistantSettings } from './types';

export { manifest };
export { migrateAssistantSettings as migrateSettings } from './types';

const QUICK_EDIT_ID = 'assistant.quick-edit';

// Textarea wands and pinned commands are registered in later M1 sessions.
export function activate(api: ExtensionAPI<AssistantSettings>) {
  const t = api.i18n.t;

  api.ui.registerMessageButton({
    id: QUICK_EDIT_ID,
    component: markRaw(MessageQuickEditButton),
    props: { api },
  });

  const openInputQuickEdit = () => {
    const anchor = findChatInputAnchor();
    if (anchor) openQuickEditPopover(api, anchor, createInputTarget(api));
  };

  const registerInputEntries = () => {
    const inChat = api.chat.getChatInfo() !== null;
    api.ui.registerChatFormOptionsMenuItem({
      id: QUICK_EDIT_ID,
      icon: 'fa-solid fa-wand-magic-sparkles',
      label: t('extensionsBuiltin.assistant.quickEdit.openInput'),
      onClick: openInputQuickEdit,
      visible: inChat,
    });
    api.ui.registerChatQuickAction('core.input-message', '', {
      id: QUICK_EDIT_ID,
      icon: 'fa-solid fa-wand-magic-sparkles',
      label: t('extensionsBuiltin.assistant.quickEdit.openInput'),
      onClick: openInputQuickEdit,
      disabled: !inChat,
    });
  };

  api.events.on('chat:entered', registerInputEntries);
  registerInputEntries();
}
