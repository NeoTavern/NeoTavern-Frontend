import { describe, expect, it } from 'vitest';
import { migrateLegacyOaiPreset } from '../src/services/settings-migration.service';

describe('SillyTavern prompt depth migration', () => {
  it('preserves prompt order, enabled state, role, position, depth, and injection order', () => {
    const migrated = migrateLegacyOaiPreset({
      chat_completion_source: 'openai',
      reverse_proxy: '',
      proxy_password: '',
      prompts: [
        {
          identifier: 'relative',
          name: 'Relative',
          system_prompt: false,
          role: 'assistant',
          content: 'relative content',
          marker: false,
          injection_position: 0,
          injection_order: 9,
        },
        {
          identifier: 'in-chat',
          name: 'In chat',
          system_prompt: false,
          role: 'user',
          content: 'in-chat content',
          marker: false,
          injection_position: 1,
          injection_depth: 3,
          injection_order: 4,
        },
      ],
      prompt_order: [
        {
          character_id: 0,
          order: [
            { identifier: 'in-chat', enabled: false },
            { identifier: 'relative', enabled: true },
          ],
        },
      ],
    });

    expect(migrated.prompts).toMatchObject([
      {
        identifier: 'in-chat',
        enabled: false,
        role: 'user',
        injection_position: 'in-chat',
        injection_depth: 3,
        injection_order: 4,
      },
      {
        identifier: 'relative',
        enabled: true,
        role: 'assistant',
        injection_position: 'relative',
        injection_order: 9,
      },
    ]);
  });

  it('rejects unsupported roles and invalid depths instead of normalizing them', () => {
    expect(() =>
      migrateLegacyOaiPreset({
        chat_completion_source: 'openai',
        reverse_proxy: '',
        proxy_password: '',
        prompts: [
          {
            identifier: 'invalid-role',
            name: 'Invalid role',
            system_prompt: false,
            role: 'tool' as never,
            content: 'invalid',
          },
        ],
        prompt_order: [{ character_id: 0, order: [{ identifier: 'invalid-role', enabled: true }] }],
      }),
    ).toThrow('Unsupported role');

    expect(() =>
      migrateLegacyOaiPreset({
        chat_completion_source: 'openai',
        reverse_proxy: '',
        proxy_password: '',
        prompts: [
          {
            identifier: 'invalid-depth',
            name: 'Invalid depth',
            system_prompt: false,
            role: 'system',
            content: 'invalid',
            injection_position: 1,
            injection_depth: -1,
          },
        ],
        prompt_order: [{ character_id: 0, order: [{ identifier: 'invalid-depth', enabled: true }] }],
      }),
    ).toThrow('Invalid injection depth');
  });
});
