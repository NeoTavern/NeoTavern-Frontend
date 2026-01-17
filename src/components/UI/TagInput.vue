<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { uuidv4 } from '../../utils/commons';
import Button from './Button.vue';

interface Props {
  modelValue: string[];
  placeholder?: string;
  label?: string;
  suggestions?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  suggestions: () => [],
});

const emit = defineEmits(['update:modelValue']);

// --- State ---
const inputValue = ref('');
const isFocused = ref(false);
const activeIndex = ref(-1);
const liveMessage = ref('');

// --- IDs for a11y ---
const uniqueId = `tag-input-${uuidv4()}`;
const inputId = `${uniqueId}-input`;
const listId = `${uniqueId}-list`;
const descId = `${uniqueId}-desc`;
const suggestionsId = `${uniqueId}-suggestions`;

const { t } = useStrictI18n();

// --- Computed Properties ---
const filteredSuggestions = computed(() => {
  const lowerCaseInput = inputValue.value.toLowerCase();
  if (!lowerCaseInput) return [];

  return props.suggestions.filter(
    (suggestion) => !props.modelValue.includes(suggestion) && suggestion.toLowerCase().includes(lowerCaseInput),
  );
});

const showSuggestions = computed(() => isFocused.value && filteredSuggestions.value.length > 0);

const activeDescendant = computed(() => {
  return activeIndex.value >= 0 && activeIndex.value < filteredSuggestions.value.length
    ? `${suggestionsId}-item-${activeIndex.value}`
    : undefined;
});

// --- Watchers ---
watch(inputValue, () => {
  // Reset active index when input changes
  if (activeIndex.value !== -1) {
    activeIndex.value = -1;
  }
});

// --- Methods ---
function addTag(tagValue?: string) {
  const val = (tagValue ?? inputValue.value).trim();
  if (!val) return;

  // Split by comma if user pasted text
  const newTags = val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Deduplicate against existing
  const distinct = newTags.filter((t) => !props.modelValue.includes(t));

  if (distinct.length > 0) {
    emit('update:modelValue', [...props.modelValue, ...distinct]);
    liveMessage.value = t('a11y.tagInput.added', { count: distinct.length, tags: distinct.join(', ') });
  }
  inputValue.value = '';
  activeIndex.value = -1;
}

function removeTag(index: number) {
  const tagToRemove = props.modelValue[index];
  const newTags = [...props.modelValue];
  newTags.splice(index, 1);
  emit('update:modelValue', newTags);
  liveMessage.value = t('a11y.tagInput.removed', { tag: tagToRemove });
}

function handleKeydown(e: KeyboardEvent) {
  if (showSuggestions.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex.value = (activeIndex.value + 1) % filteredSuggestions.value.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex.value = (activeIndex.value - 1 + filteredSuggestions.value.length) % filteredSuggestions.value.length;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      isFocused.value = false;
      activeIndex.value = -1;
    }
  }

  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const selectedSuggestion = filteredSuggestions.value[activeIndex.value];
    addTag(selectedSuggestion);
  } else if (e.key === 'Backspace' && inputValue.value === '' && props.modelValue.length > 0) {
    removeTag(props.modelValue.length - 1);
  }
}

function handleFocus() {
  isFocused.value = true;
}

function handleBlur() {
  // Use a timeout to allow click events on suggestions to fire before blur closes it
  setTimeout(() => {
    isFocused.value = false;
    addTag();
  }, 200);
}

function selectSuggestion(suggestion: string) {
  addTag(suggestion);
  isFocused.value = false;
}
</script>

<template>
  <div class="tag-input-container">
    <label v-if="label" :for="inputId" class="tag-input-label sr-only">{{ label }}</label>

    <span :id="descId" class="sr-only">{{ t('a11y.tagInput.description') }}</span>

    <!-- Live region for announcements -->
    <div class="sr-only" role="status" aria-live="polite">{{ liveMessage }}</div>

    <div class="tag-input-controls">
      <input
        :id="inputId"
        ref="inputRef"
        v-model="inputValue"
        class="text-pole"
        :placeholder="placeholder"
        :aria-describedby="descId"
        :aria-controls="showSuggestions ? suggestionsId : listId"
        :aria-expanded="showSuggestions"
        :aria-activedescendant="activeDescendant"
        role="combobox"
        aria-haspopup="listbox"
        @keydown="handleKeydown"
        @focus="handleFocus"
        @blur="handleBlur"
      />
      <Button
        icon="fa-plus"
        :title="t('a11y.tagInput.addTag')"
        :aria-label="t('a11y.tagInput.addTag')"
        @click="addTag()"
      />
    </div>

    <ul
      v-if="showSuggestions"
      :id="suggestionsId"
      class="tag-input-suggestions"
      role="listbox"
      :aria-label="t('a11y.tagInput.suggestionsList')"
    >
      <li
        v-for="(suggestion, idx) in filteredSuggestions"
        :id="`${suggestionsId}-item-${idx}`"
        :key="suggestion"
        class="tag-input-suggestions-item"
        :class="{ 'is-active': idx === activeIndex }"
        role="option"
        :aria-selected="idx === activeIndex"
        @mousedown.prevent
        @click="selectSuggestion(suggestion)"
      >
        {{ suggestion }}
      </li>
    </ul>

    <ul
      v-if="modelValue.length > 0"
      :id="listId"
      class="tags-list"
      role="list"
      :aria-label="t('a11y.tagInput.tagsList')"
    >
      <li v-for="(tag, idx) in modelValue" :key="idx" class="tag">
        <span>{{ tag }}</span>
        <button
          class="tag-close-btn"
          :aria-label="t('a11y.tagInput.removeTag', { tag })"
          @click="removeTag(idx)"
          @keydown.enter.prevent="removeTag(idx)"
          @keydown.space.prevent="removeTag(idx)"
        >
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </li>
    </ul>
  </div>
</template>
