<script setup lang="ts">
import { autoUpdate, flip, offset, size, useFloating } from '@floating-ui/vue';
import { computed, nextTick, ref, watch } from 'vue';
import type { ExtensionAPI } from '../../../../types';
import { suggestAt, suggestCommands, suggestMessages, type AssistantRef, type AtSources } from '../references';
import type { AssistantSettings } from '../types';

const props = withDefaults(
  defineProps<{
    api: ExtensionAPI<AssistantSettings>;
    /** Offer `/` commands at the start of the text. */
    commands?: boolean;
    disabled?: boolean;
    placeholder?: string;
    rows?: number;
  }>(),
  { commands: true, disabled: false, placeholder: '', rows: 3 },
);

const text = defineModel<string>({ required: true });
const refs = defineModel<AssistantRef[]>('refs', { required: true });
const emit = defineEmits<{ (e: 'submit'): void }>();

const t = props.api.i18n.t;
const textarea = ref<HTMLTextAreaElement>();

type Trigger = { char: '@' | '#' | '/'; query: string; start: number; end: number };
type Suggestion = { key: string; icon: string; label: string; hint: string; pick: () => void };

const trigger = ref<Trigger | null>(null);
const highlighted = ref(0);
/** Lorebook entries, loaded on the first `@`. */
const loadedEntries = ref<AtSources['entries']>([]);
let entriesLoading: Promise<void> | null = null;

const REF_ICONS: Record<AssistantRef['kind'], string> = {
  character: 'fa-user',
  persona: 'fa-id-card',
  lorebook: 'fa-book',
  entry: 'fa-file-lines',
  messages: 'fa-comment',
};

const REF_KIND_LABELS: Record<AssistantRef['kind'], string> = {
  character: t('extensionsBuiltin.assistant.panel.refKinds.character'),
  persona: t('extensionsBuiltin.assistant.panel.refKinds.persona'),
  lorebook: t('extensionsBuiltin.assistant.panel.refKinds.lorebook'),
  entry: t('extensionsBuiltin.assistant.panel.refKinds.entry'),
  messages: t('extensionsBuiltin.assistant.panel.refKinds.messages'),
};

function loadEntries() {
  entriesLoading ??= (async () => {
    const names = props.api.worldInfo.getAllBookNames().map((header) => header.name);
    const books = await Promise.all(names.map((name) => props.api.worldInfo.getBook(name)));
    loadedEntries.value = books.flatMap((book) => (book ? [{ book: book.name, entries: book.entries }] : []));
  })();
}

function detectTrigger() {
  const element = textarea.value;
  if (!element || element.selectionStart !== element.selectionEnd) {
    trigger.value = null;
    return;
  }
  const caret = element.selectionStart;
  const before = text.value.slice(0, caret);
  const command = props.commands ? /^\/([a-z0-9-]*)$/.exec(before) : null;
  const mention = /(?:^|\s)([@#])([^\s@#]*)$/.exec(before);
  const next: Trigger | null = command
    ? { char: '/', query: command[1], start: 0, end: caret }
    : mention
      ? { char: mention[1] as '@' | '#', query: mention[2], start: caret - mention[2].length - 1, end: caret }
      : null;
  if (next?.char === '@') loadEntries();
  if (next?.char !== trigger.value?.char || next?.query !== trigger.value?.query) highlighted.value = 0;
  trigger.value = next;
}

function replaceTrigger(replacement: string) {
  const current = trigger.value;
  if (!current) return;
  text.value = text.value.slice(0, current.start) + replacement + text.value.slice(current.end);
  trigger.value = null;
  const caret = current.start + replacement.length;
  nextTick(() => {
    textarea.value?.focus();
    textarea.value?.setSelectionRange(caret, caret);
  });
}

function addRef(ref: AssistantRef) {
  if (!refs.value.some((existing) => existing.kind === ref.kind && existing.label === ref.label)) {
    refs.value = [...refs.value, ref];
  }
  replaceTrigger('');
}

function removeRef(index: number) {
  refs.value = refs.value.filter((_, at) => at !== index);
}

const suggestions = computed<Suggestion[]>(() => {
  const current = trigger.value;
  if (!current) return [];
  const toSuggestion = (ref: AssistantRef, key: string): Suggestion => ({
    key,
    icon: REF_ICONS[ref.kind],
    label: ref.label,
    hint: REF_KIND_LABELS[ref.kind],
    pick: () => addRef(ref),
  });

  if (current.char === '/') {
    return suggestCommands(current.query, props.api.settings.get().commands).map((command) => ({
      key: command.id,
      icon: 'fa-terminal',
      label: `/${command.name}`,
      hint: command.prompt,
      pick: () => replaceTrigger(`/${command.name} `),
    }));
  }
  if (current.char === '#') {
    const length = props.api.chat.getChatInfo() ? props.api.chat.getHistory().length : 0;
    return suggestMessages(current.query, length).map((ref) => toSuggestion(ref, ref.label));
  }
  const sources: AtSources = {
    characters: props.api.character.getAll(),
    personas: props.api.persona.getAll(),
    books: props.api.worldInfo.getAllBookNames().map((header) => header.name),
    entries: loadedEntries.value,
  };
  return suggestAt(current.query, sources).map((ref, index) => toSuggestion(ref, `${ref.kind}:${index}`));
});

watch(suggestions, (list) => {
  if (highlighted.value >= list.length) highlighted.value = 0;
});

const listElement = ref<HTMLElement>();
// The list lives in <body>, so a host with overflow (the quick-edit popup, the sidebar) can't clip it.
const { floatingStyles } = useFloating(textarea, listElement, {
  placement: 'top-start',
  open: computed(() => suggestions.value.length > 0),
  whileElementsMounted: autoUpdate,
  middleware: [
    offset(4),
    flip({ padding: 8 }),
    size({
      padding: 8,
      apply({ rects, elements, availableHeight }) {
        Object.assign(elements.floating.style, {
          width: `${rects.reference.width}px`,
          maxHeight: `${Math.min(240, availableHeight)}px`,
        });
      },
    }),
  ],
});
watch(highlighted, async (index) => {
  await nextTick();
  listElement.value?.children[index]?.scrollIntoView({ block: 'nearest' });
});

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  const list = suggestions.value;
  if (list.length > 0) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      highlighted.value = (highlighted.value + step + list.length) % list.length;
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      list[highlighted.value].pick();
      return;
    }
  }
  if (event.key === 'Escape' && trigger.value) {
    event.preventDefault();
    event.stopPropagation();
    trigger.value = null;
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    emit('submit');
  }
}

function handleInput(event: Event) {
  text.value = (event.target as HTMLTextAreaElement).value;
  detectTrigger();
}

function focus() {
  textarea.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <div class="mention-input">
    <div v-if="refs.length > 0" class="mention-input-chips">
      <span
        v-for="(item, index) in refs"
        :key="`${item.kind}:${item.label}`"
        class="mention-chip"
        :title="REF_KIND_LABELS[item.kind]"
      >
        <i class="fa-solid" :class="REF_ICONS[item.kind]"></i>
        <span class="mention-chip-label">{{ item.label }}</span>
        <button
          class="mention-chip-remove"
          :title="t('extensionsBuiltin.assistant.panel.removeRef')"
          :disabled="disabled"
          @click="removeRef(index)"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </span>
    </div>

    <div class="mention-input-field">
      <Teleport to="body">
        <ul
          v-if="suggestions.length > 0"
          ref="listElement"
          class="mention-suggestions"
          :style="floatingStyles"
          role="listbox"
        >
          <li
            v-for="(suggestion, index) in suggestions"
            :key="suggestion.key"
            class="mention-suggestion"
            :class="{ highlighted: index === highlighted }"
            role="option"
            :aria-selected="index === highlighted"
            @mousedown.prevent="suggestion.pick()"
            @mouseenter="highlighted = index"
          >
            <i class="fa-solid" :class="suggestion.icon"></i>
            <span class="mention-suggestion-label">{{ suggestion.label }}</span>
            <span class="mention-suggestion-hint">{{ suggestion.hint }}</span>
          </li>
        </ul>
      </Teleport>
      <textarea
        ref="textarea"
        class="text-pole mention-input-textarea"
        :value="text"
        :rows="rows"
        :placeholder="placeholder"
        :disabled="disabled"
        @input="handleInput"
        @keydown="handleKeydown"
        @keyup="(event) => !['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key) && detectTrigger()"
        @click="detectTrigger"
        @blur="trigger = null"
      ></textarea>
    </div>
  </div>
</template>

<style scoped lang="scss">
.mention-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.mention-input-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mention-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 1px 4px 1px 8px;
  border: 1px solid var(--theme-border-color);
  border-radius: 999px;
  background-color: var(--black-30a);
  font-size: 0.85em;
}

.mention-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-chip-remove {
  padding: 0 4px;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;

  &:hover:not(:disabled) {
    opacity: 1;
  }
}

.mention-input-textarea {
  width: 100%;
  resize: vertical;
}

.mention-suggestions {
  // Popups sit at --z-toast - 1, and the quick-edit popup hosts this input.
  z-index: var(--z-toast);
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  list-style: none;
  border: 1px solid var(--theme-border-color);
  border-radius: 6px;
  background-color: var(--theme-background-tint);
  backdrop-filter: blur(var(--blur-strength, 10px));
  box-shadow: 0 4px 12px var(--black-50a);
}

.mention-suggestion {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  cursor: pointer;

  &.highlighted {
    background-color: var(--white-20a);
  }
}

.mention-suggestion-label {
  flex-shrink: 0;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-suggestion-hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.6;
  font-size: 0.85em;
}
</style>
