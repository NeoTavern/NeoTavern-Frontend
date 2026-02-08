import { ref } from 'vue';
import type { Character, ExtensionAPI, Persona } from '../../../../types';
import { RewriteService } from '../RewriteService';
import type { RewriteSettings } from '../types';

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
  ) {
    if (!selectedProfile) {
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
        selectedProfile || api.settings.getGlobal('api.selectedConnectionProfile'),
        promptToUse,
        deepToRaw(contextData),
        deepToRaw(additionalMacros),
        argOverrides,
        abortController.value?.signal,
        lastAssistantMessage,
      );

      if (Symbol.asyncIterator in response) {
        let rawAcc = lastAssistantMessage || '';
        for await (const chunk of response) {
          rawAcc += chunk.delta;
          oneShotGeneratedText.value = service.extractCodeBlock(rawAcc);
        }
      } else {
        oneShotGeneratedText.value = service.extractCodeBlock(response.content);
      }
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
