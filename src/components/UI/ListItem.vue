<script setup lang="ts">
defineProps<{
  active?: boolean;
  selected?: boolean;
}>();

const emit = defineEmits<{
  (e: 'click', event: MouseEvent | KeyboardEvent): void;
}>();

function onClick(event: MouseEvent) {
  emit('click', event);
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('click', event);
  }
}
</script>

<template>
  <div
    class="list-item"
    :class="{ 'is-active': active, 'is-selected': selected }"
    role="button"
    tabindex="0"
    :aria-pressed="active"
    :aria-selected="selected"
    @click="onClick"
    @keydown="onKeyDown"
  >
    <!-- Left: Avatar/Icon -->
    <div v-if="$slots.start" class="list-item-start">
      <slot name="start" />
    </div>

    <!-- Center: Text content -->
    <div class="list-item-content">
      <slot />
    </div>

    <!-- Right: Actions/Meta -->
    <div v-if="$slots.end" class="list-item-end">
      <slot name="end" />
    </div>
  </div>
</template>
