<script setup lang="ts">
import { computed, ref } from 'vue';
import { PROVIDER_CAPABILITIES } from '../../api/provider-definitions';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useApiStore } from '../../stores/api.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import { POPUP_RESULT, POPUP_TYPE } from '../../types/popup';
import { PresetControl } from '../common';
import InstructTemplatePopup from '../NavBar/InstructTemplatePopup.vue';
import { FormItem, Select } from '../UI';

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

const instructTemplateOptions = computed(() => {
  return apiStore.instructTemplates.map((template) => ({ label: template.name, value: template.name }));
});

function createTemplate() {
  editingTemplateId.value = undefined;
  isInstructPopupVisible.value = true;
}

function editTemplate() {
  editingTemplateId.value = settingsStore.settings.api.instructTemplateName;
  isInstructPopupVisible.value = true;
}

async function deleteTemplate() {
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
</script>

<template>
  <div class="api-formatting-panel">
    <div v-show="showFormatter" class="api-connections-drawer-section">
      <FormItem :label="t('apiConnections.formatter')">
        <Select v-model="settingsStore.settings.api.formatter" :options="supportedFormatterOptions" />
      </FormItem>
    </div>

    <div v-show="!showFormatter" class="api-connections-drawer-section neutral_warning">
      {{ t('aiConfig.formattingUnavailable') }}
    </div>

    <div v-show="settingsStore.settings.api.formatter === 'text'" class="api-connections-drawer-section">
      <h3>{{ t('apiConnections.instruct.title') }}</h3>
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
        @create="createTemplate"
        @edit="editTemplate"
        @delete="deleteTemplate"
        @import="apiStore.importInstructTemplate"
        @export="apiStore.exportInstructTemplate(settingsStore.settings.api.instructTemplateName || '')"
      />
    </div>

    <InstructTemplatePopup
      :visible="isInstructPopupVisible"
      :template-id="editingTemplateId"
      @close="isInstructPopupVisible = false"
    />
  </div>
</template>
