/// <reference types="node" />

// wtf TypeScript. https://stackoverflow.com/a/70887388
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  if (!(error instanceof Error)) return false;
  const err = error as unknown as { [key: string]: unknown };
  return (
    (typeof err.errno === 'number' || typeof err.errno === 'undefined') &&
    (typeof err.code === 'string' || typeof err.code === 'undefined') &&
    (typeof err.path === 'string' || typeof err.path === 'undefined') &&
    (typeof err.syscall === 'string' || typeof err.syscall === 'undefined')
  );
}
