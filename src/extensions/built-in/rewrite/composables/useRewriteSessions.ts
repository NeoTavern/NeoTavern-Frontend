import { computed, ref } from 'vue';
import { ToolService } from '../../../../services/tool.service';
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
    const initialFieldsMap = new Map(activeSession.value.initialFields.map((f) => [f.id, f]));

    // Build the final state by applying changes from ALL assistant messages in order
    const finalState = new Map<string, string>();
    activeSession.value.initialFields.forEach((field) => {
      finalState.set(field.id, field.value);
    });

    // Track which fields have been changed and their old values
    const fieldChanges = new Map<string, { oldValue: string; newValue: string }>();

    // Initialize old values from initial fields
    activeSession.value.initialFields.forEach((field) => {
      fieldChanges.set(field.id, { oldValue: field.value, newValue: field.value });
    });

    // Apply changes from all assistant messages in chronological order
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;

      const msgContent = msg.content as RewriteLLMResponse;
      if (!msgContent) continue;

      // Handle multi-field changes
      if (msgContent.changes && msgContent.changes.length > 0) {
        msgContent.changes.forEach((change) => {
          // Store the current value as oldValue if this is the first time we see this field change
          if (!fieldChanges.has(change.fieldId)) {
            fieldChanges.set(change.fieldId, {
              oldValue: finalState.get(change.fieldId) || '',
              newValue: change.newValue,
            });
          } else {
            const existing = fieldChanges.get(change.fieldId)!;
            // Only update oldValue if it still points to initial value
            if (existing.newValue === existing.oldValue) {
              existing.oldValue = finalState.get(change.fieldId) || '';
            }
            existing.newValue = change.newValue;
          }
          finalState.set(change.fieldId, change.newValue);
        });
      }

      // Handle single-field response (backward compatibility)
      if (msgContent.response) {
        const primaryField = activeSession.value.initialFields[0];
        if (primaryField) {
          const fieldId = primaryField.id;
          if (!fieldChanges.has(fieldId)) {
            fieldChanges.set(fieldId, { oldValue: finalState.get(fieldId) || '', newValue: msgContent.response });
          } else {
            const existing = fieldChanges.get(fieldId)!;
            if (existing.newValue === existing.oldValue) {
              existing.oldValue = finalState.get(fieldId) || '';
            }
            existing.newValue = msgContent.response;
          }
          finalState.set(fieldId, msgContent.response);
        }
      }
    }

    // Convert to FieldChange array, only including fields that actually changed
    const result: FieldChange[] = [];
    fieldChanges.forEach((value, fieldId) => {
      if (value.oldValue !== value.newValue) {
        const initialField = initialFieldsMap.get(fieldId);
        result.push({
          fieldId,
          label: initialField?.label || fieldId,
          oldValue: value.oldValue,
          newValue: value.newValue,
        });
      }
    });

    return result;
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

    let iterations = 0;
    const maxIterations = 3;

    while (iterations < maxIterations) {
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
            activeSession.value.messages.push({
              id: api.uuid(),
              role: 'tool',
              content: inv.result,
              timestamp: Date.now(),
            });
          }
          for (const error of errors) {
            activeSession.value.messages.push({
              id: api.uuid(),
              role: 'tool',
              content: error.message,
              timestamp: Date.now(),
            });
          }

          await service.saveSession(deepToRaw(activeSession.value));
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

    isGenerating.value = false;
    abortController.value = null;
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
