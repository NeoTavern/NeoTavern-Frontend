import { markRaw } from 'vue';
import type { ExtensionAPI } from '../../../types';
import PinnedCommandButton from './components/PinnedCommandButton.vue';
import { commandIcon, runCommandAndApply } from './quick-edit';
import { createInputTarget, findChatInputAnchor, openQuickEditPopover } from './quick-edit-ui';
import type { AssistantCommand, AssistantSettings } from './types';

/**
 * Registers a message button, an input options item and a quick action (`assistant.cmd.<id>`) for every
 * pinned command, and registers them again whenever the commands change or a chat is entered.
 */
export function setupPinnedCommands(api: ExtensionAPI<AssistantSettings>, extensionId: string) {
  const t = api.i18n.t;
  let cleanups: (() => void)[] = [];
  let commandsSnapshot = '';
  /** Commands whose auto-accept run on the input box is in progress. */
  const busyInput = new Set<string>();

  const registerInputEntries = (command: AssistantCommand): (() => void)[] => {
    const inChat = api.chat.getChatInfo() !== null;
    const busy = busyInput.has(command.id);
    const id = `assistant.cmd.${command.id}`;
    const label = command.name;
    const title = busy ? t('extensionsBuiltin.assistant.pinned.running', { name: command.name }) : command.prompt;
    const icon = `fa-solid ${busy ? 'fa-circle-notch fa-spin' : commandIcon(command)}`;
    const onClick = () => {
      if (busyInput.has(command.id)) return;
      if (!command.autoAccept) {
        const anchor = findChatInputAnchor();
        if (anchor) openQuickEditPopover(api, anchor, createInputTarget(api), command.id);
        return;
      }
      busyInput.add(command.id);
      sync();
      runCommandAndApply(api, createInputTarget(api), command).finally(() => {
        busyInput.delete(command.id);
        sync();
      });
    };
    return [
      api.ui.registerChatFormOptionsMenuItem({ id, icon, label, title, onClick, visible: inChat, disabled: busy }),
      api.ui.registerChatQuickAction('core.input-message', '', {
        id,
        icon,
        label,
        title,
        onClick,
        disabled: !inChat || busy,
      }),
    ];
  };

  function sync() {
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
    for (const command of api.settings.get().commands.filter((candidate) => candidate.pinned)) {
      cleanups.push(
        api.ui.registerMessageButton({
          id: `assistant.cmd.${command.id}`,
          component: markRaw(PinnedCommandButton),
          props: { api, command },
        }),
        ...registerInputEntries(command),
      );
    }
  }

  const syncIfCommandsChanged = () => {
    const snapshot = JSON.stringify(api.settings.get().commands);
    if (snapshot === commandsSnapshot) return;
    commandsSnapshot = snapshot;
    sync();
  };

  // The settings panel replaces the whole settings object, so the change arrives on the extension's root path.
  const settingsPath = `extensionSettings["${extensionId}"]`;
  api.events.on('setting:changed', (path) => {
    if (path === settingsPath || path.startsWith(`${settingsPath}.commands`)) syncIfCommandsChanged();
  });
  api.events.on('chat:entered', sync);
  syncIfCommandsChanged();
}
