<script setup lang="ts">
import { ref, watch } from 'vue';
import { slideTransitionHooks } from '@/utils/dom';

interface Props {
  title: string;
  initiallyOpen?: boolean;
  subtitle?: string;
}

const props = withDefaults(defineProps<Props>(), {
  initiallyOpen: false,
  subtitle: '',
});

const isOpen = ref(props.initiallyOpen);
const { beforeEnter, enter, afterEnter, beforeLeave, leave, afterLeave } = slideTransitionHooks;

function toggle() {
  isOpen.value = !isOpen.value;
}

watch(
  () => props.initiallyOpen,
  (val) => (isOpen.value = val),
);
</script>

<template>
  <div class="inline-drawer">
    <div class="inline-drawer-header" @click="toggle">
      <div class="inline-drawer-title">
        {{ title }}
        <small v-if="subtitle" class="subtitle">{{ subtitle }}</small>
      </div>

      <!-- Header Actions Slot (e.g. buttons) -->
      <div v-if="$slots.actions" class="header-actions" @click.stop>
        <slot name="actions" />
      </div>

      <i class="fa-solid fa-circle-chevron-down inline-drawer-icon" :class="{ 'is-open': isOpen }"></i>
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
      <div v-show="isOpen" class="drawer-wrapper">
        <div class="inline-drawer-content">
          <slot />
        </div>
      </div>
    </Transition>
  </div>
</template>
