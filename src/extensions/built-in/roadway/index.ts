import type { Component } from 'vue';
import { GenerationMode } from '../../../constants';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { ChatFormOptionsMenuItemDefinition, ChatQuickActionDefinition } from '../../../types/ExtensionAPI';
import type { StructuredResponseOptions } from '../../../types/generation';
import { manifest } from './manifest';
import RoadwayChoices from './RoadwayChoices.vue';
import SettingsPanel from './SettingsPanel.vue';
import {
  DEFAULT_SETTINGS,
  type RoadwayChatExtra,
  type RoadwayMessageExtra,
  type RoadwayMessageExtraData,
  type RoadwaySettings,
} from './types';

export { manifest };

type RoadwayExtensionAPI = ExtensionAPI<RoadwaySettings, RoadwayChatExtra, RoadwayMessageExtra>;

interface MountedComponent {
  unmount: () => void;
  component: Component;
}

// TODO: i18n

class RoadwayManager {
  private mountedChoices = new Map<number, MountedComponent>();
  private unregisterChatFormUiFns: Array<() => void> = [];
  private choiceGenAbortControllers = new Map<number, AbortController>();

  constructor(private api: RoadwayExtensionAPI) {}

  private getSettings(): RoadwaySettings {
    const saved = this.api.settings.get();
    return { ...DEFAULT_SETTINGS, ...saved };
  }

  public manualGenerateChoicesForLastMessage(): void {
    if (!this.getSettings().enabled) {
      this.api.ui.showToast('Roadway is disabled.', 'info');
      return;
    }

    const history = this.api.chat.getHistory();
    // Find the last non-user message to generate choices for
    for (let i = history.length - 1; i >= 0; i--) {
      const message = history[i];
      if (!message.is_user) {
        this.generateChoicesForMessage(message, i);
        return;
      }
    }
    this.api.ui.showToast('No AI message found to generate choices for.', 'info');
  }

  public async generateChoicesForMessage(message: ChatMessage, index: number): Promise<void> {
    const settings = this.getSettings();
    if (!settings.enabled) return;

    const connectionProfile =
      settings.choiceGenConnectionProfile || this.api.settings.getGlobal('api.selectedConnectionProfile');
    if (!connectionProfile) {
      this.api.ui.showToast('Roadway: Choice Generation Connection Profile is not set.', 'error');
      return;
    }

    // Abort any previous generation for this message index
    this.abortChoiceGeneration(index);
    const abortController = new AbortController();
    this.choiceGenAbortControllers.set(index, abortController);

    try {
      await this.updateMessageExtra(index, { choiceMade: false, isGeneratingChoices: true });

      const chatHistory = this.api.chat.getHistory().slice(0, index + 1);
      const generationId = `roadway-choices-${index}-${Date.now()}`;

      const structuredResponse: StructuredResponseOptions = {
        format: settings.structuredRequestFormat,
        schema: {
          name: 'roadway_choices',
          strict: true,
          value: {
            type: 'object',
            properties: {
              choices: {
                type: 'array',
                items: { type: 'string' },
                description: `An array of ${settings.choiceCount} user reply options.`,
              },
            },
            required: ['choices'],
          },
        },
      };

      const itemizedPrompt = await this.api.chat.buildPrompt({ chatHistory, generationId, structuredResponse });
      const contextMessages = itemizedPrompt.messages;

      const choicePrompt = this.api.macro.process(settings.choiceGenPrompt, undefined, {
        choiceCount: settings.choiceCount,
      });
      contextMessages.push({ role: 'system', name: 'System', content: choicePrompt });

      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const thus = this;
      const response = await this.api.llm.generate(contextMessages, {
        connectionProfile,
        structuredResponse,
        signal: abortController.signal,
        captureMessageIndex: index,
        async onCompletion({ structured_content, parse_error }) {
          if (abortController.signal.aborted) return;
          if (parse_error) {
            thus.api.ui.showToast('Roadway: Failed to parse choice generation response.', 'error');
            console.error('Roadway choice generation parse error:', parse_error);
            return;
          }
          if (!structured_content) {
            thus.api.ui.showToast('Roadway: No structured content in choice generation response.', 'error');
            console.error('Roadway choice generation missing structured content.');
            return;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const choices = (structured_content as any).choices;

          await thus.updateMessageExtra(index, { choices });
        },
      });

      if (Symbol.asyncIterator in response) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of response) {
          if (abortController.signal.aborted) break;
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Roadway choice generation failed:', error);
        this.api.ui.showToast('Failed to generate choices.', 'error');
      }
    } finally {
      if (!abortController.signal.aborted) {
        await this.updateMessageExtra(index, { isGeneratingChoices: false });
      }
      this.choiceGenAbortControllers.delete(index);
    }
  }

  public abortChoiceGeneration(messageIndex: number, showToast = true) {
    const controller = this.choiceGenAbortControllers.get(messageIndex);
    if (controller) {
      controller.abort();
      this.choiceGenAbortControllers.delete(messageIndex);
      // Clean up the UI state
      this.updateMessageExtra(messageIndex, { isGeneratingChoices: false });
      if (showToast) {
        this.api.ui.showToast('Choice generation cancelled.', 'info');
      }
    }
  }

  public async dismissPendingChoices(): Promise<void> {
    const history = this.api.chat.getHistory();
    const updates = history.map(async (message, index) => {
      const roadwayExtra = message.extra['core.roadway'];
      const isGeneratingChoices = roadwayExtra?.isGeneratingChoices || this.choiceGenAbortControllers.has(index);
      if (message.is_user || roadwayExtra?.choiceMade || (!roadwayExtra?.choices?.length && !isGeneratingChoices)) {
        return;
      }

      this.abortChoiceGeneration(index, false);
      await this.updateMessageExtra(index, {
        choiceMade: true,
        isGeneratingChoices: false,
      });
    });

    await Promise.all(updates);
  }

  public async dismissChoicesForMessage(index: number): Promise<void> {
    const message = this.api.chat.getHistory()[index];
    const roadwayExtra = message?.extra['core.roadway'];
    const isGeneratingChoices = roadwayExtra?.isGeneratingChoices || this.choiceGenAbortControllers.has(index);
    if (
      !message ||
      message.is_user ||
      roadwayExtra?.choiceMade ||
      (!roadwayExtra?.choices?.length && !isGeneratingChoices)
    ) {
      return;
    }

    this.abortChoiceGeneration(index, false);
    await this.updateMessageExtra(index, {
      choiceMade: true,
      isGeneratingChoices: false,
    });
  }

  private async updateMessageExtra(index: number, data: Partial<RoadwayMessageExtraData>) {
    const message = this.api.chat.getHistory()[index];
    if (!message) return;

    const existingExtra = message.extra['core.roadway'] ?? {};

    await this.api.chat.updateMessageObject(index, {
      extra: {
        'core.roadway': {
          ...existingExtra,
          ...data,
        },
      },
    });
  }

  public handleGenerationFinished(
    result: { message: ChatMessage | null; error?: Error },
    context: { generationId: string; mode: GenerationMode },
  ): void {
    const settings = this.getSettings();
    const relevantModes = [GenerationMode.NEW, GenerationMode.ADD_SWIPE, GenerationMode.REGENERATE];

    if (
      result.message &&
      !result.error &&
      !result.message.is_user &&
      settings.enabled &&
      settings.autoMode &&
      relevantModes.includes(context.mode)
    ) {
      const index = this.api.chat.getHistory().length - 1;
      this.generateChoicesForMessage(result.message, index);
    }
  }

  public injectAllUi(): void {
    this.unmountAllUi();
    if (!this.getSettings().enabled) return;

    const messages = this.api.chat.getHistory();
    messages.forEach((message, index) => this.injectUiForMessage(index, message));
    this.injectChatFormUi();
  }

  public injectUiForMessage(index: number, message = this.api.chat.getHistory()[index]): void {
    if (!message || message.is_user) return;

    const roadwayExtra = message.extra['core.roadway'];
    if (
      !roadwayExtra ||
      roadwayExtra.choiceMade ||
      (!roadwayExtra.choices?.length && !roadwayExtra.isGeneratingChoices)
    ) {
      return;
    }

    this.unmountMessageUi([index]); // Ensure no duplicates

    const messageEl = document.querySelector(`[data-message-index="${index}"] .message-main`);
    if (messageEl) {
      const mountPoint = document.createElement('div');
      messageEl.appendChild(mountPoint);

      const choicesInstance = this.api.ui.mount(mountPoint, RoadwayChoices, {
        api: this.api,
        message,
        index,
      });

      this.mountedChoices.set(index, {
        unmount: () => {
          choicesInstance.unmount();
          mountPoint.remove();
        },
        component: RoadwayChoices,
      });
    }
  }

  public injectChatFormUi(): void {
    // Unregister previous instances to prevent duplicates
    this.unregisterChatFormUiFns.forEach((fn) => fn());
    this.unregisterChatFormUiFns = [];

    const isChatOpen = this.api.chat.getChatInfo() !== null;
    if (!isChatOpen) return;

    const isRoadwayEnabled = this.getSettings().enabled;
    const quickActionGroupId = 'core.context-ai';
    const quickActionGroupLabel = 'Context AI';

    // ---- Generate Choices Action ----
    const generateAction: ChatQuickActionDefinition & ChatFormOptionsMenuItemDefinition = {
      id: 'roadway-generate-choices',
      icon: 'fa-solid fa-list-check',
      label: 'Generate Choices',
      title: 'Generate reply choices for the last AI message',
      onClick: () => this.manualGenerateChoicesForLastMessage(),
      disabled: !isRoadwayEnabled,
    };

    this.unregisterChatFormUiFns.push(
      this.api.ui.registerChatQuickAction(quickActionGroupId, quickActionGroupLabel, generateAction),
    );
    this.unregisterChatFormUiFns.push(this.api.ui.registerChatFormOptionsMenuItem(generateAction));
  }

  public unmountMessageUi(indices: number[]): void {
    indices.forEach((index) => {
      this.mountedChoices.get(index)?.unmount();
      this.mountedChoices.delete(index);
    });
  }

  public unmountAllUi(): void {
    this.mountedChoices.forEach((c) => c.unmount());
    this.mountedChoices.clear();
    this.unregisterChatFormUiFns.forEach((fn) => fn());
    this.unregisterChatFormUiFns = [];
    this.choiceGenAbortControllers.forEach((controller) => controller.abort());
    this.choiceGenAbortControllers.clear();
  }

  public handleChatContextChange(): void {
    this.unmountAllUi();
    if (!this.api.chat.getChatInfo()) return;

    this.injectAllUi();
  }
}

export function activate(api: RoadwayExtensionAPI) {
  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const manager = new RoadwayManager(api);
  const unbinds: Array<() => void> = [];

  const onGenerationFinished = (
    result: { message: ChatMessage | null; error?: Error },
    context: { generationId: string; mode: GenerationMode },
  ) => {
    // A small delay to ensure the DOM has updated before we try to mount
    setTimeout(() => {
      manager.handleGenerationFinished(result, context);
    }, 100);
  };
  const onGenerationRequested = async (payload: { mode: GenerationMode }) => {
    if (![GenerationMode.ADD_SWIPE, GenerationMode.REGENERATE].includes(payload.mode)) return;

    const lastMessageIndex = api.chat.getHistory().length - 1;
    await manager.dismissChoicesForMessage(lastMessageIndex);
  };
  const onMessageUpdated = (index: number) => {
    // Unmount and re-mount to handle data changes
    manager.unmountMessageUi([index]);
    manager.injectUiForMessage(index);
  };
  const onMessageCreated = async () => {
    await manager.dismissPendingChoices();
  };
  const onSwipeChanged = async (messageIndex: number) => {
    await manager.dismissChoicesForMessage(messageIndex);
  };
  const onMessageDeleted = (indices: number[]) => manager.unmountMessageUi(indices);
  const onChatCleared = () => manager.unmountAllUi();
  const onChatDeleted = () => manager.unmountAllUi();
  const onChatContextChanged = () => manager.handleChatContextChange();
  const onAbortChoiceGeneration = ({ messageIndex }: { messageIndex: number }) => {
    manager.abortChoiceGeneration(messageIndex);
  };
  const onSettingsChanged = () => manager.handleChatContextChange();

  unbinds.push(api.events.on('chat:entered', onChatContextChanged));
  unbinds.push(api.events.on('chat:generation-requested', onGenerationRequested));
  unbinds.push(api.events.on('generation:finished', onGenerationFinished));
  unbinds.push(api.events.on('message:created', onMessageCreated));
  unbinds.push(api.events.on('message:updated', onMessageUpdated));
  unbinds.push(api.events.on('message:swipe-changed', onSwipeChanged));
  unbinds.push(api.events.on('message:deleted', onMessageDeleted));
  unbinds.push(api.events.on('chat:cleared', onChatCleared));
  unbinds.push(api.events.on('chat:deleted', onChatDeleted));
  // @ts-expect-error custom event
  unbinds.push(api.events.on('roadway:abort-choice-generation', onAbortChoiceGeneration));
  // @ts-expect-error custom event
  unbinds.push(api.events.on('roadway:settings-changed', onSettingsChanged));

  // Initial load if a chat is already open
  if (api.chat.getChatInfo()) {
    onChatContextChanged();
  }

  return () => {
    unbinds.forEach((u) => u());
    manager.unmountAllUi();
  };
}
