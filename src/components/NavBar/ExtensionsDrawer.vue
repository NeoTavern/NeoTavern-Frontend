<script setup lang="ts">
import { ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useExtensionStore, type Extension } from '../../stores/extension.store';
import { useLayoutStore } from '../../stores/layout.store';
import { EmptyState } from '../common';
import PanelLayout from '../common/PanelLayout.vue';
import { Button, FormItem, ListItem, Search, Toggle } from '../UI';

const { t } = useStrictI18n();
const props = defineProps<{
  mode?: 'full' | 'main-only' | 'side-only';
  title?: string;
}>();
const extensionStore = useExtensionStore();
const layoutStore = useLayoutStore();

const isBrowserCollapsed = ref(false); // TODO: load from account storage
const notifyOnUpdates = ref(false); // TODO: Connect this to settings

function manageExtensions() {
  // TODO: Open manage extensions popup
  alert(t('extensions.managePopupNotImplemented'));
}

function installExtension() {
  // TODO: Open install extension popup
  alert(t('extensions.installPopupNotImplemented'));
}

function handleExtensionSelect(extension: Extension) {
  extensionStore.selectExtension(extension.id);
  layoutStore.autoCloseSidebarsOnMobile();
}
</script>

<template>
  <PanelLayout
    v-model:collapsed="isBrowserCollapsed"
    :mode="props.mode"
    :title="props.title ?? t('navbar.extensions')"
    storage-key="extensionsBrowserWidth"
    :initial-width="250"
    class="extensions-panel"
  >
    <template #side>
      <div class="sidebar-controls extensions-panel-controls">
        <div class="sidebar-controls-row extensions-panel-controls-row">
          <Button variant="ghost" icon="fa-cubes" :title="t('extensions.manage')" @click="manageExtensions" />
          <Button
            variant="ghost"
            icon="fa-cloud-arrow-down"
            :title="t('extensions.install')"
            @click="installExtension"
          />
          <FormItem>
            <Toggle v-model="notifyOnUpdates" :title="t('extensions.notifyUpdates')" style="margin-left: auto" />
          </FormItem>
        </div>
        <div class="sidebar-controls-row extensions-panel-controls-row">
          <Search v-model="extensionStore.searchTerm" :placeholder="t('common.search')" />
        </div>
      </div>

      <div class="extensions-panel-list">
        <div v-for="extension in extensionStore.filteredExtensions" :key="extension.id">
          <ListItem
            :active="extensionStore.selectedExtensionId === extension.id"
            :data-extension-id="extension.id"
            @click="handleExtensionSelect(extension)"
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
  </PanelLayout>
</template>
