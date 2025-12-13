<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { uuidv4 } from '../../utils/commons';

const { t } = useStrictI18n();

const props = defineProps<{
  modelValue: string;
  options: { label: string; value: string; icon?: string }[];
}>();

const emit = defineEmits(['update:modelValue']);

const tabsId = `tabs-${uuidv4()}`;
const buttonRefs = ref<HTMLElement[]>([]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setButtonRef(el: any, index: number) {
  if (el) buttonRefs.value[index] = el;
}

// Ensure refs array is trimmed if options change
watch(
  () => props.options.length,
  () => {
    buttonRefs.value = [];
  },
);

function selectTab(value: string) {
  emit('update:modelValue', value);
}

function handleKeyDown(event: KeyboardEvent, index: number) {
  let newIndex = index;

  switch (event.key) {
    case 'ArrowLeft':
      newIndex = index - 1;
      if (newIndex < 0) newIndex = props.options.length - 1;
      break;
    case 'ArrowRight':
      newIndex = index + 1;
      if (newIndex >= props.options.length) newIndex = 0;
      break;
    case 'Home':
      newIndex = 0;
      break;
    case 'End':
      newIndex = props.options.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  const option = props.options[newIndex];
  if (option) {
    selectTab(option.value);
    nextTick(() => {
      buttonRefs.value[newIndex]?.focus();
    });
  }
}
</script>

<template>
  <div class="tabs" role="tablist" :aria-label="t('a11y.tabs.list')">
    <button
      v-for="(tab, index) in options"
      :id="`${tabsId}-tab-${tab.value}`"
      :key="tab.value"
      :ref="(el) => setButtonRef(el, index)"
      class="tab-button"
      :class="{ active: modelValue === tab.value }"
      role="tab"
      :aria-selected="modelValue === tab.value"
      :aria-controls="`${tabsId}-panel-${tab.value}`"
      :tabindex="modelValue === tab.value ? 0 : -1"
      @click="selectTab(tab.value)"
      @keydown="handleKeyDown($event, index)"
    >
      <i v-if="tab.icon" :class="['fa-solid', tab.icon]" aria-hidden="true"></i>
      <span>{{ tab.label }}</span>
    </button>
  </div>
</template>
