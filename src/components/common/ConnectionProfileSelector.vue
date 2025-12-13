<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useApiStore } from '../../stores/api.store';
import { Select } from '../UI';

const props = defineProps<{
  modelValue?: string;
}>();

const emit = defineEmits(['update:modelValue']);

const { t } = useStrictI18n();
const apiStore = useApiStore();

const selectedProfile = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const options = computed(() => {
  return [
    { label: t('apiConnections.profileManagement.none'), value: '' },
    ...apiStore.connectionProfiles.map((p) => ({ label: p.name, value: p.name })),
  ];
});
</script>

<template>
  <Select v-model="selectedProfile!" :options="options" searchable />
</template>
