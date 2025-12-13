<script setup lang="ts">
import { ref, watch } from 'vue';
import { slideTransitionHooks } from '../../utils/client';
import { uuidv4 } from '../../utils/commons';

interface Props {
  title: string;
  /**
   * Controlled state. Use v-model:is-open="var" in parent.
   */
  isOpen?: boolean;
  subtitle?: string;
}

const props = withDefaults(defineProps<Props>(), {
  isOpen: undefined,
  subtitle: '',
});

const emit = defineEmits(['update:isOpen']);

// Internal state.
const internalIsOpen = ref(props.isOpen);
const headerId = `collapsible-header-${uuidv4()}`;
const contentId = `collapsible-content-${uuidv4()}`;

const { beforeEnter, enter, afterEnter, beforeLeave, leave, afterLeave } = slideTransitionHooks;

// Watch for external updates (Controlled Mode)
watch(
  () => props.isOpen,
  (val) => {
    if (val !== undefined) {
      internalIsOpen.value = val;
    }
  },
);

function toggle() {
  const newValue = !internalIsOpen.value;
  internalIsOpen.value = newValue;
  emit('update:isOpen', newValue);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggle();
  }
}
</script>

<template>
  <div class="inline-drawer">
    <div
      :id="headerId"
      class="inline-drawer-header"
      role="button"
      tabindex="0"
      :aria-expanded="internalIsOpen"
      :aria-controls="contentId"
      @click="toggle"
      @keydown="onKeydown"
    >
      <div class="inline-drawer-title">
        {{ title }}
        <small v-if="subtitle" class="subtitle">{{ subtitle }}</small>
      </div>

      <!-- Header Actions Slot (e.g. buttons) -->
      <div v-if="$slots.actions" class="header-actions" @click.stop @keydown.stop>
        <slot name="actions" />
      </div>

      <i
        class="fa-solid fa-circle-chevron-down inline-drawer-icon"
        :class="{ 'is-open': internalIsOpen }"
        aria-hidden="true"
      ></i>
    </div>

    <Transition
      name="slide-js"
      @before-enter="beforeEnter"
      @enter="enter"
      @after-enter="afterEnter"
      @before-leave="beforeLeave"
      @leave="leave"
      @after-leave="afterLeave"
    >
      <div v-show="internalIsOpen" :id="contentId" class="drawer-wrapper" role="region" :aria-labelledby="headerId">
        <div class="inline-drawer-content">
          <slot />
        </div>
      </div>
    </Transition>
  </div>
</template>
