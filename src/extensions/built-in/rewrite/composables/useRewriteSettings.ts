import { computed, onMounted, ref, watch } from 'vue';
import type { ExtensionAPI } from '../../../../types';
import type {
  RewriteSettings,
  RewriteTemplate,
  RewriteTemplateArg,
  RewriteTemplateOverride,
  StructuredResponseFormat,
} from '../types';
import { DEFAULT_TEMPLATES } from '../types';

export function useRewriteSettings(api: ExtensionAPI<RewriteSettings>, identifier: string) {
  const settings = ref<RewriteSettings>(
    api.settings.get() || {
      templates: [...DEFAULT_TEMPLATES],
      lastUsedTemplates: {},
      templateOverrides: {},
    },
  );

  const selectedTemplateId = ref<string>('');
  const selectedProfile = ref<string>('');
  const promptOverride = ref<string>('');
  const contextMessageCount = ref<number>(0);
  const escapeMacros = ref<boolean>(true);
  const argOverrides = ref<Record<string, boolean | number | string>>({});
  const structuredResponseFormat = ref<StructuredResponseFormat>('native');

  const selectedContextLorebooks = ref<string[]>([]);
  const selectedContextEntries = ref<Record<string, number[]>>({});
  const selectedContextCharacters = ref<string[]>([]);

  const isCharacterContextOpen = ref(false);
  const isWorldInfoContextOpen = ref(false);

  const IS_CHARACTER_FIELD = computed(() => identifier.startsWith('character.'));
  const IS_WORLD_INFO_FIELD = computed(() => identifier.startsWith('world_info.'));

  const templateOptions = computed(() => {
    return settings.value.templates.map((t) => ({ label: t.name, value: t.id }));
  });

  const currentTemplate = computed(() => settings.value.templates.find((t) => t.id === selectedTemplateId.value));

  const canResetPrompt = computed(() => {
    if (!currentTemplate.value) return false;
    return promptOverride.value !== currentTemplate.value.prompt;
  });

  onMounted(() => {
    if (!settings.value.lastUsedTemplates) settings.value.lastUsedTemplates = {};
    if (!settings.value.templateOverrides) settings.value.templateOverrides = {};

    // Auto-select template
    const lastUsedTpl = settings.value.lastUsedTemplates[identifier];
    if (lastUsedTpl && settings.value.templates.find((t) => t.id === lastUsedTpl)) {
      selectedTemplateId.value = lastUsedTpl;
    } else {
      // Smart defaults
      if (IS_WORLD_INFO_FIELD.value) {
        const wiTpl = settings.value.templates.find((t) => t.id === 'world-info-refiner');
        if (wiTpl) selectedTemplateId.value = wiTpl.id;
      } else if (IS_CHARACTER_FIELD.value) {
        const charTpl = settings.value.templates.find((t) => t.id === 'character-polisher');
        if (charTpl) selectedTemplateId.value = charTpl.id;
      } else {
        if (settings.value.templates.length > 0) {
          selectedTemplateId.value = settings.value.templates[0].id;
        }
      }
    }

    loadTemplateOverrides();
  });

  function loadTemplateOverrides() {
    const tplId = selectedTemplateId.value;
    if (!tplId) return;

    const overrides = settings.value.templateOverrides[tplId] || {};
    const tpl = settings.value.templates.find((t: RewriteTemplate) => t.id === tplId);

    selectedProfile.value = overrides.lastUsedProfile || settings.value.defaultConnectionProfile || '';
    promptOverride.value = overrides.prompt ?? tpl?.prompt ?? '';
    contextMessageCount.value = overrides.lastUsedXMessages ?? 0;
    escapeMacros.value = overrides.escapeInputMacros ?? true;
    selectedContextLorebooks.value = overrides.selectedContextLorebooks || [];
    selectedContextEntries.value = overrides.selectedContextEntries ? { ...overrides.selectedContextEntries } : {};
    selectedContextCharacters.value = overrides.selectedContextCharacters || [];
    structuredResponseFormat.value = overrides.structuredResponseFormat || 'native';
    isCharacterContextOpen.value = !(overrides.isCharacterContextCollapsed ?? true);
    isWorldInfoContextOpen.value = !(overrides.isWorldInfoContextCollapsed ?? true);

    const args: Record<string, boolean | number | string> = {};
    if (tpl?.args) {
      tpl.args.forEach((arg: RewriteTemplateArg) => {
        args[arg.key] = overrides.args?.[arg.key] ?? arg.defaultValue;
      });
    }
    argOverrides.value = args;
  }

  function resetPrompt() {
    if (currentTemplate.value) {
      promptOverride.value = currentTemplate.value.prompt;
    }
  }

  function saveState() {
    const tplId = selectedTemplateId.value;
    if (!tplId) return;

    settings.value.lastUsedTemplates[identifier] = tplId;

    const overrides: RewriteTemplateOverride = {
      lastUsedProfile: selectedProfile.value,
      prompt: promptOverride.value,
      lastUsedXMessages: Number(contextMessageCount.value),
      escapeInputMacros: escapeMacros.value,
      args: argOverrides.value,
      selectedContextLorebooks: selectedContextLorebooks.value,
      selectedContextEntries: { ...selectedContextEntries.value },
      selectedContextCharacters: selectedContextCharacters.value,
      structuredResponseFormat: structuredResponseFormat.value,
      isCharacterContextCollapsed: !isCharacterContextOpen.value,
      isWorldInfoContextCollapsed: !isWorldInfoContextOpen.value,
    };

    settings.value.templateOverrides[tplId] = overrides;

    api.settings.set(undefined, settings.value);
    api.settings.save();
  }

  watch(selectedTemplateId, () => {
    loadTemplateOverrides();
  });

  watch(
    [
      selectedProfile,
      promptOverride,
      contextMessageCount,
      escapeMacros,
      structuredResponseFormat,
      isCharacterContextOpen,
      isWorldInfoContextOpen,
    ],
    () => {
      saveState();
    },
  );

  watch(
    [selectedContextLorebooks, selectedContextEntries, selectedContextCharacters, argOverrides],
    () => {
      saveState();
    },
    { deep: true },
  );

  return {
    settings,
    selectedTemplateId,
    selectedProfile,
    promptOverride,
    contextMessageCount,
    escapeMacros,
    argOverrides,
    structuredResponseFormat,
    selectedContextLorebooks,
    selectedContextEntries,
    selectedContextCharacters,
    isCharacterContextOpen,
    isWorldInfoContextOpen,
    IS_CHARACTER_FIELD,
    IS_WORLD_INFO_FIELD,
    templateOptions,
    currentTemplate,
    canResetPrompt,
    resetPrompt,
    saveState,
  };
}
