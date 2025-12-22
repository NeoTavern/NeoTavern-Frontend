import { h } from 'vue';
import { EventPriority, GenerationMode } from '../../../constants';
import type { Character, ExtensionAPI } from '../../../types';
import { GroupChatService } from './GroupChatService';
import GroupSettingsTab from './GroupSettingsTab.vue';
import { manifest } from './manifest';
import { GroupGenerationHandlingMode } from './types';

export { manifest };

export function activate(api: ExtensionAPI) {
  const service = new GroupChatService(api);

  // 1. UI: Register the Settings Tab
  const WrappedTab = {
    render() {
      return h(GroupSettingsTab, { api, service });
    },
  };
  api.ui.registerChatSettingsTab('group', 'Group', WrappedTab);

  // 2. Events: Initialization
  api.events.on(
    'chat:entered',
    () => {
      service.init();
    },
    EventPriority.HIGH,
  );

  api.events.on(
    'chat:cleared',
    () => {
      service.clearQueue();
      service.generatingAvatar.value = null;
      service.stopAutoModeTimer();
    },
    EventPriority.HIGH,
  );

  // 3. Events: Generation Start (Sync State for Manual Generations)
  api.events.on(
    'generation:started',
    (payload) => {
      if (!service.isGroupChat) return;

      // If generation started manually (not via processQueue), we need to sync the state
      // so that prompt building and context resolution work correctly.
      if (!service.generatingAvatar.value && payload.activeCharacter) {
        service.generatingAvatar.value = payload.activeCharacter.avatar;
      }
    },
    EventPriority.HIGH,
  );

  // 4. Events: Context Resolution
  api.events.on(
    'generation:resolve-context',
    (payload) => {
      if (!service.isGroupChat || !service.groupConfig.value) return;

      const meta = api.chat.metadata.get();
      const members = meta?.members || [];
      const allChars = api.character.getAll();

      // Map logic
      const mutedMap = service.groupConfig.value.members;
      const handlingMode = service.groupConfig.value.config.handlingMode;

      // Filter Logic
      let activeChars: Character[] = [];
      if (handlingMode === GroupGenerationHandlingMode.SWAP) {
        // Only the current speaker is active
        if (service.generatingAvatar.value) {
          const char = allChars.find((c) => c.avatar === service.generatingAvatar.value);
          if (char) activeChars = [char];
        } else if (payload.characters.length > 0) {
          // Fallback to what was passed (likely clicked 'force talk' or default)
          activeChars = payload.characters;
        }
      } else {
        // JOIN modes
        activeChars = members.map((avatar) => allChars.find((c) => c.avatar === avatar)).filter(Boolean) as Character[];

        if (handlingMode === GroupGenerationHandlingMode.JOIN_EXCLUDE_MUTED) {
          activeChars = activeChars.filter((c) => !mutedMap[c.avatar]?.muted);
        }
        // If INCLUDE_MUTED, we include everyone
      }

      // Replace the payload
      if (activeChars.length > 0) {
        payload.characters = activeChars;
      }
    },
    EventPriority.HIGH,
  );

  // 5. Events: Generation & Queue
  api.events.on(
    'chat:generation-requested',
    (payload) => {
      if (!service.isGroupChat) return;
      if (payload.mode !== GenerationMode.NEW) return;

      service.prepareGenerationQueue();
      if (service.generationQueue.value.length > 0) {
        payload.handled = true;
        service.processQueue();
        service.startAutoModeTimer();
      }
    },
    EventPriority.HIGH,
  );

  api.events.on(
    'generation:finished',
    () => {
      service.generatingAvatar.value = null;
      // Process next in queue
      service.processQueue();
      service.startAutoModeTimer();
    },
    EventPriority.HIGH,
  );

  // 6. Events: Prompt Construction (Name Prefill)
  api.events.on(
    'prompt:built',
    (messages) => {
      if (!service.isGroupChat) return;

      if (service.generatingAvatar.value) {
        const char = api.character.get(service.generatingAvatar.value);
        if (char) {
          messages.push({
            role: 'assistant',
            content: `${char.name}: `,
            name: char.name,
          });
        }
      }
    },
    EventPriority.HIGH,
  );

  // 7. Events: Payload Modification (Stop Sequences)
  api.events.on(
    'generation:build-payload',
    (config) => {
      if (!service.isGroupChat) return;

      // Inject names of other members as stop sequences to prevent hijacking
      if (service.generatingAvatar.value) {
        const meta = api.chat.metadata.get();
        const members = meta?.members || [];
        const allChars = api.character.getAll();

        const currentName = api.character.get(service.generatingAvatar.value)?.name;

        members.forEach((avatar) => {
          if (avatar !== service.generatingAvatar.value) {
            const char = allChars.find((c) => c.avatar === avatar);
            if (char && char.name && char.name !== currentName) {
              if (!config.samplerSettings.stop) config.samplerSettings.stop = [];
              const stopSeq = `\n${char.name}:`;
              if (!config.samplerSettings.stop.includes(stopSeq)) {
                config.samplerSettings.stop.push(stopSeq);
              }
            }
          }
        });
      }
    },
    EventPriority.HIGH,
  );

  // 8. Events: History Message Processing (Name Prefixing)
  api.events.on(
    'prompt:history-message-processing',
    (apiMsg, context) => {
      if (!context.isGroupContext) return;

      if (!apiMsg.content.startsWith(`${context.originalMessage.name}:`)) {
        apiMsg.content = `${context.originalMessage.name}: ${apiMsg.content}`;
      }
    },
    EventPriority.HIGH,
  );
}
