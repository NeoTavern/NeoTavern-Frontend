<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useExtensionStore } from '../../stores/extension.store';
import { EmptyState, MainContentFullscreenToggle, SidebarHeader, SplitPane } from '../common';
import { Button, ListItem, Search, Toggle } from '../UI';

const { t } = useStrictI18n();
const props = defineProps<{
  mode?: 'full' | 'main-only' | 'side-only';
}>();
const extensionStore = useExtensionStore();

const isBrowserCollapsed = ref(false); // TODO: load from account storage
const notifyOnUpdates = ref(false); // TODO: Connect this to settings
const displayMode = computed(() => props.mode ?? 'full');
const isSideOnly = computed(() => displayMode.value === 'side-only');
const isMainOnly = computed(() => displayMode.value === 'main-only');

function manageExtensions() {
  // TODO: Open manage extensions popup
  alert(t('extensions.managePopupNotImplemented'));
}

function installExtension() {
  // TODO: Open install extension popup
  alert(t('extensions.installPopupNotImplemented'));
}

onMounted(() => {
  if (Object.keys(extensionStore.extensions).length === 0) {
    extensionStore.initializeExtensions();
  }
});
</script>

<template>
  <template v-if="isSideOnly">
    <div class="standalone-pane extensions-panel">
      <SidebarHeader :title="t('navbar.extensions')" class="extensions-panel-header" />
      <div class="sidebar-controls extensions-panel-controls">
        <div class="sidebar-controls__row extensions-panel-controls-row">
          <Button variant="ghost" icon="fa-cubes" :title="t('extensions.manage')" @click="manageExtensions" />
          <Button
            variant="ghost"
            icon="fa-cloud-arrow-down"
            :title="t('extensions.install')"
            @click="installExtension"
          />
          <Toggle v-model="notifyOnUpdates" :title="t('extensions.notifyUpdates')" style="margin-left: auto" />
        </div>
        <Search v-model="extensionStore.searchTerm" :placeholder="t('common.search')" />
      </div>

      <div class="extensions-panel-list">
        <div v-for="extension in extensionStore.filteredExtensions" :key="extension.id">
          <ListItem
            :active="extensionStore.selectedExtensionId === extension.id"
            :data-extension-id="extension.id"
            @click="extensionStore.selectExtension(extension.id)"
          >
            <template #start>
              <i class="fa-solid fa-puzzle-piece" style="opacity: 0.7"></i>
            </template>
            <template #default>
              <div class="font-bold">{{ extension.manifest.display_name || extension.id }}</div>
              <div v-if="extension.manifest.author" style="font-size: 0.8em; opacity: 0.7">
                {{ t('common.by') }} {{ extension.manifest.author }}
              </div>
            </template>
            <template #end>
              <div @click.stop>
                <Toggle
                  :model-value="extension.isActive"
                  @update:model-value="(val) => extensionStore.toggleExtension(extension.id, val)"
                />
              </div>
            </template>
          </ListItem>
        </div>
      </div>
    </div>
  </template>

  <template v-else-if="isMainOnly">
    <div class="standalone-pane extensions-panel">
      <div class="main-page-header">
        <div class="main-page-header-left">
          <MainContentFullscreenToggle />
        </div>
        <div class="main-page-header-main">
          <h3>{{ t('navbar.extensions') }}</h3>
        </div>
        <div class="main-page-header-actions"></div>
      </div>

      <div class="main-page-content">
        <div class="extensions-panel-editor">
          <EmptyState
            v-show="!extensionStore.selectedExtension"
            icon="fa-puzzle-piece"
            :title="t('extensions.placeholder.title')"
            :description="t('extensions.placeholder.text')"
          />

          <template v-for="extension in Object.values(extensionStore.extensions)" :key="extension.id">
            <div v-show="extensionStore.selectedExtensionId === extension.id">
              <div class="extension-content">
                <div class="extension-content-header">
                  <h3>
                    <span>{{ extension.manifest.display_name || extension.id }}</span>
                    <span v-if="extension.manifest.version" class="version">v{{ extension.manifest.version }}</span>
                  </h3>
                </div>
                <p v-if="extension.manifest.description" class="extension-content-description">
                  {{ extension.manifest.description }}
                </p>

                <div :id="extension.containerId"></div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </template>

  <SplitPane
    v-else
    v-model:collapsed="isBrowserCollapsed"
    storage-key="extensionsBrowserWidth"
    :initial-width="250"
    class="extensions-panel"
  >
    <template #side>
      <div class="sidebar-controls extensions-panel-controls">
        <div class="sidebar-controls__row extensions-panel-controls-row">
          <Button variant="ghost" icon="fa-cubes" :title="t('extensions.manage')" @click="manageExtensions" />
          <Button
            variant="ghost"
            icon="fa-cloud-arrow-down"
            :title="t('extensions.install')"
            @click="installExtension"
          />
          <Toggle v-model="notifyOnUpdates" :title="t('extensions.notifyUpdates')" style="margin-left: auto" />
        </div>
        <div class="sidebar-controls__row extensions-panel-controls-row">
          <Search v-model="extensionStore.searchTerm" :placeholder="t('common.search')" />
        </div>
      </div>

      <div class="extensions-panel-list">
        <div v-for="extension in extensionStore.filteredExtensions" :key="extension.id">
          <ListItem
            :active="extensionStore.selectedExtensionId === extension.id"
            :data-extension-id="extension.id"
            @click="extensionStore.selectExtension(extension.id)"
          >
            <template #start>
              <i class="fa-solid fa-puzzle-piece" style="opacity: 0.7"></i>
            </template>
            <template #default>
              <div class="font-bold">{{ extension.manifest.display_name || extension.id }}</div>
              <div v-if="extension.manifest.author" style="font-size: 0.8em; opacity: 0.7">
                {{ t('common.by') }} {{ extension.manifest.author }}
              </div>
            </template>
            <template #end>
              <div @click.stop>
                <Toggle
                  :model-value="extension.isActive"
                  @update:model-value="(val) => extensionStore.toggleExtension(extension.id, val)"
                />
              </div>
            </template>
          </ListItem>
        </div>
      </div>
    </template>

    <template #main>
      <div class="extensions-panel-editor">
        <EmptyState
          v-show="!extensionStore.selectedExtension"
          icon="fa-puzzle-piece"
          :title="t('extensions.placeholder.title')"
          :description="t('extensions.placeholder.text')"
        />

        <template v-for="extension in Object.values(extensionStore.extensions)" :key="extension.id">
          <div v-show="extensionStore.selectedExtensionId === extension.id">
            <div class="extension-content">
              <div class="extension-content-header">
                <h3>
                  <span>{{ extension.manifest.display_name || extension.id }}</span>
                  <span v-if="extension.manifest.version" class="version">v{{ extension.manifest.version }}</span>
                </h3>
              </div>
              <p v-if="extension.manifest.description" class="extension-content-description">
                {{ extension.manifest.description }}
              </p>

              <div :id="extension.containerId"></div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </SplitPane>
</template>

<style scoped>
.font-bold {
  font-weight: bold;
}

.extensions-panel-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.standalone-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--theme-background-tint);
  min-height: 0;
  min-width: 0;
}
</style>
