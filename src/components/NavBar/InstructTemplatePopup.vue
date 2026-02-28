<script setup lang="ts">
import { cloneDeep } from 'lodash-es';
import { ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useApiStore } from '../../stores/api.store';
import { NamesBehavior, createDefaultInstructTemplate, type InstructTemplate } from '../../types/instruct';
import { Button, Checkbox, FormItem, Input, Select, Textarea } from '../UI';

const props = defineProps<{
  visible: boolean;
  templateId?: string; // If provided, edit mode
}>();

const emit = defineEmits(['close']);
const apiStore = useApiStore();
const { t } = useStrictI18n();
const dialog = ref<HTMLDialogElement | null>(null);

const activeTemplate = ref<InstructTemplate>(createDefaultInstructTemplate());

const namesBehaviorOptions = [
  { label: t('instruct.namesBehavior.none'), value: NamesBehavior.NONE },
  { label: t('instruct.namesBehavior.force'), value: NamesBehavior.FORCE },
  { label: t('instruct.namesBehavior.include'), value: NamesBehavior.INCLUDE },
];

watch(
  () => props.visible,
  (val) => {
    if (val) {
      if (props.templateId) {
        const found = apiStore.instructTemplates.find((t) => t.id === props.templateId || t.name === props.templateId);
        if (found) {
          activeTemplate.value = cloneDeep(found);
        }
      } else {
        activeTemplate.value = createDefaultInstructTemplate();
      }
      dialog.value?.showModal();
    } else {
      dialog.value?.close();
    }
  },
);

async function save() {
  if (!activeTemplate.value.name.trim()) {
    return;
  }
  await apiStore.saveInstructTemplate(activeTemplate.value);
  emit('close');
}

function close() {
  emit('close');
}
</script>

<template>
  <dialog ref="dialog" class="popup wide" @cancel="close">
    <div class="popup-body">
      <h3>{{ templateId ? 'Edit Instruct Template' : 'New Instruct Template' }}</h3>

      <div class="template-form">
        <FormItem label="Template Name">
          <Input v-model="activeTemplate.name" />
        </FormItem>

        <div class="grid-2">
          <FormItem label="Input Sequence (User)">
            <Textarea v-model="activeTemplate.input_sequence" :rows="2" />
          </FormItem>
          <FormItem label="Input Suffix">
            <Textarea v-model="activeTemplate.input_suffix" :rows="1" />
          </FormItem>
        </div>

        <div class="grid-2">
          <FormItem label="Output Sequence (Assistant)">
            <Textarea v-model="activeTemplate.output_sequence" :rows="2" />
          </FormItem>
          <FormItem label="Output Suffix">
            <Textarea v-model="activeTemplate.output_suffix" :rows="1" />
          </FormItem>
        </div>

        <div class="grid-2">
          <FormItem label="System Sequence">
            <Textarea v-model="activeTemplate.system_sequence" :rows="2" />
          </FormItem>
          <FormItem label="System Suffix">
            <Textarea v-model="activeTemplate.system_suffix" :rows="1" />
          </FormItem>
        </div>

        <FormItem label="Stop Sequence">
          <Input v-model="activeTemplate.stop_sequence" placeholder="e.g. <|im_end|>" />
        </FormItem>

        <div class="grid-2">
          <FormItem label="Names Behavior">
            <Select v-model="activeTemplate.names_behavior" :options="namesBehaviorOptions" />
          </FormItem>
          <div class="checkbox-group">
            <Checkbox v-model="activeTemplate.sequences_as_stop_strings" label="Sequences as Stop Strings" />
            <Checkbox v-model="activeTemplate.wrap" label="Wrap" />
            <Checkbox v-model="activeTemplate.macro" label="Macro" />
            <Checkbox v-model="activeTemplate.skip_examples" label="Skip Examples" />
          </div>
        </div>

        <details>
          <summary>Advanced</summary>
          <div class="grid-2 mt-2">
            <FormItem label="First Output Sequence">
              <Input v-model="activeTemplate.first_output_sequence" />
            </FormItem>
            <FormItem label="Last Output Sequence">
              <Input v-model="activeTemplate.last_output_sequence" />
            </FormItem>
            <FormItem label="Last System Sequence">
              <Input v-model="activeTemplate.last_system_sequence" />
            </FormItem>
            <FormItem label="User Alignment Message">
              <Input v-model="activeTemplate.user_alignment_message" />
            </FormItem>
          </div>
        </details>
      </div>

      <div class="popup-controls">
        <Button variant="confirm" @click="save">{{ t('common.save') }}</Button>
        <Button @click="close">{{ t('common.cancel') }}</Button>
      </div>
    </div>
  </dialog>
</template>
