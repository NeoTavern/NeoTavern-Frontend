<script setup lang="ts">
import { arrow, autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue';
import { computed, onMounted, onUnmounted, ref, toRef } from 'vue';

const props = defineProps<{
  text: string;
  displayDurationMs: number;
  referenceElement: HTMLElement;
  onClose: () => void;
  onTypingComplete?: () => void;
}>();

const displayedText = ref('');
const floating = ref<HTMLElement | null>(null);
const arrowRef = ref<HTMLElement | null>(null);

let typingInterval: number | null = null;
let closeTimeout: number | null = null;
const typingSpeed = 50; // ms per character

const { x, y, strategy, middlewareData, placement } = useFloating(toRef(props, 'referenceElement'), floating, {
  placement: 'top',
  strategy: 'absolute',
  whileElementsMounted: autoUpdate,
  middleware: [offset(12), flip(), shift({ padding: 10 }), arrow({ element: arrowRef })],
});

// Manual positioning styles using top/left instead of transform
const positionStyle = computed(() => ({
  position: strategy.value,
  top: `${y.value ?? 0}px`,
  left: `${x.value ?? 0}px`,
}));

// Calculate arrow position based on middleware data
const arrowStyle = computed(() => {
  const { x, y } = middlewareData.value.arrow || {};
  const staticSide =
    {
      top: 'bottom',
      right: 'left',
      bottom: 'top',
      left: 'right',
    }[placement.value.split('-')[0]] || 'bottom';

  return {
    left: x != null ? `${x}px` : '',
    top: y != null ? `${y}px` : '',
    [staticSide]: '-4px', // Hide half of the rotated square
  };
});

onMounted(() => {
  let i = 0;
  typingInterval = window.setInterval(() => {
    if (i < props.text.length) {
      displayedText.value += props.text.charAt(i);
      i++;
    } else {
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }

      props.onTypingComplete?.();

      // Start countdown to close after typing is finished
      closeTimeout = window.setTimeout(() => {
        props.onClose();
      }, props.displayDurationMs);
    }
  }, typingSpeed);
});

onUnmounted(() => {
  if (typingInterval) {
    clearInterval(typingInterval);
  }
  if (closeTimeout) {
    clearTimeout(closeTimeout);
  }
});
</script>

<template>
  <div ref="floating" class="commentary-bubble" :style="positionStyle" @click="onClose">
    <div class="commentary-bubble-content">{{ displayedText }}<span class="typing-cursor"></span></div>
    <div ref="arrowRef" class="commentary-bubble-arrow" :style="arrowStyle"></div>
  </div>
</template>

<style scoped>
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.commentary-bubble {
  z-index: var(--z-tooltip);
  width: max-content;
  max-width: 250px;
  animation: fadeIn 0.3s ease-out forwards;
  will-change: opacity, transform;
  pointer-events: auto;
}

.commentary-bubble-content {
  background-color: var(--theme-chat-tint);
  color: var(--theme-text-color);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--base-border-radius-rounded);
  border: 1px solid var(--theme-border-color);
  box-shadow: 0 4px 12px var(--theme-shadow-color);
  font-size: 0.9em;
  line-height: 1.4;
  position: relative;
}

.commentary-bubble-arrow {
  position: absolute;
  width: 8px;
  height: 8px;
  background-color: var(--theme-chat-tint);
  border: 1px solid var(--theme-border-color);
  transform: rotate(45deg);
  /* The borders that match the box shadow direction */
  border-left-color: transparent;
  border-top-color: transparent;
  z-index: -1; /* Behind the content bubble */
}

.typing-cursor {
  display: inline-block;
  width: 8px;
  height: 1em;
  background-color: var(--theme-text-color);
  animation: blink 1s step-end infinite;
  vertical-align: bottom;
  margin-left: 2px;
}
</style>
