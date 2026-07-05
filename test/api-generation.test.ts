import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatCompletionService,
  buildChatCompletionPayload,
  processMessagesWithPrefill,
  resolveConnectionProfileSettings,
} from '../src/api/generation';
import { CustomPromptPostProcessing, defaultSamplerSettings } from '../src/constants';
import { useAuthStore } from '../src/stores/auth.store';
import { useApiStore } from '../src/stores/api.store';
import { useSettingsStore } from '../src/stores/settings.store';
import { api_providers } from '../src/types';
import type { ApiChatMessage, ChatCompletionPayload } from '../src/types/generation';
import type { Settings } from '../src/types/settings';

vi.mock('../src/composables/useStrictI18n', () => ({
  useStrictI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('processMessagesWithPrefill', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().token = 'test-token';
  });

  it('preserves a named assistant prefill after single-message post-processing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ role: 'user', content: 'merged prompt', name: 'User' }] }), {
        status: 200,
      }),
    );

    const messages: ApiChatMessage[] = [
      { role: 'system', content: 'System prompt', name: 'System' },
      { role: 'user', content: 'Hello', name: 'User' },
      { role: 'assistant', content: 'Eli: ', name: 'Eli' },
    ];

    const result = await processMessagesWithPrefill(messages, CustomPromptPostProcessing.SINGLE);

    expect(result).toEqual([
      { role: 'user', content: 'merged prompt', name: 'User' },
      { role: 'assistant', content: 'Eli: ', name: 'Eli' },
    ]);

    const request = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(request.messages).toEqual(messages.slice(0, -1));
  });

  it('preserves impersonate starter text as assistant prefill', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ role: 'user', content: 'merged prompt', name: 'User' }] }), {
        status: 200,
      }),
    );

    const result = await processMessagesWithPrefill(
      [
        { role: 'user', content: 'Hello', name: 'User' },
        { role: 'assistant', content: 'Eli: I think', name: 'Eli' },
      ],
      CustomPromptPostProcessing.SINGLE,
    );

    expect(result.at(-1)).toEqual({ role: 'assistant', content: 'Eli: I think', name: 'Eli' });
  });

  it('preserves leading whitespace in the first streamed prefill chunk', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
          'data: {"choices":[{"delta":{"content":" \\""},"finish_reason":null}]}',
          'data: {"choices":[{"delta":{"content":"Local"},"finish_reason":null}]}',
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { status: 200 },
      ),
    );

    const response = await ChatCompletionService.generate(
      {
        model: 'deepseek-v4-flash',
        chat_completion_source: 'deepseek',
        stream: true,
        messages: [{ role: 'assistant', content: 'Joe: The name of the book is', name: 'Joe' }],
      } as ChatCompletionPayload,
      'chat',
      { isContinuation: true },
    );

    let generated = '';
    if (Symbol.asyncIterator in response) {
      for await (const chunk of response) {
        generated += chunk.delta ?? '';
      }
    }

    expect(generated).toBe(' "Local');
  });

  it('uses status text for non-json streaming errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
      }),
    );

    await expect(
      ChatCompletionService.generate(
        {
          model: 'gpt-test',
          chat_completion_source: 'openai',
          stream: true,
          messages: [{ role: 'user', content: 'Hello', name: 'User' }],
        } as ChatCompletionPayload,
        'chat',
      ),
    ).rejects.toThrow('Service Unavailable');
  });

  it('removes media parts when building a payload for a text-only provider', () => {
    const payload = buildChatCompletionPayload({
      messages: [
        {
          role: 'user',
          name: 'User',
          content: [
            { type: 'text', text: 'describe this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'low' } },
          ],
        },
      ],
      model: 'deepseek-reasoner',
      provider: api_providers.DEEPSEEK,
      providerSpecific: {} as Settings['api']['providerSpecific'],
      samplerSettings: defaultSamplerSettings,
      customPromptPostProcessing: CustomPromptPostProcessing.NONE,
      formatter: 'chat',
    });

    expect(payload.messages?.[0].content).toEqual([{ type: 'text', text: 'describe this' }]);
  });

  it('resolves sampler preset name from the selected connection profile', async () => {
    const settingsStore = useSettingsStore();
    const apiStore = useApiStore();
    const creativeSampler = { ...defaultSamplerSettings, temperature: 1.3 };

    settingsStore.settings.api.provider = api_providers.OPENAI;
    settingsStore.settings.api.selectedProviderModels.openai = 'gpt-test';
    settingsStore.settings.api.selectedSampler = 'Default';
    settingsStore.settings.api.connectionProfiles = [
      {
        id: 'profile-1',
        name: 'Roleplay Profile',
        provider: api_providers.OPENAI,
        model: 'gpt-profile',
        sampler: 'Creative',
      },
    ];
    apiStore.presets = [{ name: 'Creative', preset: creativeSampler }];

    const resolved = await resolveConnectionProfileSettings({ profile: 'profile-1' });

    expect(resolved.samplerPresetName).toBe('Creative');
    expect(resolved.samplerSettings.temperature).toBe(1.3);
    expect(resolved.model).toBe('gpt-profile');
  });
});
