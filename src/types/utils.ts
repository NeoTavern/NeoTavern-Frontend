// This type generates all possible dot-notation paths for a given object type T.
// For example, for { a: { b: string } }, it will generate "a" | "a.b".
export type Path<T> = T extends object
  ? {
      [K in Exclude<keyof T, symbol>]: `${K}` | `${K}.${Path<T[K]>}`;
    }[Exclude<keyof T, symbol>]
  : never;

// This type looks up the value type in T at a given path P.
// For example, for T = { a: { b: string } } and P = "a.b", it will resolve to string.
export type ValueForPath<T, P extends string> = P extends `${infer K}.${infer R}`
  ? K extends keyof T
    ? ValueForPath<T[K], R>
    : never
  : P extends keyof T
    ? T[P]
    : never;

// DeepPartial makes all properties optional recursively
export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;
