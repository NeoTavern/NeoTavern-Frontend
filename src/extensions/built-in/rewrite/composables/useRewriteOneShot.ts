import { ref } from 'vue';
import type { Character, ExtensionAPI, Persona } from '../../../../types';
import { resolveConnectionProfile } from '../../_shared/runtime/connection-profile';
import { RewriteService } from '../RewriteService';
import type { RewriteSettings } from '../types';
import { deepToRaw } from '../utils';
import { collectResponseText } from '../../_shared/runtime/llm-text';

export function useRewriteOneShot(api: ExtensionAPI<RewriteSettings>) {
  const service = new RewriteService(api);

  const oneShotGeneratedText = ref<string>('');
  const isGenerating = ref<boolean>(false);
  const abortController = ref<AbortController | null>(null);

  function handleAbort() {
    if (abortController.value) {
      abortController.value.abort();
      abortController.value = null;
    }
  }

  async function handleGenerateOneShot(
    originalText: string,
    selectedTemplateId: string,
    selectedProfile: string,
    promptOverride: string,
    contextData: { activeCharacter?: Character; persona?: Persona },
    additionalMacros: Record<string, unknown>,
    argOverrides: Record<string, boolean | number | string>,
    escapeMacros: boolean,
    t: (key: string) => string,
    lastAssistantMessage?: string,
    referenceMessageIndex?: number,
  ) {
    const connectionProfile = resolveConnectionProfile(api, selectedProfile);
    if (!connectionProfile) {
      api.ui.showToast(t('extensionsBuiltin.rewrite.errors.selectProfile'), 'error');
      return;
    }
    isGenerating.value = true;
    abortController.value = new AbortController();
    oneShotGeneratedText.value = lastAssistantMessage || '';

    try {
      let inputToProcess = originalText;
      let promptToUse = promptOverride;
      if (escapeMacros) {
        inputToProcess = `{{#raw}}${originalText}{{/raw}}`;
        promptToUse = `{{#raw}}${promptOverride}{{/raw}}`;
      }

      const response = await service.generateRewrite(
        inputToProcess,
        selectedTemplateId,
        connectionProfile,
        promptToUse,
        deepToRaw(contextData),
        deepToRaw(additionalMacros),
        argOverrides,
        abortController.value?.signal,
        lastAssistantMessage,
        referenceMessageIndex,
      );

      await collectResponseText(response, {
        prefix: Symbol.asyncIterator in response ? lastAssistantMessage || '' : '',
        onText: (text) => (oneShotGeneratedText.value = service.extractCodeBlock(text)),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(error);
      if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
        api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationAborted'), 'info');
      } else {
        api.ui.showToast(t('extensionsBuiltin.rewrite.messages.generationFailed') + ': ' + error.message, 'error');
      }
    } finally {
      isGenerating.value = false;
      abortController.value = null;
    }
  }

  function handleCopyOutput(t: (key: string) => string) {
    if (!oneShotGeneratedText.value) return;
    navigator.clipboard.writeText(oneShotGeneratedText.value).then(
      () => api.ui.showToast(t('extensionsBuiltin.rewrite.messages.copiedToClipboard'), 'success'),
      () => api.ui.showToast(t('extensionsBuiltin.rewrite.messages.copyFailed'), 'error'),
    );
  }

  return {
    oneShotGeneratedText,
    isGenerating,
    abortController,
    handleAbort,
    handleGenerateOneShot,
    handleCopyOutput,
  };
}
