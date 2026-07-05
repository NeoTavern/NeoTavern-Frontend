import { describe, expect, it } from 'vitest';
import { getModelCapabilities } from '../src/api/provider-definitions';
import { api_providers } from '../src/types';

describe('getModelCapabilities', () => {
  it('does not enable media for custom providers without explicit model metadata', () => {
    const capabilities = getModelCapabilities(api_providers.CUSTOM, 'local-text-model');

    expect(capabilities.vision).toBe(false);
    expect(capabilities.video).toBe(false);
    expect(capabilities.audio).toBe(false);
  });

  it('enables custom provider media from explicit model metadata', () => {
    const capabilities = getModelCapabilities(api_providers.CUSTOM, 'local-vision-model', [
      {
        id: 'local-vision-model',
        architecture: { input_modalities: ['text', 'image', 'audio', 'video'] },
      },
    ]);

    expect(capabilities.vision).toBe(true);
    expect(capabilities.video).toBe(true);
    expect(capabilities.audio).toBe(true);
  });
});
