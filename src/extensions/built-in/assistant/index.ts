import { markRaw } from 'vue';
import type { CodeMirrorTarget, ExtensionAPI } from '../../../types';
import MessageQuickEditButton from './components/MessageQuickEditButton.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { manifest } from './manifest';
import { setupPinnedCommands } from './pinned-commands';
import {
  createFieldTarget,
  createInputTarget,
  EXTENSION_FIELD_PATTERN,
  FIELD_TARGETS,
  findChatInputAnchor,
  openQuickEditPopover,
  openQuickEditPopup,
} from './quick-edit-ui';
import type { AssistantSettings } from './types';

export { manifest };
export { migrateAssistantSettings as migrateSettings } from './types';

const QUICK_EDIT_ID = 'assistant.quick-edit';

export function activate(api: ExtensionAPI<AssistantSettings>) {
  const t = api.i18n.t;

  api.ui.registerSettingsPanel(SettingsPanel, { api });

  const registerWand = (match: CodeMirrorTarget | RegExp, identifier: string, label: string) => {
    api.ui.registerTextareaTool(match, {
      id: QUICK_EDIT_ID,
      icon: 'fa-solid fa-wand-magic-sparkles',
      title: t('extensionsBuiltin.assistant.quickEdit.open'),
      onClick: (payload) => openQuickEditPopup(api, createFieldTarget(api, identifier, label, payload)),
    });
  };
  for (const [identifier, labelKey] of Object.entries(FIELD_TARGETS)) {
    registerWand(identifier as CodeMirrorTarget, identifier, t(labelKey));
  }
  // Pattern matches don't tell the tool which field was clicked, so they share one identifier, as in Rewrite.
  registerWand(
    EXTENSION_FIELD_PATTERN,
    'extension.generic',
    t('extensionsBuiltin.assistant.quickEdit.fields.extension'),
  );

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

  setupPinnedCommands(api, manifest.name);
}
