<script setup lang="ts">
import { computed } from 'vue';

export interface TimelineSegment {
  start: number;
  end: number;
  type: string; // 'memory' | 'selection' | 'overlap' | 'summarized' | 'missing'
  title: string;
}

const props = defineProps<{
  totalItems: number;
  segments: TimelineSegment[];
  title: string;
  messageUnitLabel: string;
}>();

const processedSegments = computed(() => {
  const total = props.totalItems;
  if (total <= 0) return [];

  return props.segments.map((seg) => {
    const safeStart = Math.max(0, seg.start);
    const safeEnd = Math.min(total - 1, seg.end);
    const count = Math.max(0, safeEnd - safeStart + 1);

    return {
      ...seg,
      leftPercent: (safeStart / total) * 100,
      widthPercent: (count / total) * 100,
    };
  });
});
</script>

<template>
  <div class="timeline-container" :title="title">
    <div class="timeline-bar">
      <div
        v-for="(seg, idx) in processedSegments"
        :key="idx"
        class="timeline-segment"
        :class="seg.type"
        :style="{ left: seg.leftPercent + '%', width: seg.widthPercent + '%' }"
        :title="seg.title"
      ></div>
    </div>
    <div class="timeline-labels">
      <span>0</span>
      <span>{{ totalItems }} {{ messageUnitLabel }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.timeline-container {
  margin-bottom: 15px;
  padding: 10px 0;
}

.timeline-bar {
  position: relative;
  height: 12px;
  background-color: var(--black-50a);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--theme-border-color);
  width: 100%;
}

.timeline-segment {
  position: absolute;
  height: 100%;
  top: 0;
  transition: all 0.2s ease;
  pointer-events: none; // Let tooltips on container or specific logic handle interaction if needed

  &.memory {
    background-color: var(--color-accent-green-70a);
    opacity: 0.8;
  }

  &.selection {
    background-color: var(--color-info-cobalt);
    opacity: 0.7;
    z-index: 2;
    border: 1px solid var(--white-50a);
  }

  &.overlap {
    background-color: var(--color-warning);
    opacity: 0.9;
    z-index: 3;
    animation: pulse 2s infinite;
  }

  &.summarized {
    background-color: var(--color-accent-green);
    opacity: 0.6;
  }

  &.missing {
    background-color: var(--black-50a); // Transparentish
    opacity: 0; // Don't show anything for missing, just base bar
  }
}

.timeline-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.8em;
  color: var(--theme-emphasis-color);
  margin-top: 5px;
}

@keyframes pulse {
  0% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.7;
  }
}
</style>
