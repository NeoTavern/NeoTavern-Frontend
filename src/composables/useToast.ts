import { createVNode, reactive, render, type App } from 'vue';
import ToastContainer from '../components/Toast/ToastContainer.vue';
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
let isInitialized = false;
let mainAppContext: App | null = null;

export function setToastContext(app: App) {
  mainAppContext = app;
}

function init() {
  if (isInitialized) return;
  const container = document.createElement('div');
  document.body.appendChild(container);

  const vnode = createVNode(ToastContainer, { toasts });

  if (mainAppContext) {
    vnode.appContext = mainAppContext._context;
  }

  render(vnode, container);
  isInitialized = true;
}

function show(type: ToastType, message: string, title?: string, options?: ToastOptions) {
  init();

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
