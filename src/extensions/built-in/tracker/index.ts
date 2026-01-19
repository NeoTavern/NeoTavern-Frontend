import type { Component } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { ApiChatMessage, StructuredResponseOptions } from '../../../types/generation';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import TrackerDisplay from './TrackerDisplay.vue';
import TrackerIcon from './TrackerIcon.vue';
import { DEFAULT_SETTINGS, type TrackerData, type TrackerSettings } from './types';

export { manifest };

interface MountedComponent {
  unmount: () => void;
  component: Component;
}

class TrackerManager {
  private mountedIcons = new Map<number, MountedComponent>();
  private mountedDisplays = new Map<number, MountedComponent>();
  private pendingRequests = new Set<number>();
  private changeSchemaMenuItem: HTMLElement | null = null;

  constructor(private api: ExtensionAPI<TrackerSettings>) {}

  private get extensionId(): string {
    return this.api.meta.id;
  }

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

    // 1. Determine which schema to use
    let schemaName = this.api.chat.metadata.get()?.extra?.[this.extensionId]?.schemaName as string | undefined;

    if (!schemaName) {
      const { result, value } = await this.promptForSchemaSelection();
      if (result !== POPUP_RESULT.AFFIRMATIVE || !value) {
        return; // User cancelled
      }
      schemaName = value;
      this.api.chat.metadata.update({
        extra: { ...this.api.chat.metadata.get()?.extra, [this.extensionId]: { schemaName } },
      });
    }

    const preset = settings.schemaPresets.find((p) => p.name === schemaName);
    if (!preset) {
      this.api.ui.showToast(
        this.api.i18n.t('extensionsBuiltin.tracker.toasts.schemaNotFound', { name: schemaName }),
        'error',
      );
      return;
    }

    let schemaObject: object;
    try {
      schemaObject = JSON.parse(preset.schema);
    } catch (e) {
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.tracker.toasts.invalidJson'), 'error');
      return;
    }

    // 2. Update UI to 'pending' state
    this.pendingRequests.add(index);
    await this.updateTrackerData(index, { status: 'pending', schemaName });

    try {
      // 3. Build context for the prompt
      const contextMessages = await this.buildTrackerContext(chat, index);
      const systemPrompt = this.api.macro.process(settings.prompt, undefined, { messageText: message.mes });
      contextMessages.push({ role: 'system', name: 'System', content: systemPrompt });

      // 4. Prepare structured response options
      const structuredResponse: StructuredResponseOptions = {
        schema: {
          name: 'tracker_data_extraction',
          strict: true,
          value: schemaObject,
        },
        format: settings.promptEngineering,
      };

      // 5. Call LLM
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const thus = this;
      const response = await this.api.llm.generate(contextMessages, {
        connectionProfile: settings.connectionProfile,
        samplerOverrides: { max_tokens: settings.maxResponseTokens },
        structuredResponse,
        async onCompletion({ structured_content, parse_error }) {
          let trackerHtml = '';
          if (!parse_error && structured_content) {
            trackerHtml = thus.api.macro.process(
              preset.template,
              undefined,
              structured_content as Record<string, unknown>,
            );
          }

          await thus.updateTrackerData(index, {
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
      console.error('Tracker generation failed:', error);
      await this.updateTrackerData(index, { status: 'error', error: errorMessage, schemaName });
    } finally {
      this.pendingRequests.delete(index);
    }
  }

  public async changeChatSchema(): Promise<void> {
    const { result, value } = await this.promptForSchemaSelection();
    if (result === POPUP_RESULT.AFFIRMATIVE && value) {
      this.api.chat.metadata.update({
        extra: { ...this.api.chat.metadata.get()?.extra, [this.extensionId]: { schemaName: value } },
      });
      this.api.ui.showToast(this.api.i18n.t('extensionsBuiltin.tracker.toasts.schemaSet', { name: value }), 'success');
    }
  }

  private async promptForSchemaSelection(): Promise<{ result: number; value: string }> {
    const settings = this.getSettings();
    const currentDefault =
      (this.api.chat.metadata.get()?.extra?.[this.extensionId]?.schemaName as string) ||
      settings.activeSchemaPresetName;

    return await this.api.ui.showPopup({
      title: this.api.i18n.t('extensionsBuiltin.tracker.popups.selectSchemaTitle'),
      type: POPUP_TYPE.SELECT,
      content: this.api.i18n.t('extensionsBuiltin.tracker.popups.selectSchemaContent'),
      selectOptions: settings.schemaPresets.map((p) => ({ label: p.name, value: p.name })),
      selectValue: currentDefault,
      okButton: true,
      cancelButton: true,
    });
  }

  private async buildTrackerContext(chat: ChatMessage[], currentIndex: number): Promise<ApiChatMessage[]> {
    const settings = this.getSettings();
    const messagesToConsider = chat.slice(0, currentIndex);

    // Include last X messages
    const messageHistory =
      settings.includeLastXMessages === -1
        ? messagesToConsider
        : messagesToConsider.slice(-settings.includeLastXMessages);

    // Build ApiChatMessage array
    const apiMessages: ApiChatMessage[] = [];
    const baseApiMessages = await this.api.chat.buildPrompt({ chatHistory: messageHistory });
    apiMessages.push(...baseApiMessages);

    return apiMessages;
  }

  private async updateTrackerData(index: number, partialData: Partial<TrackerData>) {
    const message = this.api.chat.getHistory()[index];
    if (!message) return;

    const existingExtra = message.extra?.[this.extensionId] || {};
    const existingTracker = existingExtra.tracker || {};

    const newTrackerData = { ...existingTracker, ...partialData };

    await this.api.chat.updateMessageObject(index, {
      extra: {
        ...message.extra,
        [this.extensionId]: { ...existingExtra, tracker: newTrackerData },
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

  public injectContext(apiMessages: ApiChatMessage[], originalMessage: ChatMessage, index: number): void {
    const trackerData = originalMessage.extra?.[this.extensionId]?.tracker as TrackerData | undefined;

    if (trackerData?.status === 'success' && trackerData.trackerJson) {
      const settings = this.getSettings();
      // Find all successful trackers up to the current message
      const trackerHistory = this.api.chat
        .getHistory()
        .slice(0, index + 1)
        .filter((msg) => msg.extra?.[this.extensionId]?.tracker?.status === 'success');

      // Only inject if it's within the N most recent trackers
      if (settings.includeLastXTrackers !== -1 && trackerHistory.length > settings.includeLastXTrackers) {
        const recentTrackers = trackerHistory.slice(-settings.includeLastXTrackers);
        if (!recentTrackers.includes(originalMessage)) {
          return; // This tracker is too old, so don't inject it.
        }
      }

      const messageSource = originalMessage.is_user ? "the user's last message" : 'your last response';
      const trackerContent = `[The following data was tracked for ${messageSource} using the "${
        trackerData.schemaName
      }" schema: ${JSON.stringify(trackerData.trackerJson)}]`;
      apiMessages.push({ role: 'system', name: 'System', content: trackerContent });
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
      const target = messageEl.querySelector('.message-main');
      if (target) {
        const mountPoint = document.createElement('div');
        target.insertAdjacentElement('afterbegin', mountPoint);
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
    this.unmountChatFormUi(); // Clean up existing first
    const settings = this.getSettings();
    if (!settings.enabled) return;

    // Use a small delay to ensure the menu exists in the DOM
    setTimeout(() => {
      const optionsMenu = document.querySelector('#chat-form .options-menu');
      if (optionsMenu) {
        const separator = document.createElement('hr');
        separator.setAttribute('role', 'separator');

        const menuItem = document.createElement('a');
        menuItem.className = 'options-menu-item';
        menuItem.setAttribute('role', 'menuitem');
        menuItem.tabIndex = 0;
        menuItem.innerHTML = `<i class="fa-solid fa-chart-simple"></i> <span>${this.api.i18n.t(
          'extensionsBuiltin.tracker.chatForm.changeSchema',
        )}</span>`;
        menuItem.onclick = () => {
          this.changeChatSchema();
          // Hide the menu after clicking
          const menu = menuItem.closest('.options-menu') as HTMLElement | null;
          if (menu) menu.style.display = 'none';
        };
        menuItem.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.changeChatSchema();
          }
        };

        optionsMenu.appendChild(separator);
        optionsMenu.appendChild(menuItem);
        this.changeSchemaMenuItem = menuItem; // Store reference for cleanup
      }
    }, 200);
  }

  public unmountChatFormUi(): void {
    if (this.changeSchemaMenuItem) {
      const separator = this.changeSchemaMenuItem.previousElementSibling;
      if (separator instanceof HTMLHRElement) {
        separator.remove();
      }
      this.changeSchemaMenuItem.remove();
      this.changeSchemaMenuItem = null;
    }
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
    this.unmountChatFormUi();
  }
}

export function activate(api: ExtensionAPI<TrackerSettings>) {
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
    context: { originalMessage: ChatMessage; index: number },
  ) => {
    manager.injectContext(payload.apiMessages, context.originalMessage, context.index);
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
