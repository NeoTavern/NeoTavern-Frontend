<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useApiStore } from '../../stores/api.store';
import { Select } from '../UI';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    showGlobalOption?: boolean;
  }>(),
  {
    showGlobalOption: true,
  },
);

const emit = defineEmits(['update:modelValue']);

const { t } = useStrictI18n();
const apiStore = useApiStore();

const selectedProfile = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const options = computed(() => {
  const sortedProfiles = [...apiStore.connectionProfiles].sort((a, b) => a.name.localeCompare(b.name));

  const profileOptions = sortedProfiles.map((p) => ({ label: p.name, value: p.id }));

  const defaultOption = props.showGlobalOption
    ? { label: t('apiConnections.profileManagement.globalActive'), value: '' }
    : { label: t('apiConnections.profileManagement.none'), value: '' };

  return [defaultOption, ...profileOptions];
});
</script>

<template>
  <Select v-model="selectedProfile!" :options="options" searchable />
</template>
