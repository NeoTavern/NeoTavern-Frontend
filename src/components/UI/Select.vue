<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts" generic="T extends string | number">
import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useMobile } from '../../composables/useMobile';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { uuidv4 } from '../../utils/commons';
import Icon from './Icon.vue';

export interface Option<T> {
  label: string;
  value: T;
  disabled?: boolean;
}

export interface Group<T> {
  label: string;
  options: Option<T>[];
}

export type SelectItem<T> = Option<T> | Group<T>;

interface Props {
  modelValue: T | T[];
  options: SelectItem<T>[];
  label?: string;
  disabled?: boolean;
  title?: string;
  multiple?: boolean;
  placeholder?: string;
  searchable?: boolean;
  groupSelect?: boolean;
  id?: string;
}

const props = withDefaults(defineProps<Props>(), {
  multiple: false,
  disabled: false,
  label: undefined,
  title: undefined,
  placeholder: 'Select...',
  searchable: false,
  groupSelect: false,
  id: undefined,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: T | T[]): void;
  (e: 'change', value: T | T[]): void;
}>();

const isOpen = ref(false);
const containerRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const searchQuery = ref('');
const highlightedIndex = ref<number>(-1); // For visual navigation

const { isDeviceMobile } = useMobile();
const { t } = useStrictI18n();

const selectId = props.id || `select-${uuidv4()}`;
const listboxId = `${selectId}-listbox`;
const labelId = props.label ? `${selectId}-label` : undefined;

const { floatingStyles } = useFloating(triggerRef, dropdownRef, {
  placement: 'bottom-start',
  open: isOpen,
  whileElementsMounted: autoUpdate,
  middleware: [
    offset(4),
    flip({ padding: 10 }),
    shift({ padding: 8 }),
    size({
      apply({ rects, elements, availableWidth }) {
        const minWidth = 200;
        const referenceWidth = rects.reference.width;
        const constrainedWidth = Math.min(referenceWidth, availableWidth - 16);
        const finalWidth = Math.max(minWidth, constrainedWidth);

        Object.assign(elements.floating.style, {
          width: `${finalWidth}px`,
          maxWidth: `${availableWidth - 16}px`,
        });
      },
    }),
  ],
});

function isGroup(item: SelectItem<T>): item is Group<T> {
  return 'options' in item;
}

const visibleFlatOptions = computed(() => {
  const result: { item: Option<T>; groupLabel?: string }[] = [];
  const query = searchQuery.value.toLowerCase().trim();

  props.options.forEach((item) => {
    if (isGroup(item)) {
      const matching = item.options.filter((opt) => !query || opt.label.toLowerCase().includes(query));
      if (matching.length > 0) {
        matching.forEach((opt) => result.push({ item: opt, groupLabel: item.label }));
      }
    } else {
      if (!query || item.label.toLowerCase().includes(query)) {
        result.push({ item });
      }
    }
  });
  return result;
});

// Used for rendering the structure (preserving groups)
const filteredOptions = computed(() => {
  if (!props.searchable || !searchQuery.value.trim()) {
    return props.options;
  }

  const query = searchQuery.value.toLowerCase().trim();
  const result: SelectItem<T>[] = [];

  for (const item of props.options) {
    if (isGroup(item)) {
      // Filter options within the group
      const matchingChildren = item.options.filter((opt) => opt.label.toLowerCase().includes(query));
      if (matchingChildren.length > 0) {
        // Return a new group object with only matching children
        result.push({
          ...item,
          options: matchingChildren,
        });
      }
    } else {
      // Check individual option
      if (item.label.toLowerCase().includes(query)) {
        result.push(item);
      }
    }
  }

  return result;
});

const getOptionId = (index: number) => `${selectId}-option-${index}`;

const activeDescendantId = computed(() => {
  if (isOpen.value && highlightedIndex.value >= 0 && visibleFlatOptions.value[highlightedIndex.value]) {
    return getOptionId(highlightedIndex.value);
  }
  return undefined;
});

watch(searchQuery, () => {
  if (visibleFlatOptions.value.length > 0) {
    highlightedIndex.value = 0;
  } else {
    highlightedIndex.value = -1;
  }
});

function toggleOpen() {
  if (props.disabled) return;
  isOpen.value = !isOpen.value;

  if (isOpen.value) {
    highlightedIndex.value = visibleFlatOptions.value.findIndex((o) => isSelected(o.item.value));
    if (highlightedIndex.value === -1 && visibleFlatOptions.value.length > 0) {
      highlightedIndex.value = 0;
    }

    nextTick(() => {
      scrollToHighlightedOption();
      if (props.searchable && !isDeviceMobile.value) {
        searchInputRef.value?.focus();
      } else if (dropdownRef.value) {
        dropdownRef.value.focus();
      }
    });
  } else {
    triggerRef.value?.focus();
    searchQuery.value = '';
    highlightedIndex.value = -1;
  }
}

function scrollToHighlightedOption() {
  if (!dropdownRef.value || highlightedIndex.value === -1) return;

  const activeId = getOptionId(highlightedIndex.value);
  const element = document.getElementById(activeId);

  if (element) {
    element.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }
}

function close() {
  isOpen.value = false;
  searchQuery.value = '';
}

function isSelected(value: T): boolean {
  if (props.multiple && Array.isArray(props.modelValue)) {
    return props.modelValue.includes(value);
  }
  return props.modelValue === value;
}

function isGroupSelected(group: Group<T>): boolean {
  if (!props.multiple || !props.groupSelect || !Array.isArray(props.modelValue)) return false;

  const enabledOptions = group.options.filter((opt) => !opt.disabled);
  if (enabledOptions.length === 0) return false;

  const values = props.modelValue as T[];
  return enabledOptions.every((opt) => values.includes(opt.value));
}

function isGroupPartiallySelected(group: Group<T>): boolean {
  if (!props.multiple || !props.groupSelect || !Array.isArray(props.modelValue)) return false;

  const enabledOptions = group.options.filter((opt) => !opt.disabled);
  if (enabledOptions.length === 0) return false;

  const values = props.modelValue as T[];
  const selectedCount = enabledOptions.filter((opt) => values.includes(opt.value)).length;
  return selectedCount > 0 && selectedCount < enabledOptions.length;
}

function toggleGroup(group: Group<T>) {
  if (!props.multiple || !props.groupSelect) return;

  const enabledOptions = group.options.filter((opt) => !opt.disabled);
  if (enabledOptions.length === 0) return;

  const currentValues = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
  const allSelected = enabledOptions.every((opt) => currentValues.includes(opt.value));

  let newValues: T[];

  if (allSelected) {
    // Deselect all
    const valuesToRemove = enabledOptions.map((opt) => opt.value);
    newValues = currentValues.filter((val) => !valuesToRemove.includes(val));
  } else {
    // Select all (union)
    newValues = [...currentValues];
    enabledOptions.forEach((opt) => {
      if (!newValues.includes(opt.value)) {
        newValues.push(opt.value);
      }
    });
  }

  emit('update:modelValue', newValues);
  emit('change', newValues);
}

function selectOption(option: Option<T>) {
  if (option.disabled) return;

  if (props.multiple) {
    const currentValues = Array.isArray(props.modelValue) ? [...props.modelValue] : [];
    const index = currentValues.indexOf(option.value);

    if (index === -1) {
      currentValues.push(option.value);
    } else {
      currentValues.splice(index, 1);
    }

    emit('update:modelValue', currentValues);
    emit('change', currentValues);
    // Keep open for multiple selection
  } else {
    emit('update:modelValue', option.value);
    emit('change', option.value);
    close();
    triggerRef.value?.focus();
  }
}

// Display Value lookup
const flatOptions = computed(() => {
  const flat: Option<T>[] = [];
  for (const item of props.options) {
    if (isGroup(item)) {
      flat.push(...item.options);
    } else {
      flat.push(item);
    }
  }
  return flat;
});

const displayValue = computed(() => {
  if (props.multiple && Array.isArray(props.modelValue)) {
    if (props.modelValue.length === 0) return props.placeholder;

    const selectedLabels = props.modelValue
      .map((val) => flatOptions.value.find((opt) => opt.value === val)?.label)
      .filter(Boolean);

    if (selectedLabels.length === 0) return props.placeholder;
    return selectedLabels.join(', ');
  }

  const selectedOption = flatOptions.value.find((opt) => opt.value === props.modelValue);
  return selectedOption ? selectedOption.label : props.placeholder;
});

function onClickOutside(event: MouseEvent) {
  const target = event.target as Node;

  const isOutsideContainer = containerRef.value && !containerRef.value.contains(target);
  const isOutsideDropdown = dropdownRef.value && !dropdownRef.value.contains(target);

  if (isOutsideContainer && isOutsideDropdown) {
    close();
  }
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return;

  // Open on Enter/Space/Down if closed
  if (!isOpen.value) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      toggleOpen();
    }
    return;
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (highlightedIndex.value < visibleFlatOptions.value.length - 1) {
        highlightedIndex.value++;
        scrollToHighlightedOption();
      }
      break;
    case 'ArrowUp':
      event.preventDefault();
      if (highlightedIndex.value > 0) {
        highlightedIndex.value--;
        scrollToHighlightedOption();
      }
      break;
    case 'Enter':
      event.preventDefault();
      if (highlightedIndex.value !== -1) {
        const opt = visibleFlatOptions.value[highlightedIndex.value];
        if (opt) selectOption(opt.item);
      }
      break;
    case 'Escape':
      event.preventDefault();
      close();
      triggerRef.value?.focus();
      break;
    case 'Tab':
      close();
      break;
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside);
});

// Close if disabled changes to true
watch(
  () => props.disabled,
  (newVal) => {
    if (newVal) close();
  },
);

function getFlatIndex(opt: Option<T>) {
  return visibleFlatOptions.value.findIndex((o) => o.item === opt);
}
</script>

<template>
  <div ref="containerRef" class="select-wrapper">
    <label v-if="label" :id="labelId" class="select-label" :for="selectId">{{ label }}</label>

    <!-- Trigger -->
    <div
      :id="selectId"
      ref="triggerRef"
      class="select-trigger text-pole"
      :class="{ 'is-open': isOpen, 'is-disabled': disabled }"
      :title="title"
      role="combobox"
      :aria-expanded="isOpen"
      :aria-haspopup="'listbox'"
      :aria-controls="isOpen ? listboxId : undefined"
      :aria-labelledby="label ? labelId : undefined"
      :aria-label="!label ? placeholder : undefined"
      :aria-activedescendant="activeDescendantId"
      :tabindex="disabled ? -1 : 0"
      @click="toggleOpen"
      @keydown="onKeydown"
    >
      <div class="selected-text">{{ displayValue }}</div>
      <Icon icon="fa-chevron-down" class="chevron-icon" :class="{ 'rotate-180': isOpen }" aria-hidden="true" />
    </div>

    <!-- Dropdown -->
    <Transition name="fade-fast">
      <div
        v-if="isOpen"
        :id="listboxId"
        ref="dropdownRef"
        class="select-dropdown"
        :style="floatingStyles"
        role="listbox"
        :aria-multiselectable="multiple"
        :aria-labelledby="label ? labelId : undefined"
        :tabindex="-1"
        :aria-activedescendant="activeDescendantId"
        @keydown="onKeydown"
      >
        <!-- Search Input -->
        <div v-show="searchable" class="select-search-container" @click.stop>
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            class="select-search-input"
            :placeholder="placeholder || t('a11y.select.searchPlaceholder')"
            :aria-label="t('a11y.select.filterOptions')"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="true"
            :aria-controls="listboxId"
            :aria-activedescendant="activeDescendantId"
            @keydown="onKeydown"
          />
          <Icon icon="fa-magnifying-glass" class="select-search-icon" aria-hidden="true" />
        </div>

        <div v-if="filteredOptions.length === 0" class="select-option is-disabled" role="option" aria-disabled="true">
          {{ t('a11y.select.noOptions') }}
        </div>

        <template v-for="(item, index) in filteredOptions" :key="index">
          <!-- Group -->
          <div v-if="isGroup(item)" class="select-group" role="group" :aria-label="item.label">
            <div
              v-if="item.label"
              class="select-group-label"
              :class="{ 'is-interactive': multiple && groupSelect }"
              role="presentation"
              @click.stop="toggleGroup(item)"
            >
              <div v-if="multiple && groupSelect" class="option-checkbox">
                <Icon v-if="isGroupSelected(item)" icon="fa-check" class="check-icon" aria-hidden="true" />
                <Icon
                  v-else-if="isGroupPartiallySelected(item)"
                  icon="fa-minus"
                  class="check-icon"
                  style="font-size: 0.7em"
                  aria-hidden="true"
                />
              </div>
              <span class="group-label-text">{{ item.label }}</span>
            </div>

            <div
              v-for="opt in item.options"
              :id="getOptionId(getFlatIndex(opt))"
              :key="String(opt.value)"
              class="select-option is-nested"
              :class="{
                'is-selected': isSelected(opt.value),
                'is-highlighted': highlightedIndex === getFlatIndex(opt),
                'is-disabled': opt.disabled,
              }"
              role="option"
              :aria-selected="isSelected(opt.value)"
              :aria-disabled="opt.disabled"
              @click.stop="selectOption(opt)"
            >
              <div v-if="multiple" class="option-checkbox">
                <Icon v-if="isSelected(opt.value)" icon="fa-check" class="check-icon" aria-hidden="true" />
              </div>
              <span class="option-label">{{ opt.label }}</span>
              <Icon
                v-if="!multiple && isSelected(opt.value)"
                icon="fa-check"
                class="check-icon-single"
                aria-hidden="true"
              />
            </div>
          </div>

          <!-- Single Option -->
          <div
            v-else
            :id="getOptionId(getFlatIndex(item))"
            class="select-option"
            :class="{
              'is-selected': isSelected(item.value),
              'is-highlighted': highlightedIndex === getFlatIndex(item),
              'is-disabled': item.disabled,
            }"
            role="option"
            :aria-selected="isSelected(item.value)"
            :aria-disabled="item.disabled"
            @click.stop="selectOption(item)"
          >
            <div v-if="multiple" class="option-checkbox">
              <Icon v-if="isSelected(item.value)" icon="fa-check" class="check-icon" aria-hidden="true" />
            </div>
            <span class="option-label">{{ item.label }}</span>
            <Icon
              v-if="!multiple && isSelected(item.value)"
              icon="fa-check"
              class="check-icon-single"
              aria-hidden="true"
            />
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>
