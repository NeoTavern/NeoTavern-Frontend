<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  icon: string;
  spin?: boolean;
  fixedWidth?: boolean;
}>();

const classes = computed(() => {
  const list = ['fa-solid', props.icon];
  if (props.spin) list.push('fa-spin');
  if (props.fixedWidth) list.push('fa-fw');
  return list;
});
</script>

<template>
  <i :class="classes" aria-hidden="true"></i>
</template>
