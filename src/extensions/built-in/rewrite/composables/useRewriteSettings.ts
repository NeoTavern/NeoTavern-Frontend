import { computed, onMounted, ref, watch } from 'vue';
import type { ExtensionAPI } from '../../../../types';
import type { RewriteSettings, RewriteTemplate, RewriteTemplateOverride, StructuredResponseFormat } from '../types';
import { migrateRewriteSettings } from '../types';
import { getInitialRewriteTemplateId, resolveRewriteTemplateArgOverrides } from '../utils';

export function useRewriteSettings(api: ExtensionAPI<RewriteSettings>, identifier: string) {
  const settings = ref<RewriteSettings>(migrateRewriteSettings(api.settings.get()));

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

    selectedTemplateId.value = getInitialRewriteTemplateId(settings.value, identifier);

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

    argOverrides.value = resolveRewriteTemplateArgOverrides(tpl, overrides);
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
