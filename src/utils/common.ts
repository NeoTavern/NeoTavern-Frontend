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
 * A utility class for generating string hash codes. Cryptographically insecure but fast.
 */
export class StringHash {
  /**
   * A fast and simple 64-bit (or 53-bit) string hash function with decent collision resistance.
   * cyrb53 (c) 2018 bryc (github.com/bryc). License: Public domain. Attribution appreciated.
   * Source: https://gist.github.com/jlevy/c246006675becc446360a798e2b2d781
   */
  private static cyrb64(str: string, seed: number = 0): [number, number] {
    let h1 = 0xdeadbeef ^ seed,
      h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return [h1, h2];
  }

  /**
   * Generates a 64-bit hash code as a string. Output is always 14 characters.
   * @param str The string to hash.
   * @param seed The seed to use for the hash.
   * @returns The hash code (as a string).
   */
  static get(str: string, seed: number = 0): string {
    if (typeof str !== 'string') {
      return '0'.repeat(14);
    }

    const [h1, h2] = this.cyrb64(str, seed);

    // Convert to base36 string and pad to ensure fixed length
    return (h2 >>> 0).toString(36).padStart(7, '0') + (h1 >>> 0).toString(36).padStart(7, '0');
  }

  /**
   * Generates a 53-bit numeric hash code (compatible with ST 1.0)
   * @param str The string to hash.
   * @param seed The seed to use for the hash.
   * @returns The hash code (as a number).
   */
  static legacy(str: string, seed: number = 0): number {
    if (typeof str !== 'string') {
      return 0;
    }

    const [h1, h2] = this.cyrb64(str, seed);

    // Return a single number (53-bit)
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
}
