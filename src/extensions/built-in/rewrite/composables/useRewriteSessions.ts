import { computed, ref } from 'vue';
import type { Character, ExtensionAPI, Persona } from '../../../../types';
import { RewriteService } from '../RewriteService';
import type {
  FieldChange,
  RewriteField,
  RewriteLLMResponse,
  RewriteSession,
  RewriteSettings,
  StructuredResponseFormat,
} from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepToRaw<T extends Record<string, any>>(sourceObj: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const objectIterator = (input: any): any => {
    if (Array.isArray(input)) {
      return input.map((item) => objectIterator(item));
    }
    if (input && typeof input === 'object') {
      return Object.keys(input).reduce((acc, key) => {
        acc[key as keyof typeof acc] = objectIterator(input[key]);
        return acc;
      }, {} as T);
    }
    return input;
  };

  return objectIterator(sourceObj);
}

export function useRewriteSessions(api: ExtensionAPI<RewriteSettings>) {
  const service = new RewriteService(api);

  const sessions = ref<RewriteSession[]>([]);
  const activeSession = ref<RewriteSession | null>(null);
  const isGenerating = ref<boolean>(false);
  const abortController = ref<AbortController | null>(null);

  const latestSessionChanges = computed((): FieldChange[] => {
    if (!activeSession.value || activeSession.value.messages.length === 0) return [];

    const messages = activeSession.value.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;

      const content = msg.content as RewriteLLMResponse;
      if (!content) continue;

      const initialFieldsMap = new Map(activeSession.value.initialFields.map((f) => [f.id, f]));

      // Handle multi-field changes
      if (content.changes && content.changes.length > 0) {
        return content.changes.map((change) => {
          const initialField = initialFieldsMap.get(change.fieldId);
          return {
            ...change,
            label: initialField?.label || change.fieldId,
            oldValue: initialField?.value || '',
          };
        });
      }

      // Handle single-field response (backward compatibility)
      if (content.response) {
        const primaryField = activeSession.value.initialFields[0];
        if (primaryField) {
          return [
            {
              fieldId: primaryField.id,
              label: primaryField.label,
              oldValue: primaryField.value,
              newValue: content.response,
            },
          ];
        }
      }
    }
    return [];
  });

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
  ) {
    if (!activeSession.value || !selectedProfile) return;

    isGenerating.value = true;
    abortController.value = new AbortController();

    // Add User Message
    activeSession.value.messages.push({
      id: api.uuid(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });
    await service.saveSession(deepToRaw(activeSession.value));

    await executeSessionGeneration(selectedProfile, structuredResponseFormat, availableFields, t);
  }

  async function executeSessionGeneration(
    selectedProfile: string,
    structuredResponseFormat: StructuredResponseFormat,
    availableFields: RewriteField[],
    t: (key: string) => string,
  ) {
    if (!activeSession.value || !selectedProfile) return;

    try {
      const response = await service.generateSessionResponse(
        activeSession.value.messages,
        structuredResponseFormat,
        deepToRaw(availableFields),
        selectedProfile || api.settings.getGlobal('api.selectedConnectionProfile'),
        abortController.value?.signal,
      );

      activeSession.value.messages.push({
        id: api.uuid(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      });

      await service.saveSession(deepToRaw(activeSession.value));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(error);
      if (error?.name === 'AbortError') {
        api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationAborted'), 'info');
      } else {
        api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationFailed') + ': ' + error.message, 'error');
      }
    } finally {
      isGenerating.value = false;
      abortController.value = null;
    }
  }

  async function handleSessionDeleteFrom(msgId: string) {
    if (!activeSession.value) return;
    const index = activeSession.value.messages.findIndex((m) => m.id === msgId);
    if (index !== -1) {
      activeSession.value.messages = activeSession.value.messages.slice(0, index);
      await service.saveSession(deepToRaw(activeSession.value));
    }
  }

  async function handleEditMessage(msgId: string, newContent: string) {
    if (!activeSession.value) return;
    const msg = activeSession.value.messages.find((m) => m.id === msgId);
    if (msg) {
      msg.content = newContent;
      await service.saveSession(deepToRaw(activeSession.value));
    }
  }

  async function handleRegenerate(
    selectedProfile: string,
    structuredResponseFormat: StructuredResponseFormat,
    availableFields: RewriteField[],
    t: (key: string) => string,
  ) {
    if (!activeSession.value) return;

    const lastMsg = activeSession.value.messages[activeSession.value.messages.length - 1];
    if (!lastMsg) return;

    if (lastMsg.role === 'assistant') {
      // Remove last assistant message
      activeSession.value.messages.pop();
      await service.saveSession(deepToRaw(activeSession.value));
    }

    // Generate
    isGenerating.value = true;
    abortController.value = new AbortController();
    await executeSessionGeneration(selectedProfile, structuredResponseFormat, availableFields, t);
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
