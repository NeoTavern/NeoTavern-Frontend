export type ToastType = 'success' | 'error' | 'info' | 'warning';
export type ToastPosition =
  | 'toast-top-left'
  | 'toast-top-center'
  | 'toast-top-right'
  | 'toast-bottom-left'
  | 'toast-bottom-center'
  | 'toast-bottom-right';

export interface ToastOptions {
  title?: string;
  positionClass?: ToastPosition;
  closeButton?: boolean;
  showDuration?: number;
  hideDuration?: number;
  timeOut?: number;
  extendedTimeOut?: number;
  escapeHtml?: boolean;
  onHidden?: () => void;
  onShown?: () => void;
  preventDuplicates?: boolean;
}

const defaultOptions: Omit<Required<ToastOptions>, 'title'> = {
  positionClass: 'toast-top-center',
  closeButton: false,
  showDuration: 250,
  hideDuration: 250,
  timeOut: 4000,
  extendedTimeOut: 10000,
  escapeHtml: true,
  onHidden: () => {},
  onShown: () => {},
  preventDuplicates: true,
};

let currentOptions: Omit<Required<ToastOptions>, 'title'> = { ...defaultOptions };

/**
 * Gets the current toast container or creates a new one.
 * It intelligently places the container in the body or the top-most open dialog.
 */
function getOrCreateToastContainer(): HTMLElement {
  let toastContainer = document.getElementById('toast-container');

  const openDialog = Array.from(document.querySelectorAll('dialog[open]:not([closing])')).pop();
  const parent = openDialog ?? document.body;

  if (toastContainer) {
    if (!toastContainer.classList.contains(currentOptions.positionClass)) {
      toastContainer.className = '';
      toastContainer.classList.add(currentOptions.positionClass);
    }
    if (toastContainer.parentElement !== parent) {
      parent.appendChild(toastContainer);
    }
    return toastContainer;
  }

  toastContainer = document.createElement('div');
  toastContainer.setAttribute('id', 'toast-container');
  toastContainer.classList.add(currentOptions.positionClass);
  parent.appendChild(toastContainer);
  return toastContainer;
}

function showToast(type: ToastType, message: string, options: ToastOptions) {
  const mergedOptions = { ...currentOptions, ...options };
  const container = getOrCreateToastContainer();

  if (mergedOptions.preventDuplicates) {
    const existingToasts = container.querySelectorAll('.toast');
    for (const existingToast of Array.from(existingToasts)) {
      const existingMessageEl = existingToast.querySelector('.toast-message');
      const existingTitleEl = existingToast.querySelector('.toast-title');

      const existingMessage = existingMessageEl?.textContent ?? '';
      if (existingMessage !== message) continue;

      if (mergedOptions.title) {
        const existingTitle = existingTitleEl?.textContent ?? '';
        if (existingTitle === mergedOptions.title) return;
      } else if (!existingTitleEl) {
        return;
      }
    }
  }

  const toastElement = document.createElement('div');
  toastElement.classList.add('toast', `toast-${type}`);

  if (mergedOptions.title) {
    const titleElement = document.createElement('div');
    titleElement.classList.add('toast-title');
    titleElement.textContent = mergedOptions.title;
    toastElement.appendChild(titleElement);
  }

  const messageElement = document.createElement('div');
  messageElement.classList.add('toast-message');
  if (mergedOptions.escapeHtml) {
    messageElement.textContent = message;
  } else {
    messageElement.innerHTML = message;
  }
  toastElement.appendChild(messageElement);

  if (mergedOptions.closeButton) {
    const closeElement = document.createElement('button');
    closeElement.type = 'button';
    closeElement.classList.add('toast-close-button');
    closeElement.setAttribute('role', 'button');
    closeElement.innerHTML = '&times;';
    closeElement.onclick = () => hideToast(toastElement, mergedOptions);
    toastElement.appendChild(closeElement);
  }

  let hideTimeout: number;
  const hide = () => hideToast(toastElement, mergedOptions);

  if (mergedOptions.timeOut > 0) {
    hideTimeout = window.setTimeout(hide, mergedOptions.timeOut);
  }

  toastElement.onmouseover = () => {
    clearTimeout(hideTimeout);
  };

  toastElement.onmouseout = () => {
    if (mergedOptions.extendedTimeOut > 0) {
      hideTimeout = window.setTimeout(hide, mergedOptions.extendedTimeOut);
    }
  };

  container.prepend(toastElement);

  requestAnimationFrame(() => {
    toastElement.classList.add('show');
  });

  mergedOptions.onShown();
}

function hideToast(toastElement: HTMLElement, options: Omit<Required<ToastOptions>, 'title'> & { title?: string }) {
  toastElement.classList.remove('show');

  setTimeout(() => {
    toastElement.remove();
    const container = document.getElementById('toast-container');
    if (container && container.children.length === 0) {
      container.remove();
    }
    options.onHidden();
  }, options.hideDuration);
}

function notify(type: ToastType, message: string, title?: string, overrideOptions?: ToastOptions) {
  showToast(type, message, { ...overrideOptions, title });
}

export const Toast = {
  success: (message: string, title?: string, options?: ToastOptions) => notify('success', message, title, options),
  error: (message: string, title?: string, options?: ToastOptions) => notify('error', message, title, options),
  info: (message: string, title?: string, options?: ToastOptions) => notify('info', message, title, options),
  warning: (message: string, title?: string, options?: ToastOptions) => notify('warning', message, title, options),

  options: (newOptions: ToastOptions) => {
    currentOptions = { ...defaultOptions, ...newOptions };
  },
};
