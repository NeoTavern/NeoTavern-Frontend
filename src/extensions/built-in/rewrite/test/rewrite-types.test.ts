import { describe, expect, test } from 'vitest';
import { cloneRewriteTemplate, DEFAULT_TEMPLATES, migrateRewriteSettings } from '../types';

describe('rewrite types', () => {
  test('migrateRewriteSettings keeps customized built-ins as custom templates and remaps references', () => {
    const customized = cloneRewriteTemplate(DEFAULT_TEMPLATES[0]);
    customized.prompt = 'Custom prompt';

    const migrated = migrateRewriteSettings({
      templates: [customized],
      lastUsedTemplates: { field: customized.id },
      templateOverrides: { [customized.id]: { prompt: 'Override' } },
    });

    const customTemplate = migrated.templates.find((template) => template.id === `custom-${customized.id}`);

    expect(customTemplate).toMatchObject({
      builtIn: false,
      name: `Custom ${customized.name}`,
      prompt: 'Custom prompt',
    });
    expect(migrated.lastUsedTemplates.field).toBe(customTemplate?.id);
    expect(migrated.templateOverrides[customTemplate!.id]).toEqual({ prompt: 'Override' });
  });
});
