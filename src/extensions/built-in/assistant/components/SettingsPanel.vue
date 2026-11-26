<script setup lang="ts">
import { computed, reactive } from 'vue';
import { DraggableList } from '../../../../components/common';
import { Button, Checkbox, FormItem, Input, Select, Textarea } from '../../../../components/UI';
import type { ExtensionAPI } from '../../../../types';
import { uuidv4 } from '../../../../utils/commons';
import ConnectionProfileField from '../../_shared/components/ConnectionProfileField.vue';
import { useExtensionSettings } from '../../_shared/composables/use-extension-settings';
import {
  type AssistantCommand,
  type AssistantSettings,
  COMMAND_NAME_PATTERN,
  createDefaultSettings,
  migrateAssistantSettings,
} from '../types';

const props = defineProps<{
  api: ExtensionAPI<AssistantSettings>;
}>();

const t = props.api.i18n.t;
const settings = useExtensionSettings<AssistantSettings>(props.api, createDefaultSettings(), migrateAssistantSettings);

/**
 * Name inputs edit a draft. Only a valid, unique draft is written to the command, so a stored name always
 * matches `COMMAND_NAME_PATTERN` and stays unique.
 */
const nameDrafts = reactive<Record<string, string>>({});

function nameDraft(command: AssistantCommand): string {
  return nameDrafts[command.id] ?? command.name;
}

function nameError(command: AssistantCommand): string | undefined {
  const name = nameDraft(command);
  if (!COMMAND_NAME_PATTERN.test(name)) return t('extensionsBuiltin.assistant.settings.nameInvalid');
  if (settings.value.commands.some((other) => other.id !== command.id && other.name === name)) {
    return t('extensionsBuiltin.assistant.settings.nameTaken');
  }
  return undefined;
}

function updateName(command: AssistantCommand, value: string | number) {
  nameDrafts[command.id] = String(value);
  if (!nameError(command)) command.name = nameDrafts[command.id];
}

function addCommand() {
  const names = new Set(settings.value.commands.map((command) => command.name));
  let n = 1;
  while (names.has(`command-${n}`)) n++;
  settings.value.commands.push({
    id: uuidv4(),
    name: `command-${n}`,
    prompt: '',
    connectionProfile: '',
    pinned: false,
    autoAccept: false,
  });
}

function deleteCommand(command: AssistantCommand) {
  settings.value.commands = settings.value.commands.filter((other) => other.id !== command.id);
  delete nameDrafts[command.id];
}

/** A command's '' means the assistant's default profile, not the global one, so it gets its own label. */
const commandProfileOptions = computed(() => [
  { label: t('extensionsBuiltin.assistant.settings.commandProfileDefault'), value: '' },
  ...props.api.api
    .getConnectionProfiles()
    .map((profile) => ({ label: profile.name, value: profile.id }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]);

function setPinned(command: AssistantCommand, pinned: boolean) {
  command.pinned = pinned;
  if (!pinned) command.autoAccept = false;
}
</script>

<template>
  <div class="assistant-settings">
    <ConnectionProfileField
      v-model="settings.connectionProfile"
      :label="t('extensionsBuiltin.assistant.settings.connectionProfile')"
      :description="t('extensionsBuiltin.assistant.settings.connectionProfileHint')"
    />

    <FormItem
      :label="t('extensionsBuiltin.assistant.settings.contextMessageCount')"
      :description="t('extensionsBuiltin.assistant.settings.contextMessageCountHint')"
    >
      <Input v-model.number="settings.contextMessageCount" type="number" :min="0" :step="1" />
    </FormItem>

    <FormItem
      :label="t('extensionsBuiltin.assistant.settings.commands')"
      :description="t('extensionsBuiltin.assistant.settings.commandsHint')"
    >
      <DraggableList
        :items="settings.commands"
        item-key="id"
        handle-class="assistant-command-handle"
        @update:items="settings.commands = $event"
      >
        <template #default="{ item: command }">
          <div class="assistant-command">
            <div class="assistant-command-header">
              <i
                class="fa-solid fa-grip-lines assistant-command-handle"
                :title="t('extensionsBuiltin.assistant.settings.dragToReorder')"
              ></i>
              <FormItem class="assistant-command-name" :error="nameError(command)">
                <Input
                  :model-value="nameDraft(command)"
                  :placeholder="t('extensionsBuiltin.assistant.settings.name')"
                  @update:model-value="updateName(command, $event)"
                />
              </FormItem>
              <Button
                variant="danger"
                icon="fa-trash-can"
                :title="t('extensionsBuiltin.assistant.settings.deleteCommand')"
                @click="deleteCommand(command)"
              />
            </div>

            <FormItem :label="t('extensionsBuiltin.assistant.settings.prompt')">
              <Textarea v-model="command.prompt" :rows="2" />
            </FormItem>

            <FormItem :label="t('extensionsBuiltin.assistant.settings.commandProfile')">
              <Select v-model="command.connectionProfile" :options="commandProfileOptions" searchable />
            </FormItem>

            <div class="assistant-command-flags">
              <Checkbox
                :model-value="command.pinned"
                :label="t('extensionsBuiltin.assistant.settings.pinned')"
                :title="t('extensionsBuiltin.assistant.settings.pinnedHint')"
                @update:model-value="setPinned(command, $event)"
              />
              <Checkbox
                v-model="command.autoAccept"
                :disabled="!command.pinned"
                :label="t('extensionsBuiltin.assistant.settings.autoAccept')"
                :title="t('extensionsBuiltin.assistant.settings.autoAcceptHint')"
              />
            </div>
          </div>
        </template>
      </DraggableList>
      <Button
        icon="fa-plus"
        :label="t('extensionsBuiltin.assistant.settings.addCommand')"
        class="assistant-add-command"
        @click="addCommand"
      />
    </FormItem>
  </div>
</template>

<style scoped>
.assistant-settings {
  display: flex;
  flex-direction: column;
  padding: 10px;
}

.assistant-command {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid var(--theme-border-color);
  border-radius: 6px;
  background-color: var(--black-30a);
}

.assistant-command-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.assistant-command-handle {
  padding: 10px 2px;
  cursor: grab;
  opacity: 0.5;
}

.assistant-command-name {
  flex: 1;
  margin: 0;
}

.assistant-command-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.assistant-add-command {
  align-self: flex-start;
}
</style>
