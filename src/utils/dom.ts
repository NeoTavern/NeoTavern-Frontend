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
 * Run an action once an animation on a control ends. If the control has no animation, the action will be executed immediately.
 * The action will be executed after the animation ends or after the timeout, whichever comes first.
 * @param {HTMLElement} control - The control element to listen for animation end event
 * @param {(control:*?) => void} callback - The callback function to be executed when the animation ends
 * @param {number} [timeout=500] - The timeout in milliseconds to wait for the animation to end before executing the callback
 */
export function runAfterAnimation(control: HTMLElement, callback: (control: HTMLElement) => void, timeout = 500) {
  if (hasAnimation(control)) {
    Promise.race([
      new Promise((r) => setTimeout(r, timeout)), // Fallback timeout
      new Promise((r) => control.addEventListener('animationend', r, { once: true })),
    ]).finally(() => callback(control));
  } else {
    callback(control);
  }
}
