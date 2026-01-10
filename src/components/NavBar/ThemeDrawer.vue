<script setup lang="ts">
import { computed } from 'vue';
import {
  CollapsibleSection,
  ColorPicker,
  FileInput,
  FormItem,
  Input,
  RangeControl,
  Textarea,
} from '../../components/UI';
import { PresetControl, SidebarHeader } from '../../components/common';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useThemeStore } from '../../stores/theme.store';
import { POPUP_TYPE } from '../../types';
import type { ThemeVariables } from '../../types/theme';
import { THEME_CATEGORIES, VARIABLE_LABELS, VARIABLE_TYPES } from '../../types/theme';

const themeStore = useThemeStore();
const popupStore = usePopupStore();
const settingsStore = useSettingsStore();
const { t } = useStrictI18n();

const themeOptions = computed(() => {
  const list = [{ label: 'Default', value: 'Default' }];
  themeStore.themes.forEach((t) => {
    list.push({ label: t.name, value: t.name });
  });
  return list;
});

function onThemeChange(name: string | number) {
  themeStore.loadTheme(String(name));
  settingsStore.settings.ui.selectedTheme = String(name);
}

function getVariable(key: keyof ThemeVariables) {
  return themeStore.currentVariables[key] || '';
}

function setVariable(key: keyof ThemeVariables, value: string | number) {
  const newValue = String(value);
  themeStore.updateVariable(key, newValue);
}

function updateCustomCss(val: string) {
  themeStore.updateCustomCss(val);
}

// Helpers for specific input types
function isColor(key: keyof ThemeVariables) {
  return VARIABLE_TYPES[key] === 'color';
}
function isNumber(key: keyof ThemeVariables) {
  return VARIABLE_TYPES[key] === 'number';
}

// CRUD Actions
async function onCreate() {
  const { result, value } = await popupStore.show<string>({
    type: POPUP_TYPE.INPUT,
    title: t('common.create'),
    okButton: 'common.save',
    cancelButton: 'common.cancel',
  });

  if (result && value) {
    await themeStore.saveTheme(value);
  }
}

async function onSave() {
  if (themeStore.activeThemeName === 'Default') {
    await onCreate();
    return;
  }
  await themeStore.saveTheme(themeStore.activeThemeName);
}

async function onDelete() {
  if (themeStore.activeThemeName === 'Default') return;

  const { result } = await popupStore.show({
    type: POPUP_TYPE.CONFIRM,
    title: t('common.delete'),
    content: `Delete theme "${themeStore.activeThemeName}"?`,
  });

  if (result) {
    await themeStore.deleteTheme(themeStore.activeThemeName);
  }
}

function onImport(files: File[]) {
  if (files.length > 0) {
    themeStore.importTheme(files[0]);
  }
}
</script>

<template>
  <div class="theme-drawer">
    <SidebarHeader title="Themes" />

    <div class="theme-drawer-content">
      <!-- Preset Control -->
      <div class="theme-presets">
        <PresetControl
          :model-value="themeStore.activeThemeName"
          :options="themeOptions"
          allow-create
          allow-save
          allow-delete
          allow-export
          @update:model-value="onThemeChange"
          @create="onCreate"
          @save="onSave"
          @delete="onDelete"
          @export="themeStore.exportTheme"
        >
          <template #actions>
            <FileInput accept=".json" icon="fa-file-import" @change="onImport" />
          </template>
        </PresetControl>
      </div>

      <!-- Variable Editors -->
      <div class="theme-editor">
        <!-- Custom CSS Section -->
        <CollapsibleSection title="Custom CSS">
          <div class="theme-vars-list">
            <Textarea
              :model-value="themeStore.customCss"
              allow-maximize
              identifier="theme.custom_css"
              language="css"
              class="custom-css-editor"
              @update:model-value="updateCustomCss"
            />
          </div>
        </CollapsibleSection>

        <CollapsibleSection v-for="(vars, category) in THEME_CATEGORIES" :key="category" :title="category">
          <div class="theme-vars-list">
            <div v-for="key in vars" :key="key" class="theme-var-item">
              <!-- Colors -->
              <div v-if="isColor(key)">
                <ColorPicker
                  :model-value="getVariable(key)"
                  :label="t(VARIABLE_LABELS[key])"
                  @update:model-value="(val) => setVariable(key, val)"
                />
              </div>

              <!-- Numbers (Sliders) -->
              <div v-else-if="isNumber(key)">
                <RangeControl
                  :label="t(VARIABLE_LABELS[key])"
                  :model-value="parseFloat(getVariable(key)) || 0"
                  :min="0"
                  :max="50"
                  @update:model-value="(val) => setVariable(key, val)"
                />
              </div>

              <!-- Text / generic -->
              <div v-else>
                <FormItem :label="t(VARIABLE_LABELS[key])">
                  <Input :model-value="getVariable(key)" @update:model-value="(val) => setVariable(key, val)" />
                </FormItem>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.theme-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;

  &-content {
    padding: var(--spacing-md);
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }
}

.theme-vars-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) 0;
}

.custom-css-editor {
  min-height: 200px;
  max-height: 500px;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
}
</style>
