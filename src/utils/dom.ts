/**
 * Checks if the given control has an animation applied to it
 *
 * @param {HTMLElement} control - The control element to check for animation
 * @returns {boolean} Whether the control has an animation applied
 */
export function hasAnimation(control: HTMLElement): boolean {
  // @ts-ignore
  const animationName = getComputedStyle(control, null)['animation-name'];
  return animationName != 'none';
}

/**
 * Sanitizes a string to be used as a DOM selector.
 * Replaces characters that are not alphanumeric, underscore, or hyphen with an underscore.
 * @param {string} selector - The string to sanitize.
 * @returns {string} - The sanitized selector.
 */
export function sanitizeSelector(selector: string): string {
  if (!selector) {
    return '';
  }
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
