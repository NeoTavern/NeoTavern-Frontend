<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { usePopupStore } from '../../stores/popup.store';
import { useWorldInfoUiStore } from '../../stores/world-info-ui.store';
import { useWorldInfoStore } from '../../stores/world-info.store';
import type { WorldInfoEntry as WorldInfoEntryType } from '../../types';
import { POPUP_RESULT, POPUP_TYPE } from '../../types';
import { PanelLayout } from '../common';
import { Button, FileInput, Icon, ListItem, Search, Select, Textarea } from '../UI';
import WorldInfoEntryEditor from './WorldInfoEntryEditor.vue';
import WorldInfoGlobalSettings from './WorldInfoGlobalSettings.vue';

const { t } = useStrictI18n();

const props = defineProps<{
  mode?: 'full' | 'main-only' | 'side-only';
  title?: string;
}>();
const worldInfoStore = useWorldInfoStore();
const worldInfoUiStore = useWorldInfoUiStore();
const popupStore = usePopupStore();

const isBrowserCollapsed = ref(false);

onMounted(() => {
  if (worldInfoStore.bookInfos.length === 0) {
    worldInfoStore.initialize();
  }
});

async function updateEntry(newEntry: WorldInfoEntryType) {
  const book = worldInfoUiStore.selectedBookForEntry;
  if (book) {
    await worldInfoStore.updateEntry(book, newEntry);
  }
}

function toggleEntryDisabled() {
  const entry = worldInfoUiStore.selectedEntry;
  if (!entry) return;

  void updateEntry({ ...entry, disable: !entry.disable });
}

function updateEntryComment(comment: string) {
  const entry = worldInfoUiStore.selectedEntry;
  if (!entry) return;

  void updateEntry({ ...entry, comment });
}

async function duplicateSelectedEntry() {
  const entry = worldInfoUiStore.selectedEntry;
  const filename = worldInfoUiStore.selectedFilename;
  if (!entry || !filename) return;

  const newUid = await worldInfoStore.duplicateEntry(filename, entry);
  if (newUid) {
    worldInfoUiStore.selectItem(`${filename}/${newUid}`);
  }
}

async function deleteSelectedEntry() {
  const entry = worldInfoUiStore.selectedEntry;
  const filename = worldInfoUiStore.selectedFilename;
  if (!entry || !filename) return;

  const { result } = await popupStore.show({
    title: t('worldInfo.popup.deleteEntryTitle'),
    content: t('worldInfo.popup.deleteEntryContent', { name: entry.comment }),
    type: POPUP_TYPE.CONFIRM,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    await worldInfoStore.deleteEntry(filename, entry.uid);
    worldInfoUiStore.selectItem('global-settings');
  }
}

async function handleFileImport(files: File[]) {
  if (files[0]) {
    const filename = await worldInfoStore.importBook(files[0]);
    if (filename) {
      await worldInfoStore.fetchBook(filename);
      worldInfoUiStore.toggleBookExpansion(filename);
    }
  }
}

async function handleCreateBook() {
  const { result, value } = await popupStore.show<string>({
    title: t('worldInfo.popup.newBookTitle'),
    content: t('worldInfo.popup.newBookContent'),
    type: POPUP_TYPE.INPUT,
    inputValue: t('worldInfo.popup.newBookInput'),
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && value) {
    const filename = await worldInfoStore.createBook(value);
    if (filename) {
      worldInfoUiStore.toggleBookExpansion(filename);
    }
  }
}

async function handleDeleteBook(fileId: string, bookName: string) {
  const { result } = await popupStore.show({
    title: t('common.confirmDelete'),
    content: t('worldInfo.popup.deleteBookContent', { name: bookName }),
    type: POPUP_TYPE.CONFIRM,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE) {
    await worldInfoStore.deleteBook(fileId);
    if (worldInfoUiStore.selectedItemId?.startsWith(`${fileId}/`)) {
      worldInfoUiStore.selectItem('global-settings');
    }
    worldInfoUiStore.expandedBooks.delete(fileId);
  }
}

async function handleRenameBook(fileId: string) {
  const book = await worldInfoStore.getBookFromCache(fileId, true);
  if (!book) return;

  const { result, value: newName } = await popupStore.show<string>({
    title: t('worldInfo.popup.renameBookTitle'),
    type: POPUP_TYPE.INPUT,
    inputValue: book.name,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && newName && newName.trim() && newName !== book.name) {
    await worldInfoStore.renameBook(fileId, newName);
  }
}

async function handleDuplicateBook(fileId: string) {
  const book = await worldInfoStore.getBookFromCache(fileId, true);
  if (!book) return;

  const { result, value: newName } = await popupStore.show<string>({
    title: t('worldInfo.popup.duplicateBookTitle'),
    type: POPUP_TYPE.INPUT,
    inputValue: `${book.name}${t('worldInfo.popup.duplicateBookInputSuffix')}`,
  });

  if (result === POPUP_RESULT.AFFIRMATIVE && newName) {
    const filename = await worldInfoStore.createBook(newName, { ...book, name: newName });
    if (filename) {
      worldInfoUiStore.toggleBookExpansion(filename);
    }
  }
}

async function handleCreateEntry(fileId: string) {
  const newEntry = await worldInfoStore.createEntry(fileId);
  if (newEntry) {
    worldInfoUiStore.selectItem(`${fileId}/${newEntry.uid}`);
  }
}

const filteredBookNames = computed(() => {
  if (!worldInfoUiStore.browserSearchTerm) {
    return worldInfoStore.bookInfos;
  }
  const lowerSearch = worldInfoUiStore.browserSearchTerm.toLowerCase();

  return worldInfoStore.bookInfos.filter((bookInfo) => {
    // Show book if its name matches
    if (bookInfo.name.toLowerCase().includes(lowerSearch)) {
      return true;
    }
    // Or if it has any entries that match
    return worldInfoUiStore.filteredAndSortedEntries(bookInfo.file_id).length > 0;
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
  <PanelLayout
    v-model:collapsed="isBrowserCollapsed"
    :mode="props.mode"
    :title="props.title ?? t('navbar.worldInfo')"
    storage-key="worldinfoBrowserWidth"
    :initial-width="350"
    class="character-panel world-info-drawer"
  >
    <template #side>
      <div class="sidebar-controls world-info-controls">
        <div class="sidebar-controls-row world-info-controls-row">
          <Button variant="ghost" icon="fa-plus" :title="t('worldInfo.newWorld')" @click="handleCreateBook" />
          <FileInput accept=".json" icon="fa-file-import" :label="t('worldInfo.import')" @change="handleFileImport" />
          <Button variant="ghost" icon="fa-sync" :title="t('worldInfo.refresh')" @click="worldInfoStore.initialize" />
        </div>
        <div class="sidebar-controls-row world-info-controls-row">
          <Search v-model="worldInfoUiStore.browserSearchTerm" :placeholder="t('worldInfo.searchPlaceholder')">
            <template #actions>
              <Select
                v-model="worldInfoUiStore.sortOrder"
                :title="t('worldInfo.sorting.title')"
                :options="sortOptions"
              />
            </template>
          </Search>
        </div>
      </div>

      <div class="character-panel-character-list">
        <ListItem
          :active="worldInfoUiStore.selectedItemId === 'global-settings'"
          @click="worldInfoUiStore.selectItem('global-settings')"
        >
          <template #start><i class="fa-solid fa-cogs" style="opacity: 0.7"></i></template>
          <template #default>{{ t('worldInfo.globalSettings') }}</template>
        </ListItem>

        <hr class="panel-divider" />

        <div v-for="bookInfo in filteredBookNames" :key="bookInfo.file_id" class="lorebook-group">
          <ListItem class="is-book" @click="worldInfoUiStore.toggleBookExpansion(bookInfo.file_id)">
            <template #start>
              <i
                class="fa-solid fa-chevron-right browser-item-chevron"
                :class="{ 'is-open': worldInfoUiStore.expandedBooks.has(bookInfo.file_id) }"
                style="font-size: 0.8em; width: 15px; text-align: center"
              ></i>
            </template>
            <template #default>
              <span class="font-bold">{{ bookInfo.name }}</span>
            </template>
            <template #end>
              <div class="browser-item-actions" @click.stop>
                <Button
                  variant="ghost"
                  icon="fa-plus"
                  :title="t('worldInfo.newEntryInBook', { bookName: bookInfo.name })"
                  @click.stop="handleCreateEntry(bookInfo.file_id)"
                />
                <Button
                  variant="ghost"
                  icon="fa-file-export"
                  :title="t('worldInfo.export')"
                  @click.stop="worldInfoStore.exportBook(bookInfo.file_id)"
                />
                <Button
                  variant="ghost"
                  icon="fa-clone"
                  :title="t('worldInfo.duplicate')"
                  @click.stop="handleDuplicateBook(bookInfo.file_id)"
                />
                <Button
                  variant="ghost"
                  icon="fa-pencil"
                  :title="t('worldInfo.rename')"
                  @click.stop="handleRenameBook(bookInfo.file_id)"
                />
                <Button
                  variant="danger"
                  icon="fa-trash-can"
                  :title="t('worldInfo.deleteBook', { bookName: bookInfo.name })"
                  @click.stop="handleDeleteBook(bookInfo.file_id, bookInfo.name)"
                />
              </div>
            </template>
          </ListItem>

          <Transition name="grid-slide">
            <div v-if="worldInfoUiStore.expandedBooks.has(bookInfo.file_id)" class="lorebook-group-entries">
              <div>
                <div v-if="worldInfoStore.loadingBooks.has(bookInfo.file_id)" class="lorebook-group-loading">
                  <i class="fa-solid fa-spinner fa-spin"></i>
                </div>
                <div v-else>
                  <div v-for="entry in worldInfoUiStore.filteredAndSortedEntries(bookInfo.file_id)" :key="entry.uid">
                    <ListItem
                      :active="worldInfoUiStore.selectedItemId === `${bookInfo.file_id}/${entry.uid}`"
                      @click="worldInfoUiStore.selectItem(`${bookInfo.file_id}/${entry.uid}`)"
                    >
                      <template #default>
                        <span style="font-size: 0.95em">{{ entry.comment || '[Untitled Entry]' }}</span>
                      </template>
                    </ListItem>
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
        <WorldInfoGlobalSettings v-show="worldInfoUiStore.selectedItemId === 'global-settings'" />
        <WorldInfoEntryEditor
          v-if="worldInfoUiStore.selectedEntry"
          :model-value="worldInfoUiStore.selectedEntry"
          :show-header="props.mode === 'main-only' ? false : undefined"
          @update:model-value="updateEntry"
        >
          <template v-if="props.mode === 'main-only'" #inline-header>
            <div class="main-page-header world-info-form-header">
              <div class="main-page-header-main">
                <div class="toggle-icon-wrapper" :title="t('worldInfo.entry.toggle')" @click="toggleEntryDisabled">
                  <Icon :icon="worldInfoUiStore.selectedEntry?.disable ? 'fa-toggle-off' : 'fa-toggle-on'" />
                </div>

                <div style="flex-grow: 1">
                  <Textarea
                    :model-value="worldInfoUiStore.selectedEntry?.comment || ''"
                    :rows="1"
                    :placeholder="t('worldInfo.entry.titlePlaceholder')"
                    :resizable="false"
                    @update:model-value="updateEntryComment"
                  />
                </div>
              </div>

              <div class="main-page-header-actions">
                <Button variant="ghost" icon="fa-right-left" :title="t('worldInfo.entry.move')" />
                <Button
                  variant="ghost"
                  icon="fa-paste"
                  :title="t('worldInfo.entry.duplicate')"
                  @click="duplicateSelectedEntry"
                />
                <Button
                  icon="fa-trash-can"
                  variant="danger"
                  :title="t('worldInfo.entry.delete')"
                  @click="deleteSelectedEntry"
                />
              </div>
            </div>
          </template>
        </WorldInfoEntryEditor>
      </div>
    </template>
  </PanelLayout>
</template>

<style scoped>
.font-bold {
  font-weight: bold;
}

.toggle-icon-wrapper {
  cursor: pointer;
  font-size: 1.4em;
  color: var(--color-accent-green-70a);
  transition: opacity var(--animation-duration-2x);

  &:hover {
    opacity: 0.8;
  }
}
</style>
