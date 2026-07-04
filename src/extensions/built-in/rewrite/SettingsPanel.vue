<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector, SplitPane } from '../../../components/common';
import { Button, Checkbox, FormItem, Input, Select, Textarea } from '../../../components/UI';
import { POPUP_RESULT, POPUP_TYPE, type ExtensionAPI } from '../../../types';
import { uuidv4 } from '../../../utils/commons';
import { RewriteService } from './RewriteService';
import {
  DEFAULT_TEMPLATES,
  type RewriteSettings,
  type RewriteTemplate,
  type RewriteTemplateArg,
  migrateRewriteSettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
}>();

const t = props.api.i18n.t;

const settings = ref<RewriteSettings>({
  templates: [...DEFAULT_TEMPLATES],
  defaultConnectionProfile: '',
  lastUsedTemplates: {},
  templateOverrides: {},
  disabledTools: [],
});
const isSidebarCollapsed = ref(false);

const service = new RewriteService(props.api);

onMounted(() => {
  settings.value = migrateRewriteSettings(props.api.settings.get());
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

const isActiveTemplateBuiltIn = computed(() => !!activeTemplate.value?.builtIn);

function createTemplate() {
  const newTemplate: RewriteTemplate = {
    id: uuidv4(),
    name: 'New Template',
    prompt: 'Rewrite the text...',
    template: 'You are a helpful assistant. {{input}}',
    sessionPreamble: 'You are a helpful writing assistant.',
    args: [],
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
    args: original.args ? JSON.parse(JSON.stringify(original.args)) : [],
    builtIn: false,
  };
  settings.value.templates.push(newTemplate);
  editingTemplateId.value = newTemplate.id;
}

async function renameTemplate(id: string) {
  const tpl = settings.value.templates.find((t) => t.id === id);
  if (!tpl || tpl.builtIn) return;

  const { result, value } = await props.api.ui.showPopup({
    type: POPUP_TYPE.INPUT,
    title: t('extensionsBuiltin.rewrite.settings.renameTemplate'),
    inputValue: tpl.name,
    okButton: 'common.rename',
    cancelButton: 'common.cancel',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && typeof value === 'string' && value.trim()) {
    tpl.name = value.trim();
  }
}

async function deleteTemplate(id: string) {
  const tpl = settings.value.templates.find((template) => template.id === id);
  if (!tpl || tpl.builtIn) return;

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
    title: t('extensionsBuiltin.rewrite.settings.resetTemplatesTitle'),
    content: t('extensionsBuiltin.rewrite.settings.resetTemplatesContent'),
    okButton: 'common.reset',
    cancelButton: 'common.cancel',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    const customTemplates = settings.value.templates.filter((template) => !template.builtIn);
    settings.value.templates = [...JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)), ...customTemplates];
    editingTemplateId.value = null;
  }
}

async function deleteAllSessions() {
  const { result } = await props.api.ui.showPopup({
    type: POPUP_TYPE.CONFIRM,
    title: t('extensionsBuiltin.rewrite.settings.deleteAllSessionsTitle'),
    content: t('extensionsBuiltin.rewrite.settings.deleteAllSessionsContent'),
    okButton: 'common.delete',
    cancelButton: 'common.cancel',
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    await service.clearAllSessions();
    props.api.ui.showToast(t('common.deleted'), 'success');
  }
}

// Argument Management
const argTypes = [
  { label: 'Boolean', value: 'boolean' },
  { label: 'String', value: 'string' },
  { label: 'Number', value: 'number' },
];

function addArg() {
  if (!activeTemplate.value || activeTemplate.value.builtIn) return;
  if (!activeTemplate.value.args) activeTemplate.value.args = [];
  activeTemplate.value.args.push({
    key: 'newArg',
    label: 'New Argument',
    type: 'boolean',
    defaultValue: true,
  });
}

function removeArg(index: number) {
  if (!activeTemplate.value || activeTemplate.value.builtIn || !activeTemplate.value.args) return;
  activeTemplate.value.args.splice(index, 1);
}

// Fix default value type when type changes
function onArgTypeChange(arg: RewriteTemplateArg) {
  if (isActiveTemplateBuiltIn.value) return;
  if (arg.type === 'boolean') arg.defaultValue = false;
  else if (arg.type === 'number') arg.defaultValue = 0;
  else arg.defaultValue = '';
}
</script>

<template>
  <div class="rewrite-settings">
    <div class="settings-section">
      <h3>{{ t('common.general') }}</h3>
      <FormItem :label="t('extensionsBuiltin.rewrite.settings.defaultConnectionProfile')">
        <ConnectionProfileSelector v-model="settings.defaultConnectionProfile" />
      </FormItem>
    </div>

    <div class="settings-section">
      <div class="header-row">
        <h3>{{ t('extensionsBuiltin.rewrite.settings.templates') }}</h3>
        <div class="actions">
          <Button icon="fa-rotate-left" @click="resetTemplates">{{ t('common.reset') }}</Button>
          <Button icon="fa-plus" @click="createTemplate">{{ t('common.create') }}</Button>
        </div>
      </div>

      <div class="templates-layout">
        <SplitPane v-model:collapsed="isSidebarCollapsed" :initial-width="300" :min-width="150" :max-width="500">
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
                  <button
                    v-if="!template.builtIn"
                    class="action-btn"
                    :title="t('extensionsBuiltin.rewrite.settings.renameTemplate')"
                    @click.stop="renameTemplate(template.id)"
                  >
                    <i class="fa-solid fa-pen"></i>
                  </button>
                  <button
                    class="action-btn"
                    :title="t('extensionsBuiltin.rewrite.settings.duplicateTemplate')"
                    @click.stop="duplicateTemplate(template.id)"
                  >
                    <i class="fa-solid fa-copy"></i>
                  </button>
                  <button
                    v-if="!template.builtIn"
                    class="action-btn delete"
                    :title="t('extensionsBuiltin.rewrite.settings.deleteTemplate')"
                    @click.stop="deleteTemplate(template.id)"
                  >
                    <i class="fa-solid fa-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <template #main>
            <div v-if="activeTemplate" class="template-editor">
              <FormItem :label="t('extensionsBuiltin.rewrite.settings.name')">
                <Input v-model="activeTemplate.name" :disabled="isActiveTemplateBuiltIn" />
              </FormItem>

              <div class="checkbox-field">
                <Checkbox
                  v-model="activeTemplate.ignoreInput!"
                  :label="t('extensionsBuiltin.rewrite.settings.ignoreInput')"
                  :title="t('extensionsBuiltin.rewrite.settings.ignoreInputHint')"
                  :disabled="isActiveTemplateBuiltIn"
                />
              </div>

              <FormItem :label="t('extensionsBuiltin.rewrite.settings.instruction')">
                <Textarea
                  v-model="activeTemplate.prompt"
                  :rows="3"
                  allow-maximize
                  :disabled="isActiveTemplateBuiltIn"
                />
              </FormItem>

              <FormItem :label="t('extensionsBuiltin.rewrite.settings.customArgs')">
                <div class="args-list">
                  <div v-if="!activeTemplate.args?.length" class="empty-args">
                    {{ t('extensionsBuiltin.rewrite.settings.noCustomArgs') }}
                  </div>
                  <div v-for="(arg, idx) in activeTemplate.args" :key="idx" class="arg-item">
                    <div class="arg-row">
                      <Input
                        v-model="arg.key"
                        placeholder="Key (e.g. includeChar)"
                        class="arg-input-sm"
                        :disabled="isActiveTemplateBuiltIn"
                      />
                      <Input
                        v-model="arg.label"
                        placeholder="Label"
                        class="arg-input-md"
                        :disabled="isActiveTemplateBuiltIn"
                      />
                      <Select
                        v-model="arg.type"
                        :options="argTypes"
                        class="arg-input-sm"
                        :disabled="isActiveTemplateBuiltIn"
                        @update:model-value="onArgTypeChange(arg)"
                      />
                      <div class="arg-default">
                        <Checkbox
                          v-if="arg.type === 'boolean'"
                          v-model="arg.defaultValue as boolean"
                          :label="t('common.default')"
                          :disabled="isActiveTemplateBuiltIn"
                        />
                        <Input
                          v-else
                          v-model="arg.defaultValue as string | number"
                          :type="arg.type === 'number' ? 'number' : 'text'"
                          placeholder="Default"
                          :disabled="isActiveTemplateBuiltIn"
                        />
                      </div>
                      <Button
                        icon="fa-trash"
                        variant="ghost"
                        class="delete-arg-btn"
                        :disabled="isActiveTemplateBuiltIn"
                        @click="removeArg(idx)"
                      />
                    </div>
                  </div>
                  <Button
                    icon="fa-plus"
                    variant="ghost"
                    class="add-arg-btn"
                    :disabled="isActiveTemplateBuiltIn"
                    @click="addArg"
                  >
                    {{ t('extensionsBuiltin.rewrite.settings.addArgument') }}
                  </Button>
                </div>
              </FormItem>

              <FormItem :label="t('extensionsBuiltin.rewrite.settings.templateMacro')">
                <Textarea
                  v-model="activeTemplate.template"
                  :rows="10"
                  allow-maximize
                  :disabled="isActiveTemplateBuiltIn"
                />
                <div class="help-text">
                  Available variables: <code>{{ '{' + '{input}' + '}' }}</code
                  >, <code>{{ '{' + '{prompt}' + '}' }}</code
                  >, <code>{{ '{' + '{contextMessages}' + '}' }}</code
                  >, <code>{{ '{' + '{fieldName}' + '}' }}</code
                  >.<br />
                  Custom Args:
                  <template v-if="activeTemplate.args?.length">
                    <code v-for="arg in activeTemplate.args" :key="arg.key"
                      >{{ '{' + '{' + arg.key + '}' + '}' }}
                    </code>
                  </template>
                  <template v-else>None</template>
                  <br />
                  Standard macros (e.g. <code>{{ '{' + '{char}' + '}' }}</code
                  >, <code>{{ '{' + '{user}' + '}' }}</code
                  >)
                </div>
              </FormItem>

              <FormItem
                :label="t('extensionsBuiltin.rewrite.settings.sessionPreamble')"
                :description="t('extensionsBuiltin.rewrite.settings.sessionPreambleHint')"
              >
                <Textarea
                  v-model="activeTemplate.sessionPreamble"
                  :rows="5"
                  allow-maximize
                  :disabled="isActiveTemplateBuiltIn"
                />
              </FormItem>
            </div>
            <div v-else class="empty-state">{{ t('extensionsBuiltin.rewrite.settings.selectTemplate') }}</div>
          </template>
        </SplitPane>
      </div>
    </div>

    <div class="settings-section">
      <div class="header-row">
        <h3>{{ t('extensionsBuiltin.rewrite.session.sessions') }}</h3>
        <div class="actions">
          <Button icon="fa-trash-can" variant="danger" @click="deleteAllSessions">{{
            t('extensionsBuiltin.rewrite.settings.deleteAllSessions')
          }}</Button>
        </div>
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
  height: 600px;
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

/* Args Editor */
.args-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background-color: var(--black-20a);
  border-radius: var(--base-border-radius);
}

.arg-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--theme-border-color);
}
.arg-item:last-child {
  border-bottom: none;
}

.arg-row {
  display: flex;
  gap: 5px;
  align-items: center;
}

.arg-input-sm {
  width: 120px;
  flex-shrink: 0;
}
.arg-input-md {
  flex: 1;
}

.arg-default {
  width: 100px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.delete-arg-btn {
  color: var(--color-accent-red);
}

.add-arg-btn {
  align-self: flex-start;
  font-size: 0.9em;
}

.empty-args {
  font-size: 0.9em;
  opacity: 0.6;
  font-style: italic;
  padding: 5px 0;
}

.checkbox-field {
  padding: 8px 0;
  border-bottom: 1px solid var(--theme-border-color);
}
</style>
