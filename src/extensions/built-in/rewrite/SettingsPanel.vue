<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector, SplitPane } from '../../../components/common';
import { Button, FormItem, Input, Textarea } from '../../../components/UI';
import { useStrictI18n } from '../../../composables/useStrictI18n';
import { POPUP_RESULT, POPUP_TYPE, type ExtensionAPI } from '../../../types';
import { uuidv4 } from '../../../utils/commons';
import { DEFAULT_TEMPLATES, type RewriteSettings, type RewriteTemplate } from './types';

// TODO: i18n

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
}>();

const { t } = useStrictI18n();

const settings = ref<RewriteSettings>({
  templates: [...DEFAULT_TEMPLATES],
  defaultConnectionProfile: undefined,
  lastUsedTemplates: {},
  templateOverrides: {},
});

onMounted(() => {
  const saved = props.api.settings.get();
  if (saved) {
    // Merge defaults if templates are missing (first run)
    if (!saved.templates || saved.templates.length === 0) {
      saved.templates = [...DEFAULT_TEMPLATES];
    }
    // Ensure maps exist
    if (!saved.lastUsedTemplates) saved.lastUsedTemplates = {};
    if (!saved.templateOverrides) saved.templateOverrides = {};

    settings.value = saved;
  }
});

watch(
  settings,
  (newSettings) => {
    props.api.settings.set(undefined, newSettings);
    props.api.settings.save();
  },
  { deep: true },
);

// Template Management
const editingTemplateId = ref<string | null>(null);

const activeTemplate = computed(() => {
  return settings.value.templates.find((t) => t.id === editingTemplateId.value);
});

function createTemplate() {
  const newTemplate: RewriteTemplate = {
    id: uuidv4(),
    name: 'New Template',
    prompt: 'Rewrite the text...',
    template: DEFAULT_TEMPLATES[0].template,
  };
  settings.value.templates.push(newTemplate);
  editingTemplateId.value = newTemplate.id;
}

function duplicateTemplate(id: string) {
  const original = settings.value.templates.find((t) => t.id === id);
  if (!original) return;

  const newTemplate: RewriteTemplate = {
    ...original,
    id: uuidv4(),
    name: `${original.name} (Copy)`,
  };
  settings.value.templates.push(newTemplate);
  editingTemplateId.value = newTemplate.id;
}

async function renameTemplate(id: string) {
  const tpl = settings.value.templates.find((t) => t.id === id);
  if (!tpl) return;

  const { result, value } = await props.api.ui.showPopup({
    type: POPUP_TYPE.INPUT,
    title: 'Rename Template',
    inputValue: tpl.name,
    okButton: 'common.rename',
    cancelButton: 'common.cancel',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && typeof value === 'string' && value.trim()) {
    tpl.name = value.trim();
  }
}

async function deleteTemplate(id: string) {
  const { result } = await props.api.ui.showPopup({
    type: POPUP_TYPE.CONFIRM,
    title: t('common.delete'),
    content: t('common.confirm'),
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    settings.value.templates = settings.value.templates.filter((t) => t.id !== id);
    if (editingTemplateId.value === id) editingTemplateId.value = null;
    // Cleanup overrides
    delete settings.value.templateOverrides[id];
  }
}

async function resetTemplates() {
  const { result } = await props.api.ui.showPopup({
    type: POPUP_TYPE.CONFIRM,
    title: t('common.reset'),
    content: t('common.confirm'),
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    settings.value.templates = [...DEFAULT_TEMPLATES];
    editingTemplateId.value = null;
  }
}

// Default Template Helpers
function isDefaultTemplate(id: string) {
  return DEFAULT_TEMPLATES.some((t) => t.id === id);
}

async function resetDefaultField(id: string, field: 'prompt' | 'template') {
  const def = DEFAULT_TEMPLATES.find((t) => t.id === id);
  const current = settings.value.templates.find((t) => t.id === id);
  if (def && current) {
    const { result } = await props.api.ui.showPopup({
      type: POPUP_TYPE.CONFIRM,
      title: t('common.reset'),
      content: t('common.confirm'),
    });

    if (result === POPUP_RESULT.AFFIRMATIVE) {
      current[field] = def[field];
    }
  }
}
</script>

<template>
  <div class="rewrite-settings">
    <div class="settings-section">
      <h3>{{ t('common.general') }}</h3>
      <FormItem label="Default Connection Profile">
        <ConnectionProfileSelector v-model="settings.defaultConnectionProfile" />
      </FormItem>
    </div>

    <div class="settings-section">
      <div class="header-row">
        <h3>Templates</h3>
        <div class="actions">
          <Button icon="fa-rotate-left" @click="resetTemplates">{{ t('common.reset') }}</Button>
          <Button icon="fa-plus" @click="createTemplate">{{ t('common.create') }}</Button>
        </div>
      </div>

      <div class="templates-layout">
        <SplitPane :initial-width="200" :min-width="150" :max-width="500">
          <template #side>
            <div class="template-list">
              <div
                v-for="template in settings.templates"
                :key="template.id"
                class="template-item"
                :class="{ active: editingTemplateId === template.id }"
                @click="editingTemplateId = template.id"
              >
                <span class="template-name">{{ template.name }}</span>
                <div class="item-actions">
                  <button class="action-btn" title="Rename Template" @click.stop="renameTemplate(template.id)">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button class="action-btn" title="Duplicate Template" @click.stop="duplicateTemplate(template.id)">
                    <i class="fa-solid fa-copy"></i>
                  </button>
                  <button class="action-btn delete" title="Delete Template" @click.stop="deleteTemplate(template.id)">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <template #main>
            <div v-if="activeTemplate" class="template-editor">
              <FormItem label="Name">
                <Input v-model="activeTemplate.name" />
              </FormItem>
              <FormItem label="Instruction (Prompt)">
                <div class="input-row">
                  <Input v-model="activeTemplate.prompt" />
                  <Button
                    v-if="isDefaultTemplate(activeTemplate.id)"
                    icon="fa-rotate-left"
                    title="Reset to default"
                    variant="ghost"
                    @click="resetDefaultField(activeTemplate.id, 'prompt')"
                  />
                </div>
              </FormItem>
              <FormItem label="Template Macro">
                <div class="textarea-container">
                  <Textarea v-model="activeTemplate.template" :rows="10" />
                  <Button
                    v-if="isDefaultTemplate(activeTemplate.id)"
                    class="reset-macro-btn"
                    icon="fa-rotate-left"
                    title="Reset to default"
                    variant="ghost"
                    @click="resetDefaultField(activeTemplate.id, 'template')"
                  />
                </div>
                <div class="help-text">
                  Available variables: <code>{{ '{' + '{input}' + '}' }}</code
                  >, <code>{{ '{' + '{prompt}' + '}' }}</code
                  >, <code>{{ '{' + '{contextMessages}' + '}' }}</code
                  >, <code>{{ '{' + '{fieldName}' + '}' }}</code
                  >.
                  <br />
                  Standard macros (e.g. <code>{{ '{' + '{char}' + '}' }}</code
                  >, <code>{{ '{' + '{user}' + '}' }}</code
                  >)
                </div>
              </FormItem>
            </div>
            <div v-else class="empty-state">Select a template to edit</div>
          </template>
        </SplitPane>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rewrite-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 10px;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.actions {
  display: flex;
  gap: 5px;
}

.templates-layout {
  border: 1px solid var(--theme-border-color);
  height: 500px;
  position: relative;
  display: flex;
  flex-direction: column;
}

.template-list {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.template-item {
  padding: 10px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--theme-border-color);
  gap: 8px;
}

.template-item:hover {
  background-color: var(--white-20a);
}

.template-item.active {
  background-color: var(--theme-emphasis-color);
  color: var(--black-100);
}

.template-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.item-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.5;
  padding: 4px;
  border-radius: 3px;
}

.action-btn:hover {
  opacity: 1;
  background-color: var(--black-20a);
}

.action-btn.delete:hover {
  color: var(--color-accent-red);
}

.template-editor {
  padding: 15px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 15px;
  height: 100%;
}

.input-row {
  display: flex;
  gap: 5px;
}
.input-row > :first-child {
  flex: 1;
}

.textarea-container {
  position: relative;
}

.reset-macro-btn {
  position: absolute;
  top: 5px;
  right: 20px; /* Scrollbar width approx */
  opacity: 0.5;
  background-color: var(--black-50a);
}
.reset-macro-btn:hover {
  opacity: 1;
}

.help-text {
  font-size: 0.85em;
  opacity: 0.8;
  margin-top: 5px;
}

.empty-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
}
</style>
