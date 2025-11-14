<script setup lang="ts">
import { computed } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';

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

function changeItemsPerPage(event: Event) {
  const newSize = parseInt((event.target as HTMLSelectElement).value, 10);
  emit('update:itemsPerPage', newSize);
  emit('update:currentPage', 1); // Reset to first page
}
</script>

<template>
  <div v-if="totalItems > 0" class="pagination">
    <div class="pagination__nav">{{ startItem }}-{{ endItem }} {{ t('common.of') }} {{ totalItems }}</div>
    <div class="pagination__pages">
      <div
        class="menu-button fa-solid fa-angles-left"
        :class="{ disabled: !canGoBack }"
        @click="changePage(1)"
        :title="t('pagination.first')"
      ></div>
      <div
        class="menu-button fa-solid fa-angle-left"
        :class="{ disabled: !canGoBack }"
        @click="changePage(currentPage - 1)"
        :title="t('pagination.previous')"
      ></div>
      <div
        class="menu-button fa-solid fa-angle-right"
        :class="{ disabled: !canGoForward }"
        @click="changePage(currentPage + 1)"
        :title="t('pagination.next')"
      ></div>
      <div
        class="menu-button fa-solid fa-angles-right"
        :class="{ disabled: !canGoForward }"
        @click="changePage(totalPages)"
        :title="t('pagination.last')"
      ></div>
    </div>
    <div class="pagination__size-changer">
      <select :value="itemsPerPage" @change="changeItemsPerPage" class="text-pole">
        <option v-for="option in itemsPerPageOptions" :key="option" :value="option">
          {{ t('pagination.perPage', { count: option }) }}
        </option>
      </select>
    </div>
  </div>
</template>
