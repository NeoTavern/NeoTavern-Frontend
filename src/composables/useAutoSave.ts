import { debounce } from 'lodash-es';
import { onUnmounted, ref } from 'vue';
import { toast } from './useToast';

interface AutoSaveOptions {
  timeout?: number;
  onSave?: () => void;
  onError?: (error: unknown) => void;
  successMessage?: string;
  errorMessage?: string;
}

export function useAutoSave<T>(saveFn: (data: T) => Promise<void>, options: AutoSaveOptions = {}) {
  const { timeout = 1000, errorMessage = 'Failed to save changes', onSave, onError } = options;

  const isSaving = ref(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trigger = debounce(async (data?: any) => {
    isSaving.value = true;
    try {
      await saveFn(data);
      if (onSave) onSave();
    } catch (error) {
      console.error(error);
      toast.error(errorMessage);
      if (onError) onError(error);
    } finally {
      isSaving.value = false;
    }
  }, timeout);

  // Cancel pending saves on unmount to prevent trying to save destroyed data
  onUnmounted(() => {
    trigger.cancel();
  });

  return {
    trigger,
    isSaving,
    cancel: trigger.cancel,
    flush: trigger.flush,
  };
}
