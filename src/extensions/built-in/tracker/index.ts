import type { Component } from 'vue';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { ApiChatMessage, GenerationResponse, StructuredResponseOptions } from '../../../types/generation';
import { POPUP_RESULT, POPUP_TYPE } from '../../../types/popup';
import {
  buildTrackerDeltaSchema,
  validateAgainstSchema,
  validateAndApplyTrackerDelta,
  type TrackerDeltaMode,
} from './delta';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { getLatestTrackerStoryTime } from './story-time';
import TrackerDisplay from './TrackerDisplay.vue';
import TrackerIcon from './TrackerIcon.vue';
import {
  DEFAULT_SETTINGS,
  type TrackerChatExtra,
  type TrackerData,
  type TrackerMessageExtra,
  type TrackerService,
  type TrackerSettings,
} from './types';

export { manifest };

type TrackerExtensionAPI = ExtensionAPI<TrackerSettings, TrackerChatExtra, TrackerMessageExtra>;

const MAX_SCHEMA_REPAIRS = 3;

interface MountedComponent {
  unmount: () => void;
  component: Component;
}

interface TrackerGenerationResult {
  rawContent: string;
  structuredContent?: object;
  parseError?: string;
}

interface ProcessedTrackerResult {
  trackerJson: Record<string, unknown>;
  trackerDelta?: Record<string, unknown>;
  trackerHtml: string;
}

function isFinishedAssistantMessage(message: ChatMessage | null): message is ChatMessage {
  return Boolean(message && !message.is_user && !message.is_system && message.gen_finished);
}

function findMessageIndex(history: ChatMessage[], message: ChatMessage, generationId?: string): number {
  if (generationId) {
    for (let index = history.length - 1; index >= 0; index--) {
      const candidate = history[index];
      if (candidate.swipe_info?.some((swipe) => swipe.generation_id === generationId)) return index;
    }
  }

  const identityIndex = history.lastIndexOf(message);
  if (identityIndex !== -1) return identityIndex;

  for (let index = history.length - 1; index >= 0; index--) {
    const candidate = history[index];
    if (
      candidate.name === message.name &&
      candidate.send_date === message.send_date &&
      candidate.gen_started === message.gen_started &&
      candidate.gen_finished === message.gen_finished &&
      candidate.mes === message.mes
    ) {
      return index;
    }
  }

  return -1;
}

// TODO: i18n

class TrackerManager {
  private mountedIcons = new Map<number, MountedComponent>();
  private mountedDisplays = new Map<number, MountedComponent>();
  private pendingRequests = new Set<number>();

  constructor(private api: TrackerExtensionAPI) {}

  public getSettings(): TrackerSettings {
    const saved = this.api.settings.get();
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      schemaPresets: saved?.schemaPresets?.length ? saved.schemaPresets : DEFAULT_SETTINGS.schemaPresets,
    };
  }

  public getLatestTrackerValue(schemaName: string, path: string): unknown {
    const parts = path.split('.').filter(Boolean);
    const history = this.api.chat.getHistory();
    for (let index = history.length - 1; index >= 0; index--) {
      const tracker = history[index].extra?.['core.tracker']?.trackers?.[schemaName];
      if (tracker?.status !== 'success' || !tracker.trackerJson) continue;
      return parts.reduce<unknown>((value, part) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
        return (value as Record<string, unknown>)[part];
      }, tracker.trackerJson);
    }
    return undefined;
  }

  private getPreviousTrackerJson(schemaName: string, beforeIndex: number): Record<string, unknown> | null {
    const history = this.api.chat.getHistory();
    for (let index = beforeIndex - 1; index >= 0; index--) {
      const tracker = history[index].extra?.['core.tracker']?.trackers?.[schemaName];
      if (tracker?.status === 'success' && tracker.trackerJson) return tracker.trackerJson;
    }
    return null;
  }

  private shouldUseDeltaMode(
    mode: TrackerDeltaMode,
    previousTrackerJson: Record<string, unknown> | null,
    hasDeltaFields: boolean,
  ): boolean {
    if (!previousTrackerJson || mode === 'off') return false;
    if (mode === 'always') return hasDeltaFields;
    return hasDeltaFields;
  }

  private buildDeltaSystemPrompt(schemaName: string, previousTrackerJson: Record<string, unknown>): ApiChatMessage {
    return {
      role: 'system',
      name: 'System',
      content: `Delta tracker update for schema "${schemaName}": return only changed fields allowed by the delta schema. Do not repeat unchanged fields. If you change a field that requires another field, include both fields in the same JSON object. For keyed arrays, include the key field plus only changed fields for that item.\n\nPrevious full tracker state:\n${JSON.stringify(
        previousTrackerJson,
        null,
        2,
      )}`,
    };
  }

  private processTrackerStructuredContent(
    structuredContent: object | undefined,
    schemaObject: object,
    presetTemplate: string,
    useDelta: boolean,
    previousTrackerJson: Record<string, unknown> | null,
  ): ProcessedTrackerResult {
    if (!structuredContent) throw new Error('Tracker generation returned no structured content.');

    let trackerJson: Record<string, unknown>;
    let trackerDelta: Record<string, unknown> | undefined;

    if (useDelta && previousTrackerJson) {
      const applied = validateAndApplyTrackerDelta(
        previousTrackerJson,
        structuredContent as Record<string, unknown>,
        schemaObject,
      );
      trackerJson = applied.full;
      trackerDelta = applied.delta;
    } else {
      validateAgainstSchema(structuredContent, schemaObject, 'Tracker');
      trackerJson = structuredContent as Record<string, unknown>;
    }

    return {
      trackerJson,
      trackerDelta,
      trackerHtml: this.api.macro.process(presetTemplate, undefined, { data: trackerJson }),
    };
  }

  private async generateTracker(
    messages: ApiChatMessage[],
    connectionProfile: string,
    maxResponseTokens: number,
    structuredResponse: StructuredResponseOptions,
  ): Promise<TrackerGenerationResult> {
    let completionStructuredContent: object | undefined;
    let completionParseError: Error | undefined;
    const response = await this.api.llm.generate(messages, {
      connectionProfile,
      samplerOverrides: { max_tokens: maxResponseTokens, stream: false },
      structuredResponse,
      onCompletion({ structured_content, parse_error }) {
        completionStructuredContent = structured_content;
        completionParseError = parse_error;
      },
    });

    if (Symbol.asyncIterator in response) {
      for await (const chunk of response) void chunk;
      return { rawContent: '', parseError: 'Tracker generation unexpectedly returned a stream.' };
    }

    const generationResponse = response as GenerationResponse;
    const structuredContent = generationResponse.structured_content ?? completionStructuredContent;
    const parseError = completionParseError?.message;

    return {
      rawContent: generationResponse.content,
      structuredContent,
      parseError: structuredContent ? undefined : (parseError ?? 'Tracker generation returned no structured content.'),
    };
  }

  private async repairTracker(
    originalMessages: ApiChatMessage[],
    rawContent: string,
    parseError: string,
    structuredResponse: StructuredResponseOptions,
    connectionProfile: string,
    maxResponseTokens: number,
    useDelta: boolean,
  ): Promise<TrackerGenerationResult> {
    const repairKind = useDelta ? 'delta JSON object' : 'full tracker JSON object';
    const repairMessages: ApiChatMessage[] = [
      ...originalMessages,
      { role: 'assistant', name: 'Assistant', content: rawContent },
      {
        role: 'user',
        name: 'User',
        content: `[Schema validation error]\n${parseError}\n\nRepair your previous Tracker ${repairKind}. Return the complete corrected ${repairKind}, not prose or markdown. Preserve valid fields unless the error requires changing that specific field. For delta repairs, keep unchanged tracker fields out of the response and include required coupled fields together.`,
      },
    ];

    return await this.generateTracker(repairMessages, connectionProfile, maxResponseTokens, structuredResponse);
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
    const connectionProfile =
      settings.connectionProfile || this.api.settings.getGlobal('api.selectedConnectionProfile');
    if (!connectionProfile) {
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
          const systemPrompt = this.api.macro.process(preset.prompt);
          const deltaSchema = buildTrackerDeltaSchema(schemaObject);
          const previousTrackerJson = this.getPreviousTrackerJson(schemaName, index);
          const useDelta = this.shouldUseDeltaMode(settings.deltaMode, previousTrackerJson, deltaSchema.hasDeltaFields);
          const responseSchema = useDelta ? deltaSchema.schema : schemaObject;
          const structuredResponse: StructuredResponseOptions = {
            schema: {
              name: useDelta ? 'tracker_delta_extraction' : 'tracker_data_extraction',
              strict: true,
              value: responseSchema,
            },
            format: settings.promptEngineering,
          };

          // Build context messages with structured response for this specific preset
          const contextMessages = await this.buildTrackerContext(chat, index, structuredResponse);

          const messagesForLlm: ApiChatMessage[] = [
            ...contextMessages,
            ...(useDelta && previousTrackerJson ? [this.buildDeltaSystemPrompt(schemaName, previousTrackerJson)] : []),
            { role: 'system' as const, name: 'System', content: systemPrompt },
          ];

          let generation = await this.generateTracker(
            messagesForLlm,
            connectionProfile,
            settings.maxResponseTokens,
            structuredResponse,
          );
          let processed: ProcessedTrackerResult | undefined;
          let error = generation.parseError;

          if (!error) {
            try {
              processed = this.processTrackerStructuredContent(
                generation.structuredContent,
                schemaObject,
                preset.template,
                useDelta,
                previousTrackerJson,
              );
            } catch (validationError) {
              error = validationError instanceof Error ? validationError.message : 'Tracker validation failed.';
            }
          }

          let repairCount = 0;
          while (!processed && error && repairCount < MAX_SCHEMA_REPAIRS) {
            const repairRawContent =
              generation.rawContent ||
              (generation.structuredContent ? JSON.stringify(generation.structuredContent, null, 2) : '');
            if (!repairRawContent.trim()) break;

            repairCount += 1;
            this.api.ui.showToast(
              `Tracker response for "${schemaName}" needs schema repair. Retry ${repairCount}/${MAX_SCHEMA_REPAIRS}...`,
              'info',
            );
            generation = await this.repairTracker(
              messagesForLlm,
              repairRawContent,
              error,
              structuredResponse,
              connectionProfile,
              settings.maxResponseTokens,
              useDelta,
            );
            error = generation.parseError;

            if (!error) {
              try {
                processed = this.processTrackerStructuredContent(
                  generation.structuredContent,
                  schemaObject,
                  preset.template,
                  useDelta,
                  previousTrackerJson,
                );
              } catch (validationError) {
                error = validationError instanceof Error ? validationError.message : 'Tracker validation failed.';
              }
            }
          }

          await this.updateTrackerData(index, schemaName, {
            error,
            status: processed ? 'success' : 'error',
            trackerJson: processed?.trackerJson,
            trackerDelta: processed?.trackerDelta,
            deltaMode: useDelta ? 'delta' : 'full',
            trackerHtml: processed?.trackerHtml ?? '',
          });
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

  private async buildTrackerContext(
    chat: ChatMessage[],
    currentIndex: number,
    structuredResponse?: StructuredResponseOptions,
  ): Promise<ApiChatMessage[]> {
    const settings = this.getSettings();
    const messagesToConsider = chat.slice(0, currentIndex + 1); // Include the current message

    const messageHistory =
      settings.includeLastXMessages === -1
        ? messagesToConsider
        : messagesToConsider.slice(-settings.includeLastXMessages);

    const generationId = `tracker-${currentIndex}-${Date.now()}`;
    const itemizedPrompt = await this.api.chat.buildPrompt({
      chatHistory: messageHistory,
      generationId,
      structuredResponse,
    });
    const apiMessages: ApiChatMessage[] = [...itemizedPrompt.messages];

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
            [schemaName]: newTrackerData,
          },
        },
      },
    });
  }

  public handleAutoTrack(message: ChatMessage) {
    const settings = this.getSettings();
    if (!settings.enabled || settings.autoMode === 'none') return;

    const shouldTrackUser = settings.autoMode === 'inputs' || settings.autoMode === 'both';

    if (message.is_user && shouldTrackUser) {
      const index = this.api.chat.getHistory().lastIndexOf(message);
      if (index === -1) return;
      // Small delay to allow UI to settle
      setTimeout(() => this.runTracker(index), 200);
    }
  }

  public handleAutoTrackGenerationFinished(
    result: { message: ChatMessage | null; error?: Error },
    generationId: string,
  ) {
    const settings = this.getSettings();
    if (!settings.enabled || result.error || settings.autoMode === 'none') return;
    const shouldTrackBot = settings.autoMode === 'responses' || settings.autoMode === 'both';
    const message = result.message;
    if (!shouldTrackBot || !isFinishedAssistantMessage(message)) return;

    const index = findMessageIndex(this.api.chat.getHistory(), message, generationId);
    if (index === -1) return;
    setTimeout(() => this.runTracker(index), 200);
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

        // TODO: Move to extension settings
        const trackerContent = `[Data for schema "${
          trackerData.schemaName
        }": ${JSON.stringify(trackerData.trackerJson)}]`;
        apiMessages.push({ role: 'system', name: 'System', content: trackerContent });
      }
    }
  }

  public injectAllUi(): void {
    this.unmountAllUi();
    const messages = this.api.chat.getHistory();
    messages.forEach((message, index) => this.injectUiForMessage(index, message));
    this.injectChatFormUi();
  }

  public injectUiForMessage(index: number, message = this.api.chat.getHistory()[index]): void {
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
      icon: 'fa-solid fa-clipboard-list',
      label: this.api.i18n.t('extensionsBuiltin.tracker.chatForm.manageSchemas'),
      visible: this.api.chat.getChatInfo() !== null,
      onClick,
    });
    this.api.ui.registerChatQuickAction('core.context-ai', '', {
      id: 'tracker-manage-schemas',
      icon: 'fa-solid fa-clipboard-list',
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
  const trackerService: TrackerService = {
    getLatestStoryTime: () => getLatestTrackerStoryTime(manager.getSettings(), api.chat.getHistory()),
    getLatestTrackerValue: (schemaName, path) => manager.getLatestTrackerValue(schemaName, path),
  };
  api.extensions.registerService('core.tracker', trackerService);
  const unbinds: Array<() => void> = [];

  const onChatEntered = () => manager.injectAllUi();
  const onMessageCreated = (msg: ChatMessage) => {
    manager.injectUiForMessage(api.chat.getHistory().length - 1);
    manager.handleAutoTrack(msg);
  };
  const onGenerationFinished = (
    result: { message: ChatMessage | null; error?: Error },
    context: { generationId: string },
  ) => {
    manager.handleAutoTrackGenerationFinished(result, context.generationId);
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
  unbinds.push(api.events.on('generation:finished', onGenerationFinished));
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
    api.extensions.unregisterService('core.tracker');
  };
}
