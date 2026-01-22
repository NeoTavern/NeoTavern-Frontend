<script setup lang="ts">
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { hsvToRgb, parseColor, rgbToHex, rgbToHsv, rgbaToString } from '../../utils/color';

const props = defineProps<{
  label: string;
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

// Dragging Logic
const dragging = ref(false);
const dragType = ref<'sat' | 'hue' | 'alpha' | null>(null);

const isOpen = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const saturationRef = ref<HTMLElement | null>(null);
const hueRef = ref<HTMLElement | null>(null);
const alphaRef = ref<HTMLElement | null>(null);

// HSV State
const hsv = ref({ h: 0, s: 0, v: 0 });
const alpha = ref(1);

const { floatingStyles } = useFloating(triggerRef, dropdownRef, {
  placement: 'bottom-end',
  strategy: 'fixed',
  open: isOpen,
  whileElementsMounted: (reference, floating, update) => {
    return autoUpdate(reference, floating, () => {
      if (!dragging.value) {
        update();
      }
    });
  },
  middleware: [offset(8), flip({ padding: 10 }), shift({ padding: 10 })],
});

// Computed Colors
const currentColor = computed(() => {
  const { r, g, b } = hsvToRgb(hsv.value.h / 360, hsv.value.s, hsv.value.v);
  return rgbaToString(r, g, b, alpha.value);
});

const hueColor = computed(() => {
  const { r, g, b } = hsvToRgb(hsv.value.h / 360, 1, 1);
  return `rgb(${r}, ${g}, ${b})`;
});

const hasTransparency = computed(() => alpha.value < 1);

// Initialize state from modelValue
watch(
  () => props.modelValue,
  (newVal) => {
    // Only update internal state if not currently dragging (optimization could be added, but simple check is okay)
    // Actually better to parse always to stay in sync with text edits, unless we flag it.
    // For now, let's parse.
    const rgba = parseColor(newVal);
    const convertedHsv = rgbToHsv(rgba.r, rgba.g, rgba.b);

    // Prevent jumping if slight rounding diffs, but simple assignment is safer for sync
    // We only update if significantly different to preserve slider positions?
    // Let's just update.
    if (!dragging.value) {
      hsv.value = convertedHsv;
      alpha.value = rgba.a;
    }
  },
  { immediate: true },
);

function updateColor() {
  const { r, g, b } = hsvToRgb(hsv.value.h / 360, hsv.value.s, hsv.value.v);
  emit('update:modelValue', rgbaToString(r, g, b, alpha.value));
}

function handleMouseDown(e: MouseEvent, type: 'sat' | 'hue' | 'alpha') {
  dragging.value = true;
  dragType.value = type;
  handleMouseMove(e);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
}

function handleMouseMove(e: MouseEvent) {
  if (!dragging.value || !dragType.value) return;

  if (dragType.value === 'sat' && saturationRef.value) {
    const rect = saturationRef.value.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    x = Math.max(0, Math.min(x, rect.width));
    y = Math.max(0, Math.min(y, rect.height));

    hsv.value.s = x / rect.width;
    hsv.value.v = 1 - y / rect.height;
  } else if (dragType.value === 'hue' && hueRef.value) {
    const rect = hueRef.value.getBoundingClientRect();
    let x = e.clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    hsv.value.h = (x / rect.width) * 360;
  } else if (dragType.value === 'alpha' && alphaRef.value) {
    const rect = alphaRef.value.getBoundingClientRect();
    let x = e.clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    alpha.value = +(x / rect.width).toFixed(2);
  }

  updateColor();
}

function handleMouseUp() {
  dragging.value = false;
  dragType.value = null;
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
}

// Toggle Popover
function toggleOpen() {
  isOpen.value = !isOpen.value;
}

function close(e: MouseEvent) {
  // Click outside logic
  if (
    isOpen.value &&
    dropdownRef.value &&
    triggerRef.value &&
    !dropdownRef.value.contains(e.target as Node) &&
    !triggerRef.value.contains(e.target as Node)
  ) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('mousedown', close);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', close);
});

// Hex Input
const hexInputValue = computed({
  get: () => {
    const { r, g, b } = hsvToRgb(hsv.value.h / 360, hsv.value.s, hsv.value.v);
    return rgbToHex(r, g, b).toUpperCase();
  },
  set: (val) => {
    if (/^#[0-9A-F]{6}$/i.test(val)) {
      const rgba = parseColor(val);
      hsv.value = rgbToHsv(rgba.r, rgba.g, rgba.b);
      updateColor();
    }
  },
});
</script>

<template>
  <div class="color-picker-row">
    <label>{{ label }}</label>
    <div class="color-input-wrapper">
      <div
        ref="triggerRef"
        class="color-swatch-trigger"
        :class="{ 'has-transparency': hasTransparency }"
        :style="{ backgroundColor: currentColor }"
        @click="toggleOpen"
      ></div>

      <span class="color-value">{{ modelValue }}</span>
    </div>
    <!-- Dropdown -->
    <div v-if="isOpen" ref="dropdownRef" class="color-picker-dropdown" :style="floatingStyles">
      <!-- Saturation/Value Area -->
      <div
        ref="saturationRef"
        class="saturation-area"
        :style="{ backgroundColor: hueColor }"
        @mousedown="(e) => handleMouseDown(e, 'sat')"
      >
        <div class="saturation-white"></div>
        <div class="saturation-black"></div>
        <div
          class="saturation-cursor"
          :style="{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: currentColor,
          }"
        ></div>
      </div>

      <!-- Controls -->
      <div class="controls-area">
        <div class="sliders">
          <!-- Hue Slider -->
          <div ref="hueRef" class="slider hue-slider" @mousedown="(e) => handleMouseDown(e, 'hue')">
            <div
              class="slider-cursor"
              :style="{
                left: `${(hsv.h / 360) * 100}%`,
                backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
              }"
            ></div>
          </div>

          <!-- Alpha Slider -->
          <div ref="alphaRef" class="slider alpha-slider" @mousedown="(e) => handleMouseDown(e, 'alpha')">
            <div class="alpha-bg"></div>
            <div
              class="alpha-overlay"
              :style="{
                background: `linear-gradient(to right, transparent, ${hueColor})`,
              }"
            ></div>
            <div
              class="slider-cursor"
              :style="{
                left: `${alpha * 100}%`,
              }"
            ></div>
          </div>
        </div>
        <div
          class="preview-swatch"
          :class="{ 'has-transparency': hasTransparency }"
          :style="{ backgroundColor: currentColor }"
        ></div>
      </div>

      <!-- Input -->
      <div class="input-area">
        <div class="input-group">
          <label>Hex</label>
          <input v-model.lazy="hexInputValue" type="text" maxlength="9" />
        </div>
        <div class="input-group">
          <label>Alpha</label>
          <input v-model.number="alpha" type="number" min="0" max="1" step="0.01" @input="updateColor" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.color-picker-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--black-30a);
  padding: var(--spacing-sm);
  border-radius: var(--base-border-radius);
  border: 1px solid var(--theme-border-color);
  position: relative; // For anchoring logic if needed, but we use floating-ui

  label {
    font-size: 0.9em;
    opacity: 0.9;
  }
}

.color-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);

  .color-swatch-trigger {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    border: 1px solid var(--white-30a);
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);

    &.has-transparency {
      background-image:
        linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%);
      background-size: 10px 10px;
      background-position:
        0 0,
        0 5px,
        5px -5px,
        -5px 0px;
    }
  }

  .color-value {
    font-family: var(--font-family-mono);
    font-size: 0.8em;
    opacity: 0.7;
    min-width: 60px;
    text-transform: uppercase;
  }
}

.color-picker-dropdown {
  width: 240px;
  background-color: var(--theme-background-tint);
  border: 1px solid var(--theme-border-color);
  border-radius: var(--base-border-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  padding: var(--spacing-md);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.saturation-area {
  width: 100%;
  height: 150px;
  position: relative;
  background-color: red; // Default fallback
  border-radius: var(--base-border-radius);
  cursor: crosshair;
  overflow: hidden;

  .saturation-white {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(to right, #fff, transparent);
  }

  .saturation-black {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(to top, #000, transparent);
  }

  .saturation-cursor {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
}

.controls-area {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;

  .sliders {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .preview-swatch {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--white-30a);

    &.has-transparency {
      background-image:
        linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%);
      background-size: 8px 8px;
      background-position:
        0 0,
        0 4px,
        4px -4px,
        -4px 0px;
    }
  }
}

.slider {
  height: 12px;
  border-radius: 6px;
  position: relative;
  cursor: pointer;

  .slider-cursor {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background-color: #fff;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
    border: 1px solid var(--grey-30);
    pointer-events: none;
  }
}

.hue-slider {
  background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
}

.alpha-slider {
  background-image:
    linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%);
  background-size: 8px 8px;

  .alpha-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: 6px;
  }
}
.input-area {
  display: flex;
  gap: var(--spacing-sm);

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;

    label {
      font-size: 0.7em;
      opacity: 0.6;
    }

    input {
      width: 100%;
      background-color: var(--black-30a);
      border: 1px solid var(--theme-border-color);
      border-radius: 4px;
      padding: 4px;
      color: #fff;
      font-size: 0.9em;
      font-family: var(--font-family-mono);
      &:focus {
        outline: none;
        border-color: var(--theme-underline-color);
      }
    }
  }
}
</style>
