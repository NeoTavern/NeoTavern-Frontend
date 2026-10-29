<script setup lang="ts">
import { ref, watch, type Ref } from 'vue';
import { Button } from '../../../components/UI';

const props = defineProps<{
  index: number;
  title: string;
  /** Bumped whenever captures are added or removed, so the button re-checks its message. */
  capturesVersion: Ref<number>;
  hasCaptures: (messageIndex: number) => Promise<boolean>;
  onOpen: (messageIndex: number) => void;
}>();

const visible = ref(false);

watch(
  () => [props.index, props.capturesVersion.value] as const,
  async ([index]) => {
    const result = await props.hasCaptures(index);
    if (index === props.index) visible.value = result;
  },
  { immediate: true },
);
</script>

<template>
  <Button v-if="visible" variant="ghost" icon="fa-file-lines" :title="title" @click.stop="onOpen(index)" />
</template>
