const forbiddenSegments = new Set(['__proto__', 'prototype', 'constructor']);
const namedSegment = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const indexSegment = /^(0|[1-9][0-9]*)$/;

export function isSafePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path
      .split('.')
      .every((part) => (namedSegment.test(part) || indexSegment.test(part)) && !forbiddenSegments.has(part))
  );
}
