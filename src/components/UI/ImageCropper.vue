<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';

const props = defineProps({
  src: { type: String, required: true },
  aspectRatio: { type: Number, default: undefined },
});

const { t } = useStrictI18n();
const image = ref<HTMLImageElement | null>(null);
const isReady = ref(false);

const crop = reactive({ x: 0, y: 0, w: 0, h: 0 });
const naturalSize = reactive({ w: 0, h: 0 });
const displaySize = reactive({ w: 0, h: 0 });

let startX = 0;
let startY = 0;
let startCrop = { x: 0, y: 0, w: 0, h: 0 };
let activeHandle: string | null = null;
let resizeObserver: ResizeObserver | null = null;

const onImageLoad = () => {
  if (!image.value) return;

  naturalSize.w = image.value.naturalWidth;
  naturalSize.h = image.value.naturalHeight;
  updateDisplaySize();

  // Init crop box
  const minDim = Math.min(displaySize.w, displaySize.h);
  let initW = minDim * 0.8;
  let initH = initW;

  if (props.aspectRatio) {
    if (props.aspectRatio > 1) {
      initH = initW / props.aspectRatio;
    } else {
      initW = initH * props.aspectRatio;
    }
  } else {
    initW = displaySize.w * 0.8;
    initH = displaySize.h * 0.6;
  }

  crop.w = initW;
  crop.h = initH;
  crop.x = (displaySize.w - crop.w) / 2;
  crop.y = (displaySize.h - crop.h) / 2;

  isReady.value = true;
};

const updateDisplaySize = () => {
  if (!image.value) return;
  displaySize.w = image.value.offsetWidth;
  displaySize.h = image.value.offsetHeight;
};

const boxStyle = computed(() => ({
  transform: `translate(${crop.x}px, ${crop.y}px)`,
  width: `${crop.w}px`,
  height: `${crop.h}px`,
}));

const startDrag = (handle: string, event: MouseEvent | TouchEvent) => {
  if (!isReady.value) return;

  activeHandle = handle;

  const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
  const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

  startX = clientX;
  startY = clientY;
  startCrop.x = crop.x;
  startCrop.y = crop.y;
  startCrop.w = crop.w;
  startCrop.h = crop.h;

  window.addEventListener('mousemove', onDrag);
  window.addEventListener('touchmove', onDrag, { passive: false });
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('touchend', stopDrag);
};

const onDrag = (event: MouseEvent | TouchEvent) => {
  if (!activeHandle) return;
  event.preventDefault();

  const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
  const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

  const dx = clientX - startX;
  const dy = clientY - startY;

  applyMoveOrResize(dx, dy);
};

const applyMoveOrResize = (dx: number, dy: number) => {
  if (!activeHandle) return;

  if (activeHandle === 'move') {
    let newX = startCrop.x + dx;
    let newY = startCrop.y + dy;

    newX = Math.max(0, Math.min(newX, displaySize.w - startCrop.w));
    newY = Math.max(0, Math.min(newY, displaySize.h - startCrop.h));

    crop.x = newX;
    crop.y = newY;
  } else {
    // Resize logic
    let newX = startCrop.x;
    let newY = startCrop.y;
    let newW = startCrop.w;
    let newH = startCrop.h;

    // Apply delta
    if (activeHandle.includes('e')) newW = startCrop.w + dx;
    if (activeHandle.includes('w')) {
      newW = startCrop.w - dx;
      newX = startCrop.x + dx;
    }
    if (activeHandle.includes('s')) newH = startCrop.h + dy;
    if (activeHandle.includes('n')) {
      newH = startCrop.h - dy;
      newY = startCrop.y + dy;
    }

    // Min size
    const min = 20;
    if (newW < min) {
      if (activeHandle.includes('w')) newX = startCrop.x + startCrop.w - min;
      newW = min;
    }
    if (newH < min) {
      if (activeHandle.includes('n')) newY = startCrop.y + startCrop.h - min;
      newH = min;
    }

    // Aspect Ratio
    if (props.aspectRatio) {
      if (activeHandle.includes('n') || activeHandle.includes('s')) {
        // Height driven
        newW = newH * props.aspectRatio;
        if (activeHandle.includes('w') || activeHandle === 'nw' || activeHandle === 'sw') {
          // If we are expanding left, we need to adjust X
          newX = startCrop.x + startCrop.w - newW;
        } else if (activeHandle === 'n' || activeHandle === 's') {
          // Center adjust if purely vertical handle
          newX = startCrop.x + (startCrop.w - newW) / 2;
        }
      } else {
        // Width driven (default for corners and E/W)
        newH = newW / props.aspectRatio;
        if (activeHandle.includes('n') || activeHandle === 'nw' || activeHandle === 'ne') {
          newY = startCrop.y + startCrop.h - newH;
        } else if (activeHandle === 'e' || activeHandle === 'w') {
          newY = startCrop.y + (startCrop.h - newH) / 2;
        }
      }
    }

    // Boundary Constraint
    if (newX < 0) {
      newX = 0;
    }
    if (newY < 0) {
      newY = 0;
    }

    // Check if box exceeds container
    if (newX + newW > displaySize.w) {
      if (activeHandle.includes('e') || activeHandle.includes('w')) {
        newW = displaySize.w - newX;
      }
    }
    if (newY + newH > displaySize.h) {
      if (activeHandle.includes('s') || activeHandle.includes('n')) {
        newH = displaySize.h - newY;
      }
    }

    // Re-apply AR if we clamped size and it matters
    if (props.aspectRatio) {
      const currentRatio = newW / newH;
      if (Math.abs(currentRatio - props.aspectRatio) > 0.01) {
        // Fit into box maintaining AR
        if (currentRatio > props.aspectRatio) {
          newW = newH * props.aspectRatio;
        } else {
          newH = newW / props.aspectRatio;
        }
      }
    }

    crop.x = newX;
    crop.y = newY;
    crop.w = newW;
    crop.h = newH;
  }
};

const stopDrag = () => {
  activeHandle = null;
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('touchmove', onDrag);
  window.removeEventListener('mouseup', stopDrag);
  window.removeEventListener('touchend', stopDrag);
};

const getData = () => {
  if (naturalSize.w === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const scaleX = naturalSize.w / displaySize.w;
  const scaleY = naturalSize.h / displaySize.h;

  return {
    x: Math.round(crop.x * scaleX),
    y: Math.round(crop.y * scaleY),
    width: Math.round(crop.w * scaleX),
    height: Math.round(crop.h * scaleY),
  };
};

function handleKeyDown(e: KeyboardEvent) {
  if (!isReady.value) return;

  const step = e.shiftKey ? 10 : 1;
  let dx = 0;
  let dy = 0;
  let handled = false;

  // If shift is held, we resize (se handle), otherwise we move
  if (e.shiftKey) {
    activeHandle = 'se'; // Resize from bottom-right
  } else {
    activeHandle = 'move';
  }

  // Initialize start positions for the "drag" logic simulation
  startCrop.x = crop.x;
  startCrop.y = crop.y;
  startCrop.w = crop.w;
  startCrop.h = crop.h;

  switch (e.key) {
    case 'ArrowLeft':
      dx = -step;
      handled = true;
      break;
    case 'ArrowRight':
      dx = step;
      handled = true;
      break;
    case 'ArrowUp':
      dy = -step;
      handled = true;
      break;
    case 'ArrowDown':
      dy = step;
      handled = true;
      break;
  }

  if (handled) {
    e.preventDefault();
    applyMoveOrResize(dx, dy);
    activeHandle = null;
  }
}

defineExpose({ getData });

onMounted(() => {
  if (image.value) {
    resizeObserver = new ResizeObserver(updateDisplaySize);
    resizeObserver.observe(image.value);
  }
});

onBeforeUnmount(() => {
  if (resizeObserver) resizeObserver.disconnect();
  stopDrag();
});
</script>

<template>
  <div class="image-cropper">
    <div class="wrapper">
      <img ref="image" :src="src" :alt="t('common.image')" @load="onImageLoad" />

      <div
        v-if="isReady"
        class="crop-box"
        :style="boxStyle"
        tabindex="0"
        role="button"
        :aria-label="t('a11y.imageCropper.cropBoxLabel')"
        :aria-description="t('a11y.imageCropper.cropBoxDescription')"
        @mousedown="startDrag('move', $event)"
        @touchstart="startDrag('move', $event)"
        @keydown="handleKeyDown"
      >
        <!-- Handles (Hidden from SR as keyboard users use the main box) -->
        <div
          class="handle nw"
          aria-hidden="true"
          @mousedown.stop="startDrag('nw', $event)"
          @touchstart.stop="startDrag('nw', $event)"
        ></div>
        <div
          class="handle ne"
          aria-hidden="true"
          @mousedown.stop="startDrag('ne', $event)"
          @touchstart.stop="startDrag('ne', $event)"
        ></div>
        <div
          class="handle sw"
          aria-hidden="true"
          @mousedown.stop="startDrag('sw', $event)"
          @touchstart.stop="startDrag('sw', $event)"
        ></div>
        <div
          class="handle se"
          aria-hidden="true"
          @mousedown.stop="startDrag('se', $event)"
          @touchstart.stop="startDrag('se', $event)"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.image-cropper {
  width: 100%;
  display: flex;
  justify-content: center;
  background-color: #000;
  overflow: hidden;
  user-select: none;
  border-radius: 4px;

  .wrapper {
    position: relative;
    display: inline-block;
    line-height: 0;
  }

  img {
    max-width: 100%;
    max-height: 60vh;
    display: block;
    -webkit-user-drag: none;
  }
}

.crop-box {
  position: absolute;
  top: 0;
  left: 0;
  cursor: move;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-sizing: border-box;
  touch-action: none;

  &:focus {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  &::before {
    // Grid lines (thirds)
    content: '';
    position: absolute;
    top: 33.33%;
    left: 0;
    width: 100%;
    height: 33.33%;
    border-top: 1px dashed rgba(255, 255, 255, 0.3);
    border-bottom: 1px dashed rgba(255, 255, 255, 0.3);
    pointer-events: none;
    box-sizing: border-box;
  }
  &::after {
    // Grid lines (vertical)
    content: '';
    position: absolute;
    left: 33.33%;
    top: 0;
    width: 33.33%;
    height: 100%;
    border-left: 1px dashed rgba(255, 255, 255, 0.3);
    border-right: 1px dashed rgba(255, 255, 255, 0.3);
    pointer-events: none;
    box-sizing: border-box;
  }
}

.handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background-color: #fff;
  border: 1px solid #000;
  border-radius: 50%;
  z-index: var(--z-dropdown);

  &.nw {
    top: -6px;
    left: -6px;
    cursor: nw-resize;
  }
  &.ne {
    top: -6px;
    right: -6px;
    cursor: ne-resize;
  }
  &.sw {
    bottom: -6px;
    left: -6px;
    cursor: sw-resize;
  }
  &.se {
    bottom: -6px;
    right: -6px;
    cursor: se-resize;
  }
}
</style>
