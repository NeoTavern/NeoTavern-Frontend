<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useExtensionStore, type Extension } from '../../stores/extension.store';
import { useLayoutStore } from '../../stores/layout.store';
import { useSettingsStore } from '../../stores/settings.store';
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
const settingsStore = useSettingsStore();

const notifyOnUpdates = ref(false); // TODO: Connect this to settings
const isBrowserCollapsed = computed({
  get: () => settingsStore.settings.account.extensionsBrowserExpanded,
  set: (value) => (settingsStore.settings.account.extensionsBrowserExpanded = value),
});

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

function handleClose() {
  layoutStore.activateNavBarItem('chat');
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
    <template #main-header-actions>
      <div class="sidebar-mobile-header">
        <Button icon="fa-xmark" variant="ghost" @click="handleClose" />
      </div>
    </template>
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
              <i :class="extension.manifest.icon ?? 'fa-solid fa-puzzle-piece'" style="opacity: 0.7"></i>
            </template>
            <template #default>
              <div class="font-bold">{{ extensionStore.getExtensionDisplayName(extension) }}</div>
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
                  <span>{{ extensionStore.getExtensionDisplayName(extension) }}</span>
                  <span v-if="extension.manifest.version" class="version">v{{ extension.manifest.version }}</span>
                </h3>
              </div>
              <p v-if="extensionStore.getExtensionDescription(extension)" class="extension-content-description">
                {{ extensionStore.getExtensionDescription(extension) }}
              </p>

              <div :id="extension.containerId"></div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </PanelLayout>
</template>
