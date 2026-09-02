import type { z } from 'zod';

export interface ValidationSuccess<T> {
  valid: true;
  value: T;
  errors: [];
}

export interface ValidationFailure {
  valid: false;
  errors: string[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function issuePath(path: string, parts: ReadonlyArray<PropertyKey>): string {
  return parts.reduce<string>(
    (out, part) => (typeof part === 'number' ? `${out}[${part}]` : `${out}.${String(part)}`),
    path,
  );
}

export function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, path: string): ValidationResult<T> {
  let result: z.ZodSafeParseResult<T>;
  try {
    result = schema.safeParse(value);
  } catch {
    return { valid: false, errors: [`${path} must contain only JSON data`] };
  }
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => `${issuePath(path, issue.path)} ${issue.message}`),
    };
  }
  return { valid: true, value: result.data, errors: [] };
}

export function assertValid<T>(result: ValidationResult<T>): T {
  if (!result.valid) throw new Error(result.errors.join('; '));
  return result.value;
}
