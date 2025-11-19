<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useExtensionStore } from '../../stores/extension.store';
import { useStrictI18n } from '../../composables/useStrictI18n';
import { useResizable } from '../../composables/useResizable';

const { t } = useStrictI18n();
const extensionStore = useExtensionStore();

const browserPane = ref<HTMLElement | null>(null);
const dividerEl = ref<HTMLElement | null>(null);
const isBrowserCollapsed = ref(false); // TODO: load from account storage

useResizable(browserPane, dividerEl, { storageKey: 'extensions_browser_width', initialWidth: 250 });

const notifyOnUpdates = ref(false); // TODO: Connect this to settings

function manageExtensions() {
  // TODO: Open manage extensions popup
  alert(t('extensions.managePopupNotImplemented'));
}

function installExtension() {
  // TODO: Open install extension popup
  alert(t('extensions.installPopupNotImplemented'));
}

onMounted(() => {
  // Only initialize once
  if (Object.keys(extensionStore.extensions).length === 0) {
    extensionStore.initializeExtensions();
  }
});
</script>

<template>
  <div id="extensions-panel" class="extensions-panel" :class="{ 'is-collapsed': isBrowserCollapsed }">
    <!-- Left Pane: Extension Browser -->
    <div id="extensions-browser" ref="browserPane" class="extensions-panel-browser">
      <div class="extensions-panel-browser-header">
        <div style="display: flex; gap: 5px">
          <div class="menu-button" :title="t('extensions.manage')" @click="manageExtensions">
            <i class="fa-solid fa-cubes"></i>
          </div>
          <div class="menu-button" :title="t('extensions.install')" @click="installExtension">
            <i class="fa-solid fa-cloud-arrow-down"></i>
          </div>
          <label class="checkbox-label" style="margin-left: auto; font-size: 0.9em; cursor: pointer">
            <input v-model="notifyOnUpdates" type="checkbox" />
            <span>{{ t('extensions.notifyUpdates') }}</span>
          </label>
        </div>
        <input v-model="extensionStore.searchTerm" class="text-pole" type="search" :placeholder="t('common.search')" />
      </div>

      <div class="extensions-panel-list">
        <div
          v-for="extension in extensionStore.filteredExtensions"
          :key="extension.id"
          class="extension-item"
          :class="{ 'is-active': extensionStore.selectedExtensionId === extension.id }"
          :data-extension-id="extension.id"
          @click="extensionStore.selectExtension(extension.id)"
        >
          <i class="extension-item-icon fa-solid fa-puzzle-piece"></i>
          <div class="extension-item-content">
            <div class="extension-item-name">{{ extension.manifest.display_name || extension.id }}</div>
            <div v-if="extension.manifest.author" class="extension-item-author">
              {{ t('common.by') }} {{ extension.manifest.author }}
            </div>
          </div>
          <div class="extension-item-actions">
            <label class="toggle-switch" @click.stop>
              <input
                type="checkbox"
                :checked="extension.isActive"
                @change="extensionStore.toggleExtension(extension.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Divider -->
    <div ref="dividerEl" class="extensions-panel-divider">
      <div class="extensions-panel-collapse-toggle" @click="isBrowserCollapsed = !isBrowserCollapsed">
        <i class="fa-solid" :class="isBrowserCollapsed ? 'fa-angles-right' : 'fa-angles-left'"></i>
      </div>
    </div>

    <!-- Right Pane: Editor -->
    <div id="extensions-editor" class="extensions-panel-editor">
      <div v-show="!extensionStore.selectedExtension" class="extensions-panel-placeholder">
        <div class="placeholder-icon fa-solid fa-puzzle-piece"></div>
        <h2 class="placeholder-title">{{ t('extensions.placeholder.title') }}</h2>
        <p>{{ t('extensions.placeholder.text') }}</p>
      </div>

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

            <!-- This is the container where the extension will mount its UI -->
            <div :id="extension.containerId"></div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
