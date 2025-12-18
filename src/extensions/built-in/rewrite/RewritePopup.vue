<script setup lang="ts">
import * as Diff from 'diff';
import { computed, onMounted, ref, watch } from 'vue';
import { ConnectionProfileSelector } from '../../../components/common';
import { Button, Checkbox, CollapsibleSection, FormItem, Input, Select, Textarea } from '../../../components/UI';
import type { Character, ExtensionAPI, Persona } from '../../../types';
import { RewriteService } from './RewriteService';
import { DEFAULT_TEMPLATES, type RewriteSettings, type RewriteTemplateOverride } from './types';

// TODO: i18n

const props = defineProps<{
  api: ExtensionAPI<RewriteSettings>;
  originalText: string;
  identifier: string;
  referenceMessageIndex?: number;
  onApply: (text: string) => void;
  onCancel: () => void;
  closePopup?: () => void;
}>();

const service = new RewriteService(props.api);

// Settings State
const settings = ref<RewriteSettings>(
  props.api.settings.get() || {
    templates: [...DEFAULT_TEMPLATES],
    lastUsedTemplates: {},
    templateOverrides: {},
  },
);

// UI State
const selectedTemplateId = ref<string>('');
const selectedProfile = ref<string>('');
const promptOverride = ref<string>('');
const contextMessageCount = ref<number>(0);
const escapeMacros = ref<boolean>(true);
const argOverrides = ref<Record<string, boolean | number | string>>({});

// Generation State
const generatedText = ref<string>('');
const isGenerating = ref<boolean>(false);

// Diff State
const leftHtml = ref<string>('');
const rightHtml = ref<string>('');
const leftPaneRef = ref<HTMLElement | null>(null);
const rightPaneRef = ref<HTMLElement | null>(null);

// Constants
const IS_CHARACTER_FIELD = computed(() => props.identifier.startsWith('character.'));

onMounted(() => {
  if (!settings.value.lastUsedTemplates) settings.value.lastUsedTemplates = {};
  if (!settings.value.templateOverrides) settings.value.templateOverrides = {};

  const lastUsedTpl = settings.value.lastUsedTemplates[props.identifier];
  if (lastUsedTpl && settings.value.templates.find((t) => t.id === lastUsedTpl)) {
    selectedTemplateId.value = lastUsedTpl;
  } else if (settings.value.templates.length > 0) {
    selectedTemplateId.value = settings.value.templates[0].id;
  }

  loadTemplateOverrides();
  updateDiff(); // Initialize diff (likely just original text on left)
});

const templateOptions = computed(() => {
  return settings.value.templates.map((t) => ({ label: t.name, value: t.id }));
});

const currentTemplate = computed(() => settings.value.templates.find((t) => t.id === selectedTemplateId.value));

const canResetPrompt = computed(() => {
  if (!currentTemplate.value) return false;
  return promptOverride.value !== currentTemplate.value.prompt;
});

function loadTemplateOverrides() {
  const tplId = selectedTemplateId.value;
  if (!tplId) return;

  const overrides = settings.value.templateOverrides[tplId] || {};
  const tpl = settings.value.templates.find((t) => t.id === tplId);

  if (overrides.lastUsedProfile) {
    selectedProfile.value = overrides.lastUsedProfile;
  } else {
    selectedProfile.value = settings.value.defaultConnectionProfile || '';
  }

  promptOverride.value = overrides.prompt ?? tpl?.prompt ?? '';
  contextMessageCount.value = overrides.lastUsedXMessages ?? 0;
  escapeMacros.value = overrides.escapeInputMacros ?? true;

  // Load args
  const args: Record<string, boolean | number | string> = {};
  if (tpl?.args) {
    tpl.args.forEach((arg) => {
      // Priority: Override > Default
      if (overrides.args && overrides.args[arg.key] !== undefined) {
        args[arg.key] = overrides.args[arg.key];
      } else {
        args[arg.key] = arg.defaultValue;
      }
    });
  }
  argOverrides.value = args;
}

function resetPrompt() {
  if (currentTemplate.value) {
    promptOverride.value = currentTemplate.value.prompt;
  }
}

function saveState() {
  const tplId = selectedTemplateId.value;
  if (!tplId) return;

  settings.value.lastUsedTemplates[props.identifier] = tplId;

  const overrides: RewriteTemplateOverride = {
    lastUsedProfile: selectedProfile.value,
    prompt: promptOverride.value,
    lastUsedXMessages: Number(contextMessageCount.value),
    escapeInputMacros: escapeMacros.value,
    args: argOverrides.value,
  };

  settings.value.templateOverrides[tplId] = overrides;

  props.api.settings.set(undefined, settings.value);
  props.api.settings.save();
}

watch(selectedTemplateId, () => {
  loadTemplateOverrides();
});

// --- Diff Logic ---

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateDiff() {
  if (!generatedText.value) {
    // If no generation yet, just show original on left, empty right
    leftHtml.value = escapeHtml(props.originalText);
    rightHtml.value = '';
    return;
  }

  const diff = Diff.diffWords(props.originalText, generatedText.value);

  let lHtml = '';
  let rHtml = '';

  diff.forEach((part) => {
    const escapedVal = escapeHtml(part.value);

    if (part.removed) {
      // Exist in original, removed in new -> Show on Left (Red)
      lHtml += `<span class="diff-del">${escapedVal}</span>`;
    } else if (part.added) {
      // Not in original, added in new -> Show on Right (Green)
      rHtml += `<span class="diff-ins">${escapedVal}</span>`;
    } else {
      // Common -> Show on both
      lHtml += escapedVal;
      rHtml += escapedVal;
    }
  });

  leftHtml.value = lHtml;
  rightHtml.value = rHtml;
}

// --- Scroll Sync ---
let isSyncingLeft = false;
let isSyncingRight = false;

function onLeftScroll() {
  if (!leftPaneRef.value || !rightPaneRef.value) return;
  if (isSyncingLeft) {
    isSyncingLeft = false;
    return;
  }
  isSyncingRight = true;
  rightPaneRef.value.scrollTop = leftPaneRef.value.scrollTop;
  rightPaneRef.value.scrollLeft = leftPaneRef.value.scrollLeft;
}

function onRightScroll() {
  if (!leftPaneRef.value || !rightPaneRef.value) return;
  if (isSyncingRight) {
    isSyncingRight = false;
    return;
  }
  isSyncingLeft = true;
  leftPaneRef.value.scrollTop = rightPaneRef.value.scrollTop;
  leftPaneRef.value.scrollLeft = rightPaneRef.value.scrollLeft;
}

// --- Generation Logic ---

function getContextData() {
  let activeCharacter: Character | undefined;
  const persona: Persona | undefined = props.api.persona.getActive() || undefined;

  if (IS_CHARACTER_FIELD.value) {
    activeCharacter = props.api.character.getEditing() || undefined;
  } else {
    const actives = props.api.character.getActives();
    if (actives.length > 0) activeCharacter = actives[0];
  }

  return { activeCharacter, persona };
}

function getContextMessagesString(): string {
  if (contextMessageCount.value <= 0) return '';

  const history = props.api.chat.getHistory();
  if (history.length === 0) return '';

  const endIndex = props.referenceMessageIndex !== undefined ? props.referenceMessageIndex : history.length;
  const startIndex = Math.max(0, endIndex - contextMessageCount.value);

  const slice = history.slice(startIndex, endIndex);

  return slice.map((m) => `${m.name}: ${m.mes}`).join('\n');
}

async function handleGenerate() {
  if (!selectedProfile.value) {
    props.api.ui.showToast('Please select a connection profile', 'error');
    return;
  }

  saveState();

  isGenerating.value = true;
  generatedText.value = '';
  leftHtml.value = escapeHtml(props.originalText);
  rightHtml.value = '';

  try {
    const contextData = getContextData();
    const contextMessagesStr = getContextMessagesString();

    let inputToProcess = props.originalText;
    if (escapeMacros.value) {
      inputToProcess = `{{#raw}}${props.originalText}{{/raw}}`;
    }

    const response = await service.generateRewrite(
      inputToProcess,
      selectedTemplateId.value,
      selectedProfile.value,
      promptOverride.value,
      contextData,
      {
        contextMessages: contextMessagesStr,
        fieldName: props.identifier,
      },
      argOverrides.value,
    );

    if (typeof response === 'function') {
      const generator = response();
      let rawAcc = '';
      for await (const chunk of generator) {
        rawAcc += chunk.delta;
        generatedText.value = service.extractCodeBlock(rawAcc);
        updateDiff();
        // Auto scroll to bottom during generation if desired, but for diff view usually top is better.
        // We'll leave scroll as is.
      }
    } else {
      generatedText.value = service.extractCodeBlock(response.content);
      updateDiff();
    }
  } catch (error) {
    console.error(error);
    props.api.ui.showToast('Generation failed', 'error');
  } finally {
    isGenerating.value = false;
  }
}

function handleApply() {
  saveState();
  props.onApply(generatedText.value);
  props.closePopup?.();
}

function handleCancel() {
  props.onCancel();
  props.closePopup?.();
}
</script>

<template>
  <div class="rewrite-popup-content">
    <div class="controls-row">
      <div style="flex: 1">
        <FormItem label="Template">
          <Select v-model="selectedTemplateId" :options="templateOptions" />
        </FormItem>
      </div>
      <div style="flex: 1">
        <FormItem label="Connection Profile">
          <ConnectionProfileSelector v-model="selectedProfile" />
        </FormItem>
      </div>
    </div>

    <CollapsibleSection title="Context & Prompt" :is-open="true">
      <!-- Dynamic Arguments Section -->
      <div v-if="currentTemplate?.args && currentTemplate.args.length > 0" class="dynamic-args-grid">
        <div v-for="arg in currentTemplate.args" :key="arg.key" class="dynamic-arg-item">
          <Checkbox v-if="arg.type === 'boolean'" v-model="argOverrides[arg.key] as boolean" :label="arg.label" />
          <FormItem v-else :label="arg.label">
            <Input
              v-model="argOverrides[arg.key] as string | number"
              :type="arg.type === 'number' ? 'number' : 'text'"
            />
          </FormItem>
        </div>
      </div>

      <div class="context-controls">
        <div class="escape-control">
          <Checkbox
            v-model="escapeMacros"
            label="Escape Macros"
            title="Prevents {{macros}} in input text from being processed"
          />
        </div>
        <div class="flex-spacer"></div>
        <div class="msg-count-control">
          <span class="label">Context Messages:</span>
          <Input v-model="contextMessageCount" type="number" :min="0" :max="50" style="width: 60px" />
        </div>
      </div>
      <FormItem label="Instruction">
        <div class="input-with-reset">
          <Textarea v-model="promptOverride" :rows="2" />
          <Button
            v-if="canResetPrompt"
            class="reset-btn"
            icon="fa-rotate-left"
            variant="ghost"
            title="Reset to template default"
            @click="resetPrompt"
          />
        </div>
      </FormItem>
    </CollapsibleSection>

    <div class="split-view">
      <!-- Original / Left Pane -->
      <div class="pane">
        <div class="pane-header">Original</div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div ref="leftPaneRef" class="pane-content diff-content" @scroll="onLeftScroll" v-html="leftHtml"></div>
      </div>

      <!-- Generated / Right Pane -->
      <div class="pane">
        <div class="pane-header">
          New
          <span v-if="isGenerating" class="generating-indicator"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div ref="rightPaneRef" class="pane-content diff-content" @scroll="onRightScroll" v-html="rightHtml"></div>
      </div>
    </div>

    <div class="actions-row">
      <Button :disabled="isGenerating" @click="handleGenerate">
        <i class="fa-solid" :class="isGenerating ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'"></i>
        Generate
      </Button>
      <div class="spacer"></div>
      <Button variant="ghost" @click="handleCancel">Cancel</Button>
      <Button variant="confirm" :disabled="!generatedText || isGenerating" @click="handleApply">Apply</Button>
    </div>
  </div>
</template>

<style scoped>
.rewrite-popup-content {
  display: flex;
  flex-direction: column;
  gap: 15px;
  height: 100%;
}

.controls-row {
  display: flex;
  gap: 10px;
}

.context-controls {
  display: flex;
  gap: 15px;
  align-items: center;
  margin-bottom: 10px;
}

.dynamic-args-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 15px;
  padding-bottom: 15px;
  border-bottom: 1px dashed var(--theme-border-color);
}

.flex-spacer {
  flex: 1;
}

.msg-count-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
}

.escape-control {
  display: flex;
  align-items: center;
}

.input-with-reset {
  position: relative;
  display: flex;
}
.input-with-reset :deep(textarea) {
  flex: 1;
}
.reset-btn {
  margin-left: 5px;
  height: auto;
  align-self: flex-start;
}

.split-view {
  display: flex;
  gap: 10px;
  flex: 1;
  min-height: 300px;
  overflow: hidden;
}

.pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  background-color: var(--black-30a);
  min-width: 0;
  min-height: 0;
  max-height: 400px;
}

.pane-header {
  padding: 5px 10px;
  border-bottom: 1px solid var(--theme-border-color);
  font-weight: bold;
  background-color: var(--white-20a);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pane-content {
  flex: 1;
  padding: 10px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-family-mono);
  font-size: 0.9em;
  line-height: 1.5;
}

:deep(.diff-del) {
  background-color: var(--color-accent-crimson-70a);
  text-decoration: line-through;
  opacity: 0.8;
  border-radius: 2px;
}

:deep(.diff-ins) {
  background-color: var(--color-accent-green-70a);
  border-radius: 2px;
}

.actions-row {
  display: flex;
  gap: 10px;
  margin-top: auto;
}

.spacer {
  flex: 1;
}

.generating-indicator {
  color: var(--theme-text-color);
  opacity: 0.7;
}
</style>
