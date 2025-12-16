import Bowser from 'bowser';
import { useAuthStore } from '../stores/auth.store';

// --- API Utils ---

export function getRequestHeaders({ omitContentType = false } = {}) {
  // Pinia stores must be instantiated within the function call
  const authStore = useAuthStore();
  const tokenValue = authStore.token;

  if (!tokenValue) {
    throw new Error('CSRF token is not set');
  }

  const headers: {
    'Content-Type'?: string;
    'X-CSRF-Token': string;
  } = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': tokenValue,
  };

  if (omitContentType) {
    delete headers['Content-Type'];
  }

  return headers;
}

// --- Browser Utils ---

let parsedUA: Bowser.Parser.ParsedResult | null = null;

export function getParsedUA() {
  if (!parsedUA) {
    try {
      parsedUA = Bowser.parse(navigator.userAgent);
    } catch {
      // Handle empty or invalid UA
    }
  }
  return parsedUA;
}

export function isDeviceMobile() {
  const mobileTypes = ['mobile', 'tablet'];
  const result = getParsedUA();
  if (!result || !result.platform || !result.platform.type) {
    return false;
  }
  return mobileTypes.includes(result.platform.type);
}

/**
 * Check if the current viewport width is considered "mobile".
 */
export function isViewportMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

// --- DOM Utils ---

/**
 * Sanitizes a string to be used as a DOM selector.
 */
export function sanitizeSelector(selector: string): string {
  if (!selector) return '';
  return selector.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export const slideTransitionHooks = {
  beforeEnter(el: Element) {
    if (!(el instanceof HTMLElement)) return;
    el.style.height = '0';
    el.style.opacity = '0';
    el.style.overflow = 'hidden';
  },
  enter(el: Element) {
    if (!(el instanceof HTMLElement)) return;
    el.getBoundingClientRect(); // Force repaint
    requestAnimationFrame(() => {
      el.style.height = `${el.scrollHeight}px`;
      el.style.opacity = '1';
    });
  },
  afterEnter(el: Element) {
    if (!(el instanceof HTMLElement)) return;
    el.style.height = '';
  },
  beforeLeave(el: Element) {
    if (!(el instanceof HTMLElement)) return;
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflow = 'hidden';
  },
  leave(el: Element) {
    if (!(el instanceof HTMLElement)) return;
    el.getBoundingClientRect(); // Force repaint
    requestAnimationFrame(() => {
      el.style.height = '0';
      el.style.opacity = '0';
    });
  },
  afterLeave(el: Element) {
    if (!(el instanceof HTMLElement)) return;
    el.style.height = '';
    el.style.opacity = '0';
  },
};
