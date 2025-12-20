import { reactive } from 'vue';
import { uuidv4 } from '../utils/commons';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  timeout?: number;
  count: number;
}

export interface ToastOptions {
  timeout?: number;
  preventDuplicates?: boolean;
}

const toasts = reactive<Toast[]>([]);

export function useToastState() {
  return { toasts };
}

function show(type: ToastType, message: string, title?: string, options?: ToastOptions) {
  const timeout = options?.timeout ?? 4000;
  const preventDuplicates = options?.preventDuplicates ?? true;

  if (preventDuplicates) {
    const existingToast = toasts.find((t) => t.type === type && t.message === message && t.title === title);
    if (existingToast) {
      existingToast.count++;
      existingToast.timeout = timeout;
      return;
    }
  }

  const id = uuidv4();
  toasts.push({
    id,
    type,
    message,
    title,
    timeout,
    count: 1,
  });
}

function remove(id: string) {
  const index = toasts.findIndex((t) => t.id === id);
  if (index > -1) {
    toasts.splice(index, 1);
  }
}

export const toast = {
  success: (message: string, title?: string, options?: ToastOptions) => show('success', message, title, options),
  error: (message: string, title?: string, options?: ToastOptions) => show('error', message, title, options),
  info: (message: string, title?: string, options?: ToastOptions) => show('info', message, title, options),
  warning: (message: string, title?: string, options?: ToastOptions) => show('warning', message, title, options),
  remove,
};
