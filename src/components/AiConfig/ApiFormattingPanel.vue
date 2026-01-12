<script setup lang="ts">
import { computed, markRaw, ref } from 'vue';
import { PROVIDER_CAPABILITIES } from '../../api/provider-definitions';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useApiStore } from '../../stores/api.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import type { ReasoningTemplate } from '../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../types/popup';
import { PresetControl } from '../common';
import InstructTemplatePopup from '../NavBar/InstructTemplatePopup.vue';
import { FormItem, Select } from '../UI';
import ReasoningTemplatePopup from './ReasoningTemplatePopup.vue';

const { t } = useStrictI18n();
const apiStore = useApiStore();
const settingsStore = useSettingsStore();
const popupStore = usePopupStore();

const isInstructPopupVisible = ref(false);
const editingTemplateId = ref<string | undefined>(undefined);

const currentProviderCaps = computed(() => PROVIDER_CAPABILITIES[settingsStore.settings.api.provider]);

const formatterOptions = computed(() => [
  {
    label: t('common.chat'),
    value: 'chat',
  },
  {
    label: t('common.text'),
    value: 'text',
  },
]);

const supportedFormatterOptions = computed(() => {
  const caps = currentProviderCaps.value;

  const options = [];
  if (caps?.supportsChat || settingsStore.settings.api.formatter === 'chat') {
    options.push(formatterOptions.value[0]);
  }
  if (caps?.supportsText || settingsStore.settings.api.formatter === 'text') {
    options.push(formatterOptions.value[1]);
  }

  return options;
});

const showFormatter = computed(() => supportedFormatterOptions.value.length > 1);

// Instruct Templates
const instructTemplateOptions = computed(() => {
  return apiStore.instructTemplates.map((template) => ({ label: template.name, value: template.name }));
});

function createInstructTemplate() {
  editingTemplateId.value = undefined;
  isInstructPopupVisible.value = true;
}

function editInstructTemplate() {
  editingTemplateId.value = settingsStore.settings.api.instructTemplateName;
  isInstructPopupVisible.value = true;
}

async function deleteInstructTemplate() {
  const name = settingsStore.settings.api.instructTemplateName;
  if (!name) return;

  const { result } = await popupStore.show({
    title: t('apiConnections.instruct.deleteTitle'),
    content: t('apiConnections.instruct.deleteContent', { name }),
    type: POPUP_TYPE.CONFIRM,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    await apiStore.deleteInstructTemplate(name);
  }
}

// Reasoning Templates
const reasoningTemplateOptions = computed(() => {
  return apiStore.reasoningTemplates.map((template) => ({ label: template.name, value: template.name }));
});

async function openReasoningPopup(template?: ReasoningTemplate) {
  const isEdit = !!template;
  const templateData = ref<ReasoningTemplate>(
    template
      ? { ...template }
      : {
          name: '',
          prefix: '<think>\n',
          suffix: '\n</think>',
          separator: '\n\n',
        },
  );

  const { result } = await popupStore.show({
    title: isEdit ? t('apiConnections.reasoning.edit') : t('apiConnections.reasoning.create'),
    type: POPUP_TYPE.CONFIRM,
    component: markRaw(ReasoningTemplatePopup),
    componentProps: {
      modelValue: templateData,
      isEdit,
    },
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    if (!templateData.value.name) return;
    await apiStore.saveReasoningTemplate(templateData.value);
  }
}

function createReasoningTemplate() {
  openReasoningPopup();
}

function editReasoningTemplate() {
  const name = settingsStore.settings.api.reasoningTemplateName;
  if (!name) return;
  const template = apiStore.reasoningTemplates.find((t) => t.name === name);
  if (template) {
    openReasoningPopup(template);
  }
}

async function deleteReasoningTemplate() {
  const name = settingsStore.settings.api.reasoningTemplateName;
  if (!name) return;

  const { result } = await popupStore.show({
    title: t('common.confirmDelete'),
    content: t('apiConnections.reasoning.deleteContent', { name }),
    type: POPUP_TYPE.CONFIRM,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    await apiStore.deleteReasoningTemplate(name);
  }
}
</script>

<template>
  <div class="api-formatting-panel">
    <FormItem v-show="showFormatter" :label="t('apiConnections.formatter')">
      <Select v-model="settingsStore.settings.api.formatter" :options="supportedFormatterOptions" />
    </FormItem>

    <!-- Instruct Templates -->
    <FormItem v-show="settingsStore.settings.api.formatter === 'text'" :label="t('apiConnections.instruct.title')">
      <PresetControl
        v-model="settingsStore.settings.api.instructTemplateName"
        :options="instructTemplateOptions"
        :create-title="'apiConnections.instruct.create'"
        :edit-title="'apiConnections.instruct.edit'"
        :delete-title="'apiConnections.instruct.delete'"
        :import-title="'apiConnections.instruct.import'"
        :export-title="'apiConnections.instruct.export'"
        allow-create
        allow-edit
        allow-delete
        allow-import
        allow-export
        @create="createInstructTemplate"
        @edit="editInstructTemplate"
        @delete="deleteInstructTemplate"
        @import="apiStore.importInstructTemplate"
        @export="apiStore.exportInstructTemplate(settingsStore.settings.api.instructTemplateName || '')"
      />
    </FormItem>

    <!-- Reasoning Templates -->
    <FormItem :label="t('apiConnections.reasoning.title')">
      <PresetControl
        v-model="settingsStore.settings.api.reasoningTemplateName"
        :options="reasoningTemplateOptions"
        :create-title="'apiConnections.reasoning.create'"
        :edit-title="'apiConnections.reasoning.edit'"
        :delete-title="'apiConnections.reasoning.delete'"
        :import-title="'apiConnections.reasoning.import'"
        :export-title="'apiConnections.reasoning.export'"
        allow-create
        allow-edit
        allow-delete
        allow-import
        allow-export
        @create="createReasoningTemplate"
        @edit="editReasoningTemplate"
        @delete="deleteReasoningTemplate"
        @import="apiStore.importReasoningTemplate"
        @export="apiStore.exportReasoningTemplate(settingsStore.settings.api.reasoningTemplateName || '')"
      />
    </FormItem>

    <InstructTemplatePopup
      :visible="isInstructPopupVisible"
      :template-id="editingTemplateId"
      @close="isInstructPopupVisible = false"
    />
  </div>
</template>
