import { mergeWith } from 'lodash-es';

export function onlyUnique<T>(value: T, index: number, self: T[]): boolean {
  return self.indexOf(value) === index;
}

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

  static get(str: string, seed: number = 0): string {
    if (typeof str !== 'string') return '0'.repeat(14);
    const [h1, h2] = this.cyrb64(str, seed);
    return (h2 >>> 0).toString(36).padStart(7, '0') + (h1 >>> 0).toString(36).padStart(7, '0');
  }

  static legacy(str: string, seed: number = 0): number {
    if (typeof str !== 'string') return 0;
    const [h1, h2] = this.cyrb64(str, seed);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
}

// --- Date Utils ---

export function humanizedDateTime() {
  const now = new Date(Date.now());
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return now.toLocaleString(undefined, options);
}

export function getMessageTimeStamp(): string {
  return new Date().toISOString();
}

export function formatTimeStamp(dateString?: string | number): string {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return String(dateString);

  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return (
    `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ` +
    `${d.getHours() % 12 || 12}:${('0' + d.getMinutes()).slice(-2)}${d.getHours() >= 12 ? 'pm' : 'am'}`
  );
}

// --- File Utils ---

export function getBase64Async(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function () {
      resolve(String(reader.result));
    };
    reader.onerror = function (error) {
      reject(error);
    };
  });
}

export function base64EncodeUTF8(str: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const binaryString = Array.from(data, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binaryString);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsText(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

export function formatFileSize(value: number, decimals = 2): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';

  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), FILE_SIZE_UNITS.length - 1);
  const scaled = bytes / 1024 ** unitIndex;
  const decimalPlaces = unitIndex === 0 ? 0 : scaled >= 10 ? 0 : Math.max(0, decimals);
  const formatted =
    decimalPlaces > 0 ? Number(scaled.toFixed(decimalPlaces)).toString() : Math.round(scaled).toString();

  return `${formatted}${FILE_SIZE_UNITS[unitIndex]}`;
}

export function downloadFile(content: string, fileName: string, contentType: string) {
  const a = document.createElement('a');
  const file = new Blob([content], { type: contentType });
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/**
 * A customizer for lodash's mergeWith that allows source values to override destination values.
 * - Arrays are replaced, not merged element-by-element
 * - undefined values from source override destination values
 * - Only plain objects are deeply merged; other types are replaced
 *
 * @param objValue - The value from the object being merged into.
 * @param srcValue - The value from the source object.
 * @param key - The key of the property being merged.
 * @param object - The destination object.
 * @returns The value to use, or undefined to continue with lodash's default behavior.
 */
function customizer(objValue: unknown, srcValue: unknown, key: string | number | symbol, object: object): unknown {
  // Handle undefined: explicitly set it
  if (srcValue === undefined) {
    if (object && typeof object === 'object') {
      (object as Record<string | number | symbol, unknown>)[key] = undefined;
    }
    return undefined;
  }

  // Handle arrays: replace instead of merging element-by-element
  if (Array.isArray(srcValue)) {
    return srcValue;
  }

  // Handle null: replace
  if (srcValue === null) {
    return srcValue;
  }

  // For plain objects, let lodash continue deep merging
  // For everything else (primitives, dates, etc.), replace
  if (typeof srcValue === 'object' && srcValue.constructor === Object) {
    return undefined; // Let lodash handle plain object merging
  }

  // Replace with srcValue for all other types
  return srcValue;
}

/**
 * Deeply merges objects, allowing source values to override destination values.
 * Arrays and primitives are replaced. Only plain objects are deeply merged.
 * @param object - The destination object.
 * @param sources - The source objects.
 * @returns The merged object.
 */
export function mergeWithUndefined<TObject, TSource>(object: TObject, source: TSource): TObject & TSource {
  return mergeWith(object, source, customizer);
}

/**
 * Deeply merges multiple objects, allowing source values to override destination values.
 * Arrays and primitives are replaced. Only plain objects are deeply merged.
 * @param object - The destination object.
 * @param sources - The source objects.
 * @returns The merged object.
 */
export function mergeWithUndefinedMulti<TObject, TSource1, TSource2>(
  object: TObject,
  source1: TSource1,
  source2: TSource2,
): TObject & TSource1 & TSource2;
export function mergeWithUndefinedMulti<TObject, TSource1>(object: TObject, source1: TSource1): TObject & TSource1;
export function mergeWithUndefinedMulti<TObject>(object: TObject, ...sources: unknown[]): TObject {
  return mergeWith(object, ...sources, customizer);
}
