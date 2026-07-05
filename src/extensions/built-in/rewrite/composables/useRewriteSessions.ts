import { computed, ref } from 'vue';
import { ToolService } from '../../../../services/tool.service';
import type { Character, ExtensionAPI, Persona } from '../../../../types';
import { resolveConnectionProfile } from '../../_shared/runtime/connection-profile';
import { RewriteService } from '../RewriteService';
import type {
  RewriteField,
  RewriteSession,
  RewriteSessionMessage,
  RewriteSettings,
  StructuredResponseFormat,
} from '../types';
import { deepToRaw, getLatestSessionChanges } from '../utils';

export function useRewriteSessions(api: ExtensionAPI<RewriteSettings>) {
  const service = new RewriteService(api);

  const sessions = ref<RewriteSession[]>([]);
  const activeSession = ref<RewriteSession | null>(null);
  const isGenerating = ref<boolean>(false);
  const abortController = ref<AbortController | null>(null);

  const latestSessionChanges = computed(() => getLatestSessionChanges(activeSession.value));

  async function saveActiveSession() {
    if (!activeSession.value) return;
    await service.saveSession(deepToRaw(activeSession.value));
  }

  function appendActiveSessionMessage(message: Omit<RewriteSessionMessage, 'id' | 'timestamp'>) {
    if (!activeSession.value) return;

    activeSession.value.messages.push({
      id: api.uuid(),
      timestamp: Date.now(),
      ...message,
    });
  }

  function beginGeneration() {
    isGenerating.value = true;
    abortController.value = new AbortController();
  }

  function endGeneration() {
    isGenerating.value = false;
    abortController.value = null;
  }

  async function refreshSessions(identifier: string) {
    sessions.value = await service.getSessions(identifier);
  }

  async function handleNewSession(
    selectedTemplateId: string,
    identifier: string,
    initialFields: RewriteField[],
    contextData: { activeCharacter?: Character; persona?: Persona },
    additionalMacros: Record<string, unknown>,
    argOverrides: Record<string, boolean | number | string>,
    t: (key: string) => string,
  ) {
    try {
      activeSession.value = await service.createSession(
        selectedTemplateId,
        identifier,
        deepToRaw(initialFields),
        deepToRaw(contextData),
        deepToRaw(additionalMacros),
        argOverrides,
      );
      await refreshSessions(identifier);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      console.error(e);
      api.ui.showToast(t('extensionsBuiltin.rewrite.session.createFailed') + ': ' + e.message, 'error');
    }
  }

  async function handleLoadSession(id: string) {
    activeSession.value = await service.getSession(id);
  }

  async function handleDeleteSession(id: string, identifier: string) {
    await service.deleteSession(id);
    if (activeSession.value?.id === id) {
      activeSession.value = null;
    }
    await refreshSessions(identifier);
  }

  async function handleClearAllSessions() {
    await service.clearAllSessions();
    activeSession.value = null;
    sessions.value = [];
  }

  async function handleSessionSend(
    text: string,
    selectedProfile: string,
    structuredResponseFormat: StructuredResponseFormat,
    availableFields: RewriteField[],
    t: (key: string) => string,
    referenceMessageIndex?: number,
  ) {
    if (!activeSession.value || !selectedProfile) return;

    beginGeneration();

    appendActiveSessionMessage({
      role: 'user',
      content: text,
    });
    await saveActiveSession();

    await executeSessionGeneration(
      selectedProfile,
      structuredResponseFormat,
      availableFields,
      t,
      referenceMessageIndex,
    );
  }

  async function executeSessionGeneration(
    selectedProfile: string,
    structuredResponseFormat: StructuredResponseFormat,
    availableFields: RewriteField[],
    t: (key: string) => string,
    referenceMessageIndex?: number,
  ) {
    if (!activeSession.value || !selectedProfile) return;

    let iterations = 0;
    const maxIterations = 3;

    while (iterations < maxIterations) {
      try {
        const response = await service.generateSessionResponse(
          activeSession.value.messages,
          structuredResponseFormat,
          deepToRaw(availableFields),
          resolveConnectionProfile(api, selectedProfile),
          abortController.value?.signal,
          referenceMessageIndex,
        );

        appendActiveSessionMessage({
          role: 'assistant',
          content: response,
        });

        await saveActiveSession();

        if (response.toolCalls && response.toolCalls.length > 0) {
          const disabledTools = api.settings.get().disabledTools || [];
          const fakeToolCalls = response.toolCalls
            .filter((tc) => !disabledTools.includes(tc.name))
            .map((tc) => ({
              id: api.uuid(),
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: tc.arguments,
              },
            }));
          const { invocations, errors } = await ToolService.processToolCalls(fakeToolCalls);

          if (errors.length > 0) {
            console.warn('Tool call errors:', errors);
          }

          for (const inv of invocations) {
            appendActiveSessionMessage({
              role: 'tool',
              content: inv.result,
            });
          }
          for (const error of errors) {
            appendActiveSessionMessage({
              role: 'tool',
              content: error.message,
            });
          }

          await saveActiveSession();
          iterations++;
        } else {
          break;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        console.error(error);
        if (error?.name === 'AbortError') {
          api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationAborted'), 'info');
        } else {
          api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationFailed') + ': ' + error.message, 'error');
        }
        break;
      }
    }

    endGeneration();
  }

  async function handleSessionDeleteFrom(msgId: string) {
    if (!activeSession.value) return;
    const index = activeSession.value.messages.findIndex((m) => m.id === msgId);
    if (index !== -1) {
      activeSession.value.messages = activeSession.value.messages.slice(0, index);
      await saveActiveSession();
    }
  }

  async function handleEditMessage(msgId: string, newContent: string) {
    if (!activeSession.value) return;
    const msg = activeSession.value.messages.find((m) => m.id === msgId);
    if (msg) {
      msg.content = newContent;
      await saveActiveSession();
    }
  }

  async function handleRegenerate(
    selectedProfile: string,
    structuredResponseFormat: StructuredResponseFormat,
    availableFields: RewriteField[],
    t: (key: string) => string,
    referenceMessageIndex?: number,
  ) {
    if (!activeSession.value) return;

    const lastMsg = activeSession.value.messages[activeSession.value.messages.length - 1];
    if (!lastMsg) return;

    if (lastMsg.role === 'assistant') {
      // Remove last assistant message
      activeSession.value.messages.pop();
      await saveActiveSession();
    }

    beginGeneration();
    await executeSessionGeneration(
      selectedProfile,
      structuredResponseFormat,
      availableFields,
      t,
      referenceMessageIndex,
    );
  }

  function handleAbort() {
    if (abortController.value) {
      abortController.value.abort();
      abortController.value = null;
    }
  }

  return {
    sessions,
    activeSession,
    isGenerating,
    abortController,
    latestSessionChanges,
    refreshSessions,
    handleNewSession,
    handleLoadSession,
    handleDeleteSession,
    handleClearAllSessions,
    handleSessionSend,
    handleSessionDeleteFrom,
    handleEditMessage,
    handleRegenerate,
    handleAbort,
  };
}
