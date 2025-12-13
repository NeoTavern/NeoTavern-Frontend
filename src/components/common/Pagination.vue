<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { Button, Select } from '../UI';

const props = defineProps({
  totalItems: { type: Number, required: true },
  currentPage: { type: Number, required: true },
  itemsPerPage: { type: Number, required: true },
  itemsPerPageOptions: { type: Array as () => number[], default: () => [10, 25, 50, 100, 500, 1000] },
});

const emit = defineEmits(['update:currentPage', 'update:itemsPerPage']);

const { t } = useStrictI18n();

const totalPages = computed(() => Math.ceil(props.totalItems / props.itemsPerPage));

const canGoBack = computed(() => props.currentPage > 1);
const canGoForward = computed(() => props.currentPage < totalPages.value);

const startItem = computed(() => (props.currentPage - 1) * props.itemsPerPage + 1);
const endItem = computed(() => Math.min(props.currentPage * props.itemsPerPage, props.totalItems));

function changePage(page: number) {
  if (page >= 1 && page <= totalPages.value) {
    emit('update:currentPage', page);
  }
}

const sizeOptions = computed(() => {
  return props.itemsPerPageOptions.map((opt) => ({
    label: t('pagination.perPage', { count: opt }),
    value: opt,
  }));
});

function onSizeChange(newSize: number | number[]) {
  emit('update:itemsPerPage', newSize);
  emit('update:currentPage', 1); // Reset to first page
}
</script>

<template>
  <div v-if="totalItems > 0" class="pagination" role="navigation" :aria-label="t('a11y.pagination.navigation')">
    <div class="pagination-nav" aria-live="polite">
      {{ startItem }}-{{ endItem }} {{ t('common.of') }} {{ totalItems }}
    </div>
    <div class="pagination-pages">
      <Button
        variant="ghost"
        icon="fa-angles-left"
        :disabled="!canGoBack"
        :title="t('pagination.first')"
        :aria-label="t('pagination.first')"
        @click="changePage(1)"
      />
      <Button
        variant="ghost"
        icon="fa-angle-left"
        :disabled="!canGoBack"
        :title="t('pagination.previous')"
        :aria-label="t('pagination.previous')"
        @click="changePage(currentPage - 1)"
      />
      <Button
        variant="ghost"
        icon="fa-angle-right"
        :disabled="!canGoForward"
        :title="t('pagination.next')"
        :aria-label="t('pagination.next')"
        @click="changePage(currentPage + 1)"
      />
      <Button
        variant="ghost"
        icon="fa-angles-right"
        :disabled="!canGoForward"
        :title="t('pagination.last')"
        :aria-label="t('pagination.last')"
        @click="changePage(totalPages)"
      />
    </div>
    <div class="pagination-size-changer">
      <Select
        :model-value="itemsPerPage"
        :options="sizeOptions"
        :label="t('pagination.itemsPerPageLabel')"
        class="pagination-select"
        @update:model-value="onSizeChange"
      />
    </div>
  </div>
</template>
