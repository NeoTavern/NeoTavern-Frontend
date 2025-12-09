import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { Preset } from '../api/presets';
import * as api from '../api/presets';
import { useStrictI18n } from '../composables/useStrictI18n';
import { toast } from '../composables/useToast';
import type { Theme, ThemeVariables } from '../types/theme';
import { VARIABLE_TYPES } from '../types/theme';
import { downloadFile } from '../utils/commons';
import { useSettingsStore } from './settings.store';

export const useThemeStore = defineStore('theme', () => {
  const { t } = useStrictI18n();
  const themes = ref<Preset<Theme>[]>([]);
  const activeThemeName = ref<string>('Default');

  // The current working state of variables (what is seen on screen)
  const currentVariables = ref<Partial<ThemeVariables>>({});

  const settingsStore = useSettingsStore();

  /**
   * Reads current computed styles from the DOM to populate initial state
   */
  function loadCurrentDOMStyles() {
    const computed = getComputedStyle(document.documentElement);
    const vars: Partial<ThemeVariables> = {};

    for (const key of Object.keys(VARIABLE_TYPES)) {
      const val = computed.getPropertyValue(key).trim();
      if (val) {
        vars[key as keyof ThemeVariables] = val;
      }
    }
    currentVariables.value = vars;
  }

  /**
   * Applies the variables to the root document
   */
  function applyToDOM(variables: Partial<ThemeVariables>) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(variables)) {
      if (value) {
        root.style.setProperty(key, value);
      } else {
        root.style.removeProperty(key);
      }
    }
  }

  async function fetchThemes() {
    try {
      themes.value = await api.fetchAllThemes();
      activeThemeName.value = settingsStore.settings.ui.selectedTheme;
      if (activeThemeName.value !== 'Default') {
        await loadTheme(activeThemeName.value);
      }
      // Ensure there is at least a default if API returns empty or specific logic needed
    } catch (error) {
      console.error('Failed to fetch themes', error);
      toast.error(t('themes.errors.loadFailed'));
    }
  }

  async function loadTheme(name: string) {
    // If selecting "Default" or essentially clearing overrides
    if (!name || name === 'Default') {
      activeThemeName.value = 'Default';
      // Reset DOM to stylesheet defaults
      const root = document.documentElement;
      for (const key of Object.keys(VARIABLE_TYPES)) {
        root.style.removeProperty(key);
      }
      loadCurrentDOMStyles();
      return;
    }

    const found = themes.value.find((t) => t.name === name);
    if (found) {
      activeThemeName.value = name;
      currentVariables.value = { ...found.preset.variables };
      applyToDOM(currentVariables.value);
    }
  }

  function updateVariable(key: keyof ThemeVariables, value: string) {
    currentVariables.value[key] = value;
    document.documentElement.style.setProperty(key, value);
  }

  async function saveTheme(name: string) {
    if (!name) return;

    const newTheme: Theme = {
      variables: { ...currentVariables.value },
    };

    try {
      await api.saveTheme(name, newTheme);
      await fetchThemes();
      activeThemeName.value = name;
      toast.success(`Theme "${name}" saved`);
    } catch (error) {
      console.error(error);
      toast.error(t('themes.errors.saveFailed'));
    }
  }

  async function deleteTheme(name: string) {
    try {
      await api.deleteTheme(name);
      await fetchThemes();
      if (activeThemeName.value === name) {
        await loadTheme('Default');
      }
      toast.success('Theme deleted');
    } catch (error) {
      console.error(error);
      toast.error(t('themes.errors.deleteFailed'));
    }
  }

  function exportTheme() {
    const themeToExport: Theme = {
      variables: currentVariables.value,
    };

    downloadFile(
      JSON.stringify(themeToExport, null, 2),
      `${activeThemeName.value || 'theme'}.json`,
      'application/json',
    );
  }

  async function importTheme(file: File) {
    try {
      const text = await file.text();
      const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
      const json = JSON.parse(text) as Theme;

      if (!json.variables || typeof json.variables !== 'object') {
        throw new Error('Invalid theme format');
      }

      // Apply immediately
      currentVariables.value = json.variables;
      applyToDOM(json.variables);
      activeThemeName.value = fileNameWithoutExt || 'Imported';

      // Auto save? Or let user save? Let's auto save for convenience
      await saveTheme(fileNameWithoutExt || 'Imported Theme');
    } catch (error) {
      console.error(error);
      toast.error(t('themes.errors.importFailed'));
    }
  }

  return {
    themes,
    activeThemeName,
    currentVariables,
    fetchThemes,
    loadTheme,
    updateVariable,
    saveTheme,
    deleteTheme,
    exportTheme,
    importTheme,
    loadCurrentDOMStyles,
  };
});
