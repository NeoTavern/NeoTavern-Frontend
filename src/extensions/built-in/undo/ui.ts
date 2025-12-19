import debounce, { type DebouncedFunc } from 'lodash-es/debounce';
import type { StrictT } from '../../../composables/useStrictI18n.ts';
import i18n from '../../../i18n';
import { useChatStore } from '../../../stores/chat.store.ts';
import type { ExtensionAPI } from '../../../types';
import { ChatHistory } from './index.ts';
import SettingsPanel from './SettingsPanel.vue';
import {
  DEFAULT_SETTINGS,
  saveDebounceDuration,
  snapshotEvents,
  type ExtensionSettings,
  type SettingChangeEvents,
} from './types.ts';

// src/components/Popup/Popup.vue
function isInput(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  return (
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'INPUT' ||
    target.isContentEditable ||
    target.className.includes('cm-')
  );
}

//Animate icon active.
function setupActiveIndicator(unbinds: (() => void)[]) {
  //Animate.
  const animate = () => {
    const icon = document.querySelector('[data-extension-id="core.undo"] .fa-solid') as HTMLElement;
    if (icon) {
      icon.style = 'animation: fa-spin 10s infinite linear reverse;';
      unbinds.push(() => {
        icon.style = '';
      });
    }
  };
  //Setup/cleanup.
  const extensions = document.querySelector('.menu-button[title="Extensions"]');
  if (extensions) {
    extensions.addEventListener('click', animate);
    unbinds.push(() => extensions.removeEventListener('click', animate));
  }
}

//Binds/Unbinds Ctrl+Z on settings toggle.
function setupUndoHotkey(
  api: ExtensionAPI<ExtensionSettings>,
  settings: ExtensionSettings,
  chatHistory: ChatHistory,
  unbinds: (() => void)[],
) {
  async function processUndoHotkey(event: KeyboardEvent) {
    if (!isInput(event)) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        //Undo.
        if (event.key === 'z') await chatHistory.loadPreviousSnapshot();
        //Redo.
        if (event.key === 'Z') await chatHistory.loadNextSnapshot();
      }
    }
  }

  const toggleUndoHotkey = (enabled = true) => {
    //Toggle on.
    if (enabled) {
      document.addEventListener('keydown', processUndoHotkey);
    }
    //Toggle off.
    else {
      document.removeEventListener('keydown', processUndoHotkey);
    }
  };
  //If enabled, setup the hotkey.
  toggleUndoHotkey(settings.enableCtrlZ);
  //Disable the hotkey if the extension is disabled.
  unbinds.push(() => toggleUndoHotkey(false));
  //Listen for settings toggles.
  unbinds.push(api.events.on('undo:setting:enableCtrlZ', toggleUndoHotkey));
}

//Setup snapshots on events.
function setupSnapshotEvents(
  api: ExtensionAPI<ExtensionSettings>,
  settings: ExtensionSettings,
  chatHistory: ChatHistory,
  unbinds: (() => void)[],
) {
  const toggleEventFunction = (
    event: keyof SettingChangeEvents,
    enabled: boolean,
    eventFunction: DebouncedFunc<() => Promise<void>>,
  ) => {
    //Toggle on.
    if (enabled) {
      api.events.on(event, eventFunction);
    }
    //Toggle off.
    else {
      api.events.off(event, eventFunction);
    }
  };

  const saveChatSnapshotDebounced = debounce(() => chatHistory.saveChatSnapshot(false), saveDebounceDuration);
  snapshotEvents.forEach((event) => {
    //Initializes settings.
    unbinds.push(
      api.events.on(`undo:setting:${event}` as keyof SettingChangeEvents, (enabled) =>
        toggleEventFunction(event as keyof SettingChangeEvents, enabled as boolean, saveChatSnapshotDebounced),
      ),
    );
    //Don't enable disabled events.
    if (settings.snapshotEvents[event]) unbinds.push(api.events.on(event, saveChatSnapshotDebounced));
  });
}

function createButton(id: string, label: string, title: string, faIcon: string, onClick: () => void) {
  const button = document.createElement('a');
  button.id = id;
  button.style.cursor = 'pointer';
  button.className = 'options-menu-item';

  const icon = document.createElement('i');
  icon.className = `fa-solid ${faIcon}`;
  button.title = label;

  button.appendChild(icon);

  const span = document.createElement('span');
  span.textContent = title;
  button.appendChild(span);

  button.onclick = (e) => {
    e.stopPropagation();
    // document.body.click();
    onClick();
  };
  return button;
}

function setupUndoRedoButtons(optionsMenu: Element, chatHistory: ChatHistory, t: StrictT) {
  const undoButton = createButton(
    'undo-options-menu-undo',
    t('extensionsBuiltin.undo.undoTitle'),
    t('extensionsBuiltin.undo.undoLabel'),
    'fa-clock-rotate-left',
    async () => await chatHistory.loadPreviousSnapshot(),
  );
  const redoButton = createButton(
    'undo-options-menu-redo',
    t('extensionsBuiltin.undo.redoTitle'),
    t('extensionsBuiltin.undo.redoLabel'),
    'fa-clock-rotate-left fa-flip-horizontal',
    async () => await chatHistory.loadNextSnapshot(),
  );

  const undoRedo = document.createElement('a');
  undoRedo.className = 'undo-options-menu-undo-redo';
  undoRedo.style = 'display:flex';
  undoRedo.appendChild(undoButton);
  undoRedo.appendChild(redoButton);

  optionsMenu.appendChild(undoRedo);
  return () => undoRedo.remove();
}

function setupSaveDiscardButtons(optionsMenu: Element, chatHistory: ChatHistory, t: StrictT) {
  const saveButton = createButton(
    'undo-options-menu-save',
    t('extensionsBuiltin.undo.saveTitle'),
    t('extensionsBuiltin.undo.saveLabel'),
    'fa-floppy-disk',
    async () => await chatHistory.saveChatSnapshot(true),
  );
  const discardButton = createButton(
    'undo-options-menu-discard',
    t('extensionsBuiltin.undo.discardTitle'),
    t('extensionsBuiltin.undo.discardLabel'),
    'fa-trash-can',
    async () => await chatHistory.resetChatSnapshots(true),
  );

  const saveDiscard = document.createElement('a');
  saveDiscard.className = 'undo-options-menu-save-discard';
  saveDiscard.style = 'display:flex';
  saveDiscard.appendChild(saveButton);
  saveDiscard.appendChild(discardButton);

  optionsMenu.appendChild(saveDiscard);
  return () => saveDiscard.remove();
}

let removeUndoRedo: ChildNode['remove'] | undefined;
let removeSaveDiscard: ChildNode['remove'] | undefined;

//Shows and hides the buttons on settings toggle.
function refreshButtons(settings: ExtensionSettings, chatHistory: ChatHistory, unbinds: (() => void)[], t: StrictT) {
  const optionsMenu = document.querySelector('.options-menu');

  // If menu doesn't exist exist, skip
  if (!optionsMenu) return;

  // Undo/Redo buttons.
  if (removeUndoRedo) removeUndoRedo();
  if (settings.showUndoButtons) {
    removeUndoRedo = setupUndoRedoButtons(optionsMenu, chatHistory, t);
    unbinds.push(removeUndoRedo);
  }

  // Save/Discard buttons.
  if (removeSaveDiscard) removeSaveDiscard();
  if (settings.showSaveButtons) {
    removeSaveDiscard = setupSaveDiscardButtons(optionsMenu, chatHistory, t);
    unbinds.push(removeSaveDiscard);
  }
}

export function setup(api: ExtensionAPI<ExtensionSettings>) {
  // @ts-expect-error 'i18n.global' is of type 'unknown'
  const t = i18n.global.t as StrictT;

  // Prevents unused keys. These are used in settings.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  const _UsedI18nKeys = [
    t('extensionsBuiltin.undo.settings.enableCtrlZ'),
    t('extensionsBuiltin.undo.settings.maxChatLength'),
    t('extensionsBuiltin.undo.settings.maxUndoSnapshots'),
    t('extensionsBuiltin.undo.settings.showSaveButtons'),
    t('extensionsBuiltin.undo.settings.showUndoButtons'),
    t('extensionsBuiltin.undo.settings.showToasts'),
  ];

  let settingsApp: { unmount: () => void } | null = null;

  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    settingsApp = api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const unbinds: Array<() => void> = [];

  const settings = api.settings.get() ?? DEFAULT_SETTINGS;

  // Clear snapshot when changing chats
  unbinds.push(
    api.events.on('chat:entered', async () => {
      const chatStore = useChatStore();
      if (!chatStore.activeChat) return;

      const chatHistory = new ChatHistory(chatStore.activeChat.messages, settings, api);
      //Reset chatHistory to create the initial snapshot.
      await chatHistory.resetChatSnapshots(false);
      //When the extension is disabled, free memory.
      unbinds.push(() => {
        chatHistory.chatHistory = [];
      });

      //Binds/Unbinds Ctrl+Z on settings toggle.
      setupUndoHotkey(api, settings, chatHistory, unbinds);

      //Shows and hides the buttons on settings toggle.
      const doRefreshButtons = () => refreshButtons(settings, chatHistory, unbinds, t);
      doRefreshButtons();
      unbinds.push(api.events.on('undo:setting:showUndoButtons', doRefreshButtons));
      unbinds.push(api.events.on('undo:setting:showSaveButtons', doRefreshButtons));

      //Animate icon when active.
      setupActiveIndicator(unbinds);

      //Setup snapshots on events.
      setupSnapshotEvents(api, settings, chatHistory, unbinds);
    }),
  );
  const deactivate = () => {
    settingsApp?.unmount();
    console.log('Undo Deactivated.', unbinds);
    unbinds.forEach((u) => {
      u();
    });
  };

  return deactivate;
}
