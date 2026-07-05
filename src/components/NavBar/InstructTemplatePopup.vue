<script setup lang="ts">
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
          activeTemplate.value = JSON.parse(JSON.stringify(found));
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
      <h3>{{ templateId ? t('instruct.template.editTitle') : t('instruct.template.newTitle') }}</h3>

      <div class="template-form">
        <FormItem :label="t('instruct.template.name')">
          <Input v-model="activeTemplate.name" />
        </FormItem>

        <div class="grid-2">
          <FormItem :label="t('instruct.template.inputSequence')">
            <Textarea v-model="activeTemplate.input_sequence" :rows="2" />
          </FormItem>
          <FormItem :label="t('instruct.template.inputSuffix')">
            <Textarea v-model="activeTemplate.input_suffix" :rows="1" />
          </FormItem>
        </div>

        <div class="grid-2">
          <FormItem :label="t('instruct.template.outputSequence')">
            <Textarea v-model="activeTemplate.output_sequence" :rows="2" />
          </FormItem>
          <FormItem :label="t('instruct.template.outputSuffix')">
            <Textarea v-model="activeTemplate.output_suffix" :rows="1" />
          </FormItem>
        </div>

        <div class="grid-2">
          <FormItem :label="t('instruct.template.systemSequence')">
            <Textarea v-model="activeTemplate.system_sequence" :rows="2" />
          </FormItem>
          <FormItem :label="t('instruct.template.systemSuffix')">
            <Textarea v-model="activeTemplate.system_suffix" :rows="1" />
          </FormItem>
        </div>

        <FormItem :label="t('instruct.template.stopSequence')">
          <Input v-model="activeTemplate.stop_sequence" :placeholder="t('instruct.template.stopSequencePlaceholder')" />
        </FormItem>

        <div class="grid-2">
          <FormItem :label="t('instruct.template.namesBehavior')">
            <Select v-model="activeTemplate.names_behavior" :options="namesBehaviorOptions" />
          </FormItem>
          <div class="checkbox-group">
            <Checkbox
              v-model="activeTemplate.sequences_as_stop_strings"
              :label="t('instruct.template.sequencesAsStopStrings')"
            />
            <Checkbox v-model="activeTemplate.wrap" :label="t('instruct.template.wrap')" />
            <Checkbox v-model="activeTemplate.macro" :label="t('instruct.template.macro')" />
            <Checkbox v-model="activeTemplate.skip_examples" :label="t('instruct.template.skipExamples')" />
          </div>
        </div>

        <details>
          <summary>{{ t('common.advanced') }}</summary>
          <div class="grid-2 mt-2">
            <FormItem :label="t('instruct.template.firstOutputSequence')">
              <Input v-model="activeTemplate.first_output_sequence" />
            </FormItem>
            <FormItem :label="t('instruct.template.lastOutputSequence')">
              <Input v-model="activeTemplate.last_output_sequence" />
            </FormItem>
            <FormItem :label="t('instruct.template.lastSystemSequence')">
              <Input v-model="activeTemplate.last_system_sequence" />
            </FormItem>
            <FormItem :label="t('instruct.template.userAlignmentMessage')">
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
