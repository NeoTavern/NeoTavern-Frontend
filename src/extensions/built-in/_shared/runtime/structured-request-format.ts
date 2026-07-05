import type { StructuredResponseOptions } from '../../../../types/generation';

export type StructuredRequestFormat = 'native' | 'json' | 'xml';

export interface StructuredRequestFormatLabels {
  native: string;
  json: string;
  xml: string;
}

export function createStructuredRequestFormatOptions(labels: StructuredRequestFormatLabels) {
  return [
    { label: labels.native, value: 'native' },
    { label: labels.json, value: 'json' },
    { label: labels.xml, value: 'xml' },
  ] satisfies Array<{ label: string; value: StructuredRequestFormat }>;
}

export function createStructuredResponse(
  format: StructuredRequestFormat,
  schema: { name: string; value: unknown; strict?: boolean },
): StructuredResponseOptions {
  return {
    format,
    schema: {
      name: schema.name,
      strict: schema.strict ?? true,
      value: schema.value,
    },
  };
}
