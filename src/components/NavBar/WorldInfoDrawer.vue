<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import WorldInfoEntryEditor from './WorldInfoEntryEditor.vue';
import WorldInfoGlobalSettings from './WorldInfoGlobalSettings.vue';
import type { WorldInfoEntry as WorldInfoEntryType } from '../../types';
import { AppIconButton, AppInput, AppSelect } from '../UI';
import SplitPane from '../Common/SplitPane.vue';

const { t } = useStrictI18n();
const worldInfoStore = useWorldInfoStore();

const isBrowserCollapsed = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

onMounted(() => {
  if (worldInfoStore.bookNames.length === 0) {
    worldInfoStore.initialize();
  }
});

async function updateEntry(newEntry: WorldInfoEntryType) {
  await worldInfoStore.updateSelectedEntry(newEntry);
}

function triggerImport() {
  fileInput.value?.click();
}

async function handleFileImport(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files?.[0]) {
    await worldInfoStore.importBook(target.files[0]);
  }
  if (target) target.value = '';
}

const filteredBookNames = computed(() => {
  if (!worldInfoStore.browserSearchTerm) {
    return worldInfoStore.bookNames;
  }
  const lowerSearch = worldInfoStore.browserSearchTerm.toLowerCase();
  return worldInfoStore.bookNames.filter((name) => {
    // Show book if its name matches
    if (name.toLowerCase().includes(lowerSearch)) {
      return true;
    }
    // Or if it has any entries that match
    return worldInfoStore.filteredAndSortedEntries(name).length > 0;
  });
});

const sortOptions = computed(() => [
  { value: 'order:asc', label: t('worldInfo.sorting.orderAsc') },
  { value: 'comment:asc', label: t('worldInfo.sorting.titleAsc') },
  { value: 'comment:desc', label: t('worldInfo.sorting.titleDesc') },
  { value: 'uid:asc', label: t('worldInfo.sorting.uidAsc') },
  { value: 'uid:desc', label: t('worldInfo.sorting.uidDesc') },
]);
</script>

<template>
  <SplitPane
    v-model:collapsed="isBrowserCollapsed"
    storage-key="worldinfoBrowserWidth"
    :initial-width="350"
    class="character-panel world-info-drawer"
  >
    <template #side>
      <div class="character-panel-browser-header world-info-controls">
        <div class="world-info-controls-row">
          <AppIconButton icon="fa-plus" :title="t('worldInfo.newWorld')" @click="worldInfoStore.createNewBook" />
          <AppIconButton icon="fa-file-import" :title="t('worldInfo.import')" @click="triggerImport" />
          <input ref="fileInput" type="file" accept=".json" hidden @change="handleFileImport" />
          <AppIconButton icon="fa-sync" :title="t('worldInfo.refresh')" @click="worldInfoStore.refresh" />
        </div>
        <div class="world-info-controls-row">
          <AppInput
            v-model="worldInfoStore.browserSearchTerm"
            type="search"
            :placeholder="t('worldInfo.searchPlaceholder')"
          />
          <AppSelect v-model="worldInfoStore.sortOrder" :title="t('worldInfo.sorting.title')" :options="sortOptions" />
        </div>
      </div>

      <div class="character-panel-character-list">
        <div
          class="browser-item"
          :class="{ 'is-active': worldInfoStore.selectedItemId === 'global-settings' }"
          @click="worldInfoStore.selectItem('global-settings')"
        >
          <div class="browser-item-content">
            <i class="fa-solid fa-cogs browser-item-icon"></i>
            <span class="browser-item-name">{{ t('worldInfo.globalSettings') }}</span>
          </div>
        </div>

        <hr class="panel-divider" />

        <div v-for="bookName in filteredBookNames" :key="bookName" class="lorebook-group">
          <div class="browser-item is-book" @click="worldInfoStore.toggleBookExpansion(bookName)">
            <div class="browser-item-content">
              <i
                class="fa-solid fa-chevron-right browser-item-chevron"
                :class="{ 'is-open': worldInfoStore.expandedBooks.has(bookName) }"
              ></i>
              <span class="browser-item-name">{{ bookName }}</span>
            </div>
            <div class="browser-item-actions">
              <AppIconButton
                icon="fa-plus"
                :title="t('worldInfo.newEntryInBook', { bookName })"
                @click.stop="worldInfoStore.createNewEntry(bookName)"
              />
              <AppIconButton
                icon="fa-file-export"
                :title="t('worldInfo.export')"
                @click.stop="worldInfoStore.exportBook(bookName)"
              />
              <AppIconButton
                icon="fa-clone"
                :title="t('worldInfo.duplicate')"
                @click.stop="worldInfoStore.duplicateBook(bookName)"
              />
              <AppIconButton
                icon="fa-pencil"
                :title="t('worldInfo.rename')"
                @click.stop="worldInfoStore.renameBook(bookName)"
              />
              <AppIconButton
                icon="fa-trash-can"
                :title="t('worldInfo.deleteBook', { bookName })"
                @click.stop="worldInfoStore.deleteBook(bookName)"
              />
            </div>
          </div>

          <!--
            TODO: v-if is used here instead of v-show for performance.
            Rendering potentially hundreds or thousands of lorebook entries, even if hidden,
            can impact initial load and reactivity. This is a trade-off: it improves performance
            at the cost of extensions not being able to target the DOM of collapsed entries.
            Given that data is lazy-loaded upon expansion, this is an acceptable optimization.
            I'll think something else for extensions.

            TODO: What about pagination for large books?
          -->
          <Transition name="grid-slide">
            <div v-if="worldInfoStore.expandedBooks.has(bookName)" class="lorebook-group-entries">
              <div>
                <div v-if="worldInfoStore.loadingBooks.has(bookName)" class="lorebook-group-loading">
                  <i class="fa-solid fa-spinner fa-spin"></i>
                </div>
                <div v-else>
                  <div
                    v-for="entry in worldInfoStore.filteredAndSortedEntries(bookName)"
                    :key="entry.uid"
                    class="browser-item is-entry"
                    :class="{ 'is-active': worldInfoStore.selectedItemId === `${bookName}/${entry.uid}` }"
                    @click="worldInfoStore.selectItem(`${bookName}/${entry.uid}`)"
                  >
                    <div class="browser-item-content">
                      <span class="browser-item-name">{{ entry.comment || '[Untitled Entry]' }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </template>

    <template #main>
      <div class="character-panel-editor">
        <WorldInfoGlobalSettings v-show="worldInfoStore.selectedItemId === 'global-settings'" />
        <WorldInfoEntryEditor
          v-show="worldInfoStore.selectedEntry"
          :model-value="worldInfoStore.selectedEntry ?? undefined"
          @update:model-value="updateEntry"
        />
      </div>
    </template>
  </SplitPane>
</template>
