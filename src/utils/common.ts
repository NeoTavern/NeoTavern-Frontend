export function uuidv4() {
  if ('randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns a promise that resolves after the specified number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
