<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useResizable } from '../../composables/useResizable';
import WorldInfoEntryEditor from './WorldInfoEntryEditor.vue';
import WorldInfoGlobalSettings from './WorldInfoGlobalSettings.vue';
import type { WorldInfoEntry as WorldInfoEntryType } from '../../types';

const { t } = useStrictI18n();
const worldInfoStore = useWorldInfoStore();

const browserPane = ref<HTMLElement | null>(null);
const dividerEl = ref<HTMLElement | null>(null);
const isBrowserCollapsed = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

useResizable(browserPane, dividerEl, { storageKey: 'worldinfo_browser_width', initialWidth: 350 });

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
</script>

<template>
  <div class="character-panel world-info-drawer" :class="{ 'is-collapsed': isBrowserCollapsed }">
    <!-- Left Pane: Lorebook Browser -->
    <div ref="browserPane" class="character-panel-browser">
      <div class="character-panel-browser-header world-info-controls">
        <div class="world-info-controls-row">
          <div
            class="menu-button fa-solid fa-plus"
            :title="t('worldInfo.newWorld')"
            @click="worldInfoStore.createNewBook"
          ></div>
          <div class="menu-button fa-solid fa-file-import" :title="t('worldInfo.import')" @click="triggerImport"></div>
          <input ref="fileInput" type="file" accept=".json" hidden @change="handleFileImport" />
          <div
            class="menu-button fa-solid fa-sync"
            :title="t('worldInfo.refresh')"
            @click="worldInfoStore.refresh"
          ></div>
        </div>
        <div class="world-info-controls-row">
          <input
            v-model="worldInfoStore.browserSearchTerm"
            class="text-pole"
            type="search"
            :placeholder="t('worldInfo.searchPlaceholder')"
          />
          <select v-model="worldInfoStore.sortOrder" class="text-pole" :title="t('worldInfo.sorting.title')">
            <option value="order:asc">{{ t('worldInfo.sorting.orderAsc') }}</option>
            <option value="comment:asc">{{ t('worldInfo.sorting.titleAsc') }}</option>
            <option value="comment:desc">{{ t('worldInfo.sorting.titleDesc') }}</option>
            <option value="uid:asc">{{ t('worldInfo.sorting.uidAsc') }}</option>
            <option value="uid:desc">{{ t('worldInfo.sorting.uidDesc') }}</option>
          </select>
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
              <i
                class="fa-solid fa-plus"
                :title="t('worldInfo.newEntryInBook', { bookName })"
                @click.stop="worldInfoStore.createNewEntry(bookName)"
              ></i>
              <i
                class="fa-solid fa-file-export"
                :title="t('worldInfo.export')"
                @click.stop="worldInfoStore.exportBook(bookName)"
              ></i>
              <i
                class="fa-solid fa-clone"
                :title="t('worldInfo.duplicate')"
                @click.stop="worldInfoStore.duplicateBook(bookName)"
              ></i>
              <i
                class="fa-solid fa-pencil"
                :title="t('worldInfo.rename')"
                @click.stop="worldInfoStore.renameBook(bookName)"
              ></i>
              <i
                class="fa-solid fa-trash-can"
                :title="t('worldInfo.deleteBook', { bookName })"
                @click.stop="worldInfoStore.deleteBook(bookName)"
              ></i>
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
    </div>

    <!-- Divider -->
    <div ref="dividerEl" class="character-panel-divider">
      <div class="character-panel-collapse-toggle" @click="isBrowserCollapsed = !isBrowserCollapsed">
        <i class="fa-solid" :class="isBrowserCollapsed ? 'fa-angles-right' : 'fa-angles-left'"></i>
      </div>
    </div>

    <!-- Right Pane: Editor -->
    <div class="character-panel-editor">
      <WorldInfoGlobalSettings v-show="worldInfoStore.selectedItemId === 'global-settings'" />
      <WorldInfoEntryEditor
        v-show="worldInfoStore.selectedEntry"
        :model-value="worldInfoStore.selectedEntry ?? undefined"
        @update:model-value="updateEntry"
      />
      <div v-show="!worldInfoStore.selectedEntry" class="character-panel-editor-placeholder">
        <div class="placeholder-icon fa-solid fa-book-atlas"></div>
        <h2 class="placeholder-title">{{ t('worldInfo.selectEntryPlaceholderTitle') }}</h2>
        <p class="placeholder-text">{{ t('worldInfo.selectEntryPlaceholderText') }}</p>
      </div>
    </div>
  </div>
</template>
