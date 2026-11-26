import { markRaw } from 'vue';
import type { CodeMirrorTarget, ExtensionAPI } from '../../../types';
import { MountableComponent } from '../../../types/ExtensionAPI';
import AssistantPanel from './components/AssistantPanel.vue';
import MessageQuickEditButton from './components/MessageQuickEditButton.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import { manifest } from './manifest';
import { createPanelState } from './panel-state';
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
const PANEL_ID = 'assistant-panel';
/** Main layouts the panel is available in. */
const PANEL_LAYOUTS = ['chat', 'character'];
const BUTTON_CLASS = 'assistant-character-button';

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
  // Pattern matches don't tell the tool which field was clicked, so they share one identifier.
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

  const panel = createPanelState(api);
  // Right sidebars belong to one main layout. The character editor is its own layout, so the panel
  // is registered there too; both share `panel`, so the draft and conversation follow the user.
  const sidebarIds: Record<string, Promise<string>> = {};
  for (const layoutId of PANEL_LAYOUTS) {
    sidebarIds[layoutId] = api.ui.registerSidebar(
      layoutId === 'chat' ? PANEL_ID : `${PANEL_ID}-${layoutId}`,
      markRaw(AssistantPanel),
      'right',
      {
        title: t('extensionsBuiltin.assistant.panel.title'),
        icon: 'fa-solid fa-wand-magic-sparkles',
        props: { api, panel },
        layoutId,
      },
    );
  }
  api.ui.registerChatFormOptionsMenuItem({
    id: 'assistant.open-panel',
    icon: 'fa-solid fa-wand-magic-sparkles',
    label: t('extensionsBuiltin.assistant.panel.open'),
    onClick: () => api.ui.openSidebar(PANEL_ID),
  });

  // `openSidebar` toggles, so remember what's open to only ever open the panel from the character form.
  let openRightSidebar: string | null = null;
  api.events.on('layout:right-sidebar-changed', (isOpen, view) => {
    openRightSidebar = isOpen ? view : null;
  });

  const editCharacterWithAssistant = async () => {
    const character = api.character.getEditing();
    if (!character) return;
    panel.mention({ kind: 'character', avatar: character.avatar, label: character.name });
    const sidebarId = await sidebarIds.character;
    if (openRightSidebar !== sidebarId) api.ui.openSidebar(sidebarId);
  };

  const injectCharacterButton = () => {
    // The form has two button rows: creation's (Save, Cancel) and the existing character's, which
    // follows the primary actions. Only the latter has a character to edit.
    document.querySelectorAll('.character-primary-actions + .character-edit-form-buttons').forEach((container) => {
      if (container.querySelector(`.${BUTTON_CLASS}`)) return;
      const wrapper = document.createElement('div');
      wrapper.className = BUTTON_CLASS;
      container.appendChild(wrapper);
      api.ui.mountComponent(wrapper, MountableComponent.Button, {
        icon: 'fa-wand-magic-sparkles',
        title: t('extensionsBuiltin.assistant.panel.editWithAssistant'),
        variant: 'ghost',
        onClick: editCharacterWithAssistant,
      });
    });
  };
  // The character editor mounts and unmounts with its layout, so keep watching.
  const observer = new MutationObserver(injectCharacterButton);
  observer.observe(document.body, { childList: true, subtree: true });
  injectCharacterButton();

  return () => {
    observer.disconnect();
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((element) => element.remove());
  };
}
