<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '../../../components/UI';
import type { ChatMessage, ExtensionAPI } from '../../../types';
import type { ApiChatMessage } from '../../../types/generation';
import {
  DEFAULT_IMPERSONATE_PROMPT,
  DEFAULT_SETTINGS,
  type RoadwayChatExtra,
  type RoadwayMessageExtra,
  type RoadwaySettings,
} from './types';

const props = defineProps<{
  api: ExtensionAPI<RoadwaySettings, RoadwayChatExtra, RoadwayMessageExtra>;
  message: ChatMessage;
  index: number;
}>();

// TODO: i18n

const choiceMade = ref(false);
const isImpersonating = ref(false);
const impersonateAbortController = ref<AbortController | null>(null);

const roadwayExtra = props.message.extra['core.roadway'];
const choices = roadwayExtra?.choices ?? [];

function getSettings(): RoadwaySettings {
  const saved = props.api.settings.get();
  return { ...DEFAULT_SETTINGS, ...saved };
}

async function markChoiceAsMade() {
  choiceMade.value = true;
  await props.api.chat.updateMessageObject(props.index, {
    extra: {
      'core.roadway': {
        choiceMade: true,
      },
    },
  });
}

async function handleSend(choiceText: string) {
  await markChoiceAsMade();
  props.api.chat.sendMessage(choiceText);
}

async function handleEdit(choiceText: string) {
  props.api.chat.setChatInput(choiceText);
  // Focus the input field after setting the text
  props.api.chat.focusChatInput();
}

async function handleImpersonate(choiceText: string) {
  isImpersonating.value = true;
  impersonateAbortController.value = new AbortController();
  const settings = getSettings();
  const rawImpersonatePrompt = settings.impersonatePrompt || DEFAULT_IMPERSONATE_PROMPT;
  const processedImpersonatePrompt = props.api.macro.process(rawImpersonatePrompt, undefined, {
    choice: choiceText,
  });

  try {
    const chatHistory = props.api.chat.getHistory().slice(0, props.index + 1);
    const generationId = `roadway-impersonate-${props.index}-${Date.now()}`;
    const baseApiMessages = await props.api.chat.buildPrompt({ chatHistory, generationId });

    const messages: ApiChatMessage[] = [
      ...baseApiMessages,
      { role: 'system', name: 'System', content: processedImpersonatePrompt },
    ];

    const responseStream = await props.api.llm.generate(messages, {
      connectionProfile: settings.impersonateConnectionProfile,
      signal: impersonateAbortController.value.signal,
    });

    if (Symbol.asyncIterator in responseStream) {
      let fullResponse = '';
      for await (const chunk of responseStream) {
        if (impersonateAbortController.value.signal.aborted) break;
        fullResponse += chunk.delta;
        props.api.chat.setChatInput(fullResponse);
      }
    } else {
      props.api.chat.setChatInput(responseStream.content);
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.error('Roadway impersonate error:', error);
      props.api.ui.showToast('Failed to impersonate response.', 'error');
    }
  } finally {
    isImpersonating.value = false;
    impersonateAbortController.value = null;
    props.api.chat.focusChatInput();
  }
}

function stopImpersonation() {
  if (impersonateAbortController.value) {
    impersonateAbortController.value.abort();
  }
}

function stopChoiceGeneration() {
  // @ts-expect-error custom event
  props.api.events.emit('roadway:abort-choice-generation', { messageIndex: props.index });
}
</script>

<template>
  <div
    v-if="!choiceMade && (choices.length > 0 || roadwayExtra?.isGeneratingChoices)"
    class="roadway-choices-container"
  >
    <div v-if="isImpersonating" class="roadway-overlay">
      <span>Generating impersonated response...</span>
      <Button variant="danger" icon="fa-stop" @click="stopImpersonation">Stop</Button>
    </div>
    <div v-else-if="roadwayExtra?.isGeneratingChoices" class="roadway-overlay roadway-overlay--generating">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <span>Generating choices...</span>
      <Button variant="danger" size="sm" @click="stopChoiceGeneration">Stop</Button>
    </div>

    <div class="roadway-choices-header">Choices</div>
    <ul v-if="choices.length > 0" class="roadway-choices-list">
      <li v-for="(choice, i) in choices" :key="i" class="roadway-choice-item">
        <span class="choice-text">{{ choice }}</span>
        <div class="choice-actions">
          <Button
            variant="ghost"
            icon="fa-paper-plane"
            title="Send"
            :disabled="isImpersonating"
            @click="handleSend(choice)"
          />
          <Button
            variant="ghost"
            icon="fa-pencil"
            title="Edit"
            :disabled="isImpersonating"
            @click="handleEdit(choice)"
          />
          <Button
            variant="ghost"
            icon="fa-user-secret"
            title="Impersonate"
            :disabled="isImpersonating"
            @click="handleImpersonate(choice)"
          />
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.roadway-choices-container {
  margin: var(--spacing-sm) 0;
  border: 1px solid var(--theme-border-color);
  background-color: var(--black-30a);
  border-radius: var(--base-border-radius);
  position: relative;
  overflow: hidden;
  min-height: 40px;
}

.roadway-choices-header {
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: 0.9em;
  font-weight: bold;
  color: var(--theme-emphasis-color);
  border-bottom: 1px solid var(--theme-border-color);
}

.roadway-choices-list {
  list-style-type: none;
  padding: 0;
  margin: 0;
}

.roadway-choice-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  font-size: 0.95em;
  border-bottom: 1px solid var(--theme-border-color);
  transition: background-color var(--animation-duration-sm);
}

.roadway-choice-item:last-child {
  border-bottom: none;
}

.roadway-choice-item:hover {
  background-color: var(--black-50a);
}

.choice-text {
  flex-grow: 1;
}

.choice-actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--spacing-xxs);
}

.roadway-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(2px);
  z-index: 10;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: var(--spacing-md);
  color: var(--theme-text-color);
  font-size: 1.1em;
}

.roadway-overlay--generating {
  flex-direction: row;
  font-size: 1em;
}
</style>
