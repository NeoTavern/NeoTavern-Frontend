<script setup lang="ts">
import { computed, ref } from 'vue';
import { PROVIDER_CAPABILITIES } from '../../api/provider-definitions';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useApiStore } from '../../stores/api.store';
import { usePopupStore } from '../../stores/popup.store';
import { useSettingsStore } from '../../stores/settings.store';
import { POPUP_RESULT, POPUP_TYPE } from '../../types/popup';
import { Button, FormItem, Select } from '../UI';
import InstructTemplatePopup from '../NavBar/InstructTemplatePopup.vue';

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
  const supportsChat = caps?.supportsChat ?? true;
  const supportsText = caps?.supportsText ?? true;

  const options = [];
  if (supportsChat || settingsStore.settings.api.formatter === 'chat') {
    options.push(formatterOptions.value[0]);
  }
  if (supportsText || settingsStore.settings.api.formatter === 'text') {
    options.push(formatterOptions.value[1]);
  }

  return options;
});

const showFormatter = computed(() => supportedFormatterOptions.value.length > 0);

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
    <div v-if="showFormatter" class="api-connections-drawer-section">
      <FormItem :label="t('apiConnections.formatter')">
        <Select v-model="settingsStore.settings.api.formatter" :options="supportedFormatterOptions" />
      </FormItem>
    </div>

    <div v-else class="api-connections-drawer-section neutral_warning">
      {{ t('aiConfig.formattingUnavailable') }}
    </div>

    <div v-if="settingsStore.settings.api.formatter === 'text'" class="api-connections-drawer-section">
      <h3>{{ t('apiConnections.instruct.title') }}</h3>
      <div class="preset-manager-controls">
        <!-- @vue-ignore -->
        <Select v-model="settingsStore.settings.api.instructTemplateName" :options="instructTemplateOptions" />
        <Button
          variant="ghost"
          icon="fa-file-circle-plus"
          :title="t('apiConnections.instruct.create')"
          @click="createTemplate"
        />
        <Button variant="ghost" icon="fa-pencil" :title="t('apiConnections.instruct.edit')" @click="editTemplate" />
        <Button
          variant="ghost"
          icon="fa-trash-can"
          :title="t('apiConnections.instruct.delete')"
          @click="deleteTemplate"
        />
        <Button
          variant="ghost"
          icon="fa-file-import"
          :title="t('apiConnections.instruct.import')"
          @click="apiStore.importInstructTemplate"
        />
        <Button
          variant="ghost"
          icon="fa-file-export"
          :title="t('apiConnections.instruct.export')"
          @click="apiStore.exportInstructTemplate(settingsStore.settings.api.instructTemplateName || '')"
        />
      </div>
    </div>

    <InstructTemplatePopup
      :visible="isInstructPopupVisible"
      :template-id="editingTemplateId"
      @close="isInstructPopupVisible = false"
    />
  </div>
</template>
