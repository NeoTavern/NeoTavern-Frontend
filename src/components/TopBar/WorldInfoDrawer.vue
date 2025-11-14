<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useWorldInfoStore } from '../../stores/world-info.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { slideTransitionHooks } from '../../utils/dom';
import WorldInfoEntry from './WorldInfoEntry.vue';
import type { WorldInfoEntry as WorldInfoEntryType } from '../../types';
import { WorldInfoInsertionStrategy } from '../../types';

const { t } = useStrictI18n();
const worldInfoStore = useWorldInfoStore();

const { beforeEnter, enter, afterEnter, beforeLeave, leave } = slideTransitionHooks;

const isBookSelected = computed(() => !!worldInfoStore.editingBookName);

onMounted(() => {
  worldInfoStore.initialize();
});

function handleFileImport(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    worldInfoStore.importBook(file);
  }
  if (target) {
    target.value = '';
  }
}

function updateEntry(index: number, newEntry: WorldInfoEntryType) {
  if (worldInfoStore.editingBook && worldInfoStore.editingBook.entries) {
    worldInfoStore.editingBook.entries[index] = newEntry;
    worldInfoStore.saveEditingBookDebounced();
  }
}
</script>

<template>
  <div class="world-info-drawer">
    <div class="world-info-drawer__header">
      <div
        :title="t('worldInfo.pinToggle')"
        class="menu-button-icon"
        :class="worldInfoStore.isPanelPinned ? 'fa-lock' : 'fa-unlock'"
        @click="worldInfoStore.isPanelPinned = !worldInfoStore.isPanelPinned"
      ></div>
      <h3>
        <span>{{ t('worldInfo.title') }}</span>
        <a
          href="https://docs.sillytavern.app/usage/core-concepts/worldinfo/"
          class="notes-link"
          target="_blank"
          :title="t('worldInfo.docsLink')"
        >
          <span class="fa-solid fa-circle-question note-link-span"></span>
        </a>
      </h3>
    </div>

    <div class="world-info-drawer__content">
      <div class="world-info-drawer__section">
        <!-- Active Worlds Selector -->
        <div class="range-block">
          <div class="range-block-title">
            <small>{{ t('worldInfo.activeWorlds') }}</small>
          </div>
          <!-- TODO: Replace with a proper multi-select component later -->
          <select class="text-pole" multiple v-model="worldInfoStore.activeBookNames" style="min-height: 80px">
            <option v-for="name in worldInfoStore.bookNames" :key="name" :value="name">{{ name }}</option>
          </select>
        </div>

        <!-- Global Settings -->
        <div class="range-block">
          <div class="range-block-title">
            <small>{{ t('worldInfo.globalSettings') }}</small>
          </div>
          <div class="inline-drawer">
            <div
              class="standoutHeader inline-drawer-header"
              @click="worldInfoStore.isSettingsExpanded = !worldInfoStore.isSettingsExpanded"
            >
              <b>{{ t('worldInfo.expand') }}</b>
              <div
                class="fa-solid fa-circle-chevron-down inline-drawer-icon"
                :class="{ 'is-open': worldInfoStore.isSettingsExpanded }"
              ></div>
            </div>
            <transition
              name="slide-js"
              @before-enter="beforeEnter"
              @enter="enter"
              @after-enter="afterEnter"
              @before-leave="beforeLeave"
              @leave="leave"
            >
              <div v-show="worldInfoStore.isSettingsExpanded" class="inline-drawer-content">
                <div class="wi-settings-grid">
                  <div class="wi-settings-grid__sliders">
                    <!-- Sliders -->
                    <div class="range-block">
                      <div class="range-block-title">{{ t('worldInfo.scanDepth') }}</div>
                      <div class="range-block-range-and-counter">
                        <input
                          type="range"
                          class="neo-range-slider"
                          min="0"
                          max="1000"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_depth"
                        />
                        <input
                          type="number"
                          class="neo-range-input"
                          min="0"
                          max="1000"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_depth"
                        />
                      </div>
                    </div>
                    <div class="range-block">
                      <div class="range-block-title">{{ t('worldInfo.contextPercent') }}</div>
                      <div class="range-block-range-and-counter">
                        <input
                          type="range"
                          class="neo-range-slider"
                          min="1"
                          max="100"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_budget"
                        />
                        <input
                          type="number"
                          class="neo-range-input"
                          min="1"
                          max="100"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_budget"
                        />
                      </div>
                    </div>
                    <div class="range-block">
                      <div class="range-block-title" :title="t('worldInfo.budgetCapHint')">
                        {{ t('worldInfo.budgetCap') }}
                      </div>
                      <div class="range-block-range-and-counter">
                        <input
                          type="range"
                          class="neo-range-slider"
                          min="0"
                          max="65536"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_budget_cap"
                        />
                        <input
                          type="number"
                          class="neo-range-input"
                          min="0"
                          max="65536"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_budget_cap"
                        />
                      </div>
                    </div>
                    <div class="range-block" :title="t('worldInfo.minActivationsHint')">
                      <div class="range-block-title">{{ t('worldInfo.minActivations') }}</div>
                      <div class="range-block-range-and-counter">
                        <input
                          type="range"
                          class="neo-range-slider"
                          min="0"
                          max="100"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_min_activations"
                        />
                        <input
                          type="number"
                          class="neo-range-input"
                          min="0"
                          max="100"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_min_activations"
                        />
                      </div>
                    </div>
                    <div class="range-block" :title="t('worldInfo.maxDepthHint')">
                      <div class="range-block-title">{{ t('worldInfo.maxDepth') }}</div>
                      <div class="range-block-range-and-counter">
                        <input
                          type="range"
                          class="neo-range-slider"
                          min="0"
                          max="100"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_min_activations_depth_max"
                        />
                        <input
                          type="number"
                          class="neo-range-input"
                          min="0"
                          max="100"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_min_activations_depth_max"
                        />
                      </div>
                    </div>
                    <div class="range-block" :title="t('worldInfo.maxRecursionStepsHint')">
                      <div class="range-block-title">{{ t('worldInfo.maxRecursionSteps') }}</div>
                      <div class="range-block-range-and-counter">
                        <input
                          type="range"
                          class="neo-range-slider"
                          min="0"
                          max="10"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_max_recursion_steps"
                        />
                        <input
                          type="number"
                          class="neo-range-input"
                          min="0"
                          max="10"
                          step="1"
                          v-model.number="worldInfoStore.settings.world_info_max_recursion_steps"
                        />
                      </div>
                    </div>
                    <div class="range-block">
                      <div class="range-block-title">{{ t('worldInfo.insertionStrategy') }}</div>
                      <select class="text-pole" v-model="worldInfoStore.settings.world_info_character_strategy">
                        <option :value="WorldInfoInsertionStrategy.EVENLY">
                          {{ t('worldInfo.insertionStrategies.sortedEvenly') }}
                        </option>
                        <option :value="WorldInfoInsertionStrategy.CHARACTER_FIRST">
                          {{ t('worldInfo.insertionStrategies.characterLoreFirst') }}
                        </option>
                        <option :value="WorldInfoInsertionStrategy.GLOBAL_FIRST">
                          {{ t('worldInfo.insertionStrategies.globalLoreFirst') }}
                        </option>
                      </select>
                    </div>
                  </div>
                  <div class="wi-settings-grid__checkboxes">
                    <!-- Checkboxes -->
                    <label class="checkbox-label" :title="t('worldInfo.includeNamesHint')">
                      <input type="checkbox" v-model="worldInfoStore.settings.world_info_include_names" />
                      <span>{{ t('worldInfo.includeNames') }}</span>
                    </label>
                    <label class="checkbox-label" :title="t('worldInfo.recursiveScanHint')">
                      <input type="checkbox" v-model="worldInfoStore.settings.world_info_recursive" />
                      <span>{{ t('worldInfo.recursiveScan') }}</span>
                    </label>
                    <label class="checkbox-label" :title="t('worldInfo.caseSensitiveHint')">
                      <input type="checkbox" v-model="worldInfoStore.settings.world_info_case_sensitive" />
                      <span>{{ t('worldInfo.caseSensitive') }}</span>
                    </label>
                    <label class="checkbox-label" :title="t('worldInfo.matchWholeWordsHint')">
                      <input type="checkbox" v-model="worldInfoStore.settings.world_info_match_whole_words" />
                      <span>{{ t('worldInfo.matchWholeWords') }}</span>
                    </label>
                    <label class="checkbox-label" :title="t('worldInfo.useGroupScoringHint')">
                      <input type="checkbox" v-model="worldInfoStore.settings.world_info_use_group_scoring" />
                      <span>{{ t('worldInfo.useGroupScoring') }}</span>
                    </label>
                    <label class="checkbox-label" :title="t('worldInfo.alertOnOverflowHint')">
                      <input type="checkbox" v-model="worldInfoStore.settings.world_info_overflow_alert" />
                      <span>{{ t('worldInfo.alertOnOverflow') }}</span>
                    </label>
                  </div>
                </div>
              </div>
            </transition>
          </div>
        </div>
      </div>

      <hr />

      <!-- World Editor Section -->
      <div class="world-editor">
        <div class="world-editor__controls">
          <div class="menu-button" @click="worldInfoStore.createNewBook">
            <i class="fa-solid fa-globe"></i>
            <span>{{ t('worldInfo.newWorld') }}</span>
          </div>
          <small>{{ t('worldInfo.or') }}</small>
          <select
            class="text-pole"
            :value="worldInfoStore.editingBookName"
            @change="worldInfoStore.selectBookForEditing(($event.target as HTMLSelectElement).value)"
          >
            <option :value="null">{{ t('worldInfo.pickToEdit') }}</option>
            <option v-for="name in worldInfoStore.bookNames" :key="name" :value="name">{{ name }}</option>
          </select>
          <label class="menu-button fa-solid fa-file-import" :title="t('worldInfo.import')">
            <input type="file" @change="handleFileImport" accept=".json,.lorebook,.png" hidden />
          </label>
          <div
            class="menu-button fa-solid fa-file-export"
            :title="t('worldInfo.export')"
            :class="{ disabled: !isBookSelected }"
            @click="worldInfoStore.exportEditingBook"
          ></div>
          <div
            class="menu-button fa-solid fa-pencil"
            :title="t('worldInfo.rename')"
            :class="{ disabled: !isBookSelected }"
            @click="worldInfoStore.renameEditingBook"
          ></div>
          <div
            class="menu-button fa-solid fa-paste"
            :title="t('worldInfo.duplicate')"
            :class="{ disabled: !isBookSelected }"
            @click="worldInfoStore.duplicateEditingBook"
          ></div>
          <div
            class="menu-button fa-solid fa-trash-can redWarningBG"
            :title="t('worldInfo.delete')"
            :class="{ disabled: !isBookSelected }"
            @click="worldInfoStore.deleteEditingBook"
          ></div>
        </div>

        <!-- Entry Editor (if a book is selected) -->
        <div v-if="worldInfoStore.editingBook" class="world-editor__entries">
          <div class="world-editor__entries-controls">
            <!-- TODO: New Entry, Open/Close all, Search, Sort, Pagination -->
            <div class="menu-button fa-solid fa-plus" :title="t('worldInfo.newEntry')"></div>
            <div class="menu-button fa-solid fa-expand" :title="t('worldInfo.openAllEntries')"></div>
            <div class="menu-button fa-solid fa-compress" :title="t('worldInfo.closeAllEntries')"></div>
            <input
              type="search"
              class="text-pole"
              :placeholder="t('worldInfo.searchPlaceholder')"
              v-model="worldInfoStore.searchTerm"
            />
            <select class="text-pole" v-model="worldInfoStore.sortOrder">
              <option value="priority">{{ t('worldInfo.sorting.priority') }}</option>
              <option value="title:asc">{{ t('worldInfo.sorting.titleAsc') }}</option>
              <option value="title:desc">{{ t('worldInfo.sorting.titleDesc') }}</option>
              <option value="tokens:asc">{{ t('worldInfo.sorting.tokensAsc') }}</option>
              <option value="tokens:desc">{{ t('worldInfo.sorting.tokensDesc') }}</option>
              <option value="depth:asc">{{ t('worldInfo.sorting.depthAsc') }}</option>
              <option value="depth:desc">{{ t('worldInfo.sorting.depthDesc') }}</option>
              <option value="order:asc">{{ t('worldInfo.sorting.orderAsc') }}</option>
              <option value="order:desc">{{ t('worldInfo.sorting.orderDesc') }}</option>
              <option value="uid:asc">{{ t('worldInfo.sorting.uidAsc') }}</option>
              <option value="uid:desc">{{ t('worldInfo.sorting.uidDesc') }}</option>
              <option value="trigger:asc">{{ t('worldInfo.sorting.triggerAsc') }}</option>
              <option value="trigger:desc">{{ t('worldInfo.sorting.triggerDesc') }}</option>
            </select>
            <div class="menu-button fa-solid fa-arrows-rotate" :title="t('worldInfo.refresh')"></div>
          </div>
          <div class="world-editor__entries-list">
            <WorldInfoEntry
              v-for="(entry, index) in worldInfoStore.filteredEntries"
              :key="entry.uid"
              :model-value="entry"
              @update:model-value="(newEntry) => updateEntry(index, newEntry)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
