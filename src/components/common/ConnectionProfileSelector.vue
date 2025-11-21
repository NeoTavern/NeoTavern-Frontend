<script setup lang="ts">
import { useApiStore } from '../../stores/api.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { computed } from 'vue';
import { AppSelect } from '../UI';

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
  const list = [
    { label: t('apiConnections.profileManagement.none'), value: undefined },
    ...apiStore.connectionProfiles.map((p) => ({ label: p.name, value: p.name })),
  ];
  return list as { label: string; value: string | undefined }[];
});
</script>

<template>
  <AppSelect v-model="selectedProfile" :options="options" />
</template>
