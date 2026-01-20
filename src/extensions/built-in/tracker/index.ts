import type { Component } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { ApiChatMessage, StructuredResponseOptions } from '../../../types/generation';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import TrackerDisplay from './TrackerDisplay.vue';
import TrackerIcon from './TrackerIcon.vue';
import {
  DEFAULT_SETTINGS,
  type TrackerChatExtra,
  type TrackerData,
  type TrackerMessageExtra,
  type TrackerSettings,
} from './types';

export { manifest };

type TrackerExtensionAPI = ExtensionAPI<TrackerSettings, TrackerChatExtra, TrackerMessageExtra>;

interface MountedComponent {
  unmount: () => void;
  component: Component;
}

// TODO: i18n

class TrackerManager {
  private mountedIcons = new Map<number, MountedComponent>();
  private mountedDisplays = new Map<number, MountedComponent>();
  private pendingRequests = new Set<number>();

  constructor(private api: TrackerExtensionAPI) {}

  private getSettings(): TrackerSettings {
    const saved = this.api.settings.get();
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      schemaPresets: saved?.schemaPresets?.length ? saved.schemaPresets : DEFAULT_SETTINGS.schemaPresets,
    };
  }

  public async runTracker(index: number): Promise<void> {
    if (this.pendingRequests.has(index)) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.tracker.toasts.alreadyInProgress'), 'info');
      return;
    }

    const settings = this.getSettings();
    const chat = this.api.chat.getHistory();
    const message = chat[index];
    if (!message) return;
    if (!settings.connectionProfile) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.tracker.toasts.noConnectionProfile'), 'error');
      return;
    }

    let chatSchemaNames = this.api.chat.metadata.get()?.extra?.['core.tracker']?.schemaNames ?? [];
    if (chatSchemaNames.length === 0) {
      this.api.ui.showToast('No tracker schemas are configured for this chat. Please manage schemas first.', 'info');
      await this.manageChatSchemas();
      chatSchemaNames = this.api.chat.metadata.get()?.extra?.['core.tracker']?.schemaNames ?? [];
      if (chatSchemaNames.length === 0) return; // User cancelled
    }

    this.pendingRequests.add(index);

    try {
      const contextMessages = await this.buildTrackerContext(chat, index);

      const tasks = chatSchemaNames.map((schemaName) => async () => {
        const preset = settings.schemaPresets.find((p) => p.name === schemaName);
        if (!preset) {
          console.warn(`Tracker schema preset not found: ${schemaName}`);
          await this.updateTrackerData(index, schemaName, {
            status: 'error',
            error: 'Schema preset not found.',
            schemaName,
          });
          return;
        }

        let schemaObject: object;
        try {
          schemaObject = JSON.parse(preset.schema);
        } catch (e) {
          console.error('Failed to parse tracker schema JSON:', e);
          await this.updateTrackerData(index, schemaName, {
            status: 'error',
            error: 'Invalid schema JSON.',
            schemaName,
          });
          return;
        }

        await this.updateTrackerData(index, schemaName, { status: 'pending', schemaName });

        try {
          const systemPrompt = this.api.macro.process(settings.prompt);
          const messagesForLlm: ApiChatMessage[] = [
            ...contextMessages,
            { role: 'system' as const, name: 'System', content: systemPrompt },
          ];
          const structuredResponse: StructuredResponseOptions = {
            schema: { name: 'tracker_data_extraction', strict: true, value: schemaObject },
            format: settings.promptEngineering,
          };

          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const thus = this;
          const response = await this.api.llm.generate(messagesForLlm, {
            connectionProfile: settings.connectionProfile,
            samplerOverrides: { max_tokens: settings.maxResponseTokens },
            structuredResponse,
            async onCompletion({ structured_content, parse_error }) {
              let trackerHtml = '';
              if (!parse_error && structured_content) {
                trackerHtml = thus.api.macro.process(preset.template, undefined, { data: structured_content });
              }

              await thus.updateTrackerData(index, schemaName, {
                error: parse_error?.message,
                status: parse_error ? 'error' : 'success',
                trackerJson: parse_error ? undefined : (structured_content as Record<string, unknown>),
                trackerHtml,
              });
            },
          });

          if (Symbol.asyncIterator in response) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for await (const _ of response) {
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
          console.error(`Tracker generation failed for schema "${schemaName}":`, error);
          await this.updateTrackerData(index, schemaName, { status: 'error', error: errorMessage, schemaName });
        }
      });

      await this.runPromisesWithLimit(tasks, settings.parallelRequestLimit);
    } finally {
      this.pendingRequests.delete(index);
    }
  }

  private async runPromisesWithLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: T[] = [];
    let activePromises = 0;
    let taskIndex = 0;

    return new Promise((resolve) => {
      const executeNext = () => {
        if (taskIndex >= tasks.length && activePromises === 0) {
          resolve(results);
          return;
        }

        while (activePromises < limit && taskIndex < tasks.length) {
          activePromises++;
          const currentTaskIndex = taskIndex;
          tasks[taskIndex++]()
            .then((result) => {
              results[currentTaskIndex] = result;
            })
            .catch(() => {
              // Errors are handled inside the task, just continue
            })
            .finally(() => {
              activePromises--;
              executeNext();
            });
        }
      };

      executeNext();
    });
  }

  public async manageChatSchemas(): Promise<void> {
    const { result, value } = await this.promptForSchemaSelection();
    if (result === POPUP_RESULT.AFFIRMATIVE && Array.isArray(value)) {
      this.api.chat.metadata.update({
        extra: {
          'core.tracker': {
            schemaNames: value,
          },
        },
      });
      const toastMessage =
        value.length > 0
          ? `This chat now uses: ${value.join(', ')}`
          : 'All tracker schemas have been removed from this chat.';
      this.api.ui.showToast(toastMessage, 'success');
    }
  }

  private async promptForSchemaSelection(): Promise<{ result: number; value: string[] }> {
    const settings = this.getSettings();
    const currentSelection = this.api.chat.metadata.get()?.extra?.['core.tracker']?.schemaNames || [];

    return await this.api.ui.showPopup({
      title: this.api.i18n.t('extensionsBuiltin.tracker.popups.selectSchemaTitle'),
      type: POPUP_TYPE.SELECT,
      content: this.api.i18n.t('extensionsBuiltin.tracker.popups.selectSchemaContent'),
      selectOptions: settings.schemaPresets.map((p) => ({ label: p.name, value: p.name })),
      selectValue: currentSelection,
      selectMultiple: true,
      okButton: true,
      cancelButton: true,
    });
  }

  private async buildTrackerContext(chat: ChatMessage[], currentIndex: number): Promise<ApiChatMessage[]> {
    const settings = this.getSettings();
    const messagesToConsider = chat.slice(0, currentIndex + 1); // Include the current message

    const messageHistory =
      settings.includeLastXMessages === -1
        ? messagesToConsider
        : messagesToConsider.slice(-settings.includeLastXMessages);

    const generationId = `tracker-${currentIndex}-${Date.now()}`;
    const baseApiMessages = await this.api.chat.buildPrompt({ chatHistory: messageHistory, generationId });
    const apiMessages: ApiChatMessage[] = [...baseApiMessages];

    return apiMessages;
  }

  private async updateTrackerData(index: number, schemaName: string, partialData: Partial<TrackerData>) {
    const message = this.api.chat.getHistory()[index];
    if (!message) return;

    const existingExtra = message.extra['core.tracker'] || {};
    const existingTrackers = existingExtra.trackers || {};
    const existingTracker = existingTrackers[schemaName] || { status: 'idle' };

    const newTrackerData: TrackerData = { ...existingTracker, ...partialData };

    await this.api.chat.updateMessageObject(index, {
      extra: {
        'core.tracker': {
          trackers: {
            ...existingTrackers,
            [schemaName]: newTrackerData,
          },
        },
      },
    });
  }

  public handleAutoTrack(message: ChatMessage) {
    const settings = this.getSettings();
    if (!settings.enabled || settings.autoMode === 'none') return;

    const index = this.api.chat.getHistory().length - 1;
    const shouldTrackUser = settings.autoMode === 'inputs' || settings.autoMode === 'both';
    const shouldTrackBot = settings.autoMode === 'responses' || settings.autoMode === 'both';

    if ((message.is_user && shouldTrackUser) || (!message.is_user && shouldTrackBot)) {
      // Small delay to allow UI to settle
      setTimeout(() => this.runTracker(index), 200);
    }
  }

  public injectContext(
    apiMessages: ApiChatMessage[],
    originalMessage: ChatMessage,
    index: number,
    chatLength: number,
    generationId: string,
  ): void {
    const messageWithExtra = originalMessage as unknown as { extra: TrackerMessageExtra };
    const trackers = messageWithExtra.extra?.['core.tracker']?.trackers;
    if (generationId.startsWith('tracker-') && chatLength - 1 === index) return; // Don't inject into own tracker runs

    if (!trackers) return;

    const settings = this.getSettings();
    // Find all successful trackers up to the current message
    const trackerHistory = this.api.chat
      .getHistory()
      .slice(0, index + 1)
      .flatMap((msg) => Object.values(msg.extra['core.tracker']?.trackers || {}))
      .filter((tracker) => tracker.status === 'success');

    for (const trackerData of Object.values(trackers)) {
      if (trackerData.status === 'success' && trackerData.trackerJson) {
        // Only inject if it's within the N most recent trackers
        if (settings.includeLastXTrackers !== -1 && trackerHistory.length > settings.includeLastXTrackers) {
          const recentTrackers = trackerHistory.slice(-settings.includeLastXTrackers);
          if (!recentTrackers.includes(trackerData)) {
            continue; // This tracker is too old, so don't inject it.
          }
        }

        // TODO: No need user to distinguish user vs bot here
        // TODO: Move to extension settings
        const messageSource = originalMessage.is_user ? "the user's message" : 'your response';
        const trackerContent = `[Data for schema "${
          trackerData.schemaName
        }" was tracked from ${messageSource}: ${JSON.stringify(trackerData.trackerJson)}]`;
        apiMessages.push({ role: 'system', name: 'System', content: trackerContent });
      }
    }
  }

  public injectAllUi(): void {
    this.unmountAllUi();
    const messages = this.api.chat.getHistory();
    messages.forEach((_, index) => this.injectUiForMessage(index));
    this.injectChatFormUi();
  }

  public injectUiForMessage(index: number): void {
    const message = this.api.chat.getHistory()[index];
    if (!message) return;

    const messageEl = document.querySelector(`[data-message-index="${index}"]`);
    if (!messageEl) return;

    // Inject Icon
    if (!this.mountedIcons.has(index)) {
      const target = messageEl.querySelector('.message-buttons');
      if (target) {
        const mountPoint = document.createElement('div');
        target.insertAdjacentElement('afterbegin', mountPoint);
        const iconInstance = this.api.ui.mount(mountPoint, TrackerIcon, {
          api: this.api,
          message,
          index,
          onTrack: () => this.runTracker(index),
        });
        this.mountedIcons.set(index, {
          unmount: () => {
            iconInstance.unmount();
            mountPoint.remove();
          },
          component: TrackerIcon,
        });
      }
    }

    // Inject Display
    if (!this.mountedDisplays.has(index)) {
      const target = messageEl.querySelector('.message-header');
      if (target) {
        const mountPoint = document.createElement('div');
        target.after(mountPoint);
        const displayInstance = this.api.ui.mount(mountPoint, TrackerDisplay, {
          api: this.api,
          message,
        });
        this.mountedDisplays.set(index, {
          unmount: () => {
            displayInstance.unmount();
            mountPoint.remove();
          },
          component: TrackerDisplay,
        });
      }
    }
  }

  public injectChatFormUi(): void {
    const onClick = () => this.manageChatSchemas();
    this.api.ui.registerChatFormOptionsMenuItem({
      id: 'tracker-manage-schemas',
      icon: 'fa-solid fa-chart-simple',
      label: this.api.i18n.t('extensionsBuiltin.tracker.chatForm.manageSchemas'),
      visible: this.api.chat.getChatInfo() !== null,
      onClick,
    });
    this.api.ui.registerChatQuickAction('core.context-ai', '', {
      id: 'tracker-manage-schemas',
      icon: 'fa-solid fa-chart-simple',
      label: this.api.i18n.t('extensionsBuiltin.tracker.chatForm.manageSchemas'),
      onClick,
    });
  }

  public unmountMessageUi(indices: number[]): void {
    indices.forEach((index) => {
      this.mountedIcons.get(index)?.unmount();
      this.mountedIcons.delete(index);
      this.mountedDisplays.get(index)?.unmount();
      this.mountedDisplays.delete(index);
    });
  }

  public unmountAllUi(): void {
    this.mountedIcons.forEach((c) => c.unmount());
    this.mountedIcons.clear();
    this.mountedDisplays.forEach((c) => c.unmount());
    this.mountedDisplays.clear();
    this.pendingRequests.clear();
    this.api.ui.unregisterChatFormOptionsMenuItem('tracker-manage-schemas');
    this.api.ui.unregisterChatQuickAction('core.context-ai', 'tracker-manage-schemas');
  }
}

export function activate(api: TrackerExtensionAPI) {
  const settingsContainer = document.getElementById(api.meta.containerId);
  if (settingsContainer) {
    api.ui.mount(settingsContainer, SettingsPanel, { api });
  }

  const manager = new TrackerManager(api);
  const unbinds: Array<() => void> = [];

  const onChatEntered = () => manager.injectAllUi();
  const onMessageCreated = (msg: ChatMessage) => {
    manager.injectUiForMessage(api.chat.getHistory().length - 1);
    manager.handleAutoTrack(msg);
  };
  const onMessageUpdated = (index: number) => {
    // Unmount and re-mount to handle data/position changes
    manager.unmountMessageUi([index]);
    manager.injectUiForMessage(index);
  };
  const onMessageDeleted = (indices: number[]) => manager.unmountMessageUi(indices);
  const onChatCleared = () => manager.unmountAllUi();
  const onHistoryMessageProcessing = (
    payload: { apiMessages: ApiChatMessage[] },
    context: { originalMessage: ChatMessage; index: number; generationId: string; chatLength: number },
  ) => {
    manager.injectContext(
      payload.apiMessages,
      context.originalMessage,
      context.index,
      context.chatLength,
      context.generationId,
    );
  };

  unbinds.push(api.events.on('chat:entered', onChatEntered));
  unbinds.push(api.events.on('message:created', onMessageCreated));
  unbinds.push(api.events.on('message:updated', onMessageUpdated));
  unbinds.push(api.events.on('message:deleted', onMessageDeleted));
  unbinds.push(api.events.on('chat:cleared', onChatCleared));
  unbinds.push(api.events.on('prompt:history-message-processing', onHistoryMessageProcessing));

  // Initial load if a chat is already open
  if (api.chat.getChatInfo()) {
    onChatEntered();
  }

  return () => {
    unbinds.forEach((u) => u());
    manager.unmountAllUi();
  };
}
