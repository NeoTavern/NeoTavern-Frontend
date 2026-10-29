import { markRaw, ref } from 'vue';
import { EventPriority, GenerationMode } from '../../../constants';
import { useExtensionStore } from '../../../stores/extension.store';
import {
  POPUP_TYPE,
  type ApiChatMessage,
  type ExtensionAPI,
  type GenerationResponse,
  type StreamedChunk,
} from '../../../types';
import type { LlmUsageData } from '../../../types/events';
import type { ChatCompletionPayload } from '../../../types/generation';
import { cloneJson } from '../_shared/data-utils';
import CaptureViewer from './CaptureViewer.vue';
import { manifest } from './manifest';
import SettingsPanel from './SettingsPanel.vue';
import { UsageStorage } from './storage';
import { DEFAULT_SETTINGS, type UsageTrackerSettings } from './types';
import UsageDashboard from './UsageDashboard.vue';
import UsageMessageButton from './UsageMessageButton.vue';

export { manifest };

const SIDEBAR_ID = 'usage-dashboard';

type PendingCapture = {
  generationId: string;
  messageIndex?: number;
  chatFile?: string;
  model: string;
  source: string;
  traceMessages?: ApiChatMessage[];
  streamContent: string;
  streamReasoning?: string;
  streamImages: string[];
  streamToolCalls?: unknown;
};

function getSettings(api: ExtensionAPI<UsageTrackerSettings>): UsageTrackerSettings {
  const existing = api.settings.get();
  if (!existing) {
    api.settings.set(undefined, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...existing };
}

function isCaptureEnabled(api: ExtensionAPI<UsageTrackerSettings>): boolean {
  return getSettings(api).captureFullPayloads;
}

function getActiveChatFile(api: ExtensionAPI<UsageTrackerSettings>): string | undefined {
  return api.chat.getChatInfo()?.file_id;
}

function getMessageTarget(api: ExtensionAPI<UsageTrackerSettings>, mode: GenerationMode) {
  const history = api.chat.getHistory();
  if (mode === GenerationMode.CONTINUE) {
    return { messageIndex: history.length - 1 };
  }

  if (mode === GenerationMode.ADD_SWIPE) {
    return { messageIndex: history.length - 1 };
  }

  return { messageIndex: history.length };
}

async function showCapturesPopup(
  api: ExtensionAPI<UsageTrackerSettings>,
  captures: Awaited<ReturnType<UsageStorage['getCapturesForMessage']>>,
) {
  const extensionStore = useExtensionStore();
  const formatSource = (source: string) => {
    if (source === 'core') return api.i18n.t('extensionsBuiltin.usageTracker.core');
    if (source === 'unknown') return api.i18n.t('common.unknown');
    const extension = extensionStore.extensions[source];
    return extension ? extensionStore.getExtensionDisplayName(extension) : source;
  };

  await api.ui.showPopup({
    type: POPUP_TYPE.DISPLAY,
    title: api.i18n.t('extensionsBuiltin.usageTracker.requestResponseCapture'),
    wide: true,
    large: true,
    component: markRaw(CaptureViewer),
    componentProps: { captures, formatSource },
    okButton: true,
  });
}

export function activate(api: ExtensionAPI<UsageTrackerSettings>) {
  const storage = new UsageStorage();
  const pending = new Map<string, PendingCapture>();
  let activeChatFile = getActiveChatFile(api);

  api.ui.registerSettingsPanel(SettingsPanel, { api });

  const capturesVersion = ref(0);
  const refreshMessageButtons = () => {
    capturesVersion.value++;
  };

  api.ui.registerMessageButton({
    id: 'usage-tracker.captures',
    placement: 'start',
    component: UsageMessageButton,
    props: {
      title: api.i18n.t('extensionsBuiltin.usageTracker.viewFullRequestResponse'),
      capturesVersion,
      hasCaptures: async (messageIndex: number) =>
        (await storage.getCapturesForMessage(getActiveChatFile(api), messageIndex)).length > 0,
      onOpen: async (messageIndex: number) => {
        const captures = await storage.getCapturesForMessage(getActiveChatFile(api), messageIndex);
        await showCapturesPopup(api, captures);
      },
    },
  });

  const clearPendingForChat = (chatFile: string | undefined) => {
    for (const [generationId, capture] of pending) {
      if (capture.chatFile === chatFile) pending.delete(generationId);
    }
  };

  api.events.on('chat:entered', (chatFile) => {
    activeChatFile = chatFile;
    refreshMessageButtons();
  });

  api.events.on('message:deleted', async (indices) => {
    const chatFile = getActiveChatFile(api) ?? activeChatFile;
    await storage.handleDeletedMessages(chatFile, indices);
    refreshMessageButtons();
  });

  api.events.on('chat:cleared', async () => {
    const chatFile = activeChatFile;
    await storage.deleteCapturesForChat(chatFile);
    clearPendingForChat(chatFile);
    activeChatFile = undefined;
    refreshMessageButtons();
  });

  api.events.on('chat:deleted', async (chatFile) => {
    await storage.deleteCapturesForChat(chatFile);
    clearPendingForChat(chatFile);
    if (activeChatFile === chatFile) activeChatFile = undefined;
    refreshMessageButtons();
  });

  api.events.on('process:generation-context', (context) => {
    if (!isCaptureEnabled(api)) return;
    const target = getMessageTarget(api, context.mode);
    pending.set(context.generationId, {
      generationId: context.generationId,
      messageIndex: target.messageIndex,
      chatFile: getActiveChatFile(api),
      model: context.settings.model,
      source: 'core',
      streamContent: '',
      streamImages: [],
    });
  });

  api.events.on(
    'prompt:built',
    (messages, context) => {
      const capture = pending.get(context.generationId);
      if (capture) capture.traceMessages = cloneJson(messages);
    },
    EventPriority.LOWEST,
  );

  api.events.on('process:request-payload', async (payload: ChatCompletionPayload, context) => {
    if (!isCaptureEnabled(api)) return;
    const capture = pending.get(context.generationId);

    try {
      await storage.addCapture(
        {
          generationId: context.generationId,
          messageIndex: capture?.messageIndex ?? context.messageIndex,
          chatFile: capture?.chatFile ?? getActiveChatFile(api),
          source: capture?.source ?? context.source ?? 'unknown',
          model: capture?.model ?? context.model ?? String(payload.model ?? 'unknown'),
          request: cloneJson(payload),
          traceMessages: capture?.traceMessages,
        },
        getSettings(api).captureStorageLimitBytes,
      );
      refreshMessageButtons();
    } catch (err) {
      console.error('[UsageTracker] Failed to save request capture:', err);
    }
  });

  api.events.on('process:response', async (response: GenerationResponse, context) => {
    if (!isCaptureEnabled(api)) return;
    try {
      pending.delete(context.generationId);
      await storage.updateCapture(
        context.generationId,
        {
          response: cloneJson(response),
          responseText: response.content,
          status: 'complete',
        },
        getSettings(api).captureStorageLimitBytes,
      );
      refreshMessageButtons();
    } catch (err) {
      console.error('[UsageTracker] Failed to save response capture:', err);
    }
  });

  api.events.on('process:stream-chunk', (chunk: StreamedChunk, context) => {
    if (!isCaptureEnabled(api)) return;
    const capture = pending.get(context.generationId);
    if (!capture) return;
    capture.streamContent += chunk.delta ?? '';
    if (chunk.reasoning) capture.streamReasoning = chunk.reasoning;
    if (chunk.images) capture.streamImages.push(...chunk.images);
    if (chunk.tool_calls) capture.streamToolCalls = cloneJson(chunk.tool_calls);
  });

  api.events.on('generation:finished', async (result, context) => {
    const capture = pending.get(context.generationId);
    if (!capture) return;
    pending.delete(context.generationId);
    if (!isCaptureEnabled(api)) return;

    const response: { content: string; reasoning?: string; images?: string[]; tool_calls?: unknown; error?: string } =
      result.error
        ? { content: '', error: result.error.message }
        : {
            content: capture.streamContent || result.message?.mes || '',
            reasoning: capture.streamReasoning,
            images: capture.streamImages.length > 0 ? capture.streamImages : undefined,
            tool_calls: capture.streamToolCalls,
          };

    try {
      await storage.updateCapture(
        context.generationId,
        {
          response,
          responseText: response.content,
          status: result.error ? 'error' : 'complete',
        },
        getSettings(api).captureStorageLimitBytes,
      );
      refreshMessageButtons();
    } catch (err) {
      console.error('[UsageTracker] Failed to finalize response capture:', err);
    }
  });

  api.events.on('generation:aborted', async (context) => {
    pending.delete(context.generationId);
    if (!isCaptureEnabled(api)) return;
    await storage.updateCapture(context.generationId, { status: 'aborted' }, getSettings(api).captureStorageLimitBytes);
    refreshMessageButtons();
  });

  api.events.on('llm:usage', async (data: LlmUsageData) => {
    try {
      await storage.addLog(data);
    } catch (err) {
      console.error('[UsageTracker] Failed to save log:', err);
    }
  });

  api.ui.registerSidebar(SIDEBAR_ID, markRaw(UsageDashboard), 'right', {
    title: api.i18n.t('extensionsBuiltin.usageTracker.usageStats'),
    icon: 'fa-chart-line',
    props: {
      api,
      storage,
    },
  });

  return () => {
    pending.clear();
  };
}
