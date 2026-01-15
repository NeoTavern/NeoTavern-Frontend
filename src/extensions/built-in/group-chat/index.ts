import { h } from 'vue';
import { EventPriority, GenerationMode } from '../../../constants';
import type { Character, ExtensionAPI } from '../../../types';
import { DEFAULT_SUMMARY_INJECTION_TEMPLATE, GroupChatService } from './GroupChatService';
import GroupSettingsTab from './GroupSettingsTab.vue';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { GroupGenerationHandlingMode, GroupReplyStrategy } from './types';

export { manifest };

export function activate(api: ExtensionAPI) {
  const service = new GroupChatService(api);
  const unbinds: Array<() => void> = [];

  // 0. Mount Extension Settings Panel
  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  // 1. UI: Register the Settings Tab
  const WrappedTab = {
    render() {
      return h(GroupSettingsTab, { api, service });
    },
  };
  const unregisterTab = api.ui.registerChatSettingsTab('group', 'Group', WrappedTab);
  unbinds.push(unregisterTab);

  // 2. Events: Initialization
  unbinds.push(
    api.events.on(
      'chat:entered',
      () => {
        service.init();
      },
      EventPriority.HIGH,
    ),
  );

  unbinds.push(
    api.events.on(
      'chat:cleared',
      () => {
        service.clearQueue();
        service.generatingAvatar.value = null;
        service.stopAutoModeTimer();
      },
      EventPriority.HIGH,
    ),
  );

  unbinds.push(
    api.events.on('generation:aborted', () => {
      if (service.isGroupChat) {
        service.abort();
      }
    }),
  );

  // 3. Events: Generation Start (Sync State for Manual Generations)
  unbinds.push(
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
    ),
  );

  // 4. Events: Context Resolution
  unbinds.push(
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

        if (
          handlingMode === GroupGenerationHandlingMode.SWAP ||
          handlingMode === GroupGenerationHandlingMode.SWAP_INCLUDE_SUMMARIES
        ) {
          // Only the current speaker is active
          if (service.generatingAvatar.value) {
            const char = allChars.find((c) => c.avatar === service.generatingAvatar.value);
            if (char) activeChars = [char];
          } else if (payload.characters.length > 0) {
            // Fallback to what was passed (likely clicked 'force talk' or default)
            activeChars = payload.characters;
          }

          // Special logic for SWAP_INCLUDE_SUMMARIES
          if (handlingMode === GroupGenerationHandlingMode.SWAP_INCLUDE_SUMMARIES && activeChars.length === 1) {
            const activeChar = activeChars[0];
            const otherMembers = members
              .filter((m) => m !== activeChar.avatar && !mutedMap[m]?.muted)
              .map((avatar) => {
                const char = allChars.find((c) => c.avatar === avatar);
                const summary = mutedMap[avatar]?.summary;
                return { name: char?.name || avatar, summary };
              })
              .filter((m) => !!m.name);

            if (otherMembers.length > 0) {
              const summaryBlock = otherMembers
                .map((m) => `${m.name}: ${m.summary || 'No summary available.'}`)
                .join('\n');

              const extensionSettings = api.settings.get();
              const injectionTemplate =
                extensionSettings?.summaryInjectionTemplate || DEFAULT_SUMMARY_INJECTION_TEMPLATE;
              const newDescription = api.macro.process(
                injectionTemplate,
                { activeCharacter: activeChar },
                { summaries: summaryBlock },
              );

              // We clone the character to avoid mutating store state
              activeChars = [
                {
                  ...activeChar,
                  description: newDescription,
                },
              ];
            }
          }
        } else {
          // JOIN modes
          activeChars = members
            .map((avatar) => allChars.find((c) => c.avatar === avatar))
            .filter(Boolean) as Character[];

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
    ),
  );

  // 5. Events: Generation & Queue
  unbinds.push(
    api.events.on(
      'chat:generation-requested',
      async (payload, context) => {
        if (!service.isGroupChat) return;
        if (payload.mode !== GenerationMode.NEW) return;

        await service.prepareGenerationQueue(context?.controller.signal);

        // If aborted during prep, we stop here (generation flow in core handles abort)
        if (context?.controller.signal.aborted) return;

        if (service.generationQueue.value.length > 0) {
          payload.handled = true;
          service.processQueue();
          service.startAutoModeTimer();
        } else {
          if (service.groupConfig.value?.config.replyStrategy === GroupReplyStrategy.LLM_DECISION) {
            payload.handled = true;
          }
        }
      },
      EventPriority.HIGH,
    ),
  );

  unbinds.push(
    api.events.on(
      'generation:finished',
      async (_result, context) => {
        service.generatingAvatar.value = null;

        if (service.wasAborted) {
          service.wasAborted = false;
          return;
        }

        if (context.mode !== GenerationMode.NEW) {
          return;
        }

        if (service.groupConfig.value?.config.replyStrategy === GroupReplyStrategy.LLM_DECISION) {
          await service.prepareGenerationQueue();
        }

        // Process next in queue
        service.processQueue();
        service.startAutoModeTimer();
      },
      EventPriority.HIGH,
    ),
  );

  // 6. Events: Prompt Construction (Name Prefill)
  unbinds.push(
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
    ),
  );

  // 7. Events: Payload Modification (Stop Sequences)
  unbinds.push(
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
    ),
  );

  // 8. Events: History Message Processing (Name Prefixing)
  unbinds.push(
    api.events.on(
      'prompt:history-message-processing',
      (apiMsgs, context) => {
        if (!context.isGroupContext) return;

        for (const apiMsg of apiMsgs) {
          if (apiMsg.role === 'tool') continue;
          if (typeof apiMsg.content === 'string') {
            const namePrefix = `${context.originalMessage.name}:`;
            if (!apiMsg.content.startsWith(namePrefix)) {
              apiMsg.content = `${namePrefix} ${apiMsg.content}`;
            }
          } else if (Array.isArray(apiMsg.content)) {
            for (let i = 0; i < apiMsg.content.length; i++) {
              const part = apiMsg.content[i];
              if (part.type === 'text' && part.text) {
                const namePrefix = `${context.originalMessage.name}:`;
                if (!part.text.startsWith(namePrefix)) {
                  part.text = `${namePrefix} ${part.text}`;
                }
              }
            }
          }
        }
      },
      EventPriority.LOW, // allow other extensions to modify the message first
    ),
  );

  // Cleanup function
  return () => {
    unbinds.forEach((u) => u());
    service.clearQueue();
    service.stopAutoModeTimer();
    service.generatingAvatar.value = null;
  };
}
