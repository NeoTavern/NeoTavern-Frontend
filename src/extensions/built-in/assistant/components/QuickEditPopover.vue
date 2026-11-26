<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Button, Textarea } from '../../../../components/UI';
import type { ExtensionAPI } from '../../../../types';
import TextDiff from '../../_shared/components/TextDiff.vue';
import {
  buildQuickEditMessages,
  resolveContext,
  resolveQuickEditProfile,
  runQuickEdit,
  type QuickEditTarget,
  type QuickEditTurn,
} from '../quick-edit';
import type { AssistantCommand, AssistantSettings } from '../types';

const props = defineProps<{
  api: ExtensionAPI<AssistantSettings>;
  target: QuickEditTarget;
  /** Runs this command as soon as the popover opens. */
  initialCommandId?: string;
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const t = props.api.i18n.t;
const settings = props.api.settings.get();

const commands = computed<AssistantCommand[]>(() => {
  const lastId = settings.lastCommandByTarget[props.target.identifier];
  const last = settings.commands.find((command) => command.id === lastId);
  return last ? [last, ...settings.commands.filter((command) => command !== last)] : settings.commands;
});

const instruction = ref('');
const turns = ref<QuickEditTurn[]>([]);
const streamedText = ref('');
const isGenerating = ref(false);
const errorMessage = ref('');
/** The command the current result started from; follow-ups keep it. */
const activeCommand = ref<AssistantCommand>();
let abortController: AbortController | null = null;

const output = computed(() => (isGenerating.value ? streamedText.value : (turns.value.at(-1)?.output ?? '')));
const hasResult = computed(() => turns.value.length > 0);

async function run(text: string, followUp: boolean) {
  if (isGenerating.value || !text.trim()) return;
  const profile = resolveQuickEditProfile(props.api, settings, activeCommand.value);
  if (!profile) {
    showError(t('extensionsBuiltin.assistant.quickEdit.noProfile'));
    return;
  }

  errorMessage.value = '';
  streamedText.value = '';
  isGenerating.value = true;
  abortController = new AbortController();
  const history = followUp ? turns.value : [];
  try {
    const context = await resolveContext(props.api, props.target.context, settings.contextMessageCount);
    const messages = buildQuickEditMessages(props.target, context, text, history);
    const result = await runQuickEdit(props.api, {
      messages,
      profile,
      signal: abortController.signal,
      onText: (partial) => (streamedText.value = partial),
    });
    turns.value = [...history, { instruction: text, output: result }];
    instruction.value = '';
  } catch (error) {
    if (abortController?.signal.aborted) {
      if (streamedText.value) turns.value = [...history, { instruction: text, output: streamedText.value }];
      props.api.ui.showToast(t('extensionsBuiltin.assistant.quickEdit.stopped'), 'info');
    } else {
      console.error(error);
      showError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    isGenerating.value = false;
    abortController = null;
  }
}

function showError(message: string) {
  errorMessage.value = message;
  props.api.ui.showToast(message, 'error');
}

function runCommand(command: AssistantCommand) {
  activeCommand.value = command;
  run(command.prompt, false);
}

function submitInstruction() {
  if (!hasResult.value) activeCommand.value = undefined;
  run(instruction.value, hasResult.value);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitInstruction();
  }
}

function stop() {
  abortController?.abort();
}

async function accept() {
  try {
    await props.target.apply(output.value);
  } catch (error) {
    console.error(error);
    showError(error instanceof Error ? error.message : String(error));
    return;
  }
  if (activeCommand.value) {
    props.api.settings.set('lastCommandByTarget', {
      ...settings.lastCommandByTarget,
      [props.target.identifier]: activeCommand.value.id,
    });
    props.api.settings.save();
  }
  emit('close');
}

function copy() {
  navigator.clipboard.writeText(output.value).then(
    () => props.api.ui.showToast(t('extensionsBuiltin.assistant.quickEdit.copied'), 'success'),
    () => props.api.ui.showToast(t('extensionsBuiltin.assistant.quickEdit.copyFailed'), 'error'),
  );
}

onMounted(() => {
  const command = settings.commands.find((candidate) => candidate.id === props.initialCommandId);
  if (command) runCommand(command);
});

onUnmounted(stop);
</script>
<template>
  <div class="quick-edit">
    <div class="quick-edit-header">
      <span class="quick-edit-title">{{ target.label }}</span>
      <Button variant="ghost" icon="fa-xmark" :title="t('common.close')" @click="emit('close')" />
    </div>

    <div v-if="commands.length > 0" class="quick-edit-commands">
      <button
        v-for="command in commands"
        :key="command.id"
        class="quick-edit-chip"
        :class="{ active: activeCommand?.id === command.id }"
        :title="command.prompt"
        :disabled="isGenerating"
        @click="runCommand(command)"
      >
        {{ command.name }}
      </button>
    </div>

    <Textarea
      v-model="instruction"
      :rows="2"
      :resizable="false"
      :disabled="isGenerating"
      :placeholder="
        hasResult
          ? t('extensionsBuiltin.assistant.quickEdit.followUpPlaceholder')
          : t('extensionsBuiltin.assistant.quickEdit.instructionPlaceholder')
      "
      @keydown="handleKeydown"
    />

    <div v-if="errorMessage" class="quick-edit-error">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>{{ errorMessage }}</span>
    </div>

    <TextDiff v-if="isGenerating || hasResult" class="quick-edit-diff" :old-value="target.text" :new-value="output">
      <template #old-header>{{ t('extensionsBuiltin.assistant.quickEdit.original') }}</template>
      <template #new-header>
        <span>
          {{ t('extensionsBuiltin.assistant.quickEdit.result') }}
          <i v-if="isGenerating" class="fa-solid fa-circle-notch fa-spin"></i>
        </span>
      </template>
    </TextDiff>

    <div class="quick-edit-actions">
      <Button
        v-if="isGenerating"
        icon="fa-stop"
        :label="t('extensionsBuiltin.assistant.quickEdit.stop')"
        @click="stop"
      />
      <template v-else-if="hasResult">
        <Button icon="fa-copy" :title="t('extensionsBuiltin.assistant.quickEdit.copy')" @click="copy" />
        <Button
          variant="danger"
          icon="fa-xmark"
          :label="t('extensionsBuiltin.assistant.quickEdit.reject')"
          @click="emit('close')"
        />
        <Button
          variant="confirm"
          icon="fa-check"
          :label="t('extensionsBuiltin.assistant.quickEdit.accept')"
          @click="accept"
        />
      </template>
      <Button
        v-else
        icon="fa-paper-plane"
        :label="t('extensionsBuiltin.assistant.quickEdit.run')"
        :disabled="!instruction.trim()"
        @click="submitInstruction"
      />
    </div>
  </div>
</template>
<style scoped lang="scss">
.quick-edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.quick-edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.quick-edit-title {
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-edit-commands {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.quick-edit-chip {
  padding: 2px 10px;
  border: 1px solid var(--theme-border-color);
  border-radius: 999px;
  background-color: var(--black-30a);
  color: inherit;
  cursor: pointer;
  font-size: 0.9em;

  &:hover:not(:disabled) {
    background-color: var(--white-20a);
  }

  &.active {
    border-color: var(--theme-emphasis-color);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.quick-edit-error {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  color: var(--color-accent-crimson);
  font-size: 0.9em;
  word-break: break-word;
}

.quick-edit-diff {
  min-height: 160px;
  max-height: 50vh;
}

.quick-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
